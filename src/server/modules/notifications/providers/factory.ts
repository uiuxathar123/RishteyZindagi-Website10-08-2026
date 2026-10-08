/**
 * Resolves the NotificationProvider to use for a given channel + devMode
 * flag. This is the ONE place that decides real-vs-dev, mirroring OTP's
 * own factory (src/server/modules/otp/providers/factory.ts) exactly.
 *
 * devMode is only ever honored when NODE_ENV !== "production" — a hard,
 * code-level guard, so an environment that somehow computed devMode=true
 * in production (see notifications.service.ts's notify() for exactly how
 * devMode is derived) can never cause a production deploy to skip real
 * delivery. DevNotificationProvider itself repeats this same guard (see
 * dev.provider.ts) — intentional defense in depth, not redundancy to
 * trim.
 */
import { getEnv } from "@/server/config/env";
import type { NotificationChannel, NotificationProvider } from "./types";
import { EmailNotificationProvider } from "./email.provider";
import { WhatsAppNotificationProvider } from "./whatsapp.provider";
import { PushNotificationProvider } from "./push.provider";
import { DevNotificationProvider } from "./dev.provider";

const realProviders: Record<NotificationChannel, NotificationProvider> = {
  EMAIL: new EmailNotificationProvider(),
  WHATSAPP: new WhatsAppNotificationProvider(),
  PUSH: new PushNotificationProvider(),
};

export function getNotificationProvider(channel: NotificationChannel, devMode: boolean): NotificationProvider {
  const env = getEnv();
  if (devMode && env.NODE_ENV !== "production") {
    return new DevNotificationProvider(channel);
  }
  return realProviders[channel];
}
