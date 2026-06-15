// Verify the Stripe credentials we depend on at boot.
//
// Confirms STRIPE_SECRET_KEY authenticates against the live Stripe API,
// and that the three subscription price IDs (STRIPE_PRICE_STARTER /
// _GROWTH / _SCALE) resolve to actual price objects.
//
// Skips cleanly if STRIPE_SECRET_KEY is unset (so this can sit in a
// dev environment without complaining). Run via `npm run verify:stripe`.

import {
  fetchWithTimeout,
  isPresent,
  runAsCli,
  type VerifyResult,
} from "./_shared";

const STRIPE_API = "https://api.stripe.com/v1";

async function verifyStripe(): Promise<VerifyResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!isPresent(key)) {
    return {
      service: "stripe",
      outcome: "skip",
      detail: "STRIPE_SECRET_KEY unset — skipping",
    };
  }

  // 1. Authenticate by fetching the account object — Stripe's idiomatic ping.
  let acctRes: Response;
  try {
    acctRes = await fetchWithTimeout(`${STRIPE_API}/account`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (err: any) {
    return {
      service: "stripe",
      outcome: "fail",
      detail: `network error reaching ${STRIPE_API}/account: ${err?.message ?? err}`,
    };
  }
  if (!acctRes.ok) {
    const body = await acctRes.text().catch(() => "");
    return {
      service: "stripe",
      outcome: "fail",
      detail: `account fetch returned ${acctRes.status} — ${body.slice(0, 200)}`,
    };
  }
  const acct = (await acctRes.json()) as { id?: string; livemode?: boolean };
  const mode = acct.livemode ? "live" : "test";

  // 2. Resolve each configured price id.
  const priceIds = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    scale: process.env.STRIPE_PRICE_SCALE,
  };
  const missingFromEnv = Object.entries(priceIds).filter(([, v]) => !isPresent(v));
  if (missingFromEnv.length > 0) {
    return {
      service: "stripe",
      outcome: "fail",
      detail: `auth ok (acct ${acct.id} ${mode}), but STRIPE_PRICE_* unset: ${missingFromEnv.map(([k]) => k).join(", ")}`,
    };
  }

  const priceFailures: string[] = [];
  for (const [tier, priceId] of Object.entries(priceIds)) {
    try {
      const r = await fetchWithTimeout(`${STRIPE_API}/prices/${priceId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        priceFailures.push(`${tier} (${priceId}) → ${r.status}`);
      }
    } catch (err: any) {
      // A transient blip between fetches shouldn't unstructured-abort the
      // script — record it as a soft failure for this tier and keep going.
      priceFailures.push(`${tier} (${priceId}) → network error: ${err?.message ?? err}`);
    }
  }
  if (priceFailures.length > 0) {
    return {
      service: "stripe",
      outcome: "fail",
      detail: `auth ok (acct ${acct.id} ${mode}), but price lookup failed: ${priceFailures.join("; ")}`,
    };
  }

  return {
    service: "stripe",
    outcome: "pass",
    detail: `acct ${acct.id} ${mode}, 3 price ids resolve`,
  };
}

export { verifyStripe };

void runAsCli(verifyStripe, "verify-stripe");
