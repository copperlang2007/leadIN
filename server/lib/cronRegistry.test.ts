import { describe, it, expect, vi } from "vitest";

// node-cron actually starts a timer when `schedule` is called. We don't want
// that in unit tests — just record the call and return a stub task handle.
vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })),
  },
}));

import { registerCron, listCronJobs } from "./cronRegistry";

describe("cronRegistry", () => {
  it("records registered jobs so listCronJobs reflects them", () => {
    const before = listCronJobs().length;

    registerCron({
      name: "test-job-alpha",
      schedule: "*/5 * * * *",
      fn: async () => {},
    });

    const after = listCronJobs();
    expect(after.length).toBe(before + 1);
    const job = after.find((j) => j.name === "test-job-alpha");
    expect(job).toBeDefined();
    expect(job?.schedule).toBe("*/5 * * * *");
  });

  it("returns metadata without exposing the function reference", () => {
    registerCron({
      name: "test-job-beta",
      schedule: "0 0 * * *",
      fn: async () => {},
    });

    const job = listCronJobs().find((j) => j.name === "test-job-beta");
    expect(job).toBeDefined();
    expect(Object.keys(job ?? {}).sort()).toEqual(["name", "schedule"]);
  });
});
