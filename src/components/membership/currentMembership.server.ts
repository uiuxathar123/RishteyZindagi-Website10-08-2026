import "server-only";
import { serverGet } from "@/lib/api/server";
import type { MembershipView } from "@/lib/api/types";
import type { CurrentMembershipSummary } from "./planUtils";

/**
 * For server-rendered public pages: is someone signed in, and which plan is
 * their ACTIVE membership? (Read from the real API with the httpOnly
 * cookie; a signed-out visitor simply gets `signedIn: false`.)
 *
 * Uses the membership *history* rather than `/memberships/me`, because the
 * latter returns the single most-recent row of any status — a newer PENDING
 * checkout row would hide an ACTIVE membership.
 */
export async function getCurrentMembershipSummary(): Promise<{
  signedIn: boolean;
  current: CurrentMembershipSummary | null;
}> {
  const history = await serverGet<{ memberships: MembershipView[] }>("member", "/memberships/me/history");
  if (!history) return { signedIn: false, current: null };
  const now = Date.now();
  const active = history.memberships.find(
    (m) => m.status === "ACTIVE" && (!m.expiresAt || new Date(m.expiresAt).getTime() > now)
  );
  return { signedIn: true, current: active ? { planId: active.planId, expiresAt: active.expiresAt } : null };
}
