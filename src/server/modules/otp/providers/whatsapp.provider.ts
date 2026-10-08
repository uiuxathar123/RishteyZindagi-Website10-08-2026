/**
 * WhatsApp OTP provider — SCAFFOLD, NOT IMPLEMENTED. Same honesty contract
 * as sms.provider.ts: no WhatsApp Business API credentials or vendor SDK
 * exist in this sandbox, so `send()` always throws rather than pretending
 * a message was sent. See sms.provider.ts's header for the full rationale.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { OtpProvider, OtpSendParams } from "./types";

export class WhatsAppOtpProvider implements OtpProvider {
  readonly method = "WHATSAPP" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.WHATSAPP_PROVIDER) && Boolean(env.WHATSAPP_API_KEY);
  }

  async send(_params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "WhatsApp OTP delivery is not configured. Set WHATSAPP_PROVIDER and WHATSAPP_API_KEY."
      );
    }
    throw new ServiceUnavailableError(
      "WhatsApp OTP delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
