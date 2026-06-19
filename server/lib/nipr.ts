// Wave 6 (T4) — NIPR / DOI license verification.
//
// Two modes, selected by whether NIPR_API_KEY is set at boot:
//
//   - LIVE: calls https://api.nipr.com/v2/licenses with the API key.
//     Returns whatever NIPR says. If the call fails (network error,
//     non-OK HTTP, malformed JSON) we return { verified: false } with
//     an explicit error message. We do NOT fall back to the stub —
//     that would mean every NIPR outage auto-verifies fake licenses,
//     which is the exact failure mode the live mode exists to
//     prevent. Operators see the error in the surface that called us
//     (agent-onboarding cache row) and can retry once NIPR is up.
//
//   - STUB: returns { verified: true, expiresAt: now + 1y } when
//     licenseNumber.length >= 6, else { verified: false }. Only
//     active when NIPR_API_KEY is unset (dev + CI). This is the
//     "let onboarding flows run without credentials" affordance.

import { logError } from "./safeError";

export interface VerifyLicenseInput {
  niprNumber?: string;
  state: string;
  licenseNumber: string;
}

export interface VerifyLicenseResult {
  verified: boolean;
  expiresAt?: Date;
  classes?: string[];
  error?: string;
  raw?: unknown;
}

const DEFAULT_LIVE_TIMEOUT_MS = 10_000;

function liveTimeoutMs(): number {
  const raw = Number(process.env.NIPR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIVE_TIMEOUT_MS;
}

function hasNiprKey(): boolean {
  // Truthiness check would silently treat NIPR_API_KEY="" as "stub
  // mode", which masks the misconfig — a deploy where the env var is
  // wired up but the secret didn't resolve. Treat the var as
  // "intended live mode" whenever it's defined at all; an empty
  // value will get sent as `Authorization: Bearer ` and NIPR will
  // 401, which is exactly the fail-closed outcome we want.
  return process.env.NIPR_API_KEY !== undefined;
}

export async function verifyLicense(input: VerifyLicenseInput): Promise<VerifyLicenseResult> {
  if (hasNiprKey()) {
    try {
      return await liveVerify(input);
    } catch (err) {
      // Fail closed — never fall back to the stub when running live.
      // An NIPR outage that silently flipped to stub behaviour would
      // let any 6+ char license through; that's strictly worse than
      // showing the user a retry-required state.
      logError("nipr.liveVerify failed", err);
      return {
        verified: false,
        error: err instanceof Error ? err.message : "nipr verify failed",
      };
    }
  }
  return stubVerify(input);
}

async function liveVerify(input: VerifyLicenseInput): Promise<VerifyLicenseResult> {
  const url = new URL("https://api.nipr.com/v2/licenses");
  url.searchParams.set("state", input.state);
  url.searchParams.set("licenseNumber", input.licenseNumber);
  if (input.niprNumber) url.searchParams.set("niprNumber", input.niprNumber);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), liveTimeoutMs());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.NIPR_API_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return { verified: false, error: `NIPR HTTP ${res.status}` };
  }
  const data: any = await res.json();
  const lic = Array.isArray(data?.licenses) ? data.licenses[0] : data?.license ?? data;
  const expiresAt = lic?.expirationDate ? new Date(lic.expirationDate) : undefined;
  const classes = Array.isArray(lic?.lineOfAuthority)
    ? lic.lineOfAuthority.map((l: any) => String(l))
    : undefined;
  return {
    verified: Boolean(lic?.status === "active" || lic?.active),
    expiresAt,
    classes,
    raw: data,
  };
}

export function stubVerify(input: VerifyLicenseInput): VerifyLicenseResult {
  if (!input.licenseNumber || input.licenseNumber.length < 6) {
    return { verified: false, error: "license number too short (stub)" };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return {
    verified: true,
    expiresAt,
    classes: ["Life", "Health"],
    raw: { stub: true },
  };
}

export function isNiprLive(): boolean {
  return hasNiprKey();
}
