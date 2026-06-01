import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { broadcastNewLead, closeAllSockets } from "./websocket";
import { csrfMiddleware } from "./csrf";
import { log as logger, newRequestId } from "./logger";
import { closePool } from "./db";
import { createShutdownHandler } from "./shutdown";
export { createShutdownHandler } from "./shutdown";
export type { ShutdownDeps } from "./shutdown";

const app = express();
const httpServer = createServer(app);

// Request-ID middleware: every request gets a short id we can grep across
// logs. Honors an inbound X-Request-Id header so a frontend trace can
// propagate end-to-end.
app.use((req, res, next) => {
  const incoming = String(req.headers["x-request-id"] ?? "").slice(0, 32);
  const reqId = incoming || newRequestId();
  (req as any).reqId = reqId;
  res.setHeader("X-Request-Id", reqId);
  next();
});

// Security headers. CSP is left in report-only-friendly defaults for the
// frontend; tighten in prod once the asset pipeline is locked.
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// 256 KB request body cap. The `verify` callback captures the raw bytes so
// the Stripe webhook can recompute its signature against the unparsed body.
// Oversized requests are rejected by express with HTTP 413 before the
// verify callback runs, so we don't risk holding huge payloads in memory.
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// CSRF: applied globally, exempts webhook + API-key + login redirect paths.
app.use(csrfMiddleware);

// Re-export the structured logger as `log` so legacy callers keep working,
// but interpret a single-string call as an `info` message.
export function log(message: string, source = "express") {
  logger.info(message, { source });
}

// Recursively redact PII keys from any nested JSON structure before logging
function redactPII(obj: any, piiKeys: Set<string>): any {
  if (Array.isArray(obj)) {
    return obj.map(item => redactPII(item, piiKeys));
  }
  if (obj !== null && typeof obj === "object") {
    const redacted: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      redacted[k] = piiKeys.has(k) ? "[REDACTED]" : redactPII(v, piiKeys);
    }
    return redacted;
  }
  return obj;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const PII_KEYS = new Set(["consumerName", "consumerPhone", "consumerEmail", "consumerAddress"]);
      const body = capturedJsonResponse ? redactPII(capturedJsonResponse, PII_KEYS) : undefined;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level]("http", {
        reqId: (req as any).reqId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
        ...(body ? { body } : {}),
      });
    }
  });

  next();
});

// Graceful shutdown. On SIGTERM / SIGINT we stop accepting new connections,
// close any open WebSockets, then close the PG pool. We give ourselves at
// most 15 seconds before forcing exit so a stuck connection cannot keep the
// process alive indefinitely. A second signal short-circuits to exit(1).
function installShutdownHandlers(): void {
  const handler = createShutdownHandler({
    httpServer,
    closeAllSockets: () => closeAllSockets(),
    closePool,
    exit: (code) => process.exit(code),
    log: (m) => log(m),
  });
  process.on("SIGTERM", () => { void handler(); });
  process.on("SIGINT", () => { void handler(); });
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  installShutdownHandlers();

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);

      // Broadcast seed/existing leads once the WebSocket server is ready.
      // Leads ingested via POST /api/v1/leads/ingest broadcast inline.
      // This startup broadcast ensures seed data appears in the real-time feed.
      try {
        const seedLeads = await storage.getLeads({ soldOnly: false });
        const toEmit = seedLeads.slice(0, 20);
        for (const lead of toEmit) {
          broadcastNewLead({
            id: lead.id,
            type: lead.type,
            state: lead.state,
            zipCode: lead.zipCode,
            price: lead.price,
            exclusivity: lead.exclusivity,
            verified: lead.verified,
            vendorName: lead.vendor?.name ?? "Unknown",
            createdAt: lead.createdAt ? lead.createdAt.toISOString() : null,
          });
        }
        if (toEmit.length > 0) {
          log(`Broadcasted ${toEmit.length} existing leads on startup`);
        }
      } catch (err) {
        log(`Startup lead broadcast skipped: ${err}`);
      }
    },
  );
})();
