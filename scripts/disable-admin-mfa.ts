#!/usr/bin/env -S npx tsx
/**
 * B19 break-glass — switch admin MFA OFF from the server when e-mail delivery is broken and no admin can sign in.
 *
 *     npm run admin:disable-mfa
 *
 * Needs shell access to the server (DATABASE_URL), exactly like `admin:create-super`. It only turns the setting off
 * (it can never turn it on or touch any password) and writes an audit entry with actor SYSTEM.
 */
import "dotenv/config";
import { db } from "../src/server/db/client";
import { platformSettings } from "../src/server/db/schema";
import { record } from "../src/server/modules/audit/audit.service";

async function main() {
  await db
    .insert(platformSettings)
    .values({ key: "admin.security", value: { mfaRequired: false } })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: { mfaRequired: false }, updatedAt: new Date(), updatedByAdminId: null } });
  await record({ actorType: "SYSTEM", action: "settings.admin_mfa_disabled_break_glass", entityType: "platform_setting", metadata: { setting: "admin.security", new: false, via: "scripts/disable-admin-mfa.ts" } });
  console.log("Admin MFA is now OFF. Sign in with your password, fix e-mail delivery, then switch it back on in Platform Settings.");
  process.exit(0);
}

main().catch((err) => {
  console.error("disable-admin-mfa failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
