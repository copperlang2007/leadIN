// Verify the TrustedForm API key the lead-ingest TCPA-verification path
// depends on.
//
// TrustedForm has no "account" resource to ping, so we probe the cert
// endpoint with a sentinel (non-existent) cert id:
//   - 401 → the API key is rejected (fail)
//   - 403 → key authenticated but lacks cert-read permission (fail)
//   - 404 / any other status → auth succeeded, the cert just doesn't
//     exist (exactly what we expect for a sentinel) → the key works
//
// Skips cleanly if TRUSTEDFORM_API_KEY is unset. Run via
// `npm run verify:trustedform`.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

// A syntactically-plausible but certainly-nonexistent cert id. TrustedForm
// cert ids are 40-char hex tokens; all-zero will never resolve to a real
// cert, so a healthy key returns 404 (not 401).
const SENTINEL_CERT_ID = "0".repeat(40);

async function verifyTrustedForm(): Promise<VerifyResult> {
  const apiKey = process.env.TRUSTEDFORM_API_KEY;
  if (!isPresent(apiKey)) {
    return {
      service: "trustedform",
      outcome: "skip",
      detail: "TRUSTEDFORM_API_KEY unset — skipping",
    };
  }

  // TrustedForm uses HTTP Basic with an empty username and the key as password.
  const auth = "Basic " + Buffer.from(`:${apiKey}`).toString("base64");
  const url = `https://api.trustedform.com/cert/${SENTINEL_CERT_ID}.json`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Authorization: auth, Accept: "application/json" },
    });
  } catch (err: any) {
    return {
      service: "trustedform",
      outcome: "fail",
      detail: `network error reaching TrustedForm: ${err?.message ?? err}`,
    };
  }

  if (res.status === 401) {
    return {
      service: "trustedform",
      outcome: "fail",
      detail: "401 — TRUSTEDFORM_API_KEY rejected",
    };
  }
  if (res.status === 403) {
    return {
      service: "trustedform",
      outcome: "fail",
      detail: "403 — key authenticated but lacks cert-read permission",
    };
  }
  // 404 (cert not found) is the expected healthy response for a sentinel id;
  // any non-401/403 means the credential itself works.
  return {
    service: "trustedform",
    outcome: "pass",
    detail: `auth ok (sentinel cert returned ${res.status} as expected)`,
  };
}

export { verifyTrustedForm };

void runAsCli(verifyTrustedForm, "verify-trustedform");
