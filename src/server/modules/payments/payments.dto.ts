/**
 * B8: response shaping for payments — never exposes anything beyond
 * what's already safe (no raw gateway credentials live on this table at
 * all; `rawResponse`/`config` blobs live on `transactions`/
 * `payment_gateways`, not here).
 */
import type { PaymentRow } from "./payments.repository";

export interface PaymentView {
  id: string;
  membershipId: string | null;
  /** Personal Matchmaking: the case this payment is for (never set together with membershipId). */
  matchmakingCaseId: string | null;
  gatewayId: string;
  amountInPaise: number;
  currency: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  gatewayReference: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPaymentView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    membershipId: row.membershipId,
    matchmakingCaseId: row.matchmakingCaseId,
    gatewayId: row.gatewayId,
    amountInPaise: row.amountInPaise,
    currency: row.currency,
    status: row.status,
    gatewayReference: row.gatewayReference,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verificationMethod: row.verificationMethod,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
