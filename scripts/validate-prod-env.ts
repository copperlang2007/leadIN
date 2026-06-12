// CLI wrapper around server/lib/envValidation — the validator logic
// lives in server/lib so it's part of the tsc build graph and can be
// imported by server/index.ts at boot. This script is the
// `npm run check:prod-env` entry point and the operator's pre-flight
// check before promoting an image.

import { validateEnv, formatResult, PROD_ENV_RULES } from "../server/lib/envValidation";

export { validateEnv, formatResult, PROD_ENV_RULES };
export type { EnvRule, ValidationResult } from "../server/lib/envValidation";

async function main(): Promise<void> {
  const result = validateEnv();
  console.log(formatResult(result));
  // Exit non-zero only in prod with missing vars — in dev we surface
  // the same diagnostics but don't block startup, so the script
  // doubles as a pre-flight check before promoting an image.
  if (!result.ok && result.isProd) {
    process.exit(1);
  }
}

// Only run main() when invoked directly, not when imported.
const entry = typeof process !== "undefined" ? process.argv[1] ?? "" : "";
if (entry.endsWith("validate-prod-env.ts") || entry.endsWith("validate-prod-env.js")) {
  void main();
}
