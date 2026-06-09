import { describe, it, expect, beforeEach } from "vitest";
import {
  recordCounter,
  getMetricsSnapshot,
  __resetMetricsForTests,
} from "./metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("increments by 1 by default", () => {
    recordCounter("requests");
    recordCounter("requests");
    recordCounter("requests");
    const snap = getMetricsSnapshot();
    expect(snap.counters).toHaveLength(1);
    expect(snap.counters[0]).toMatchObject({ name: "requests", count: 3 });
  });

  it("buckets by tag set with stable key", () => {
    recordCounter("http", { route: "/api/leads", status: 200 });
    recordCounter("http", { status: 200, route: "/api/leads" });
    recordCounter("http", { route: "/api/leads", status: 500 });
    const snap = getMetricsSnapshot();
    const entries = snap.counters.filter((c) => c.name === "http");
    expect(entries).toHaveLength(2);
    const ok = entries.find((e) => e.tags.status === "200");
    const err = entries.find((e) => e.tags.status === "500");
    expect(ok?.count).toBe(2);
    expect(err?.count).toBe(1);
  });

  it("accepts a delta", () => {
    recordCounter("bytes", { dir: "out" }, 1024);
    recordCounter("bytes", { dir: "out" }, 256);
    const snap = getMetricsSnapshot();
    expect(snap.counters[0].count).toBe(1280);
  });

  it("snapshot has a timestamp", () => {
    const snap = getMetricsSnapshot();
    expect(snap.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
