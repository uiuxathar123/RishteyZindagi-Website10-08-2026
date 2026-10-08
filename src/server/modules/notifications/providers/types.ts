/**
 * B7: notification delivery provider abstraction — deliberately structured
 * identically to B2's OTP provider system (src/server/modules/otp/
 * providers/types.ts), the explicit precedent this file mirrors: one tiny
 * interface, one class per channel, a factory that's the ONE place
 * deciding real-vs-dev.
 *
 * Only EMAIL/WHATSAPP/PUSH are providers here — IN_APP is never a
 * "provider" at all (see notifications.service.ts's `notify()`): an
 * IN_APP notification's delivery IS the `notifications` row's existence,
 * so there is nothing external to call.
 *
 * Contract every implementation must honor (same as OTP's providers):
 *  - `send()` either succeeds because the message was actually handed to
 *    a real delivery integration, or it throws — it must NEVER resolve
 *    successfully without attempting delivery. Faking success is exactly
 *    the "fabricated result" failure mode this codebase refuses
 *    throughout (see BACKEND.md).
 *  - `isConfigured()` is cheap, synchronous-in-spirit, and only checks
 *    that credentials are present — never that they're valid. An
 *    invalid-but-present credential still fails honestly at `send()`
 *    time as a delivery failure, never silently.
 */
export type NotificationChannel = "EMAIL" | "WHATSAPP" | "PUSH";

export interface NotificationSendParams {
  /** Destination address for this channel — resolved by
   * notifications.repository.ts's resolveDestination from the user's
   * profile (email / mobile number). */
  to: string;
  title: string;
  body: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  /** True only when this provider has everything it needs to attempt a
   * real send. Does not guarantee the send will succeed. */
  isConfigured(): boolean;
  /** Attempts real delivery. Resolves on success, throws
   * ServiceUnavailableError (unconfigured) or a delivery-specific error
   * otherwise. */
  send(params: NotificationSendParams): Promise<void>;
}
