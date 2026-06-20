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
import { redactPii } from "@shared/pii";
import { initSentry, captureException } from "./lib/sentry";
import { validateEnv, formatResult } from "./lib/envValidation";
import { safeError } from "./lib/safeError";
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

// Permissions-Policy (formerly Feature-Policy) — explicitly deny the
// browser features the app doesn't use. If a compromised script ever
// tries to access camera / microphone / geolocation / payment, the
// browser refuses at the platform layer instead of relying on the
// script's own restraint.
//
// Notes on each entry:
//   - accelerometer / gyroscope / magnetometer: motion sensors,
//     used for AR / VR / fitness tracking. Not relevant here.
//   - camera / microphone: the dialer uses Twilio Voice which dials
//     out over WebRTC initiated by Twilio's iframe, not the host
//     page. We never need direct getUserMedia on this origin.
//   - geolocation: lead territory selection uses zip codes, not
//     browser geolocation.
//   - payment: Stripe Checkout opens its own hosted page; the
//     Payment Request API on this origin would only be useful if
//     we shipped an in-page checkout (we don't).
//   - usb / bluetooth / serial / hid: hardware device APIs.
//
// `interest-cohort` ends the page's automatic enrollment in
// Google's FLoC / Topics behavioural-advertising cohort — privacy
// signal for our consumer-data audience.
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "bluetooth=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "interest-cohort=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
});

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

// Shape the access-log payload for an /api response. Extracted so the
// redaction wiring can be unit-tested without standing up express.
export interface AccessLogInput {
  reqId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  capturedJsonResponse: Record<string, any> | undefined;
}

export interface AccessLogPayload {
  level: "info" | "warn" | "error";
  fields: {
    reqId: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    body?: any;
  };
}

export function buildAccessLog(input: AccessLogInput): AccessLogPayload {
  const body = input.capturedJsonResponse ? redactPii(input.capturedJsonResponse) : undefined;
  const level: AccessLogPayload["level"] =
    input.status >= 500 ? "error" : input.status >= 400 ? "warn" : "info";
  return {
    level,
    fields: {
      reqId: input.reqId,
      method: input.method,
      path: input.path,
      status: input.status,
      durationMs: input.durationMs,
      ...(body ? { body } : {}),
    },
  };
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
      const { level, fields } = buildAccessLog({
        reqId: (req as any).reqId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
        capturedJsonResponse,
      });
      logger[level]("http", fields);
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
  // Prod-env validator runs FIRST, before anything else can read a
  // misconfigured secret. In production we hard-fail on any missing
  // required var so the orchestrator restarts us with config instead
  // of letting a partially-configured pod take real traffic. In dev /
  // CI we just surface the diagnostics and keep going so the existing
  // test stubs (vitest.setup.ts pre-fills DATABASE_URL etc.) still work.
  const envCheck = validateEnv();
  if (envCheck.missing.length > 0 || envCheck.warnings.length > 0) {
    console.log(formatResult(envCheck));
  }
  if (envCheck.isProd && !envCheck.ok) {
    throw new Error(
      `prod-env validator: ${envCheck.missing.length} required env var(s) missing — refusing to start`,
    );
  }

  // Initialise Sentry as early as possible so any error during route
  // registration or vite setup is reported. No-op when SENTRY_DSN is unset.
  await initSentry();

  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Report 5xx errors to Sentry (no-op when unconfigured). 4xx errors
    // are usually client mistakes, not server bugs — don't flood the dashboard.
    if (status >= 500) {
      captureException(err, { req });
    }

    // Log the error with PII stripped (phone/SSN/email patterns). Sentry
    // gets the full structured event with its own scrubbers; this stderr
    // line is for operators tailing logs without leaking consumer PII to
    // any log shipper downstream. Stack only in non-prod — production
    // already has Sentry for the full trace and stack lines are the most
    // common vector for embedded paths/identifiers.
    const isProd = process.env.NODE_ENV === "production";
    console.error("[uncaught]", safeError(err, { includeStack: !isProd }));

    // For 5xx responses, return a generic message instead of err.message —
    // that string can embed values from a duplicate-key violation or a
    // 3rd-party API error body, and goes back to the client. 4xx messages
    // are intentional caller-facing text (`throw new Error("Lead not found")`)
    // and stay as-is so the API surface doesn't regress.
    const message = status >= 500
      ? "Internal Server Error"
      : (err.message || "Bad Request");
    res.status(status).json({ message });
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
