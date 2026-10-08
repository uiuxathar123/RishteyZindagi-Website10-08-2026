#!/usr/bin/env -S npx tsx
/**
 * PCP — create the first Super Admin on a fresh deployment.
 *
 *     npm run admin:create-super -- --email owner@example.com --name "Site Owner"
 *
 * Prints a one-time temporary password (shown only here). The account must change it at first
 * sign-in. See src/server/modules/staff/bootstrap-super-admin.ts for the guard rails.
 * Exit code: 0 created, 1 refused/failed.
 */
import "dotenv/config";
import { createSuperAdmin } from "../src/server/modules/staff/bootstrap-super-admin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  if (!email || !name) {
    console.error('Usage: npm run admin:create-super -- --email <email> --name "<full name>" [--allow-additional]');
    process.exit(1);
  }
  const out = await createSuperAdmin({ email, name, allowAdditional: process.argv.includes("--allow-additional") });
  console.log(`Super Admin created: ${out.email}`);
  console.log(`Temporary password (shown once, change it at first sign-in): ${out.temporaryPassword}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("create-super-admin refused:", err instanceof Error ? err.message : err);
  process.exit(1);
});
