/**
 * B13 (Performance/Scalability phase) regression test for the pagination-
 * drift fix disclosed in PERFORMANCE_REPORT.md / BACKEND.md's B13
 * section: every genuinely paginated (LIMIT/OFFSET) list query in this
 * codebase now orders by its natural timestamp column PLUS the table's
 * own `id` as an always-unique tiebreaker (`chat.repository.ts`'s
 * `listMessages`, `notifications.repository.ts`'s `listForUser`,
 * `admin/users-admin.repository.ts`'s `searchUsers`, `admin/invoices-
 * admin.repository.ts`'s `searchInvoices`, `admin/memberships-admin
 * .repository.ts`'s `listMemberships`, `admin/audit-logs.repository.ts`'s
 * `listAuditLogs`, `reports.repository.ts`'s `listReports`, and
 * `payments.repository.ts`'s new `listForAdmin`).
 *
 * Without a unique tiebreaker, Postgres's `ORDER BY <timestamp>` gives no
 * guarantee about the RELATIVE order of two rows that share the exact
 * same timestamp value (a real possibility — these columns are
 * millisecond-precision `timestamptz`, and bulk inserts/fast successive
 * writes can easily collide) — across two separate LIMIT/OFFSET calls
 * (page 1, then page 2) that ambiguity can manifest as the same row
 * appearing on both pages, or a row appearing on neither ("pagination
 * drift"). This file inserts several rows sharing one IDENTICAL
 * timestamp for each list, pages through all of them in small page-size
 * slices, and asserts the union of every page is exactly the full
 * inserted set with no duplicates and no gaps.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/server/db/client";
import { inArray } from "drizzle-orm";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import {
  chats,
  chatParticipants,
  matches,
  messages,
  notifications,
  reports,
  reportCategories,
  payments,
  paymentGateways,
  users,
  invoices,
} from "@/server/db/schema";
import * as chatRepo from "@/server/modules/chat/chat.repository";
import * as notificationsRepo from "@/server/modules/notifications/notifications.repository";
import * as usersAdminRepo from "@/server/modules/admin/users-admin.repository";
import * as invoicesAdminRepo from "@/server/modules/admin/invoices-admin.repository";
import * as reportsRepo from "@/server/modules/reports/reports.repository";
import * as paymentsRepo from "@/server/modules/payments/payments.repository";
import { resetTransactionalTables, resetPaymentGatewaysForTests, resetReportAndWarningCategoriesForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";

/** Pages through `fetchPage` in `pageSize` slices until every page is
 * empty (or a safety cap is hit), and asserts the union of every page's
 * item ids is exactly `expectedIds` with zero duplicates and zero gaps
 * — the real-world contract "every row is shown exactly once across the
 * full pagination sequence", which is exactly what a missing unique
 * tiebreaker can silently violate. */
async function assertCompleteStablePagination(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: Array<{ id: string }> }>,
  expectedIds: string[],
  pageSize: number
) {
  const seen = new Set<string>();
  const allIds: string[] = [];
  let page = 1;
  const safetyCap = Math.ceil(expectedIds.length / pageSize) + 3;
  while (page <= safetyCap) {
    const { items } = await fetchPage(page, pageSize);
    if (items.length === 0) break;
    for (const item of items) {
      allIds.push(item.id);
      seen.add(item.id);
    }
    page += 1;
  }
  // No duplicate across the whole sequence (would mean the same row was
  // returned on two different pages — drift).
  expect(allIds.length).toBe(seen.size);
  // Every expected id was returned somewhere (no gap — a row silently
  // skipped between two pages).
  expect(seen).toEqual(new Set(expectedIds));
}

describe("B13 pagination-drift regression — identical-timestamp rows still paginate completely, with no duplicates and no gaps", () => {
  beforeEach(() => {
    __resetRateLimitsForTests();
  });

  it("[perf-page-messages] chat.repository.listMessages", async () => {
    await resetTransactionalTables();
    const a = await createVerifiedMember("perf-page-msg-a");
    const b = await createVerifiedMember("perf-page-msg-b");
    const [match] = await db.insert(matches).values({ userAId: a.userId, userBId: b.userId }).returning();
    const [chat] = await db.insert(chats).values({ matchId: match.id }).returning();
    await db.insert(chatParticipants).values([{ chatId: chat.id, userId: a.userId }, { chatId: chat.id, userId: b.userId }]);

    const tiedSentAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = await db
      .insert(messages)
      .values(Array.from({ length: 7 }, (_, i) => ({ chatId: chat.id, senderUserId: a.userId, body: `m${i}`, sentAt: tiedSentAt })))
      .returning();
    const expectedIds = rows.map((r) => r.id);

    await assertCompleteStablePagination((page, pageSize) => chatRepo.listMessages(chat.id, page, pageSize), expectedIds, 3);
  });

  it("[perf-page-notifications] notifications.repository.listForUser", async () => {
    await resetTransactionalTables();
    const member = await createVerifiedMember("perf-page-notif");
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = await db
      .insert(notifications)
      .values(
        Array.from({ length: 7 }, (_, i) => ({
          userId: member.userId,
          channel: "IN_APP" as const,
          title: `n${i}`,
          body: `n${i}`,
          deliveryStatus: "DELIVERED" as const,
          createdAt: tiedCreatedAt,
        }))
      )
      .returning();
    const expectedIds = rows.map((r) => r.id);

    await assertCompleteStablePagination((page, pageSize) => notificationsRepo.listForUser(member.userId, page, pageSize), expectedIds, 3);
  });

  it("[perf-page-admin-users] admin/users-admin.repository.searchUsers", async () => {
    await resetTransactionalTables();
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const members = await Promise.all(Array.from({ length: 6 }, (_, i) => createVerifiedMember(`perf-page-adminuser-${i}`)));
    await db
      .update(users)
      .set({ createdAt: tiedCreatedAt })
      .where(inArray(users.id, members.map((m) => m.userId)));
    const expectedIds = members.map((m) => m.userId);

    await assertCompleteStablePagination(
      async (page, pageSize) => {
        const { items, total } = await usersAdminRepo.searchUsers({}, page, pageSize);
        return { items: items.filter((i) => expectedIds.includes(i.user.id)).map((i) => ({ id: i.user.id })), total } as never;
      },
      expectedIds,
      // Small page size, but scan enough pages to walk past any other
      // seeded/admin-created users ahead of our tied-timestamp batch in
      // desc(createdAt) order (our batch is set to a fixed past date).
      3
    );
  });

  it("[perf-page-invoices] admin/invoices-admin.repository.searchInvoices", async () => {
    await resetTransactionalTables();
    const member = await createVerifiedMember("perf-page-invoice");
    const tiedIssuedAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = await db
      .insert(invoices)
      .values(
        Array.from({ length: 7 }, (_, i) => ({
          userId: member.userId,
          invoiceNumber: `PERF-PAGE-INV-${Date.now()}-${i}`,
          amountInPaise: 100,
          snapshot: {},
          issuedAt: tiedIssuedAt,
        }))
      )
      .returning();
    const expectedIds = rows.map((r) => r.id);

    await assertCompleteStablePagination(
      (page, pageSize) => invoicesAdminRepo.searchInvoices({ userId: member.userId }, page, pageSize),
      expectedIds,
      3
    );
  });

  it("[perf-page-reports] reports.repository.listReports", async () => {
    await resetTransactionalTables();
    await resetReportAndWarningCategoriesForTests();
    const reporter = await createVerifiedMember("perf-page-report-reporter");
    const target = await createVerifiedMember("perf-page-report-target");
    const [category] = await db.select().from(reportCategories).limit(1);
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = await db
      .insert(reports)
      .values(
        Array.from({ length: 7 }, () => ({
          reporterUserId: reporter.userId,
          reportedUserId: target.userId,
          categoryId: category.id,
          status: "OPEN" as const,
          createdAt: tiedCreatedAt,
        }))
      )
      .returning();
    const expectedIds = rows.map((r) => r.id);

    await assertCompleteStablePagination(
      (page, pageSize) => reportsRepo.listReports({ reportedUserId: target.userId }, page, pageSize),
      expectedIds,
      3
    );
  });

  it("[perf-page-admin-payments] payments.repository.listForAdmin (also the unbounded-admin-list fix's own regression coverage)", async () => {
    await resetTransactionalTables();
    await resetPaymentGatewaysForTests();
    const member = await createVerifiedMember("perf-page-payment");
    const [gateway] = await db.select().from(paymentGateways).limit(1);
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = await db
      .insert(payments)
      .values(
        Array.from({ length: 7 }, () => ({
          userId: member.userId,
          gatewayId: gateway.id,
          amountInPaise: 100,
          status: "PENDING" as const,
          createdAt: tiedCreatedAt,
        }))
      )
      .returning();
    const expectedIds = rows.map((r) => r.id);

    await assertCompleteStablePagination((page, pageSize) => paymentsRepo.listForAdmin({}, page, pageSize), expectedIds, 3);
  });
});
