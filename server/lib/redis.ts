// Lazy Redis client. Returns null when REDIS_URL is unset so call sites can
// gracefully degrade. We import dynamically so the dep is optional —
// installs that don't need Redis can skip the package.
//
// Used by: distributed rate limiter (Wave 1, S2), cron leader election
// (alternative path; the primary path uses PG advisory locks), session
// caches, etc.

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  quit(): Promise<unknown>;
};

let client: RedisClient | null = null;
let connectAttempted = false;

export async function getRedis(): Promise<RedisClient | null> {
  if (client) return client;
  if (connectAttempted) return null;
  connectAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[redis] REDIS_URL not set — running in single-instance mode");
    return null;
  }

  try {
    // 'redis' is an optional dep; only installed when distributed mode is needed.
    // @ts-ignore — dynamic import, module may not be present
    const mod: any = await import("redis").catch(() => null);
    if (!mod) {
      console.warn("[redis] 'redis' package not installed; skipping");
      return null;
    }
    const c = mod.createClient({ url });
    c.on("error", (err: any) => console.error("[redis] error:", err?.message));
    await c.connect();
    client = c as RedisClient;
    return client;
  } catch (err: any) {
    console.warn("[redis] connect failed:", err?.message);
    return null;
  }
}

export function hasRedis(): boolean {
  return client !== null;
}
