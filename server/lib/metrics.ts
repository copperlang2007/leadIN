// Minimal in-memory metrics counter.
//
// Volume of dashboards we currently need is tiny (request counts by
// route, cron success/fail counters, a handful of business events) and
// an in-process map is good enough. The exported snapshot is plain JSON
// so `/api/admin/metrics` can serve it directly without a scraper.

export type Tags = Record<string, string | number | boolean | undefined>;

interface CounterEntry {
  name: string;
  tags: Record<string, string>;
  count: number;
}

const counters = new Map<string, CounterEntry>();

function encodeTags(tags: Tags | undefined): { key: string; clean: Record<string, string> } {
  if (!tags || Object.keys(tags).length === 0) return { key: "", clean: {} };
  const entries = Object.entries(tags)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const clean: Record<string, string> = Object.fromEntries(entries);
  const key = entries.map(([k, v]) => `${k}=${v}`).join(",");
  return { key, clean };
}

export function recordCounter(name: string, tags?: Tags, delta = 1): void {
  const { key, clean } = encodeTags(tags);
  const fullKey = key ? `${name}|${key}` : name;
  const existing = counters.get(fullKey);
  if (existing) {
    existing.count += delta;
    return;
  }
  counters.set(fullKey, { name, tags: clean, count: delta });
}

export interface MetricsSnapshot {
  ts: string;
  counters: Array<{ name: string; tags: Record<string, string>; count: number }>;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    ts: new Date().toISOString(),
    counters: Array.from(counters.values()).map((c) => ({ ...c })),
  };
}

export function __resetMetricsForTests(): void {
  counters.clear();
}
