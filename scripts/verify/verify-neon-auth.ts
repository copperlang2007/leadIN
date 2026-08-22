// Verify Neon Auth (Stack) configuration: the project JWKS endpoint is
// reachable and returns at least one signing key. Catches a bad project id
// or a network-egress problem before a deploy, without needing a real user
// token.
//
// Skips cleanly if VITE_STACK_PROJECT_ID is unset (auth-off dev/CI).
// Run via `npm run verify:neon-auth`.

import { fetchWithTimeout, isPresent, runAsCli, type VerifyResult } from "./_shared";

async function verifyNeonAuth(): Promise<VerifyResult> {
  const projectId = process.env.VITE_STACK_PROJECT_ID;
  if (!isPresent(projectId)) {
    return {
      service: "neon-auth",
      outcome: "skip",
      detail: "VITE_STACK_PROJECT_ID unset — skipping (Neon Auth disabled in this environment)",
    };
  }

  const apiUrl = process.env.NEON_AUTH_API_URL || "https://api.stack-auth.com";
  const url =
    process.env.NEON_AUTH_JWKS_URL ||
    `${apiUrl}/api/v1/projects/${encodeURIComponent(projectId!)}/.well-known/jwks.json`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {});
  } catch (err: any) {
    return {
      service: "neon-auth",
      outcome: "fail",
      detail: `network error reaching ${url}: ${err?.message ?? err}`,
    };
  }
  if (!res.ok) {
    return {
      service: "neon-auth",
      outcome: "fail",
      detail: `JWKS fetch failed: ${res.status} ${res.statusText} (${url})`,
    };
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return { service: "neon-auth", outcome: "fail", detail: `JWKS at ${url} is not JSON` };
  }
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length === 0) {
    return {
      service: "neon-auth",
      outcome: "fail",
      detail: `JWKS at ${url} returned no keys — check the project id`,
    };
  }

  return {
    service: "neon-auth",
    outcome: "pass",
    detail: `JWKS reachable — ${keys.length} signing key(s) for project ${projectId}`,
  };
}

export { verifyNeonAuth };

void runAsCli(verifyNeonAuth, "verify-neon-auth");
