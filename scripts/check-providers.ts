#!/usr/bin/env -S npx tsx
/**
 * Provider connectivity check for LOCAL test-mode setup (Razorpay TEST keys + SMTP e-mail OTP).
 *
 * Prints PASS / FAIL / SKIP per check and NEVER prints a secret, an API key, an SMTP password or an OTP — only
 * variable NAMES and generic results. Safe to run repeatedly: it moves no money (the optional order check
 * creates one unpaid ₹1.00 order with a TEST key; the key-mode guard refuses live keys outside production).
 *
 *   npm run check:providers                              # env + Razorpay read-only call + SMTP login (no mail sent)
 *   npm run check:providers -- --to you@example.com      # …and send one test e-mail to that mailbox
 *   npm run check:providers -- --create-test-order       # …and create one unpaid ₹1 TEST order at Razorpay
 *
 * Exit code 0 only when every non-skipped check passed.
 */
import "dotenv/config";
import { getEnv } from "../src/server/config/env";
import { isMailerConfigured, missingMailerSettings, sendMail, verifySmtpConnection } from "../src/server/lib/mailer";
import { loadRazorpayCredentials } from "../src/server/modules/payments/credentials";
import { RazorpayProvider } from "../src/server/modules/payments/providers/razorpay.provider";
import { get as getOtpConfig } from "../src/server/modules/otp/otp-config.repository";
import { isPaymentDevMode } from "../src/server/modules/payments/dev-mode";
import { db } from "../src/server/db/client";

type Result = "PASS" | "FAIL" | "SKIP";
const rows: Array<[Result, string, string]> = [];
const add = (r: Result, name: string, detail: string) => {
  rows.push([r, name, detail]);
  console.log(`${r.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = getEnv();
  console.log(`RishteyZindagi provider check (NODE_ENV=${env.NODE_ENV})\n`);
  if (env.NODE_ENV === "production") {
    add("FAIL", "environment", "This script is for local/test-mode setup. Refusing to run with NODE_ENV=production.");
    return finish();
  }

  // ---- Razorpay -------------------------------------------------------------------------------
  for (const n of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const) {
    add(env[n] ? "PASS" : "SKIP", `env ${n}`, env[n] ? "set" : "not set (fine if saved in Admin → Payments; webhook secret is only needed to receive webhooks)");
  }
  add(isPaymentDevMode() ? "FAIL" : "PASS", "real Razorpay adapter in use", isPaymentDevMode() ? 'checkout still uses the built-in MOCK gateway — set PAYMENT_PROVIDER_MODE="real"' : "PAYMENT_PROVIDER_MODE=real");

  let creds = null;
  try {
    creds = await loadRazorpayCredentials();
  } catch {
    add("FAIL", "Razorpay credentials", "stored credentials could not be read/decrypted");
  }
  if (!creds) {
    add("FAIL", "Razorpay credentials", "none configured");
  } else {
    add(creds.mode === "test" ? "PASS" : "FAIL", "Razorpay key mode", `detected: ${creds.mode}${creds.mode === "test" ? "" : " — this setup is TEST-only"}`);
    if (creds.problem) add("FAIL", "key-mode guard", creds.problem);
    else {
      const provider = new RazorpayProvider();
      const conn = await provider.testConnection();
      add(conn.ok ? "PASS" : "FAIL", "Razorpay API (read-only)", conn.message);
      if (process.argv.includes("--create-test-order")) {
        if (!conn.ok) add("SKIP", "Razorpay TEST order", "skipped: API check failed");
        else {
          try {
            const order = await provider.createOrder({ amountInSmallestUnit: 100, currency: "INR", receiptRef: `chk_${Date.now()}`.slice(0, 40) });
            add("PASS", "Razorpay TEST order (₹1.00, unpaid)", `created ${order.providerOrderId}`);
          } catch (e) {
            add("FAIL", "Razorpay TEST order", e instanceof Error ? e.message : "failed");
          }
        }
      }
    }
  }

  // ---- SMTP / e-mail OTP ----------------------------------------------------------------------
  for (const n of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const) {
    const required = n === "SMTP_HOST" || n === "EMAIL_FROM";
    add(env[n] ? "PASS" : required ? "FAIL" : "SKIP", `env ${n}`, env[n] ? "set" : required ? "missing (required)" : "not set");
  }
  if (!isMailerConfigured()) {
    add("FAIL", "SMTP", `not configured — set ${missingMailerSettings().join(" and ")}`);
  } else {
    const v = await verifySmtpConnection();
    add(v.ok ? "PASS" : "FAIL", "SMTP connection + login", v.message);
    const to = argValue("--to");
    if (to) {
      if (!v.ok) add("SKIP", "SMTP test e-mail", "skipped: connection check failed");
      else {
        try {
          await sendMail({ to, subject: "RishteyZindagi SMTP test", text: "This is a test message from `npm run check:providers`. It contains no verification code. You can delete it." }, "check-providers");
          add("PASS", "SMTP test e-mail", `accepted by the server for ${to.replace(/^(.).*(@.*)$/, "$1***$2")} — confirm it arrived in that mailbox`);
        } catch (e) {
          add("FAIL", "SMTP test e-mail", e instanceof Error ? e.message : "failed");
        }
      }
    } else add("SKIP", "SMTP test e-mail", "pass --to <your mailbox> to send one");
  }

  // ---- OTP configuration actually used by the app ------------------------------------------------
  try {
    const otp = await getOtpConfig();
    add(otp.activeMethod === "EMAIL" ? "PASS" : "FAIL", "OTP active provider", otp.activeMethod === "EMAIL" ? "EMAIL" : `${otp.activeMethod} — switch to E-mail in Admin → Platform Settings → OTP delivery provider`);
    add(otp.devMode ? "FAIL" : "PASS", "OTP dev mode", otp.devMode ? "ON — codes are kept in memory and NOT e-mailed. Turn it off in Admin → Platform Settings → OTP settings." : "off (codes go through SMTP)");
    add(otp.enabled ? "PASS" : "FAIL", "OTP enabled", otp.enabled ? "yes" : "no");
  } catch {
    add("FAIL", "OTP configuration", "could not read otp_configs — is the database migrated and running?");
  }
  return finish();
}

async function finish() {
  const failed = rows.filter((r) => r[0] === "FAIL").length;
  const passed = rows.filter((r) => r[0] === "PASS").length;
  console.log(`\n${passed} passed, ${failed} failed, ${rows.filter((r) => r[0] === "SKIP").length} skipped`);
  try {
    await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end();
  } catch {
    /* ignore */
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("check-providers crashed:", e instanceof Error ? e.message : "unknown error");
  process.exit(2);
});
