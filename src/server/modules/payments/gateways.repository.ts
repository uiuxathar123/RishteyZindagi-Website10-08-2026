/**
 * B8: data access for `payment_gateways` — B1 schema-only foundation
 * (never read or written by any code through B7) that this phase turns
 * into real, admin-managed gateway configuration.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { paymentGateways } from "@/server/db/schema";

export type PaymentGatewayRow = typeof paymentGateways.$inferSelect;

/** Shape stored inside the `config` jsonb column. Encrypted values are
 * opaque ciphertext strings (see src/server/lib/crypto.ts) — never the
 * plaintext credential. Non-secret display fields (mode, a masked last-4)
 * live alongside them in the same object since this table has no other
 * place to put admin-configurable, non-credential settings, mirroring
 * `otp_configs`'s single-row-of-settings shape (just per-gateway here
 * instead of a singleton). */
export interface GatewayConfig {
  mode?: "test" | "live";
  merchantIdLast4?: string;
  encrypted?: {
    apiKey?: string;
    apiSecret?: string;
    merchantId?: string;
    webhookSecret?: string;
    // PCP additions (PhonePe): OAuth client version and the webhook basic-auth pair.
    clientVersion?: string;
    webhookUsername?: string;
    webhookPassword?: string;
  };
}

export async function listAll(): Promise<PaymentGatewayRow[]> {
  return db.select().from(paymentGateways).orderBy(paymentGateways.name);
}

export async function findById(id: string): Promise<PaymentGatewayRow | undefined> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.id, id)).limit(1);
  return row;
}

export async function findByName(name: string): Promise<PaymentGatewayRow | undefined> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.name, name)).limit(1);
  return row;
}

export async function findActive(): Promise<PaymentGatewayRow | undefined> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.isActive, true)).limit(1);
  return row;
}

export async function updateConfig(id: string, config: GatewayConfig): Promise<PaymentGatewayRow> {
  const [row] = await db.update(paymentGateways).set({ config }).where(eq(paymentGateways.id, id)).returning();
  return row;
}

/**
 * Atomically makes exactly ONE gateway active — deactivates every other
 * row, then activates this one, inside a single transaction, so no
 * concurrent request can ever observe (or leave behind) more than one
 * active gateway. Service-level enforcement of the "exactly one active"
 * invariant, the same simpler-than-a-partial-unique-index approach the
 * task brief itself suggests and `matching_weight_configs`'s own
 * singleton-row precedent already established for "exactly one row of
 * live configuration" in this codebase.
 */
export async function setActiveGateway(id: string): Promise<PaymentGatewayRow> {
  return db.transaction(async (tx) => {
    await tx.update(paymentGateways).set({ isActive: false });
    const [row] = await tx.update(paymentGateways).set({ isActive: true }).where(eq(paymentGateways.id, id)).returning();
    return row;
  });
}

export async function setEnabled(id: string, isActive: boolean): Promise<PaymentGatewayRow> {
  const [row] = await db.update(paymentGateways).set({ isActive }).where(eq(paymentGateways.id, id)).returning();
  return row;
}
