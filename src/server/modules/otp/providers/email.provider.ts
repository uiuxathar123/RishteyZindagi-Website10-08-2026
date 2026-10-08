/**
 * Email OTP provider — SCAFFOLD, NOT IMPLEMENTED. Same honesty contract as
 * sms.provider.ts: no email-sending vendor (SES, SendGrid, SMTP, etc.) is
 * wired in, so `send()` always throws rather than pretending an email was
 * sent, even though EMAIL is the platform's default active method (see
 * otp_configs.activeMethod's default). See sms.provider.ts's header for the
 * full rationale.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { OtpProvider, OtpSendParams } from "./types";

export class EmailOtpProvider implements OtpProvider {
  readonly method = "EMAIL" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.EMAIL_PROVIDER) && Boolean(env.EMAIL_API_KEY);
  }

  async send(_params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "Email OTP delivery is not configured. Set EMAIL_PROVIDER and EMAIL_API_KEY."
      );
    }
    throw new ServiceUnavailableError(
      "Email OTP delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
