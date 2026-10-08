/**
 * B8: response shaping for memberships.
 */
import type { MembershipRow } from "./memberships.repository";

export interface MembershipView {
  id: string;
  planId: string;
  status: "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  startedAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  createdAt: string;
}

export function toMembershipView(row: MembershipRow): MembershipView {
  return {
    id: row.id,
    planId: row.planId,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    autoRenew: row.autoRenew,
    createdAt: row.createdAt.toISOString(),
  };
}
