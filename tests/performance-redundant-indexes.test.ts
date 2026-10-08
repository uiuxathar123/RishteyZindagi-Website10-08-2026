/**
 * B13 (Performance/Scalability phase) regression test for the redundant-
 * index removal disclosed in schema.ts / drizzle/0010_b13_performance_
 * indexes.sql / PERFORMANCE_REPORT.md / BACKEND.md's B13 section.
 *
 * Four columns (`transactions.transaction_ref`, `invoices.invoice_
 * number`, `chats.match_id`, `otps.ticket_hash`) each had BOTH a
 * `.unique()` constraint (which Postgres implements as its own unique
 * btree index) AND a second, separately-declared plain `index(...)` on
 * that exact same single column — confirmed via `\d <table>` against the
 * real database before this phase. The second, redundant index was
 * dropped (write-path cost, zero read-path benefit); the unique
 * constraint (and the index it implies) was NOT touched.
 *
 * This file proves, against the real (migrated) database, that:
 *   1. the 4 named redundant indexes genuinely no longer exist;
 *   2. each unique constraint (and its implied index) still exists and
 *      still enforces uniqueness — a duplicate value is still rejected,
 *      exactly as before;
 *   3. a real lookup-by-that-column query (the same shape each
 *      repository actually issues) still returns the correct row — the
 *      removal changed zero read behavior.
 */
import { describe, it, expect } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { transactions, invoices, chats, otps, payments, matches, users, paymentGateways } from "@/server/db/schema";
import { resetTransactionalTables, resetPaymentGatewaysForTests } from "./helpers/reset-db";
import { createVerifiedMember } from "./helpers/profile-fixtures";

async function indexExists(indexName: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM pg_indexes WHERE indexname = ${indexName}`);
  return result.rows.length > 0;
}

describe("B13 redundant-index removal — dropped indexes gone, unique constraints + lookups unaffected", () => {
  it("[perf-idx-dropped] the 4 redundant single-column indexes no longer exist in the real database", async () => {
    expect(await indexExists("transactions_ref_idx")).toBe(false);
    expect(await indexExists("invoices_number_idx")).toBe(false);
    expect(await indexExists("chats_match_idx")).toBe(false);
    expect(await indexExists("otps_ticket_hash_idx")).toBe(false);
  });

  it("[perf-idx-unique-kept] each column's underlying unique constraint index is still present", async () => {
    expect(await indexExists("transactions_transaction_ref_unique")).toBe(true);
    expect(await indexExists("invoices_invoice_number_unique")).toBe(true);
    expect(await indexExists("chats_match_id_unique")).toBe(true);
    expect(await indexExists("otps_ticket_hash_unique")).toBe(true);
  });

  it("[perf-idx-transactions-unique-enforced] duplicate transaction_ref is still rejected, and lookup-by-ref still returns the right row", async () => {
    await resetTransactionalTables();
    await resetPaymentGatewaysForTests();
    const member = await createVerifiedMember("perf-idx-txn");
    const [gateway] = await db.select().from(paymentGateways).limit(1);
    const [payment] = await db
      .insert(payments)
      .values({ userId: member.userId, gatewayId: gateway.id, amountInPaise: 100, status: "PENDING" })
      .returning();

    const ref = `TXN-perf-idx-${Date.now()}`;
    const [row] = await db
      .insert(transactions)
      .values({ paymentId: payment.id, transactionRef: ref, amountInPaise: 100, status: "PENDING" })
      .returning();

    // Lookup-by-ref (the real webhook/verify query shape) still works.
    const [found] = await db.select().from(transactions).where(eq(transactions.transactionRef, ref)).limit(1);
    expect(found?.id).toBe(row.id);

    // The unique constraint still rejects a duplicate.
    await expect(
      db.insert(transactions).values({ paymentId: payment.id, transactionRef: ref, amountInPaise: 100, status: "PENDING" })
    ).rejects.toThrow();
  });

  it("[perf-idx-invoices-unique-enforced] duplicate invoice_number is still rejected, and lookup-by-number still returns the right row", async () => {
    await resetTransactionalTables();
    const member = await createVerifiedMember("perf-idx-inv");
    const invoiceNumber = `INV-PERF-IDX-${Date.now()}`;
    const [row] = await db
      .insert(invoices)
      .values({ userId: member.userId, invoiceNumber, amountInPaise: 100, snapshot: {} })
      .returning();

    const [found] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
    expect(found?.id).toBe(row.id);

    await expect(
      db.insert(invoices).values({ userId: member.userId, invoiceNumber, amountInPaise: 100, snapshot: {} })
    ).rejects.toThrow();
  });

  it("[perf-idx-chats-unique-enforced] duplicate match_id on chats is still rejected (the 'one chat per match' invariant), and lookup-by-match still returns the right row", async () => {
    await resetTransactionalTables();
    const a = await createVerifiedMember("perf-idx-chat-a");
    const b = await createVerifiedMember("perf-idx-chat-b");
    const [match] = await db.insert(matches).values({ userAId: a.userId, userBId: b.userId }).returning();
    const [chat] = await db.insert(chats).values({ matchId: match.id }).returning();

    const [found] = await db.select().from(chats).where(eq(chats.matchId, match.id)).limit(1);
    expect(found?.id).toBe(chat.id);

    await expect(db.insert(chats).values({ matchId: match.id })).rejects.toThrow();
  });

  it("[perf-idx-otps-unique-enforced] duplicate ticket_hash is still rejected, and lookup-by-ticket-hash still returns the right row", async () => {
    await resetTransactionalTables();
    const member = await createVerifiedMember("perf-idx-otp");
    const ticketHash = `perf-idx-ticket-${Date.now()}`;
    const [row] = await db
      .insert(otps)
      .values({
        purpose: "LOGIN",
        channel: "EMAIL",
        identifier: member.email,
        userId: member.userId,
        codeHash: "x",
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        ticketHash,
      })
      .returning();

    const [found] = await db.select().from(otps).where(eq(otps.ticketHash, ticketHash)).limit(1);
    expect(found?.id).toBe(row.id);

    await expect(
      db.insert(otps).values({
        purpose: "LOGIN",
        channel: "EMAIL",
        identifier: member.email,
        userId: member.userId,
        codeHash: "x",
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        ticketHash,
      })
    ).rejects.toThrow();
  });
});
