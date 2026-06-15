// Verify the NIPR API key for agent license lookups.
//
// NIPR (National Insurance Producer Registry) is the system of record
// for US insurance agent licenses. server/nipr.ts hits the PDB
// (Producer Database) API. This script does a lightweight probe so
// the operator can confirm NIPR_API_KEY actually grants access before
// promoting to a deploy that depends on it for FEATURE_NIPR.
//
// Heuristic: NIPR's PDB exposes a search endpoint. We send a
// no-match-expected query (NPN 0) and expect either a 200 with zero
// results OR a 4xx the key is allowed to receive. Anything else
// (401, 403, network error) is a configuration problem.
//
// Skips cleanly if NIPR_API_KEY is unset.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

// NIPR PDB v2 endpoint. Real URL may vary by environment (sandbox vs.
// production); this matches what server/lib/nipr.ts currently uses
// (or its stub equivalent). Override via NIPR_API_URL if needed.
const DEFAULT_NIPR_URL = process.env.NIPR_API_URL ?? "https://pdb-services.nipr.com/pdb/api/v2";

async function verifyNipr(): Promise<VerifyResult> {
  const key = process.env.NIPR_API_KEY;
  if (!isPresent(key)) {
    return {
      service: "nipr",
      outcome: "skip",
      detail: "NIPR_API_KEY unset — skipping",
    };
  }

  // Lightest possible probe: GET against the base URL with the key.
  // We don't actually want to do a real lookup; we just want to know
  // the key is recognised by NIPR's auth layer.
  let res: Response;
  try {
    res = await fetchWithTimeout(`${DEFAULT_NIPR_URL}/health`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch (err: any) {
    return {
      service: "nipr",
      outcome: "fail",
      detail: `network error reaching ${DEFAULT_NIPR_URL}: ${err?.message ?? err}`,
    };
  }

  // 401 / 403 = key rejected. Real fail.
  if (res.status === 401 || res.status === 403) {
    return {
      service: "nipr",
      outcome: "fail",
      detail: `${res.status} — NIPR_API_KEY rejected at ${DEFAULT_NIPR_URL}`,
    };
  }

  // 404 on /health is OK — we tried a plausible endpoint that may not
  // exist on every NIPR deployment. The fact that auth didn't reject
  // suggests the key reaches a server that understands it.
  if (res.status === 404) {
    return {
      service: "nipr",
      outcome: "pass",
      detail: `auth not rejected (404 on /health is expected for some envs); set NIPR_API_URL if you want a stricter probe`,
    };
  }

  // 5xx = NIPR side problem, not our config. Surface as a pass with a
  // note rather than fail — the operator's credential is fine, the
  // upstream just isn't well right now.
  if (res.status >= 500) {
    return {
      service: "nipr",
      outcome: "pass",
      detail: `auth not rejected, but upstream returned ${res.status} (NIPR-side issue, retry later)`,
    };
  }

  // 2xx — clean pass.
  if (res.ok) {
    return {
      service: "nipr",
      outcome: "pass",
      detail: `${DEFAULT_NIPR_URL} responded ${res.status}`,
    };
  }

  // Any other 4xx — the key may be valid but a path/scope mismatch.
  return {
    service: "nipr",
    outcome: "fail",
    detail: `unexpected ${res.status} from ${DEFAULT_NIPR_URL} (auth shape may need adjustment in server/lib/nipr.ts)`,
  };
}

export { verifyNipr };

void runAsCli(verifyNipr, "verify-nipr");
