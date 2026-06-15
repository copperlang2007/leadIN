// Shared utilities for the verify:* scripts.
//
// Each verify-<service>.ts script runs ONE network call against a real
// external service to confirm a credential / configuration actually
// works in production. Sharing the result shape + colored output here
// so the scripts stay consistent and `verify:all` can compose them.

export type CheckOutcome = "pass" | "fail" | "skip";

export interface VerifyResult {
  service: string;
  outcome: CheckOutcome;
  detail: string;
}

const isTty = process.stdout.isTTY;
const c = (code: string, s: string) => (isTty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const icon = {
  pass: c("32", "✅"),
  fail: c("31", "❌"),
  skip: c("33", "⏭ "),
};

export function formatResult(r: VerifyResult): string {
  const i = icon[r.outcome];
  return `${i} ${r.service.padEnd(10)} ${r.detail}`;
}

export function isPresent(v: string | undefined): boolean {
  return v !== undefined && v.trim().length > 0;
}

/**
 * Fetch with a hard timeout. Most external APIs misbehave by hanging
 * rather than 500ing, and a verify script shouldn't sit forever.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function exitFromResult(r: VerifyResult): never {
  console.log(formatResult(r));
  process.exit(r.outcome === "fail" ? 1 : 0);
}
