// TrustedForm certificate verification.
//
// TrustedForm (ActiveProspect) issues a cryptographically-signed certificate
// every time a consumer fills out a form. The vendor passes the cert URL to us
// at ingest time; we then call the TrustedForm API to confirm the cert is real
// and recent (< 90 days old, per TCPA documentation retention norms).
//
// When `TRUSTEDFORM_API_KEY` is unset we cannot verify — the caller should
// treat the lead as "vendor-claimed" instead of "verified".

interface VerifyResult {
  ok: boolean;
  certId?: string;
  source?: "trustedform";
  error?: string;
}

const MAX_CERT_AGE_SECONDS = 90 * 24 * 3600; // 90 days
const REQUEST_TIMEOUT_MS = 10_000;

// Exported so callers can distinguish the benign "TrustedForm is off in
// this environment" case from a real verification failure without
// re-hardcoding the message string (which would silently drift if this
// module changed its wording).
export const ERR_NO_API_KEY = "TRUSTEDFORM_API_KEY not configured";

/**
 * Extract the cert token from a TrustedForm cert URL.
 * Cert URLs look like `https://cert.trustedform.com/<token>` — the id is the
 * final path segment.
 */
function extractCertId(certUrl: string): string | null {
  try {
    const u = new URL(certUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const token = parts[parts.length - 1];
    if (!token) return null;
    return token;
  } catch {
    return null;
  }
}

export async function verifyTrustedFormCert(certUrl: string): Promise<VerifyResult> {
  const apiKey = process.env.TRUSTEDFORM_API_KEY;
  if (!apiKey) {
    return { ok: false, error: ERR_NO_API_KEY };
  }

  const certId = extractCertId(certUrl);
  if (!certId) {
    return { ok: false, error: "could not extract cert id from url" };
  }

  // TrustedForm uses HTTP Basic auth with an empty username and the API key as
  // the password (i.e. `:<API_KEY>`).
  const authHeader = "Basic " + Buffer.from(`:${apiKey}`).toString("base64");
  const url = `https://api.trustedform.com/cert/${encodeURIComponent(certId)}.json`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, error: `trustedform non-OK ${res.status}` };
    }

    const body: any = await res.json();
    const cert = body?.cert;
    if (!cert) {
      return { ok: false, error: "trustedform response missing cert" };
    }

    const ageSeconds = Number(cert.age_in_seconds);
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
      return { ok: false, error: "invalid age_in_seconds in response" };
    }

    if (ageSeconds >= MAX_CERT_AGE_SECONDS) {
      return { ok: false, error: `cert too old (${ageSeconds}s)` };
    }

    return {
      ok: true,
      certId,
      source: "trustedform",
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "trustedform request failed" };
  }
}
