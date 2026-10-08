/**
 * WhatsApp notification provider — SCAFFOLD, NOT IMPLEMENTED. Same honesty
 * contract as otp/providers/whatsapp.provider.ts (deliberately reuses the
 * same WHATSAPP_PROVIDER/WHATSAPP_API_KEY env vars): no WhatsApp Business
 * API credentials or vendor SDK exist in this sandbox, so `send()` always
 * throws rather than pretending a message was sent.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { NotificationProvider, NotificationSendParams } from "./types";

export class WhatsAppNotificationProvider implements NotificationProvider {
  readonly channel = "WHATSAPP" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.WHATSAPP_PROVIDER) && Boolean(env.WHATSAPP_API_KEY);
  }

  async send(_params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "WhatsApp notification delivery is not configured. Set WHATSAPP_PROVIDER and WHATSAPP_API_KEY."
      );
    }
    throw new ServiceUnavailableError(
      "WhatsApp notification delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
