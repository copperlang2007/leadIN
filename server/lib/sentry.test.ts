import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initSentry,
  captureException,
  captureMessage,
  __resetSentryForTests,
  __isSentryActiveForTests,
} from "./sentry.js";

describe("sentry no-op when DSN unset", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    __resetSentryForTests();
  });
  afterEach(() => {
    if (saved !== undefined) process.env.SENTRY_DSN = saved;
    __resetSentryForTests();
  });

  it("initSentry resolves without loading the SDK", async () => {
    await initSentry();
    expect(__isSentryActiveForTests()).toBe(false);
  });

  it("captureException is a no-op and does not throw", async () => {
    await initSentry();
    expect(() => captureException(new Error("boom"), { userId: "u1" })).not.toThrow();
  });

  it("captureMessage is a no-op and does not throw", async () => {
    await initSentry();
    expect(() => captureMessage("hello", "info")).not.toThrow();
  });

  it("calling capture* before init is safe", () => {
    expect(() => captureException(new Error("pre-init"))).not.toThrow();
    expect(() => captureMessage("pre-init", "warning")).not.toThrow();
  });
});
