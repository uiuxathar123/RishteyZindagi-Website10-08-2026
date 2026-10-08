/**
 * Dev-only notification "provider" — MOCKED FOR DEVELOPMENT, never a real
 * delivery channel. Structurally identical to OTP's DevOtpProvider
 * (src/server/modules/otp/providers/dev.provider.ts), including its
 * "structurally incapable of running in production" double guard: every
 * entry point here throws if `NODE_ENV=production`, independent of the
 * factory's own guard (./factory.ts) — two independent checks, so a bug
 * or bypass in one layer doesn't silently enable this in a live
 * environment.
 *
 * Instead of sending anything, it stores the title/body in an in-process
 * Map keyed by channel+destination, so automated tests can read back what
 * would have been "sent" without a real Email/WhatsApp/Push integration.
 */
import { getEnv } from "@/server/config/env";
import type { NotificationChannel, NotificationProvider, NotificationSendParams } from "./types";

interface DevNotificationRecord {
  title: string;
  body: string;
  sentAt: number;
}

// In-memory only — never persisted to the database or to disk.
const devNotificationStore = new Map<string, DevNotificationRecord>();

function devKey(channel: NotificationChannel, to: string): string {
  return `${channel}:${to.trim().toLowerCase()}`;
}

function assertNotProduction(context: string) {
  if (getEnv().NODE_ENV === "production") {
    throw new Error(`${context} must never run when NODE_ENV=production.`);
  }
}

export class DevNotificationProvider implements NotificationProvider {
  constructor(readonly channel: NotificationChannel) {}

  isConfigured(): boolean {
    return getEnv().NODE_ENV !== "production";
  }

  async send(params: NotificationSendParams): Promise<void> {
    assertNotProduction("DevNotificationProvider.send");
    devNotificationStore.set(devKey(this.channel, params.to), {
      title: params.title,
      body: params.body,
      sentAt: Date.now(),
    });
  }
}

/** Test/dev-only accessor — reads back the most recent "send" to a given
 * channel+destination. Used by B7 tests to verify the dev provider path. */
export function getDevNotificationSend(channel: NotificationChannel, to: string): DevNotificationRecord | undefined {
  assertNotProduction("getDevNotificationSend");
  return devNotificationStore.get(devKey(channel, to));
}

/** Test-only: clears all stored dev notifications between test cases. */
export function __clearDevNotificationStoreForTests() {
  devNotificationStore.clear();
}
