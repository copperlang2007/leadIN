// Structured per-request access log middleware.
//
// Emits one JSON line per /api response with the canonical fields a log
// pipeline (Loki / Datadog / CloudWatch) can index. Generates a request
// ID per request and stashes it on `res.locals.requestId` so downstream
// handlers can echo it back to the client or include it in their own
// log lines.
//
// We deliberately do NOT log request bodies — they may contain
// passwords, Stripe tokens, API keys, and PII.

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export interface RequestLogLine {
  ts: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  userId?: string;
  tenantId?: string;
}

export interface RequestLoggerOptions {
  sink?: (line: RequestLogLine) => void;
  filter?: (req: Request) => boolean;
}

function defaultSink(line: RequestLogLine): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function requestLogger(opts: RequestLoggerOptions = {}) {
  const sink = opts.sink ?? defaultSink;
  const filter = opts.filter ?? (() => true);
  return function requestLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const start = Date.now();
    const incoming = String(req.headers["x-request-id"] ?? "").trim();
    const requestId = incoming.length > 0 && incoming.length <= 64
      ? incoming
      : crypto.randomUUID();
    res.locals.requestId = requestId;
    if (!res.getHeader("X-Request-Id")) {
      res.setHeader("X-Request-Id", requestId);
    }
    res.on("finish", () => {
      if (!filter(req)) return;
      const userId =
        (req as any).user?.claims?.sub ||
        (req as any).user?.id ||
        undefined;
      const tenantId =
        (req as any).tenantId ||
        (req as any).user?.tenantId ||
        undefined;
      const line: RequestLogLine = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        requestId,
        ...(userId ? { userId: String(userId) } : {}),
        ...(tenantId ? { tenantId: String(tenantId) } : {}),
      };
      try {
        sink(line);
      } catch {
        // Logging must never crash the response.
      }
    });
    next();
  };
}
