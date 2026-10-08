/**
 * OTP delivery provider abstraction (B2). Every channel (SMS/WhatsApp/
 * Email) implements this same tiny interface, so otp.service.ts never
 * branches on "which channel" beyond asking the factory (./factory.ts) for
 * the right instance.
 *
 * Contract every implementation must honor:
 *  - `send()` either succeeds because the code was actually handed to a
 *    real delivery integration, or it throws — it must NEVER resolve
 *    successfully without attempting delivery. Faking success is exactly
 *    the "fabricated test results" failure mode the B2 brief calls out.
 *  - `send()` must never log or persist the plaintext `code` itself. The
 *    caller (otp.service.ts) already stores only a keyed hash; a provider
 *    implementation must not introduce a second, unhashed copy via its own
 *    logging.
 *  - `isConfigured()` must be cheap and synchronous-in-spirit (no network
 *    call) — it only checks that the credentials this provider needs are
 *    present, not that they're valid. An invalid-but-present credential
 *    still fails at `send()` time, honestly, as a delivery failure.
 */
import type { OtpMethod, OtpPurpose } from "../otp.types";

export interface OtpSendParams {
  /** Destination address for this channel — an email address for EMAIL, a
   * phone number (with country code) for SMS/WHATSAPP. */
  to: string;
  /** Plaintext OTP code. Never logged, never persisted unhashed. */
  code: string;
  purpose: OtpPurpose;
  /** How many seconds until this code expires — providers that template
   * their message (e.g. "expires in 5 minutes") may use this. */
  expirySeconds: number;
}

export interface OtpProvider {
  readonly method: OtpMethod;
  /** True only when this provider has everything it needs to attempt a
   * real send. Does not guarantee the send will succeed. */
  isConfigured(): boolean;
  /** Attempts real delivery. Resolves on success, throws
   * ServiceUnavailableError (unconfigured) or a delivery-specific error
   * otherwise. */
  send(params: OtpSendParams): Promise<void>;
}
