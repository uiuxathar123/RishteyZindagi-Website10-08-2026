/**
 * Resolves the OtpProvider to use for a given method + devMode flag. This
 * is the ONE place that decides real-vs-dev, so otp.service.ts never
 * touches DevOtpProvider directly.
 *
 * devMode is only ever honored when NODE_ENV !== "production" — a hard,
 * code-level guard independent of the `otp_configs.dev_mode` database
 * column, so a misconfigured production database (dev_mode accidentally
 * left on) can never cause a production deploy to skip real OTP delivery.
 * DevOtpProvider itself repeats this same guard (see dev.provider.ts) —
 * intentional defense in depth, not redundancy to trim.
 */
import { getEnv } from "@/server/config/env";
import type { OtpMethod } from "../otp.types";
import type { OtpProvider } from "./types";
import { SmsOtpProvider } from "./sms.provider";
import { WhatsAppOtpProvider } from "./whatsapp.provider";
import { EmailOtpProvider } from "./email.provider";
import { DevOtpProvider } from "./dev.provider";

const realProviders: Record<OtpMethod, OtpProvider> = {
  SMS: new SmsOtpProvider(),
  WHATSAPP: new WhatsAppOtpProvider(),
  EMAIL: new EmailOtpProvider(),
};

export function getOtpProvider(method: OtpMethod, devMode: boolean): OtpProvider {
  const env = getEnv();
  if (devMode && env.NODE_ENV !== "production") {
    return new DevOtpProvider(method);
  }
  return realProviders[method];
}
