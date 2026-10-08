/**
 * B11: business rules for push-notification device-token registration —
 * the "genuinely missing piece" the B11 task brief names. `send()` on the
 * push provider (providers/push.provider.ts) still honestly throws — no
 * real vendor (FCM/APNs) is wired in, unchanged from B7 — this module only
 * completes the *addressing* half: where a real integration would look up
 * "which devices does this user have", exactly as EMAIL/WHATSAPP already
 * address by the user's own stored email/mobile number.
 *
 * Identity rule (per the B11 brief, "never trust device token as user
 * identity"): every write is scoped to `ctx.subject.id` from the
 * authenticated session — a client can never register or revoke a token
 * against an arbitrary `userId` it supplies, and can never revoke a token
 * it doesn't own (same IDOR posture as every other B6/B7/B8 module: an
 * unowned resource id produces the identical AuthorizationError whether it
 * doesn't exist or simply isn't the caller's).
 */
import { AuthorizationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import { record as recordAudit, actorTypeFromSubject } from "@/server/modules/audit/audit.service";
import * as repo from "./push-tokens.repository";
import type { PushTokenRow, PushPlatform } from "./push-tokens.repository";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

export async function registerToken(ctx: AuthContext, token: string, platform: PushPlatform): Promise<PushTokenRow> {
  const userId = requireMemberSubject(ctx);
  const row = await repo.upsertToken(userId, token, platform);
  await recordAudit({
    actorType: actorTypeFromSubject(ctx.subject.type),
    actorId: userId,
    action: "push_token.register",
    entityType: "device_push_token",
    entityId: row.id,
    metadata: { platform },
  });
  return row;
}

export async function listMyTokens(ctx: AuthContext): Promise<PushTokenRow[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listActiveForUser(userId);
}

/**
 * Invalidates one of the caller's own tokens, looked up by either the
 * row's own id (a uuid — what `registerToken`'s response returns, so a
 * client that kept it can target precisely) or the raw token string itself
 * (so a client can revoke-on-logout even if it never persisted the row id,
 * since it always still has the token value the OS handed it). Same
 * identical-404-shaped defense as every other module's ownership check —
 * see this file's own top comment.
 */
export async function revokeToken(ctx: AuthContext, tokenOrId: string): Promise<void> {
  const userId = requireMemberSubject(ctx);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const existing = uuidPattern.test(tokenOrId) ? await repo.findById(tokenOrId) : await repo.findByToken(tokenOrId);

  if (!existing || existing.userId !== userId) {
    throw new AuthorizationError("You do not have permission to modify this device token.");
  }
  if (existing.revokedAt) return; // idempotent — already revoked

  await repo.markRevoked(existing.id);
  await recordAudit({
    actorType: actorTypeFromSubject(ctx.subject.type),
    actorId: userId,
    action: "push_token.revoke",
    entityType: "device_push_token",
    entityId: existing.id,
  });
}

/**
 * Callable by a future real push-vendor integration when a send fails with
 * a provider-reported "token no longer valid" class of error (won't happen
 * for real in this sandbox — no real vendor exists — but the interface is
 * real and complete, per the B11 brief's explicit ask). Today's only real
 * caller is the DELETE endpoint (`revokeToken`, above); this standalone
 * export exists so that future integration point has something concrete to
 * call rather than needing to invent its own revocation path.
 */
export async function revokePushToken(token: string): Promise<void> {
  const existing = await repo.findByToken(token);
  if (!existing || existing.revokedAt) return;
  await repo.markRevoked(existing.id);
}
