/**
 * B8: data access for `invoices` and `invoice_logs` — B1 schema-only
 * foundation (never written by any code through B7) that this phase
 * turns into real, generated invoices.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invoices, invoiceLogs } from "@/server/db/schema";
import { generateInvoiceNumber } from "./invoice-number";
import type { InvoiceSnapshot } from "./invoice-pdf";

export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLogRow = typeof invoiceLogs.$inferSelect;

const MAX_NUMBER_RETRIES = 5;

export interface InsertInvoiceInput {
  userId: string;
  paymentId: string;
  amountInPaise: number;
  snapshot: InvoiceSnapshot;
}

/**
 * Retry-on-conflict loop for `invoiceNumber`'s uniqueness — the
 * millisecond-precision format (see invoice-number.ts) makes a
 * same-millisecond collision vanishingly unlikely, but "unlikely" is
 * never treated as "impossible": a genuine unique-constraint violation
 * is caught and retried with a freshly-generated number, up to
 * MAX_NUMBER_RETRIES times, rather than assumed away.
 */
export async function insertWithUniqueNumber(input: InsertInvoiceInput): Promise<InvoiceRow> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
    const invoiceNumber = generateInvoiceNumber();
    try {
      const [row] = await db
        .insert(invoices)
        .values({
          userId: input.userId,
          paymentId: input.paymentId,
          invoiceNumber,
          amountInPaise: input.amountInPaise,
          status: "ISSUED",
          snapshot: input.snapshot as unknown as object,
        })
        .returning();
      return row;
    } catch (err) {
      lastErr = err;
      // Only retry a genuine unique-constraint violation (Postgres code
      // 23505) on invoiceNumber specifically — any other error propagates
      // immediately rather than being silently retried.
      const pgCode = (err as { code?: string } | undefined)?.code;
      if (pgCode !== "23505") throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to generate a unique invoice number after retries.");
}

export async function findById(id: string): Promise<InvoiceRow | undefined> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return row;
}

export async function findByPaymentId(paymentId: string): Promise<InvoiceRow | undefined> {
  const [row] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1);
  return row;
}

export async function listByUser(userId: string): Promise<InvoiceRow[]> {
  return db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.issuedAt));
}

export async function setPaid(id: string): Promise<InvoiceRow> {
  const [row] = await db.update(invoices).set({ status: "PAID" }).where(eq(invoices.id, id)).returning();
  return row;
}

/** VOID = the product's "CANCELLED" state (see schema.ts's
 * invoiceStatusEnum reuse note) — the invoice's own number/amount/PDF
 * are never touched, only these three fields are set. */
export async function voidInvoice(id: string, reason: string): Promise<InvoiceRow> {
  const [row] = await db
    .update(invoices)
    .set({ status: "VOID", cancelledAt: new Date(), cancellationReason: reason })
    .where(eq(invoices.id, id))
    .returning();
  return row;
}

export async function setPdfStorageKey(id: string, key: string): Promise<InvoiceRow> {
  const [row] = await db.update(invoices).set({ pdfStorageKey: key }).where(eq(invoices.id, id)).returning();
  return row;
}

export interface AddLogInput {
  invoiceId: string;
  action: string;
  actorAdminId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function addLog(input: AddLogInput): Promise<InvoiceLogRow> {
  const [row] = await db
    .insert(invoiceLogs)
    .values({ invoiceId: input.invoiceId, action: input.action, actorAdminId: input.actorAdminId ?? null, metadata: input.metadata })
    .returning();
  return row;
}
