/**
 * Dev-only OTP "provider" — MOCKED FOR DEVELOPMENT, never a real delivery
 * channel. Instead of sending anything, it stores the plaintext code in an
 * in-process Map keyed by identifier+purpose, so automated tests (and a
 * local developer) can drive a full OTP flow deterministically without a
 * real SMS/WhatsApp/Email integration — and, critically, without the code
 * ever appearing in a log line or an API response (see otp.service.ts,
 * which never returns or logs the plaintext code regardless of provider).
 *
 * Structurally incapable of running in production: every entry point here
 * throws if `NODE_ENV=production`, in addition to the factory's own guard
 * (./factory.ts) — two independent checks, so a bug or bypass in one layer
 * doesn't silently enable this in a live environment.
 */
import { getEnv } from "@/server/config/env";
import type { OtpMethod, OtpPurpose } from "../otp.types";
import type { OtpProvider, OtpSendParams } from "./types";

interface DevOtpRecord {
  code: string;
  issuedAt: number;
}

// In-memory only — intentionally never persisted to the database or to
// disk, and never logged.
//
// B16: anchored on `globalThis`. Next.js (dev server especially) may load
// this module once per route bundle, which silently gave the route that
// SENDS a code and the code that READS it two different Maps. A single
// process-wide Map keeps the exact same semantics (in-process, never
// persisted, never logged) while making the dev-only reader reliable.
const globalForDevOtp = globalThis as unknown as { __rzDevOtpStore?: Map<string, DevOtpRecord> };
const devOtpStore: Map<string, DevOtpRecord> = (globalForDevOtp.__rzDevOtpStore ??= new Map<string, DevOtpRecord>());

function devOtpKey(to: string, purpose: OtpPurpose): string {
  return `${purpose}:${to.trim().toLowerCase()}`;
}

function assertNotProduction(context: string) {
  if (getEnv().NODE_ENV === "production") {
    throw new Error(`${context} must never run when NODE_ENV=production.`);
  }
}

export class DevOtpProvider implements OtpProvider {
  constructor(readonly method: OtpMethod) {}

  isConfigured(): boolean {
    // The dev provider never needs real credentials — but it still reports
    // itself as configured only outside production, so a misuse shows up
    // immediately as a ServiceUnavailableError rather than a silent no-op.
    return getEnv().NODE_ENV !== "production";
  }

  async send(params: OtpSendParams): Promise<void> {
    assertNotProduction("DevOtpProvider.send");
    devOtpStore.set(devOtpKey(params.to, params.purpose), { code: params.code, issuedAt: Date.now() });
  }
}

/** Test/dev-only accessor — reads back the code most recently "sent" to a
 * given identifier+purpose. Used by B2 tests to complete an OTP flow. */
export function getDevOtpCode(to: string, purpose: OtpPurpose): string | undefined {
  assertNotProduction("getDevOtpCode");
  return devOtpStore.get(devOtpKey(to, purpose))?.code;
}

/** Test-only: clears all stored dev codes between test cases. */
export function __clearDevOtpStoreForTests() {
  devOtpStore.clear();
}
