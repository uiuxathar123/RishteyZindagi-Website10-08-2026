/**
 * Shared OTP types (B2). Kept as plain TypeScript unions here — rather than
 * importing Drizzle's inferred enum types everywhere — because these values
 * are referenced from route/controller/service/provider code that doesn't
 * otherwise need to know about the schema. They MUST stay in sync with
 * `otpMethodEnum` / `otpPurposeEnum` in `src/server/db/schema.ts`; that file
 * cross-references this comment so a change to one is a reminder to check
 * the other.
 */

/** How an OTP is delivered. Exactly one of these is "active" at a time,
 * platform-wide — see otp_configs / otp-config.service.ts. */
export type OtpMethod = "SMS" | "WHATSAPP" | "EMAIL";

/** Why an OTP was issued. Purposes are fully isolated from one another — an
 * OTP issued for one purpose can never be consumed to satisfy another, even
 * for the same identifier (enforced in otp.repository.ts's lookups). */
export type OtpPurpose = "SIGNUP" | "LOGIN" | "FORGOT_PASSWORD" | "NEW_DEVICE";

export const OTP_METHODS: readonly OtpMethod[] = ["SMS", "WHATSAPP", "EMAIL"];
export const OTP_PURPOSES: readonly OtpPurpose[] = ["SIGNUP", "LOGIN", "FORGOT_PASSWORD", "NEW_DEVICE"];
