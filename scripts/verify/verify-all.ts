// Compose all the verify-<service>.ts probes into a single report.
//
// `npm run verify:all` runs every probe in parallel against the
// configured env, prints a summary table, and exits non-zero if any
// probe failed (skips are fine — they mean the service isn't in use
// in this environment).
//
// Use before promoting a build to a real prod environment.

import { verifyNeonAuth } from "./verify-neon-auth";
import { verifyStripe } from "./verify-stripe";
import { verifyTwilio } from "./verify-twilio";
import { verifyNipr } from "./verify-nipr";
import { verifyEmail } from "./verify-email";
import { verifyTrustedForm } from "./verify-trustedform";
import { formatResult, type VerifyResult } from "./_shared";

async function runAll(): Promise<void> {
  console.log("Running external-service verifications…\n");
  const probes: Array<() => Promise<VerifyResult>> = [
    verifyNeonAuth,
    verifyStripe,
    verifyTwilio,
    verifyNipr,
    verifyEmail,
    verifyTrustedForm,
  ];

  const results = await Promise.all(probes.map((p) => p()));
  for (const r of results) console.log(formatResult(r));

  const failed = results.filter((r) => r.outcome === "fail").length;
  const passed = results.filter((r) => r.outcome === "pass").length;
  const skipped = results.filter((r) => r.outcome === "skip").length;

  console.log("");
  console.log(`Summary: ${passed} pass, ${failed} fail, ${skipped} skip`);
  process.exit(failed > 0 ? 1 : 0);
}

void runAll();
