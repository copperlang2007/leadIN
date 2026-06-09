import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import type { Request, Response } from "express";
import { requestLogger, type RequestLogLine } from "./requestLogger.js";

function mockReqRes(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  status?: number;
  user?: any;
} = {}) {
  const req = {
    method: opts.method ?? "GET",
    path: opts.path ?? "/api/ping",
    originalUrl: opts.path ?? "/api/ping",
    url: opts.path ?? "/api/ping",
    headers: opts.headers ?? {},
    user: opts.user,
  } as unknown as Request;

  const emitter = new EventEmitter();
  const headers: Record<string, string> = {};
  const res = Object.assign(emitter, {
    statusCode: opts.status ?? 200,
    locals: {},
    getHeader: (k: string) => headers[k.toLowerCase()],
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    headers,
  }) as unknown as Response;

  return { req, res, headers };
}

describe("requestLogger middleware", () => {
  it("emits one structured line on response finish", () => {
    const lines: RequestLogLine[] = [];
    const mw = requestLogger({ sink: (l) => lines.push(l) });
    const { req, res, headers } = mockReqRes({ status: 200 });
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(typeof (res.locals as any).requestId).toBe("string");
    expect(headers["x-request-id"]).toBeTruthy();
    (res as any).emit("finish");
    expect(lines).toHaveLength(1);
    expect(lines[0].method).toBe("GET");
    expect(lines[0].path).toBe("/api/ping");
    expect(lines[0].status).toBe(200);
    expect(lines[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(lines[0].requestId).toBe(headers["x-request-id"]);
  });

  it("honors inbound X-Request-Id header", () => {
    const lines: RequestLogLine[] = [];
    const mw = requestLogger({ sink: (l) => lines.push(l) });
    const { req, res, headers } = mockReqRes({
      headers: { "x-request-id": "trace-abc-123" },
    });
    mw(req, res, () => {});
    expect(headers["x-request-id"]).toBe("trace-abc-123");
    (res as any).emit("finish");
    expect(lines[0].requestId).toBe("trace-abc-123");
  });

  it("captures non-2xx status and userId", () => {
    const lines: RequestLogLine[] = [];
    const mw = requestLogger({ sink: (l) => lines.push(l) });
    const { req, res } = mockReqRes({
      status: 500,
      user: { claims: { sub: "user-7" } },
    });
    mw(req, res, () => {});
    (res as any).emit("finish");
    expect(lines[0].status).toBe(500);
    expect(lines[0].userId).toBe("user-7");
  });

  it("respects filter predicate", () => {
    const lines: RequestLogLine[] = [];
    const mw = requestLogger({
      sink: (l) => lines.push(l),
      filter: (r) => r.path.startsWith("/api"),
    });
    const { req: req1, res: res1 } = mockReqRes({ path: "/healthz" });
    mw(req1, res1, () => {});
    (res1 as any).emit("finish");
    const { req: req2, res: res2 } = mockReqRes({ path: "/api/leads" });
    mw(req2, res2, () => {});
    (res2 as any).emit("finish");
    expect(lines).toHaveLength(1);
    expect(lines[0].path).toBe("/api/leads");
  });
});
