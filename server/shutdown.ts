// Graceful shutdown plumbing. Extracted from server/index.ts so it can be
// unit-tested without booting the express app or opening the PG pool.
//
// On SIGTERM / SIGINT we want to:
//   1. stop accepting new HTTP connections
//   2. close any open WebSockets with code 1001 ("going away")
//   3. drain in-flight requests (with a hard 15s ceiling)
//   4. close the PG pool
//   5. exit(0)
//
// A second signal should not re-run the sequence — it should force exit(1)
// so a stuck shutdown can be unstuck by impatient operators / orchestrators.

export interface ShutdownDeps {
  httpServer: { close: (cb?: (err?: Error) => void) => void };
  closeAllSockets: () => void;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  timeoutMs?: number;
}

export function createShutdownHandler(deps: ShutdownDeps): () => Promise<void> {
  let shuttingDown = false;
  const {
    httpServer: server,
    closeAllSockets: closeSockets,
    closePool: closePoolFn,
    exit,
    log: logFn = () => {},
    timeoutMs = 15_000,
  } = deps;

  return async function shutdown(): Promise<void> {
    if (shuttingDown) {
      // Second signal: bail out immediately.
      exit(1);
      return;
    }
    shuttingDown = true;
    logFn("shutting down, draining for up to 15s");

    // Stop accepting new HTTP connections and wait for in-flight to finish
    // or for the deadline to elapse, whichever happens first.
    const drained = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        server.close(() => finish());
      } catch {
        finish();
      }
      const t = setTimeout(finish, timeoutMs);
      // Don't keep the event loop alive just for the timeout.
      t.unref?.();
    });

    // Close WebSockets in parallel with the HTTP drain so clients hear the
    // 1001 right away instead of waiting for sockets to time out.
    try {
      closeSockets();
    } catch {
      // best-effort
    }

    await drained;

    try {
      await closePoolFn();
    } catch {
      // best-effort
    }

    exit(0);
  };
}
