import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { getStorageProvider } from "@/server/modules/storage/factory";
import { ok, fail } from "@/server/lib/response";

export async function healthHandler() {
  try {
    await db.execute(sql`select 1`);
    return ok({ status: "ok", database: "connected" });
  } catch {
    // Deliberately NOT using the shared error-handling wrapper's generic
    // 500 here — a failed health check should say exactly what's down
    // (there's nothing sensitive in "database: disconnected"), and it
    // should never throw, since a monitoring probe expects a clean
    // response even when the answer is "unhealthy".
    return fail("INTERNAL_ERROR", "Database is unreachable.", 503);
  }
}

// --- B14: deep readiness check -------------------------------------------
//
// `healthHandler` above (GET /api/v1/health) is left completely untouched
// — it is the simple liveness probe most load balancers/orchestrators
// expect ("is the process up and can it reach its database"), and its
// existing test (tests/health.test.ts) asserts its exact response shape,
// so changing its envelope would be a frozen-file/frozen-test change for
// no real benefit.
//
// `readyHandler` (GET /api/v1/health/ready) is a NEW, separate endpoint
// that answers a different question: "can this instance actually serve
// real traffic right now", broken into three independently-reported
// layers per B14 §38:
//   1. application  — always "alive" if this code is running at all
//      (if the process couldn't run, nothing would ever send a response).
//   2. database     — the same `select 1` liveness check as /health.
//   3. dependencies — whether at least one OTP delivery channel and the
//      configured storage provider are USABLE, reported as booleans only
//      (`"configured"` / `"not_configured"`) — never a credential, key,
//      or connection string. This mirrors getEnv()'s own "never logs the
//      values themselves" discipline (see env.ts) and OTP/payment
//      providers' own isConfigured() pattern — B14 adds no new way to
//      leak a secret, it only surfaces the same booleans those layers
//      already compute internally.
//
// Judgment call (documented in DEPLOYMENT.md / BACKEND.md §58): the HTTP
// status code reflects the database layer ONLY (200 when connected, 503
// when not) — the same contract /health already has, so an orchestrator
// that swaps one endpoint for the other sees no behavior change. Whether
// an OTP channel or the storage provider is configured is a *business*
// readiness concern (can members actually receive an OTP / upload a
// photo right now), not an *infrastructure* one (should this instance be
// pulled from the load balancer) — those are reported in the body via
// `status: "ok" | "degraded"` and per-dependency booleans so a human or a
// deeper monitoring check can act on them, without the orchestrator's
// basic health probe flapping the instance in/out of rotation over a
// config gap that a restart won't fix anyway.
export async function readyHandler() {
  let databaseConnected = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    databaseConnected = false;
  }

  const env = getEnv();
  const otp = {
    email: !!env.EMAIL_API_KEY ? "configured" : "not_configured",
    sms: !!env.SMS_API_KEY ? "configured" : "not_configured",
    whatsapp: !!env.WHATSAPP_API_KEY ? "configured" : "not_configured",
  } as const;
  const otpChannelConfigured = otp.email === "configured" || otp.sms === "configured" || otp.whatsapp === "configured";

  let storageConfigured = false;
  try {
    storageConfigured = getStorageProvider().isConfigured();
  } catch {
    storageConfigured = false;
  }

  const body = {
    status: databaseConnected && otpChannelConfigured && storageConfigured ? "ok" : "degraded",
    checks: {
      application: "alive",
      database: databaseConnected ? "connected" : "disconnected",
      dependencies: {
        otp,
        storageProvider: storageConfigured ? "configured" : "not_configured",
      },
    },
  } as const;

  if (!databaseConnected) {
    // Status code mirrors /health exactly — an infra-level failure, the
    // one thing a liveness/readiness probe should actually act on.
    return fail("INTERNAL_ERROR", "Database is unreachable.", 503, body);
  }
  return ok(body);
}
