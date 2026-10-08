#!/usr/bin/env -S npx tsx
/**
 * B16 — production-readiness pre-flight check. NEW in this phase, purely
 * additive: reads the current environment through the existing, unmodified
 * `getEnv()` (src/server/config/env.ts) and runs it through the new, pure
 * `checkProductionReadiness()` (src/server/config/prod-readiness.ts). No
 * database connection, no network call, no mutation — safe to run in any
 * environment, including this sandbox, at any time.
 *
 * This is NOT wired into `npm run build`, `npm start`, `db:migrate`, or any
 * other existing script — running it is always an explicit, separate,
 * opt-in step an operator takes before a real deployment (see
 * B16_PRODUCTION_INFRASTRUCTURE.md's deployment procedure for exactly
 * where). Exit code is 0 when there are zero errors (warnings alone do not
 * fail the check — see prod-readiness.ts's own severity-split comment),
 * non-zero when there is at least one error, so it composes into a real
 * CI/deploy pipeline's own pass/fail step later, without this sandbox
 * inventing one that doesn't exist.
 *
 * Usage: npm run check:prod-env
 */
import "dotenv/config";
import { getEnv } from "../src/server/config/env";
import { checkProductionReadiness } from "../src/server/config/prod-readiness";

function main() {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    console.error("check-prod-env: getEnv() itself failed — fix this first:\n");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const result = checkProductionReadiness(env, process.env.ALLOWED_ORIGINS);

  console.log("=== B16 production-readiness check ===\n");

  if (result.errors.length === 0) {
    console.log("Errors: none");
  } else {
    console.log(`Errors: ${result.errors.length}`);
    for (const e of result.errors) console.log(`  [ERROR] ${e}`);
  }

  console.log("");

  if (result.warnings.length === 0) {
    console.log("Warnings: none");
  } else {
    console.log(`Warnings: ${result.warnings.length}`);
    for (const w of result.warnings) console.log(`  [WARN]  ${w}`);
  }

  console.log("");
  console.log(result.ok ? "RESULT: OK (no blocking errors)" : "RESULT: NOT READY (blocking errors above must be fixed)");

  process.exit(result.ok ? 0 : 1);
}

main();
