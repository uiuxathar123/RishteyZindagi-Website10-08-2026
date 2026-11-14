/**
 * WhatsApp OTP provider — WhatsApp Business Cloud API (Meta), AUTHENTICATION template.
 *
 *   POST {base}/{version}/{WHATSAPP_PHONE_NUMBER_ID}/messages
 *   Authorization: Bearer {WHATSAPP_API_KEY}     (permanent system-user access token)
 *   { messaging_product: "whatsapp", to: "91XXXXXXXXXX", type: "template",
 *     template: { name: WHATSAPP_OTP_TEMPLATE_NAME, language: { code: WHATSAPP_OTP_TEMPLATE_LANG || "en" },
 *       components: [ { type: "body",   parameters: [{ type: "text", text: <code> }] },
 *                     { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: <code> }] } ] } }
 *
 * The template must be an approved Meta "Authentication" template with a Copy-code
 * button (Meta fixes its wording: "<code> is your verification code."). The platform
 * still generates, hashes, expires and attempt-limits every code itself; WhatsApp is
 * only the delivery pipe — exactly like the SMS provider.
 *
 * Fallback: when the member has no usable Indian mobile, or WhatsApp refuses / cannot
 * be reached (e.g. the number is not on WhatsApp), the same code is e-mailed instead
 * if SMTP is configured, so nobody is locked out. If neither works, send() throws.
 *
 * Neither the token nor the code is ever logged or placed in an error.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { httpRequest, resolveBase } from "@/server/modules/payments/providers/http";
import type { OtpProvider, OtpSendParams } from "./types";
import { resolveOtpDestination } from "./destination";
import { EmailOtpProvider } from "./email.provider";

const DEFAULT_BASE = "https://graph.facebook.com";

export class WhatsAppOtpProvider implements OtpProvider {
  readonly method = "WHATSAPP" as const;

  constructor(private readonly emailFallback: OtpProvider = new EmailOtpProvider()) {}

  missingSettings(): string[] {
    const env = getEnv();
    const m: string[] = [];
    if (!env.WHATSAPP_API_KEY) m.push("WHATSAPP_API_KEY");
    if (!env.WHATSAPP_PHONE_NUMBER_ID) m.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!env.WHATSAPP_OTP_TEMPLATE_NAME) m.push("WHATSAPP_OTP_TEMPLATE_NAME");
    return m;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  async send(params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(`WhatsApp OTP delivery is not configured. Set ${this.missingSettings().join(", ")}.`);
    }
    const dest = await resolveOtpDestination(params.to, params.purpose);
    if (dest.mobile && (await this.sendWhatsApp(`91${dest.mobile}`, params.code))) return;

    // Fallback to e-mail so a member without WhatsApp is never locked out.
    if ((dest.email || params.contactEmail) && this.emailFallback.isConfigured()) {
      await this.emailFallback.send(params);
      return;
    }
    throw new ServiceUnavailableError("The WhatsApp code could not be sent right now. Please try again shortly.");
  }

  /** true = Meta accepted the message. Never throws for a delivery problem. */
  private async sendWhatsApp(to: string, code: string): Promise<boolean> {
    const env = getEnv();
    const version = env.WHATSAPP_API_VERSION || "v21.0";
    const url = `${resolveBase(env.WHATSAPP_API_BASE, DEFAULT_BASE)}/${encodeURIComponent(version)}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID as string)}/messages`;
    try {
      const res = await httpRequest("WhatsApp", url, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: env.WHATSAPP_OTP_TEMPLATE_NAME,
            language: { code: env.WHATSAPP_OTP_TEMPLATE_LANG || "en" },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
            ],
          },
        }),
        timeoutMs: 10_000,
      });
      if (res.status >= 200 && res.status < 300) return true;
      // Status + Meta's numeric error code only — never the body (it can echo the number).
      const errCode = (res.json as { error?: { code?: number } } | null)?.error?.code;
      logError("whatsapp-otp-rejected", new Error(`WhatsApp answered HTTP ${res.status}`), { channel: "WHATSAPP", httpStatus: res.status, metaErrorCode: errCode ?? null });
      return false;
    } catch (err) {
      logError("whatsapp-otp-unreachable", err instanceof Error ? new Error(err.message) : new Error("error"), { channel: "WHATSAPP" });
      return false;
    }
  }
}
