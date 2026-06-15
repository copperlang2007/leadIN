// Verify the OIDC issuer discovery works against the configured ISSUER_URL.
//
// This is the auth-bootstrap probe: confirms the discovery doc loads, the
// authorization_endpoint + token_endpoint are present, and (if REPL_ID
// is set) that we can at least construct an authorization URL without
// throwing. We deliberately don't try a full auth-code grant because
// that needs a human in the loop; this catches the >90% case where the
// issuer URL is wrong, unreachable, or returns garbage.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

async function verifyOidc(): Promise<VerifyResult> {
  const issuerBase = process.env.ISSUER_URL;
  const replId = process.env.REPL_ID;

  if (!isPresent(issuerBase)) {
    return {
      service: "oidc",
      outcome: "skip",
      detail: "ISSUER_URL unset — skipping (server/replitAuth.ts will default to https://replit.com/oidc at boot)",
    };
  }

  // OIDC discovery doc location is well-known.
  const discoveryUrl = issuerBase!.replace(/\/$/, "") + "/.well-known/openid-configuration";

  let res: Response;
  try {
    res = await fetchWithTimeout(discoveryUrl, { headers: { Accept: "application/json" } });
  } catch (err: any) {
    return {
      service: "oidc",
      outcome: "fail",
      detail: `network error reaching ${discoveryUrl}: ${err?.message ?? err}`,
    };
  }
  if (!res.ok) {
    return {
      service: "oidc",
      outcome: "fail",
      detail: `${discoveryUrl} → ${res.status}`,
    };
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return {
      service: "oidc",
      outcome: "fail",
      detail: `${discoveryUrl} returned non-JSON`,
    };
  }

  const required = ["authorization_endpoint", "token_endpoint", "issuer"];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return {
      service: "oidc",
      outcome: "fail",
      detail: `discovery doc missing required fields: ${missing.join(", ")}`,
    };
  }

  // If REPL_ID is set, attempt to construct an authorization URL. This
  // catches malformed authorization_endpoint values without contacting
  // the issuer further.
  let authzNote = "";
  if (isPresent(replId)) {
    try {
      const u = new URL(body.authorization_endpoint);
      u.searchParams.set("client_id", replId!);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "openid email profile offline_access");
      authzNote = `, authz URL builds (${u.hostname})`;
    } catch (err: any) {
      return {
        service: "oidc",
        outcome: "fail",
        detail: `discovery ok but authorization_endpoint malformed: ${err?.message ?? err}`,
      };
    }
  } else {
    authzNote = ", REPL_ID unset (skipped authz URL check)";
  }

  return {
    service: "oidc",
    outcome: "pass",
    detail: `issuer=${body.issuer}${authzNote}`,
  };
}

export { verifyOidc };

void runAsCli(verifyOidc, "verify-oidc");
