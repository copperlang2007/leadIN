// DNC (Do-Not-Call) compliance check for newly ingested leads + the
// dial-time gate.
//
// Two modes selected by whether DNC_VENDOR_API_KEY + DNC_VENDOR_API_URL
// are both set:
//
//   LIVE (vendor configured):
//     - We call the vendor (Gryphon, Convoso, RealPhoneValidation, ...).
//     - Any failure — non-OK HTTP, network error, timeout — returns
//       { flagged: true, source: "vendor-error" }.
//       Fail closed. A 504 from the vendor used to silently return
//       flagged:false, which auto-cleared the lead's DNC status and
//       would let downstream callers (dial-time gate, ingest) treat
//       it as DNC-clean. That's a TCPA violation cost of $500–$1,500
//       per call if the number turns out to be listed.
//     - The vendor outage is recoverable: dncRecheck.ts re-runs nightly
//       and clears the flag for numbers that are actually clean once
//       the vendor is back up.
//
//   FALLBACK (no vendor configured, dev/CI only):
//     - Deterministic local check: phones whose last 4 digits are in a
//       known suppression seed (0000/1111/5555/9999) are flagged.
//     - Keeps tests reproducible and lets local dev exercise the flag
//       path without a paid vendor account.

import { logError } from "./lib/safeError";

interface DncCheckResult {
  flagged: boolean;
  source: "vendor" | "vendor-error" | "local-fallback" | "skip";
  reason?: string;
}

const LOCAL_SUPPRESSION_SUFFIXES = new Set(["0000", "1111", "5555", "9999"]);
const VENDOR_TIMEOUT_MS = 5000;

function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function checkDnc(phone: string | null | undefined): Promise<DncCheckResult> {
  if (!phone) return { flagged: false, source: "skip", reason: "no phone" };
  const digits = normalisePhone(phone);
  if (digits.length < 10) return { flagged: false, source: "skip", reason: "invalid phone" };

  const apiKey = process.env.DNC_VENDOR_API_KEY;
  const apiUrl = process.env.DNC_VENDOR_API_URL;

  if (apiKey && apiUrl) {
    return await liveVendorCheck(digits, apiUrl, apiKey);
  }

  const last4 = digits.slice(-4);
  const flagged = LOCAL_SUPPRESSION_SUFFIXES.has(last4);
  return {
    flagged,
    source: "local-fallback",
    reason: flagged ? `local suppression match (${last4})` : undefined,
  };
}

async function liveVendorCheck(
  digits: string,
  apiUrl: string,
  apiKey: string,
): Promise<DncCheckResult> {
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ phone: digits }),
      // 5-second cap so a slow vendor never blocks ingestion.
      signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Fail closed on any non-2xx. Don't fall back to the local
      // last-4 check — that only catches CI fixtures, not the actual
      // DNC list. Better to over-flag and let nightly recheck clear
      // false positives than to under-flag and incur TCPA violations.
      return {
        flagged: true,
        source: "vendor-error",
        reason: `vendor non-OK ${res.status}`,
      };
    }
    const body: any = await res.json();
    const flagged = Boolean(body?.dnc ?? body?.onDncList ?? body?.flagged);
    return {
      flagged,
      source: "vendor",
      reason: flagged ? body?.reason || "vendor flagged" : undefined,
    };
  } catch (err) {
    logError("dnc.liveVendorCheck failed", err);
    // Same fail-closed rationale as the non-OK branch above.
    return {
      flagged: true,
      source: "vendor-error",
      reason: err instanceof Error ? err.message : "vendor lookup failed",
    };
  }
}
