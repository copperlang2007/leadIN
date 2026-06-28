// Verify the email provider credentials the digest + notification paths
// depend on.
//
// Mirrors sendEmail()'s provider precedence (SendGrid first, then Resend).
// Confirms the API key authenticates, and — because the #1 production email
// failure is an unverified sender domain (the DKIM 403 trap) — surfaces
// whether the account has at least one verified sender/domain so the
// operator catches "key works but every send 403s" BEFORE going live.
//
// Skips cleanly if no provider key is set. Run via `npm run verify:email`.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

async function verifySendGrid(apiKey: string): Promise<VerifyResult> {
  const auth = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  let scopesRes: Response;
  try {
    scopesRes = await fetchWithTimeout("https://api.sendgrid.com/v3/scopes", { headers: auth });
  } catch (err: any) {
    return { service: "email", outcome: "fail", detail: `sendgrid network error: ${err?.message ?? err}` };
  }
  if (scopesRes.status === 401) {
    return { service: "email", outcome: "fail", detail: "sendgrid 401 — SENDGRID_API_KEY rejected" };
  }
  if (!scopesRes.ok) {
    return { service: "email", outcome: "fail", detail: `sendgrid scopes returned ${scopesRes.status}` };
  }

  // Auth works. Now check for a verified sender — the DKIM trap.
  let verifiedCount: number | null = null;
  try {
    const vsRes = await fetchWithTimeout("https://api.sendgrid.com/v3/verified_senders", { headers: auth });
    if (vsRes.ok) {
      const body = (await vsRes.json()) as { results?: unknown[] };
      verifiedCount = Array.isArray(body.results) ? body.results.length : null;
    }
  } catch {
    // Non-fatal — auth already confirmed; we just can't report sender count.
  }

  if (verifiedCount === 0) {
    return {
      service: "email",
      outcome: "fail",
      detail: "sendgrid auth ok but ZERO verified senders — sends will 403 (verify your from-address)",
    };
  }
  return {
    service: "email",
    outcome: "pass",
    detail: `sendgrid auth ok${verifiedCount !== null ? `, ${verifiedCount} verified sender(s)` : ""}`,
  };
}

async function verifyResend(apiKey: string): Promise<VerifyResult> {
  const auth = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.resend.com/domains", { headers: auth });
  } catch (err: any) {
    return { service: "email", outcome: "fail", detail: `resend network error: ${err?.message ?? err}` };
  }
  if (res.status === 401) {
    return { service: "email", outcome: "fail", detail: "resend 401 — RESEND_API_KEY rejected" };
  }
  if (!res.ok) {
    return { service: "email", outcome: "fail", detail: `resend domains returned ${res.status}` };
  }
  const body = (await res.json()) as { data?: Array<{ status?: string }> };
  const domains = body.data ?? [];
  const verified = domains.filter((d) => d.status === "verified").length;
  if (domains.length > 0 && verified === 0) {
    return {
      service: "email",
      outcome: "fail",
      detail: `resend auth ok but ${domains.length} domain(s), 0 verified — sends will fail`,
    };
  }
  return {
    service: "email",
    outcome: "pass",
    detail: `resend auth ok, ${verified} verified domain(s)`,
  };
}

async function verifyEmail(): Promise<VerifyResult> {
  const sg = process.env.SENDGRID_API_KEY;
  const resend = process.env.RESEND_API_KEY;

  // sendEmail() prefers SendGrid, so probe it first to match runtime behavior.
  if (isPresent(sg)) return verifySendGrid(sg!);
  if (isPresent(resend)) return verifyResend(resend!);

  return {
    service: "email",
    outcome: "skip",
    detail: "no SENDGRID_API_KEY / RESEND_API_KEY — skipping",
  };
}

export { verifyEmail };

void runAsCli(verifyEmail, "verify-email");
