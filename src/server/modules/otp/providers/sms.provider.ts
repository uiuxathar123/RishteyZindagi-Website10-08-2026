/**
 * SMS OTP provider — SCAFFOLD, NOT IMPLEMENTED. Honestly documented as such
 * (see BACKEND.md "OTP providers" / the B2 report): this sandbox has no SMS
 * gateway credentials and no vendor SDK wired in, so `send()` always throws
 * rather than pretending an SMS was sent. `isConfigured()` reflects only
 * whether an operator has set the env vars — it is NOT a promise that
 * delivery works, since the actual HTTP call to a real vendor (Twilio,
 * MSG91, etc.) is not implemented yet. Wiring a real vendor is a drop-in
 * change: implement the body of `send()` against that vendor's API and
 * this provider becomes real without touching otp.service.ts or the
 * factory.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type { OtpProvider, OtpSendParams } from "./types";

export class SmsOtpProvider implements OtpProvider {
  readonly method = "SMS" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.SMS_PROVIDER) && Boolean(env.SMS_API_KEY);
  }

  async send(_params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(
        "SMS OTP delivery is not configured. Set SMS_PROVIDER and SMS_API_KEY."
      );
    }
    // Credentials are present, but no real vendor integration is
    // implemented in this codebase — never fabricate a successful send.
    throw new ServiceUnavailableError(
      "SMS OTP delivery has credentials set but no real vendor integration is implemented yet."
    );
  }
}
