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
 * Fetch with a hard timeout. Implemented manually rather than via
 * `AbortSignal.timeout` so the scripts work on operators' machines
 * running Node < 17.3 (the static method only landed in 17.3).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Standard CLI shell for a verify-X.ts script: run the probe, print
 * the result, exit non-zero on fail. Wraps any thrown error from the
 * probe itself into a structured fail result so a transient network
 * blip doesn't abort the script with an unstructured stack trace.
 *
 * Each script invokes this when run directly. The expectedScriptName
 * guard prevents the runner from firing when the module is imported
 * by verify-all.ts.
 */
export async function runAsCli(
  verifyFn: () => Promise<VerifyResult>,
  expectedScriptName: string,
): Promise<void> {
  const entry = typeof process !== "undefined" ? process.argv[1] ?? "" : "";
  if (!entry.endsWith(`${expectedScriptName}.ts`) && !entry.endsWith(`${expectedScriptName}.js`)) {
    return;
  }
  let result: VerifyResult;
  try {
    result = await verifyFn();
  } catch (err: any) {
    result = {
      service: expectedScriptName.replace(/^verify-/, ""),
      outcome: "fail",
      detail: `unexpected error: ${err?.message ?? err}`,
    };
  }
  console.log(formatResult(result));
  process.exit(result.outcome === "fail" ? 1 : 0);
}
