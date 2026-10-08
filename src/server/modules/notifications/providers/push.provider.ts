/**
 * Push notification provider — SCAFFOLD, NOT IMPLEMENTED. Same honesty
 * contract as the SMS/Email/WhatsApp scaffolds this mirrors: no push
 * vendor (FCM/APNs/etc.) is wired in, and — unlike email/mobile number —
 * this schema has no device-push-token store anywhere yet (out of B7
 * scope; a future phase would add one alongside a real vendor), so
 * `isConfigured()` is false in every environment until PUSH_PROVIDER/
 * PUSH_API_KEY are set AND a token store exists. `send()` always throws
 * rather than pretending a push was delivered.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { NotificationProvider, NotificationSendParams } from "./types";

export class PushNotificationProvider implements NotificationProvider {
  readonly channel = "PUSH" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.PUSH_PROVIDER) && Boolean(env.PUSH_API_KEY);
  }

  async send(_params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "Push notification delivery is not configured. Set PUSH_PROVIDER and PUSH_API_KEY."
      );
    }
    throw new ServiceUnavailableError(
      "Push notification delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
