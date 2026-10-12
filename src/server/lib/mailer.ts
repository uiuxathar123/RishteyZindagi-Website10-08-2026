/**
 * PCP: the one SMTP sender (nodemailer). Used by the EMAIL OTP provider and the
 * notification e-mail adapter.
 *
 *  - Credentials come from the environment only (SMTP_HOST/PORT/SECURE/USER/PASS,
 *    EMAIL_FROM) — never from the database, never returned by any API.
 *  - Hard connection / greeting / socket timeouts so a dead SMTP server cannot
 *    hang a request.
 *  - Errors surfaced to callers are generic; the SMTP response text is never
 *    copied into an error message (it can echo addresses) and the message BODY
 *    (which for OTP mail contains the code) is never logged.
 *  - Delivery is never faked: if SMTP is not configured, `sendMail` throws.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function isMailerConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SMTP_HOST) && Boolean(env.EMAIL_FROM);
}

export function missingMailerSettings(): string[] {
  const env = getEnv();
  const missing: string[] = [];
  if (!env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");
  return missing;
}

let cached: { key: string; transport: Transporter } | null = null;

function transport(): Transporter {
  const env = getEnv();
  const secure = (env.SMTP_SECURE ?? "").toLowerCase() === "true";
  const port = env.SMTP_PORT ?? (secure ? 465 : 587);
  const key = [env.SMTP_HOST, port, secure, env.SMTP_USER, env.SMTP_PASS ? "pw" : ""].join("|");
  if (cached && cached.key === key) return cached.transport;
  const auth = env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined;
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth,
    // Outside production a local test SMTP server without TLS is acceptable; in production STARTTLS is mandatory on non-implicit-TLS ports.
    requireTLS: env.NODE_ENV === "production" && !secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  cached = { key, transport: t };
  return t;
}

export function __resetMailerForTests() {
  cached?.transport.close();
  cached = null;
}

export async function sendMail(message: MailMessage, context: string): Promise<void> {
  if (!isMailerConfigured()) {
    throw new ServiceUnavailableError("E-mail delivery is not configured. Set SMTP_HOST and EMAIL_FROM.");
  }
  const env = getEnv();
  try {
    await transport().sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (err) {
    // Only the error class / SMTP status code — never the message or the response text.
    const code = (err as { responseCode?: number; code?: string })?.responseCode ?? (err as { code?: string })?.code ?? "UNKNOWN";
    logError("smtp-send-failed", new Error(`SMTP failure (${String(code)})`), { context });
    throw new ServiceUnavailableError("The e-mail could not be delivered right now. Please try again shortly.");
  }
}

/**
 * Opens a connection, negotiates TLS/STARTTLS and authenticates — without sending anything. Used by
 * `npm run check:providers` and available to an admin diagnostic. The result carries only a generic message and
 * an SMTP/network error CLASS (e.g. "EAUTH", "ECONNREFUSED", "535"), never the server's response text.
 */
export async function verifySmtpConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isMailerConfigured()) return { ok: false, message: `E-mail delivery is not configured. Set ${missingMailerSettings().join(" and ")}.` };
  try {
    await transport().verify();
    return { ok: true, message: "SMTP server accepted the connection and credentials." };
  } catch (err) {
    const code = (err as { responseCode?: number; code?: string })?.responseCode ?? (err as { code?: string })?.code ?? "UNKNOWN";
    logError("smtp-verify-failed", new Error(`SMTP verify failure (${String(code)})`), { context: "verify" });
    return { ok: false, message: `SMTP connection or login failed (${String(code)}). Check host, port, SMTP_SECURE and the account's app password.` };
  }
}
