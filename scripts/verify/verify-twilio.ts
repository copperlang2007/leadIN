// Verify the Twilio credentials the dialer + SMS paths depend on.
//
// Confirms TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN authenticate, and
// that the configured TWILIO_PHONE_NUMBER actually belongs to that
// account (a common misconfig: paste a number from a different
// subaccount or a number that's been released).
//
// Skips cleanly if the account SID is unset. Run via `npm run verify:twilio`.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

async function verifyTwilio(): Promise<VerifyResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER;

  if (!isPresent(sid)) {
    return {
      service: "twilio",
      outcome: "skip",
      detail: "TWILIO_ACCOUNT_SID unset — skipping",
    };
  }
  if (!isPresent(token)) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: "TWILIO_ACCOUNT_SID set but TWILIO_AUTH_TOKEN missing",
    };
  }

  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

  // 1. Authenticate by fetching the account resource.
  let acctRes: Response;
  try {
    acctRes = await fetchWithTimeout(`${TWILIO_API}/Accounts/${sid}.json`, {
      headers: { Authorization: auth, Accept: "application/json" },
    });
  } catch (err: any) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `network error reaching Twilio: ${err?.message ?? err}`,
    };
  }
  if (acctRes.status === 401) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: "401 — credentials rejected (check TWILIO_AUTH_TOKEN)",
    };
  }
  if (!acctRes.ok) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `account fetch returned ${acctRes.status}`,
    };
  }
  const acct = (await acctRes.json()) as { friendly_name?: string; status?: string };

  // 2. Verify the configured outbound number is owned by this account.
  if (!isPresent(phone)) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `auth ok (${acct.friendly_name ?? sid}, status=${acct.status ?? "?"}) but TWILIO_PHONE_NUMBER unset`,
    };
  }

  let phoneRes: Response;
  try {
    phoneRes = await fetchWithTimeout(
      `${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone!)}`,
      { headers: { Authorization: auth, Accept: "application/json" } },
    );
  } catch (err: any) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `auth ok, but phone-number lookup network error: ${err?.message ?? err}`,
    };
  }
  if (!phoneRes.ok) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `auth ok, but phone-number lookup returned ${phoneRes.status}`,
    };
  }
  const phoneBody = (await phoneRes.json()) as {
    incoming_phone_numbers?: Array<{ phone_number?: string; capabilities?: Record<string, boolean> }>;
  };
  const numbers = phoneBody.incoming_phone_numbers ?? [];
  if (numbers.length === 0) {
    return {
      service: "twilio",
      outcome: "fail",
      detail: `auth ok, but ${phone} is not owned by account ${sid}`,
    };
  }
  const caps = numbers[0].capabilities ?? {};
  const capList = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join("/");

  return {
    service: "twilio",
    outcome: "pass",
    detail: `acct ${sid} status=${acct.status ?? "?"}, ${phone} (${capList || "no caps reported"})`,
  };
}

export { verifyTwilio };

void runAsCli(verifyTwilio, "verify-twilio");
