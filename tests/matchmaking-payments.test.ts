/**
 * Personal Matchmaking purchase and fulfilment, through the existing payment architecture (dev/mock gateway only):
 * success, failure, amount mismatch, replay, concurrent verification, manual verification, interrupted fulfilment,
 * duplicate-case prevention, order-creation failure — and that membership checkout is unchanged.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invoices, matchmakingCaseEvents, matchmakingCases, memberships, notifications, paymentGateways, payments } from "@/server/db/schema";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { __clearDevPaymentStoreForTests } from "@/server/modules/payments/providers/dev.provider";
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import * as paymentsRepo from "@/server/modules/payments/payments.repository";
import { paymentReconcileJob } from "@/server/jobs/definitions/payments";
import { MATCHMAKING_CONSENT_VERSION } from "@/server/modules/matchmaking/matchmaking-settings";
import { fulfilMatchmakingPayment } from "@/server/modules/matchmaking/matchmaking-fulfilment";
import { POST as membershipCheckout } from "@/app/api/v1/memberships/checkout/route";
import { POST as manualActivate } from "@/app/api/v1/admin/payments/[paymentId]/manual-activate/route";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { resolveReferenceIds, type ReferenceIds } from "./helpers/profile-fixtures";
import { createAdmin, jreq, resetPcpTables, type TestAdmin } from "./helpers/pcp";
import { api, buildCustomer, buyMatchmaking, caseRow, configure, json, paymentRow } from "./helpers/matchmaking";

const DAY = 24 * 60 * 60 * 1000;
let refs: ReferenceIds;
let superAdmin: TestAdmin;

const count = async (table: typeof invoices | typeof matchmakingCaseEvents | typeof notifications, where: ReturnType<typeof eq>) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where))[0].n;

beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetPaymentGatewaysForTests();
  await resetPcpTables();
  __clearDevPaymentStoreForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
  superAdmin = await createAdmin("SUPER_ADMIN");
  await configure(superAdmin.token);
});

describe("Personal Matchmaking — verified purchase", () => {
  it("[mm-pay-success] a verified payment activates the case, grants 30 days of member access, and issues one service invoice", async () => {
    const c = await buildCustomer("mm-pay-ok", refs);
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
    const t0 = Date.now();
    const { caseId, paymentId, verify } = await buyMatchmaking(c.member.sessionToken);
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe("SUCCESS");

    const row = await caseRow(caseId);
    expect(row).toMatchObject({ status: "ACTIVE", paidPaymentId: paymentId, priceInPaise: 499900, currency: "INR", includedMembershipDays: 30, includedAccessRevokedAt: null });
    expect(row.includedAccessUntil!.getTime() - row.paidAt!.getTime()).toBe(30 * DAY);
    expect(row.paidAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);

    // the included access is the chat/interest entitlement — without any membership row or plan
    expect(await hasActiveMembership(c.member.userId)).toBe(true);
    expect(await db.select().from(memberships).where(eq(memberships.userId, c.member.userId))).toEqual([]);

    const inv = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId));
    expect(inv).toHaveLength(1);
    const snap = inv[0].snapshot as { service?: { code: string; includedAccessDays: number }; membership?: unknown; payment: { status: string } };
    expect(snap.membership).toBeUndefined();
    expect(snap.service).toMatchObject({ code: "PERSONAL_MATCHMAKING", includedAccessDays: 30 });
    expect(snap.payment.status).toBe("SUCCESS");

    expect(await count(matchmakingCaseEvents, eq(matchmakingCaseEvents.caseId, caseId))).toBe(2); // CONSENT + activation
    expect(await count(notifications, eq(notifications.dedupeKey, `matchmaking_activated:${caseId}`))).toBe(1);

    const mine = (await json(await api.mine(c.member.sessionToken))).body.data;
    expect(mine.case).toMatchObject({ id: caseId, status: "ACTIVE", includedMembershipDays: 30, accessRevoked: false });
    expect(mine.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(["ACTIVE"]); // the consent event is internal
  });

  it("[mm-pay-replay] replaying verification (and a manual verify) never activates, invoices or notifies twice", async () => {
    const c = await buildCustomer("mm-pay-replay", refs);
    const { caseId, paymentId } = await buyMatchmaking(c.member.sessionToken);
    const before = await caseRow(caseId);
    for (let i = 0; i < 3; i++) expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("ALREADY_RESOLVED");
    const manual = await manualActivate(jreq(`http://localhost/api/v1/admin/payments/${paymentId}/manual-activate`, { body: { reason: "replay check" }, token: superAdmin.token }), { params: { paymentId } });
    expect((await manual.json()).data.status).toBe("ALREADY_RESOLVED");
    const after = await caseRow(caseId);
    expect(after.paidAt).toEqual(before.paidAt);
    expect(after.includedAccessUntil).toEqual(before.includedAccessUntil);
    expect(await count(invoices, eq(invoices.paymentId, paymentId))).toBe(1);
    expect(await count(matchmakingCaseEvents, eq(matchmakingCaseEvents.caseId, caseId))).toBe(2);
    expect(await count(notifications, eq(notifications.dedupeKey, `matchmaking_activated:${caseId}`))).toBe(1);
  });

  it("[mm-pay-concurrent] five simultaneous verifications: exactly one wins, one activation, one invoice", async () => {
    const c = await buildCustomer("mm-pay-race", refs);
    const co = await json(await api.checkout(c.member.sessionToken));
    const { caseId, paymentId } = co.body.data.checkout;
    const results = await Promise.all(Array.from({ length: 5 }, () => api.verify(c.member.sessionToken, paymentId).then(json)));
    const statuses = results.map((r) => r.body.data.status).sort();
    expect(statuses.filter((s) => s === "SUCCESS")).toHaveLength(1);
    expect(statuses.filter((s) => s === "ALREADY_RESOLVED")).toHaveLength(4);
    expect((await caseRow(caseId)).status).toBe("ACTIVE");
    expect(await count(invoices, eq(invoices.paymentId, paymentId))).toBe(1);
    expect(await count(matchmakingCaseEvents, and(eq(matchmakingCaseEvents.caseId, caseId), eq(matchmakingCaseEvents.toStatus, "ACTIVE"))!)).toBe(1);
  });

  it("[mm-pay-failed] a failed payment grants nothing; the member can retry the same case and then succeed", async () => {
    const c = await buildCustomer("mm-pay-fail", refs);
    const first = await buyMatchmaking(c.member.sessionToken, "FAILED");
    expect(first.verify.body.data.status).toBe("FAILED");
    expect(await caseRow(first.caseId)).toMatchObject({ status: "PENDING_PAYMENT", paidPaymentId: null, includedAccessUntil: null });
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
    expect(await count(invoices, eq(invoices.paymentId, first.paymentId))).toBe(0);

    const second = await buyMatchmaking(c.member.sessionToken);
    expect(second.caseId).toBe(first.caseId); // the open case is reused, never duplicated
    expect(second.verify.body.data.status).toBe("SUCCESS");
    expect(await caseRow(second.caseId)).toMatchObject({ status: "ACTIVE", paidPaymentId: second.paymentId });
    expect(await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, c.member.userId))).toHaveLength(1);
  });

  it("[mm-pay-mismatch] a gateway success for a different amount than the stored payment is rejected; nothing is granted", async () => {
    const c = await buildCustomer("mm-pay-mismatch", refs);
    const co = await json(await api.checkout(c.member.sessionToken));
    const { caseId, paymentId } = co.body.data.checkout;
    // the immutable payment row says one amount, the gateway order another (e.g. a tampered checkout)
    await db.update(payments).set({ amountInPaise: 1 }).where(eq(payments.id, paymentId));
    const v = await json(await api.verify(c.member.sessionToken, paymentId));
    expect(v.body.data.status).toBe("FAILED");
    expect(await caseRow(caseId)).toMatchObject({ status: "PENDING_PAYMENT", paidPaymentId: null });
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
    expect(await count(invoices, eq(invoices.paymentId, paymentId))).toBe(0);
  });

  it("[mm-pay-manual] a Super Admin manual verification of a pending payment fulfils the case once", async () => {
    const c = await buildCustomer("mm-pay-manual", refs);
    const co = await json(await api.checkout(c.member.sessionToken, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: "PENDING" }));
    const { caseId, paymentId } = co.body.data.checkout;
    expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("PENDING");
    const res = await manualActivate(jreq(`http://localhost/api/v1/admin/payments/${paymentId}/manual-activate`, { body: { reason: "bank transfer confirmed" }, token: superAdmin.token }), { params: { paymentId } });
    expect((await res.json()).data.status).toBe("SUCCESS");
    expect(await caseRow(caseId)).toMatchObject({ status: "ACTIVE", paidPaymentId: paymentId });
    expect(await count(invoices, eq(invoices.paymentId, paymentId))).toBe(1);
  });

  it("[mm-pay-interrupted] a payment marked SUCCESS whose fulfilment never ran is completed by a replay, and by the reconcile job", async () => {
    for (const via of ["replay", "job"] as const) {
      const c = await buildCustomer(`mm-pay-interrupt-${via}`, refs);
      const co = await json(await api.checkout(c.member.sessionToken));
      const { caseId, paymentId } = co.body.data.checkout;
      // simulate a crash right after the payment's SUCCESS was recorded, before fulfilment
      await paymentsRepo.resolvePaymentOutcome(paymentId, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
      expect((await caseRow(caseId)).status).toBe("PENDING_PAYMENT");
      if (via === "replay") expect((await json(await api.verify(c.member.sessionToken, paymentId))).body.data.status).toBe("ALREADY_RESOLVED");
      else await paymentReconcileJob.run();
      expect(await caseRow(caseId), via).toMatchObject({ status: "ACTIVE", paidPaymentId: paymentId });
      expect(await count(invoices, eq(invoices.paymentId, paymentId)), via).toBe(1);
      expect(await hasActiveMembership(c.member.userId), via).toBe(true);
    }
  });
});

describe("Personal Matchmaking — duplicate capture is surfaced to the Super Admin", () => {
  it("[mm-dup-capture] a second captured payment for a paid case grants nothing and is flagged in the case list and detail", async () => {
    const c = await buildCustomer("mm-dupcap", refs);
    const { caseId, paymentId } = await buyMatchmaking(c.member.sessionToken);
    const first = await paymentRow(paymentId);

    const listed = async () => (await json(await api.admin.listCases(superAdmin.token))).body.data.items.find((i: { id: string }) => i.id === caseId);
    const detail = async () => (await json(await api.admin.getCase(superAdmin.token, caseId))).body.data;
    expect((await listed()).duplicateCaptures).toBe(0);
    const clean = await detail();
    expect(clean.duplicateCaptures).toBe(0);
    expect(clean.payments).toHaveLength(1);
    expect(clean.payments[0]).toMatchObject({ id: paymentId, status: "SUCCESS", isPaidPayment: true, duplicateCapture: false });

    // A second capture for the same case (e.g. the member paid again in another tab and the gateway captured both).
    const dup = await paymentsRepo.createPayment({ userId: c.member.userId, matchmakingCaseId: caseId, gatewayId: first.gatewayId, amountInPaise: first.amountInPaise, currency: first.currency });
    await paymentsRepo.resolvePaymentOutcome(dup.id, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
    expect(await fulfilMatchmakingPayment((await paymentRow(dup.id))!)).toBe("NOT_FULFILLABLE");
    expect((await caseRow(caseId)).paidPaymentId).toBe(paymentId);
    expect(await count(invoices, eq(invoices.paymentId, dup.id))).toBe(0);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "matchmaking.duplicate_payment_captured"), eq(auditLogs.entityId, dup.id)));
    expect(audit).toBeTruthy();

    expect((await listed()).duplicateCaptures).toBe(1);
    const flagged = await detail();
    expect(flagged.duplicateCaptures).toBe(1);
    expect(flagged.payments.find((p: { id: string }) => p.id === dup.id)).toMatchObject({ status: "SUCCESS", isPaidPayment: false, duplicateCapture: true });
    expect(flagged.payments.find((p: { id: string }) => p.id === paymentId)).toMatchObject({ isPaidPayment: true, duplicateCapture: false });

    // Once refunded, the flag clears.
    await db.update(payments).set({ status: "REFUNDED" }).where(eq(payments.id, dup.id));
    expect((await listed()).duplicateCaptures).toBe(0);
    expect((await detail()).duplicateCaptures).toBe(0);
  });

  it("[mm-dup-capture-unpaid] a captured payment on a still-unpaid case is awaiting fulfilment, not a duplicate", async () => {
    const c = await buildCustomer("mm-dupcap-unpaid", refs);
    const co = await json(await api.checkout(c.member.sessionToken, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: "PENDING" }));
    expect(co.status).toBe(201);
    const { caseId, paymentId } = co.body.data.checkout;
    await paymentsRepo.resolvePaymentOutcome(paymentId, { status: "SUCCESS", verifiedAt: new Date(), verificationMethod: "AUTO" });
    const d = (await json(await api.admin.getCase(superAdmin.token, caseId))).body.data;
    expect(d.duplicateCaptures).toBe(0);
    expect(d.payments[0]).toMatchObject({ id: paymentId, status: "SUCCESS", isPaidPayment: false, duplicateCapture: false });
  });
});

describe("Personal Matchmaking — one open case per member", () => {
  it("[mm-dup-case] a second checkout while one is pending or active is refused; concurrent first checkouts create one case", async () => {
    const c = await buildCustomer("mm-dup", refs);
    const pending = await json(await api.checkout(c.member.sessionToken, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: "PENDING" }));
    expect(pending.status).toBe(201);
    const again = await json(await api.checkout(c.member.sessionToken));
    expect(again.status).toBe(409);
    expect(again.body.error.details.paymentId).toBe(pending.body.data.checkout.paymentId);

    const d = await buildCustomer("mm-dup-active", refs);
    await buyMatchmaking(d.member.sessionToken);
    expect((await api.checkout(d.member.sessionToken)).status).toBe(409);

    const e = await buildCustomer("mm-dup-race", refs);
    const racing = await Promise.all([api.checkout(e.member.sessionToken), api.checkout(e.member.sessionToken), api.checkout(e.member.sessionToken)]);
    const codes = racing.map((r) => r.status).sort();
    expect(codes.filter((s) => s === 201)).toHaveLength(1);
    expect(codes.every((s) => s === 201 || s === 409)).toBe(true);
    const [raceCase] = await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, e.member.userId));
    expect(await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, e.member.userId))).toHaveLength(1);
    const pendingFor = async (caseId: string) =>
      db.select().from(payments).where(and(eq(payments.matchmakingCaseId, caseId), eq(payments.status, "PENDING")));
    expect(await pendingFor(raceCase.id)).toHaveLength(1);

    // Retry race on an EXISTING unpaid case (the earlier attempt failed): the case-row lock lets exactly one through.
    await db.update(payments).set({ status: "FAILED" }).where(eq(payments.matchmakingCaseId, raceCase.id));
    for (let round = 0; round < 3; round++) {
      __resetRateLimitsForTests(); // checkout is limited to 10/min per member
      const retry = await Promise.all(Array.from({ length: 4 }, () => api.checkout(e.member.sessionToken)));
      const retryCodes = retry.map((r) => r.status);
      expect(retryCodes.filter((s) => s === 201)).toHaveLength(1);
      expect(retryCodes.filter((s) => s === 409)).toHaveLength(3);
      expect(await pendingFor(raceCase.id)).toHaveLength(1);
      await db.update(payments).set({ status: "FAILED" }).where(eq(payments.matchmakingCaseId, raceCase.id));
    }
  });

  it("[mm-order-failure] with no active gateway the checkout fails cleanly: no case, no payment, no access", async () => {
    await db.update(paymentGateways).set({ isActive: false });
    const c = await buildCustomer("mm-no-gateway", refs);
    expect((await api.checkout(c.member.sessionToken)).status).toBe(503);
    expect(await db.select().from(matchmakingCases).where(eq(matchmakingCases.userId, c.member.userId))).toEqual([]);
    expect(await db.select().from(payments).where(eq(payments.userId, c.member.userId))).toEqual([]);
    expect(await hasActiveMembership(c.member.userId)).toBe(false);
  });
});

describe("membership checkout is unchanged", () => {
  it("[mm-membership-unchanged] a membership purchase still creates an ACTIVE membership and a membership invoice, with no case link", async () => {
    const c = await buildCustomer("mm-membership", refs);
    const co = await membershipCheckout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_MONTHLY_INR" }, token: c.member.sessionToken }));
    const body = (await co.json()).data;
    expect(body.membershipId).toBeTruthy();
    expect(body.caseId).toBeUndefined();
    const v = await json(await api.verify(c.member.sessionToken, body.paymentId));
    expect(v.body.data.status).toBe("SUCCESS");
    const pay = await paymentRow(body.paymentId);
    expect(pay).toMatchObject({ membershipId: body.membershipId, matchmakingCaseId: null, status: "SUCCESS" });
    const [m] = await db.select().from(memberships).where(eq(memberships.id, body.membershipId));
    expect(m.status).toBe("ACTIVE");
    const [inv] = await db.select().from(invoices).where(eq(invoices.paymentId, body.paymentId));
    const snap = inv.snapshot as { membership?: { planCode: string; durationDays: number }; service?: unknown };
    expect(snap.membership).toMatchObject({ planCode: "PLAN_MONTHLY_INR", durationDays: 30 });
    expect(snap.service).toBeUndefined();
    expect(await db.select().from(matchmakingCases)).toEqual([]);
  });

  it("[mm-db-single-purchase] the database refuses a payment linked to both a membership and a case", async () => {
    const c = await buildCustomer("mm-db-check", refs);
    const co = await json(await api.checkout(c.member.sessionToken, { consent: true, consentVersion: MATCHMAKING_CONSENT_VERSION, devSimulateOutcome: "PENDING" }));
    const mco = await membershipCheckout(jreq("http://localhost/api/v1/memberships/checkout", { body: { planCode: "PLAN_7DAY_INR" }, token: c.member.sessionToken }));
    const membershipId = (await mco.json()).data.membershipId;
    await expect(db.update(payments).set({ membershipId }).where(eq(payments.id, co.body.data.checkout.paymentId))).rejects.toThrow();
  });
});
