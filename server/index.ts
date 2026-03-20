import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { broadcastNewLead } from "./websocket";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
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
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Redact PII fields before logging to prevent sensitive data exposure
        const PII_KEYS = new Set(["consumerName", "consumerPhone", "consumerEmail", "consumerAddress"]);
        const redacted = redactPII(capturedJsonResponse, PII_KEYS);
        logLine += ` :: ${JSON.stringify(redacted)}`;
      }

      log(logLine);
    }
  });

  next();
});

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
