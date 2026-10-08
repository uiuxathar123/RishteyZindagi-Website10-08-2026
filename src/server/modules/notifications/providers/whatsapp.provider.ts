/**
 * WhatsApp notification provider — WhatsApp Business Cloud API (Meta).
 *
 *   POST {base}/{version}/{WHATSAPP_PHONE_NUMBER_ID}/messages
 *   Authorization: Bearer {WHATSAPP_API_KEY}   (a permanent system-user access token)
 *   { messaging_product: "whatsapp", to: "<E.164 digits>", type: "template",
 *     template: { name: WHATSAPP_TEMPLATE_NAME, language: { code: "en" },
 *                 components: [{ type: "body", parameters: [{type:"text",text:title},{type:"text",text:body}] }] } }
 *
 * Business-initiated messages outside the 24-hour customer-service window must use
 * an APPROVED template, so a template is always used; its body must accept two
 * text variables ({{1}} = title, {{2}} = body). Creating / getting the template
 * approved by Meta is an external prerequisite (REQUIRES EXTERNAL CREDENTIALS).
 * Env: WHATSAPP_API_KEY, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME,
 * optional WHATSAPP_API_VERSION (default v21.0). Secrets are never logged.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { httpRequest, resolveBase } from "@/server/modules/payments/providers/http";
import type { NotificationProvider, NotificationSendParams } from "./types";

const DEFAULT_BASE = "https://graph.facebook.com";

export class WhatsAppNotificationProvider implements NotificationProvider {
  readonly channel = "WHATSAPP" as const;

  missingSettings(): string[] {
    const env = getEnv();
    const m: string[] = [];
    if (!env.WHATSAPP_API_KEY) m.push("WHATSAPP_API_KEY");
    if (!env.WHATSAPP_PHONE_NUMBER_ID) m.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!env.WHATSAPP_TEMPLATE_NAME) m.push("WHATSAPP_TEMPLATE_NAME");
    return m;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  async send(params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(`WhatsApp notification delivery is not configured. Set ${this.missingSettings().join(", ")}.`);
    }
    const env = getEnv();
    const to = params.to.replace(/[^\d]/g, "");
    if (!/^\d{10,15}$/.test(to)) throw new ServiceUnavailableError("No valid WhatsApp number is available for this member.");
    const version = env.WHATSAPP_API_VERSION || "v21.0";
    const url = `${resolveBase(env.WHATSAPP_API_BASE, DEFAULT_BASE)}/${encodeURIComponent(version)}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID as string)}/messages`;
    const res = await httpRequest("WhatsApp", url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME,
          language: { code: "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: params.title.slice(0, 100) }, { type: "text", text: params.body.slice(0, 900) }] }],
        },
      }),
      timeoutMs: 10_000,
    });
    if (res.status < 200 || res.status >= 300) {
      logError("whatsapp-send-failed", new Error(`WhatsApp answered HTTP ${res.status}`), { httpStatus: res.status });
      throw new ServiceUnavailableError("The WhatsApp message could not be delivered.");
    }
  }
}
