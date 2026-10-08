/**
 * Production Completion Phase — automation jobs (membership expiry / reminders /
 * failed renewal, payment reconciliation, account-deletion finalisation).
 *
 * Every job is run through the real runner (advisory lock, job_runs row, audit entry).
 * Payment reconciliation uses the real Razorpay adapter against the protocol mock.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER_MODE = "real";
  process.env.RAZORPAY_API_BASE = "http://127.0.0.1:45871";
  process.env.APP_URL = "http://localhost:3000";
  process.env.CRON_SECRET = "pcp-test-cron-secret-0123456789abcdef0123456789";
});

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, jobRuns, membershipPlans, memberships, notifications, payments, paymentRefunds, transactions, users } from "@/server/db/schema";
import { runJob } from "@/server/jobs/runner";
import { listJobs } from "@/server/jobs/registry";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { startMockRazorpay, type MockRazorpay } from "./helpers/mock-gateways";

import { PUT as putCredentials } from "@/app/api/v1/admin/payments/config/[gateway]/credentials/route";
import { PATCH as patchConfig } from "@/app/api/v1/admin/payments/config/route";
import { POST as checkout } from "@/app/api/v1/memberships/checkout/route";
import { POST as createRefund } from "@/app/api/v1/admin/payments/[paymentId]/refunds/route";
import { POST as verifyPayment } from "@/app/api/v1/payments/[paymentId]/verify/route";
import { POST as jobPost } from "@/app/api/v1/internal/jobs/[job]/route";

const RZP = { keyId: "rzp_test_AbCdEf123456", keySecret: "razorpay-key-secret-123", webhookSecret: "razorpay-webhook-secret-1" };
const DAY = 24 * 60 * 60 * 1000;

let rzp: MockRazorpay;
let admin: TestAdmin;

beforeAll(async () => {
  rzp = await startMockRazorpay({ keyId: RZP.keyId, keySecret: RZP.keySecret });
});
afterAll(async () => {
  await rzp?.close();
});

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __resetRateLimitsForTests();
  rzp.requests.length = 0;
  rzp.orders.clear();
  rzp.payments.clear();
  rzp.refunds.clear();
  rzp.failNext = null;
  rzp.newRefundStatus = "pending";
  admin = await createAdmin("SUPER_ADMIN");
});

async function planId(code = "PLAN_7DAY_INR") {
  const [p] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, code));
  return p.id;
}
async function addMembership(userId: string, over: Partial<typeof memberships.$inferInsert>) {
  const [m] = await db
    .insert(memberships)
    .values({ userId, planId: await planId(), status: "ACTIVE", startedAt: new Date(Date.now() - 5 * DAY), expiresAt: new Date(Date.now() + 5 * DAY), ...over })
    .returning();
  return m;
}
const notesFor = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));
const membershipOf = async (id: string) => (await db.select().from(memberships).where(eq(memberships.id, id)))[0];
async function run(job: string) {
  const r = await runJob(job, "CLI");
  expect(r?.status, JSON.stringify(r)).toBe("SUCCEEDED");
  return r!.stats as Record<string, number>;
}

// ---------------------------------------------------------------------------
describe("job registry", () => {
  it("[jobs-registered] every production job is registered with a schedule and description", () => {
    const names = listJobs().map((j) => j.name);
    for (const n of ["housekeeping", "membership-expiry", "membership-reminders", "membership-renewal-failed", "payment-reconcile", "account-deletion-finalize"]) {
      expect(names).toContain(n);
    }
    for (const j of listJobs()) {
      expect(j.suggestedSchedule).toMatch(/\S+ \S+ \S+ \S+ \S+/);
      expect(j.description.length).toBeGreaterThan(10);
    }
  });

  it("[jobs-http-trigger] a job can be triggered over HTTP with the cron secret and writes a job_runs row + audit entry", async () => {
    const res = await jobPost(jreq("http://localhost/api/v1/internal/jobs/membership-expiry", { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), {
      params: { job: "membership-expiry" },
    } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("SUCCEEDED");
    const [row] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "membership-expiry"));
    expect(row.status).toBe("SUCCEEDED");
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "job.completed"));
    expect(logs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("membership-expiry", () => {
  it("[exp-expires-and-notifies-once] ACTIVE past expiry -> EXPIRED with one notice; future / PENDING / cancelled rows untouched; second run is a no-op", async () => {
    const a = await createVerifiedMember("exp-a");
    const b = await createVerifiedMember("exp-b");
    const c = await createVerifiedMember("exp-c");
    const d = await createVerifiedMember("exp-d");
    const past = await addMembership(a.userId, { expiresAt: new Date(Date.now() - 60_000) });
    const future = await addMembership(b.userId, { expiresAt: new Date(Date.now() + DAY) });
    const pending = await addMembership(c.userId, { status: "PENDING", startedAt: null, expiresAt: null });
    const cancelled = await addMembership(d.userId, { status: "CANCELLED", expiresAt: new Date(Date.now() - DAY) });

    const s1 = await run("membership-expiry");
    expect(s1.expired).toBe(1);
    expect((await membershipOf(past.id)).status).toBe("EXPIRED");
    expect((await membershipOf(future.id)).status).toBe("ACTIVE");
    expect((await membershipOf(pending.id)).status).toBe("PENDING");
    expect((await membershipOf(cancelled.id)).status).toBe("CANCELLED");
    expect((await notesFor(a.userId)).filter((n) => n.dedupeKey === `membership_expired:${past.id}`).length).toBe(1);
    expect((await notesFor(b.userId)).length).toBe(0);

    const s2 = await run("membership-expiry");
    expect(s2.expired).toBe(0);
    expect((await notesFor(a.userId)).filter((n) => n.dedupeKey === `membership_expired:${past.id}`).length).toBe(1);
  });

  it("[exp-concurrent-runs] two overlapping runs never double-apply: one is SKIPPED_LOCKED or both leave exactly one notice", async () => {
    const a = await createVerifiedMember("exp-conc");
    const m = await addMembership(a.userId, { expiresAt: new Date(Date.now() - 1000) });
    const results = await Promise.all([runJob("membership-expiry", "CLI"), runJob("membership-expiry", "CLI"), runJob("membership-expiry", "HTTP")]);
    expect(results.every((r) => r && (r.status === "SUCCEEDED" || r.status === "SKIPPED_LOCKED"))).toBe(true);
    expect(results.some((r) => r!.status === "SUCCEEDED")).toBe(true);
    expect((await membershipOf(m.id)).status).toBe("EXPIRED");
    expect((await notesFor(a.userId)).filter((n) => n.dedupeKey === `membership_expired:${m.id}`).length).toBe(1);
  });

  it("[exp-access-gate] after the job runs the member no longer has an active membership", async () => {
    const a = await createVerifiedMember("exp-gate");
    await addMembership(a.userId, { expiresAt: new Date(Date.now() - 1000) });
    await run("membership-expiry");
    const rows = await db.select().from(memberships).where(and(eq(memberships.userId, a.userId), eq(memberships.status, "ACTIVE")));
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("membership-reminders", () => {
  it("[rem-stages] one 7-day-stage and one 3-day-stage notice per membership, never repeated; far-off and expired rows get none", async () => {
    const m5 = await createVerifiedMember("rem-5d");
    const m2 = await createVerifiedMember("rem-2d");
    const m30 = await createVerifiedMember("rem-30d");
    const mGone = await createVerifiedMember("rem-gone");
    const x5 = await addMembership(m5.userId, { expiresAt: new Date(Date.now() + 5 * DAY) });
    const x2 = await addMembership(m2.userId, { expiresAt: new Date(Date.now() + 2 * DAY) });
    await addMembership(m30.userId, { expiresAt: new Date(Date.now() + 30 * DAY) });
    await addMembership(mGone.userId, { status: "EXPIRED", expiresAt: new Date(Date.now() - DAY) });

    const s1 = await run("membership-reminders");
    expect(s1.reminded).toBe(2);
    expect((await notesFor(m5.userId)).map((n) => n.dedupeKey)).toEqual([`renewal_reminder_7d:${x5.id}`]);
    expect((await notesFor(m2.userId)).map((n) => n.dedupeKey)).toEqual([`renewal_reminder_3d:${x2.id}`]);
    expect((await notesFor(m30.userId)).length).toBe(0);
    expect((await notesFor(mGone.userId)).length).toBe(0);

    const s2 = await run("membership-reminders");
    expect(s2.reminded).toBe(0);

    // the same membership moves into the 3-day stage later -> exactly one more notice
    await db.update(memberships).set({ expiresAt: new Date(Date.now() + 2 * DAY) }).where(eq(memberships.id, x5.id));
    expect((await run("membership-reminders")).reminded).toBe(1);
    expect((await notesFor(m5.userId)).length).toBe(2);
    expect((await run("membership-reminders")).reminded).toBe(0);
  });

  it("[rem-skips-inactive-accounts] suspended or deleted members are not messaged", async () => {
    const s = await createVerifiedMember("rem-susp");
    await addMembership(s.userId, { expiresAt: new Date(Date.now() + 2 * DAY) });
    await db.update(users).set({ status: "SUSPENDED" }).where(eq(users.id, s.userId));
    expect((await run("membership-reminders")).reminded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("membership-renewal-failed", () => {
  it("[ren-notifies-once-and-never-fakes-a-charge] lapsed auto-renew membership -> one notice, auto-renew cleared, no payment created", async () => {
    const a = await createVerifiedMember("ren-a");
    const m = await addMembership(a.userId, { status: "EXPIRED", autoRenew: true, expiresAt: new Date(Date.now() - DAY) });
    const before = await db.select().from(payments);

    const s1 = await run("membership-renewal-failed");
    expect(s1.flagged).toBe(1);
    expect((await membershipOf(m.id)).autoRenew).toBe(false);
    const notes = (await notesFor(a.userId)).filter((n) => n.dedupeKey === `auto_renewal_failed:${m.id}`);
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe("Automatic renewal failed");
    expect((await db.select().from(payments)).length).toBe(before.length);

    expect((await run("membership-renewal-failed")).flagged).toBe(0);
    expect((await notesFor(a.userId)).filter((n) => n.dedupeKey === `auto_renewal_failed:${m.id}`).length).toBe(1);
  });

  it("[ren-skips-already-renewed] a member who already has a newer ACTIVE/PENDING membership is not told renewal failed", async () => {
    const a = await createVerifiedMember("ren-b");
    const old = await addMembership(a.userId, { status: "EXPIRED", autoRenew: true, expiresAt: new Date(Date.now() - 2 * DAY), createdAt: new Date(Date.now() - 10 * DAY) });
    await addMembership(a.userId, { status: "ACTIVE" });
    expect((await run("membership-renewal-failed")).flagged).toBe(0);
    expect((await membershipOf(old.id)).autoRenew).toBe(true);
    expect((await notesFor(a.userId)).length).toBe(0);
  });

  it("[ren-ignores-non-auto-renew] EXPIRED without auto-renew is left alone", async () => {
    const a = await createVerifiedMember("ren-c");
    await addMembership(a.userId, { status: "EXPIRED", autoRenew: false, expiresAt: new Date(Date.now() - DAY) });
    expect((await run("membership-renewal-failed")).flagged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
async function saveRazorpay() {
  const r = await putCredentials(
    jreq("http://localhost/api/v1/admin/payments/config/razorpay/credentials", { method: "PUT", body: { mode: "test", ...RZP }, token: admin.token }),
    { params: { gateway: "razorpay" } }
  );
  expect(r.status).toBe(200);
  const a = await patchConfig(jreq("http://localhost/api/v1/admin/payments/config", { method: "PATCH", body: { activeGateway: "RAZORPAY" }, token: admin.token }));
  expect(a.status).toBe(200);
}
async function pendingPayment(label: string) {
  await saveRazorpay();
  const member = await createVerifiedMember(label);
  const res = await checkout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_7DAY_INR" }, token: member.sessionToken }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { member, paymentId: body.data.paymentId as string, membershipId: body.data.membershipId as string, orderId: body.data.gatewayCheckout.orderId as string };
}
const ageTo = (paymentId: string, minutes: number) =>
  db.update(payments).set({ createdAt: new Date(Date.now() - minutes * 60_000) }).where(eq(payments.id, paymentId));
const payment = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id)))[0];

describe("payment-reconcile", () => {
  it("[pay-recent-untouched] a fresh PENDING payment is not even queried", async () => {
    const p = await pendingPayment("rec-fresh");
    const before = rzp.requests.length;
    const s = await run("payment-reconcile");
    expect(s.checked).toBe(0);
    expect(rzp.requests.length).toBe(before);
    expect((await payment(p.paymentId)).status).toBe("PENDING");
  });

  it("[pay-pending-not-expired-stays] older than 10 min but within the expiry window and unpaid -> still PENDING", async () => {
    const p = await pendingPayment("rec-wait");
    await ageTo(p.paymentId, 20);
    const s = await run("payment-reconcile");
    expect(s.checked).toBe(1);
    expect(s.stillPending).toBe(1);
    expect(s.expiredClosed).toBe(0);
    expect((await payment(p.paymentId)).status).toBe("PENDING");
  });

  it("[pay-recovers-missed-webhook] captured at the gateway but never confirmed -> reconcile verifies it and activates the membership", async () => {
    const p = await pendingPayment("rec-paid");
    rzp.capture(p.orderId);
    await ageTo(p.paymentId, 30);
    const s = await run("payment-reconcile");
    expect(s.resolved).toBe(1);
    const pay = await payment(p.paymentId);
    expect(pay.status).toBe("SUCCESS");
    expect((await membershipOf(p.membershipId)).status).toBe("ACTIVE");
    // idempotent
    const s2 = await run("payment-reconcile");
    expect(s2.checked).toBe(0);
  });

  it("[pay-expired-unpaid-closed] unpaid after the expiry window -> FAILED, transaction FAILED, audited, member told; second run no-op", async () => {
    const p = await pendingPayment("rec-expire");
    await ageTo(p.paymentId, 180);
    const s = await run("payment-reconcile");
    expect(s.expiredClosed).toBe(1);
    expect((await payment(p.paymentId)).status).toBe("FAILED");
    const txns = await db.select().from(transactions).where(eq(transactions.paymentId, p.paymentId));
    expect(txns.every((t) => t.status === "FAILED")).toBe(true);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.expired_unpaid"));
    expect(logs.length).toBe(1);
    expect((await notesFor(p.member.userId)).filter((n) => n.dedupeKey === `payment_failed:${p.paymentId}`).length).toBe(1);
    expect((await membershipOf(p.membershipId)).status).toBe("PENDING");
    expect((await run("payment-reconcile")).checked).toBe(0);
  });

  it("[pay-gateway-down-never-closes] if the gateway cannot be asked, an expired PENDING payment is left alone (it may have been paid)", async () => {
    const p = await pendingPayment("rec-down");
    await ageTo(p.paymentId, 180);
    await rzp.close();
    try {
      const s = await run("payment-reconcile");
      expect(s.gatewayErrors).toBeGreaterThanOrEqual(1);
      expect(s.expiredClosed).toBe(0);
      expect((await payment(p.paymentId)).status).toBe("PENDING");
    } finally {
      rzp = await startMockRazorpay({ keyId: RZP.keyId, keySecret: RZP.keySecret });
    }
  });

  it("[pay-never-ordered-closed] a PENDING payment that never got a gateway order is closed after expiry", async () => {
    const p = await pendingPayment("rec-noorder");
    await db.update(payments).set({ gatewayReference: null }).where(eq(payments.id, p.paymentId));
    await ageTo(p.paymentId, 180);
    const s = await run("payment-reconcile");
    expect(s.expiredClosed).toBe(1);
    expect((await payment(p.paymentId)).status).toBe("FAILED");
  });

  it("[pay-late-capture-flagged-once] a payment closed as FAILED that is captured afterwards is flagged for manual review exactly once (check throttled to hourly)", async () => {
    const p = await pendingPayment("rec-late");
    await ageTo(p.paymentId, 180);
    await run("payment-reconcile");
    expect((await payment(p.paymentId)).status).toBe("FAILED");

    rzp.capture(p.orderId);
    // throttle: the previous run already checked within the hour
    let s = await run("payment-reconcile");
    expect(s.lateCaptureChecked).toBe(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.late_capture_detected"))).length).toBe(0);

    await db.execute(sql`UPDATE job_runs SET started_at = now() - interval '2 hours'`);
    s = await run("payment-reconcile");
    expect(s.lateCaptureChecked).toBe(1);
    const flagged = await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.late_capture_detected"));
    expect(flagged.length).toBe(1);
    expect(flagged[0].entityId).toBe(p.paymentId);
    // the payment is NOT silently activated
    expect((await payment(p.paymentId)).status).toBe("FAILED");

    await db.execute(sql`UPDATE job_runs SET started_at = now() - interval '4 hours'`);
    s = await run("payment-reconcile");
    expect(s.lateCaptureChecked).toBe(0);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "payment.late_capture_detected"))).length).toBe(1);
  });

  it("[pay-refund-sync] a PENDING refund processed at the gateway is picked up by the job (payment -> REFUNDED, membership cancelled)", async () => {
    const p = await pendingPayment("rec-refund");
    rzp.capture(p.orderId);
    const v = await verifyPayment(jreq(`http://localhost/api/v1/payments/${p.paymentId}/verify`, { body: {}, token: p.member.sessionToken }), { params: { paymentId: p.paymentId } });
    expect(v.status).toBe(200);
    const rf = await createRefund(
      jreq(`http://localhost/api/v1/admin/payments/${p.paymentId}/refunds`, { body: { reason: "customer request" }, token: admin.token }),
      { params: { paymentId: p.paymentId } }
    );
    expect(rf.status).toBe(201);
    const [refund] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, p.paymentId));
    expect(refund.status).toBe("PENDING");

    rzp.setRefundStatus(refund.providerRefundId!, "processed");
    await db.execute(sql`UPDATE payment_refunds SET created_at = now() - interval '1 hour'`);
    const s = await run("payment-reconcile");
    expect(s.refundsChecked).toBe(1);
    expect(s.refundsResolved).toBe(1);
    expect((await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, refund.id)))[0].status).toBe("PROCESSED");
    expect((await payment(p.paymentId)).status).toBe("REFUNDED");
    expect((await membershipOf(p.membershipId)).status).toBe("CANCELLED");
    expect((await run("payment-reconcile")).refundsChecked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("account-deletion-finalize", () => {
  it("[del-finalizes-only-after-window] DELETED_PENDING inside the recovery window is kept; past it the account is anonymised; idempotent", async () => {
    const inside = await createVerifiedMember("del-inside");
    const past = await createVerifiedMember("del-past");
    await db.update(users).set({ status: "DELETED_PENDING", deletedAt: new Date(Date.now() - 5 * DAY) }).where(eq(users.id, inside.userId));
    await db.update(users).set({ status: "DELETED_PENDING", deletedAt: new Date(Date.now() - 45 * DAY) }).where(eq(users.id, past.userId));

    const s1 = await run("account-deletion-finalize");
    expect(s1.finalized).toBe(1);
    const [i] = await db.select().from(users).where(eq(users.id, inside.userId));
    const [p] = await db.select().from(users).where(eq(users.id, past.userId));
    expect(i.status).toBe("DELETED_PENDING");
    expect(i.email).toBe(inside.email);
    expect(p.status).toBe("DELETED");
    expect(p.email).not.toBe(past.email);

    expect((await run("account-deletion-finalize")).finalized).toBe(0);
  });
});
