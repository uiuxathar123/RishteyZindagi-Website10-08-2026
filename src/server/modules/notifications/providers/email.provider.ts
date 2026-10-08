/**
 * Email notification provider — SCAFFOLD, NOT IMPLEMENTED. Same honesty
 * contract as otp/providers/email.provider.ts (deliberately reuses the
 * same EMAIL_PROVIDER/EMAIL_API_KEY env vars — both represent "is a real
 * email vendor configured for this environment", not two independent
 * concerns): no email-sending vendor is wired in, so `send()` always
 * throws rather than pretending an email was sent.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { NotificationProvider, NotificationSendParams } from "./types";

export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = "EMAIL" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.EMAIL_PROVIDER) && Boolean(env.EMAIL_API_KEY);
  }

  async send(_params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "Email notification delivery is not configured. Set EMAIL_PROVIDER and EMAIL_API_KEY."
      );
    }
    throw new ServiceUnavailableError(
      "Email notification delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
