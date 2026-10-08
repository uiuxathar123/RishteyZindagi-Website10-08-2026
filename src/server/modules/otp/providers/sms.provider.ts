/**
 * SMS OTP provider — Fast2SMS official "OTP" API (api method key FAST2SMS_SMS).
 *
 *   POST https://www.fast2sms.com/dev/otp/send
 *   header  Authorization: <FAST2SMS_API_KEY>
 *   JSON    { mobile: "<10 digits>", otp_id: "<FAST2SMS_OTP_ID>", otp: "<our code>",
 *             otp_length, otp_expiry: <minutes> }
 *   200     { return: true, status_code: 200, request_id }
 *   400/401 { return: false, message }
 *
 * Design decision (documented in PRODUCTION_COMPLETION_AUDIT.md): the platform
 * generates, hashes, expires and attempt-limits every code itself and passes it
 * to Fast2SMS in the `otp` field purely for delivery. Fast2SMS's own /verify
 * endpoint is deliberately NOT used: it is keyed by mobile number alone (no
 * purpose scoping), which would break purpose isolation and the ticket flow,
 * and would make an in-flight code depend on which provider is active.
 *
 * The API key comes from the environment only. Neither the key nor the code is
 * ever logged or placed in an error. Only Indian 10-digit mobiles are supported.
 * Whether Fast2SMS accepts the account's key/template is NOT VERIFIED until real
 * credentials are used (REQUIRES EXTERNAL CREDENTIALS).
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError, ValidationError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { httpRequest, pick, resolveBase } from "@/server/modules/payments/providers/http";
import type { OtpProvider, OtpSendParams } from "./types";
import { resolveOtpDestination } from "./destination";

const DEFAULT_BASE = "https://www.fast2sms.com/dev";

export class SmsOtpProvider implements OtpProvider {
  readonly method = "SMS" as const;

  missingSettings(): string[] {
    const env = getEnv();
    const missing: string[] = [];
    if (!env.FAST2SMS_API_KEY) missing.push("FAST2SMS_API_KEY");
    if (!env.FAST2SMS_OTP_ID) missing.push("FAST2SMS_OTP_ID");
    return missing;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  async send(params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(`SMS OTP delivery is not configured. Set ${this.missingSettings().join(" and ")}.`);
    }
    const env = getEnv();
    const dest = await resolveOtpDestination(params.to, params.purpose);
    if (!dest.mobile) {
      throw new ValidationError("SMS codes can only be sent to a valid 10-digit Indian mobile number.");
    }
    if (params.code.length > 10) throw new ServiceUnavailableError("The OTP is too long for SMS delivery.");

    let res;
    try {
      res = await httpRequest("Fast2SMS", `${resolveBase(env.FAST2SMS_API_BASE, DEFAULT_BASE)}/otp/send`, {
        method: "POST",
        headers: { Authorization: env.FAST2SMS_API_KEY as string, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mobile: dest.mobile,
          otp_id: env.FAST2SMS_OTP_ID,
          otp: params.code,
          otp_length: params.code.length,
          otp_expiry: Math.max(1, Math.round(params.expirySeconds / 60)),
        }),
        timeoutMs: 10_000,
      });
    } catch (err) {
      logError("fast2sms-unreachable", err instanceof Error ? new Error(err.message) : new Error("error"), { channel: "SMS" });
      throw new ServiceUnavailableError("The SMS could not be sent right now. Please try again shortly.");
    }

    const accepted = res.status === 200 && pick(res.json, "return") === true;
    if (!accepted) {
      // Status only — never the response body (may echo the number) and never request data.
      logError("fast2sms-rejected", new Error(`Fast2SMS answered HTTP ${res.status}`), { channel: "SMS", httpStatus: res.status });
      if (res.status === 401 || res.status === 403) {
        throw new ServiceUnavailableError("SMS delivery is misconfigured on the platform. Please try again later or contact support.");
      }
      throw new ServiceUnavailableError("The SMS could not be sent right now. Please try again shortly.");
    }
  }
}
