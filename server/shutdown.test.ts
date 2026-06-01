import { describe, it, expect, vi } from "vitest";
import { createShutdownHandler } from "./index";
import { closeAllSockets } from "./websocket";

describe("createShutdownHandler", () => {
  function makeDeps(overrides: Partial<Parameters<typeof createShutdownHandler>[0]> = {}) {
    const httpServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        // Synchronously signal drained
        cb?.();
      }),
    };
    const closeSocketsFn = vi.fn();
    const closePoolFn = vi.fn(async () => {});
    const exit = vi.fn();
    const log = vi.fn();
    const deps = {
      httpServer,
      closeAllSockets: closeSocketsFn,
      closePool: closePoolFn,
      exit,
      log,
      timeoutMs: 50,
      ...overrides,
    };
    return { deps, httpServer, closeSocketsFn, closePoolFn, exit, log };
  }

  it("runs the full shutdown sequence in order", async () => {
    const { deps, httpServer, closeSocketsFn, closePoolFn, exit, log } = makeDeps();
    const handler = createShutdownHandler(deps);

    await handler();

    expect(log).toHaveBeenCalledWith("shutting down, draining for up to 15s");
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(closeSocketsFn).toHaveBeenCalledTimes(1);
    expect(closePoolFn).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is idempotent: second call exits with code 1 and does not re-run", async () => {
    const { deps, httpServer, closePoolFn, exit } = makeDeps();
    const handler = createShutdownHandler(deps);

    await handler();
    await handler();

    // First call exits 0; second call exits 1 without re-closing things
    expect(exit).toHaveBeenNthCalledWith(1, 0);
    expect(exit).toHaveBeenNthCalledWith(2, 1);
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(closePoolFn).toHaveBeenCalledTimes(1);
  });

  it("forces resolution after timeoutMs if httpServer.close never fires its callback", async () => {
    const httpServer = { close: vi.fn(() => {}) }; // never invokes the callback
    const closePoolFn = vi.fn(async () => {});
    const exit = vi.fn();
    const handler = createShutdownHandler({
      httpServer,
      closeAllSockets: vi.fn(),
      closePool: closePoolFn,
      exit,
      log: vi.fn(),
      timeoutMs: 25,
    });

    await handler();

    expect(closePoolFn).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still exits cleanly if closePool throws", async () => {
    const { deps, exit } = makeDeps({
      closePool: vi.fn(async () => { throw new Error("boom"); }),
    });
    const handler = createShutdownHandler(deps);
    await handler();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("closeAllSockets", () => {
  it("calls close(1001, 'shutdown') on every tracked client", () => {
    const c1 = { close: vi.fn() };
    const c2 = { close: vi.fn() };
    const c3 = { close: vi.fn() };
    closeAllSockets({ clients: [c1, c2, c3] });
    expect(c1.close).toHaveBeenCalledWith(1001, "shutdown");
    expect(c2.close).toHaveBeenCalledWith(1001, "shutdown");
    expect(c3.close).toHaveBeenCalledWith(1001, "shutdown");
  });

  it("is a no-op when the server is null", () => {
    expect(() => closeAllSockets(null)).not.toThrow();
  });

  it("swallows per-client errors so one bad socket does not block the rest", () => {
    const bad = { close: vi.fn(() => { throw new Error("nope"); }) };
    const good = { close: vi.fn() };
    closeAllSockets({ clients: [bad, good] });
    expect(good.close).toHaveBeenCalledWith(1001, "shutdown");
  });
});
