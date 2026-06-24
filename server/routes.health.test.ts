// Handler-level tests for the split health endpoints. Public /api/health
// must leak nothing beyond {status}; admin /api/admin/health stays the
// detailed view but is gated by isAuthenticated + admin role.
//
// We exercise the exported handlers (publicHealthHandler, adminHealthHandler)
// directly against a tiny express-shaped req/res stub. `db`, `storage`, and
// `websocket` are mocked at the module level; `takeToken` is the real
// in-memory rate limiter — we use unique keys per test (via unique IPs) so
// runs don't bleed buckets into each other.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ./db so the SELECT 1 liveness probe is deterministic. Individual
// tests can flip `dbExecuteImpl` to simulate a degraded DB.
let dbExecuteImpl: () => Promise<unknown> = async () => ({ rows: [] });
vi.mock("./db", () => ({
  db: {
    execute: vi.fn((..._args: unknown[]) => dbExecuteImpl()),
  },
}));

// Mock ./storage so we control the role returned by the admin gate.
let storageUserImpl: (id: string) => Promise<{ role?: string } | undefined> =
  async () => ({ role: "admin" });
vi.mock("./storage", () => ({
  storage: {
    getUser: vi.fn((id: string) => storageUserImpl(id)),
  },
}));

// Mock ./websocket so getActiveConnections is stable + we don't pull in the
// real ws server module graph.
vi.mock("./websocket", () => ({
  setupWebSocket: vi.fn(),
  broadcastNewLead: vi.fn(),
  broadcastLeadAssignment: vi.fn(),
  getActiveConnections: vi.fn(() => 7),
}));

// Force the in-memory rate-limit backend so we don't depend on Redis in CI.
import {
  __setForceMemoryForTests,
  __resetForTests,
} from "./rateLimit";

// Import the handlers AFTER vi.mock so the mocks are wired in.
import { publicHealthHandler, adminHealthHandler } from "./routes";

// ──────────────────────────────────────────────────────
// Tiny express-shaped req/res helpers
// ──────────────────────────────────────────────────────
interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function makeRes(): { res: any; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: undefined };
  const res: any = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      captured.body = payload;
      return res;
    },
  };
  return { res, captured };
}

function makeReq(opts: { ip?: string; userId?: string } = {}): any {
  return {
    ip: opts.ip ?? "10.0.0.1",
    socket: { remoteAddress: opts.ip ?? "10.0.0.1" },
    user: opts.userId ? { claims: { sub: opts.userId } } : undefined,
  };
}

// Each test uses a unique IP so the per-IP token bucket is fresh.
let testCounter = 0;
function uniqueIp(): string {
  testCounter += 1;
  return `10.99.${(testCounter >> 8) & 0xff}.${testCounter & 0xff}`;
}

beforeEach(() => {
  __setForceMemoryForTests(true);
  __resetForTests();
  dbExecuteImpl = async () => ({ rows: [{ "?column?": 1 }] });
  storageUserImpl = async () => ({ role: "admin" });
});

// ──────────────────────────────────────────────────────
// Public /api/health
// ──────────────────────────────────────────────────────

describe("publicHealthHandler", () => {
  it("returns 200 with ONLY {status: 'ok'} on a healthy DB (no uptime / ws leak)", async () => {
    const { res, captured } = makeRes();
    await publicHealthHandler(makeReq({ ip: uniqueIp() }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ status: "ok" });
    // Belt-and-suspenders: explicitly assert the deploy-fingerprint fields
    // are absent from the public response.
    const body = captured.body as Record<string, unknown>;
    expect(body.uptimeSec).toBeUndefined();
    expect(body.dbLatencyMs).toBeUndefined();
    expect(body.wsConnections).toBeUndefined();
    expect(body.nodeVersion).toBeUndefined();
  });

  it("returns 503 {status: 'degraded'} when the DB throws", async () => {
    dbExecuteImpl = async () => {
      throw new Error("connection refused");
    };
    const { res, captured } = makeRes();
    await publicHealthHandler(makeReq({ ip: uniqueIp() }), res);

    expect(captured.statusCode).toBe(503);
    expect(captured.body).toEqual({ status: "degraded" });
  });

  it("returns 429 {status: 'rate_limited'} after exhausting the per-IP bucket", async () => {
    const ip = uniqueIp();
    // Bucket is 60 capacity; the 61st request in a tight loop should 429
    // because the refill is only 1 token/sec.
    for (let i = 0; i < 60; i++) {
      const { res } = makeRes();
      await publicHealthHandler(makeReq({ ip }), res);
    }
    const { res, captured } = makeRes();
    await publicHealthHandler(makeReq({ ip }), res);

    expect(captured.statusCode).toBe(429);
    expect(captured.body).toEqual({ status: "rate_limited" });
  });

  it("isolates rate-limit buckets per IP", async () => {
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    // Drain ipA.
    for (let i = 0; i < 60; i++) {
      const { res } = makeRes();
      await publicHealthHandler(makeReq({ ip: ipA }), res);
    }
    // ipB should still be allowed.
    const { res, captured } = makeRes();
    await publicHealthHandler(makeReq({ ip: ipB }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ status: "ok" });
  });
});

// ──────────────────────────────────────────────────────
// Admin /api/admin/health
// ──────────────────────────────────────────────────────

describe("adminHealthHandler", () => {
  it("returns 403 when the caller is not an admin", async () => {
    storageUserImpl = async () => ({ role: "agent" });
    const { res, captured } = makeRes();
    await adminHealthHandler(makeReq({ userId: "u-agent" }), res);

    expect(captured.statusCode).toBe(403);
    expect(captured.body).toEqual({ message: "Admin access required" });
  });

  it("returns 403 when the user record is missing entirely", async () => {
    storageUserImpl = async () => undefined;
    const { res, captured } = makeRes();
    await adminHealthHandler(makeReq({ userId: "u-ghost" }), res);

    expect(captured.statusCode).toBe(403);
  });

  it("returns 200 with the full detailed view for an admin", async () => {
    storageUserImpl = async () => ({ role: "admin" });
    const { res, captured } = makeRes();
    await adminHealthHandler(makeReq({ userId: "u-admin" }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.uptimeSec).toBe("number");
    expect(typeof body.dbLatencyMs).toBe("number");
    expect(body.wsConnections).toBe(7);
    expect(body.nodeVersion).toBe(process.version);
    // commit + environment always present so ops can identify
    // the deploy without having to chase the response shape.
    expect(typeof body.commit).toBe("string");
    expect(typeof body.environment).toBe("string");
  });

  it("includes the 7-char git SHA when GIT_COMMIT_SHA is set", async () => {
    const saved = process.env.GIT_COMMIT_SHA;
    process.env.GIT_COMMIT_SHA = "abc1234567890def1234567890abcdef12345678";
    try {
      storageUserImpl = async () => ({ role: "admin" });
      const { res, captured } = makeRes();
      await adminHealthHandler(makeReq({ userId: "u-admin" }), res);
      const body = captured.body as Record<string, unknown>;
      expect(body.commit).toBe("abc1234");
    } finally {
      if (saved !== undefined) process.env.GIT_COMMIT_SHA = saved;
      else delete process.env.GIT_COMMIT_SHA;
    }
  });

  it("falls back to 'unknown' for commit when no CI env var is set", async () => {
    const saved = {
      git: process.env.GIT_COMMIT_SHA,
      railway: process.env.RAILWAY_GIT_COMMIT_SHA,
      vercel: process.env.VERCEL_GIT_COMMIT_SHA,
    };
    delete process.env.GIT_COMMIT_SHA;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    try {
      storageUserImpl = async () => ({ role: "admin" });
      const { res, captured } = makeRes();
      await adminHealthHandler(makeReq({ userId: "u-admin" }), res);
      const body = captured.body as Record<string, unknown>;
      expect(body.commit).toBe("unknown");
    } finally {
      if (saved.git !== undefined) process.env.GIT_COMMIT_SHA = saved.git;
      if (saved.railway !== undefined) process.env.RAILWAY_GIT_COMMIT_SHA = saved.railway;
      if (saved.vercel !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = saved.vercel;
    }
  });

  it("returns 503 with a degraded payload when the DB throws (admin still sees uptime)", async () => {
    dbExecuteImpl = async () => {
      throw new Error("connection refused");
    };
    storageUserImpl = async () => ({ role: "admin" });
    const { res, captured } = makeRes();
    await adminHealthHandler(makeReq({ userId: "u-admin" }), res);

    expect(captured.statusCode).toBe(503);
    const body = captured.body as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.error).toBe("db_unreachable");
    expect(typeof body.uptimeSec).toBe("number");
  });
});
