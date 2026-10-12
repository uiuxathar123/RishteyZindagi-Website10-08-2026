/**
 * B7: `notify()` is the one function every other module calls to raise a
 * notification — the stable, reusable export B8 (Membership/Payment) will
 * call once it exists (see the B7 task brief). Deliberately best-effort,
 * mirroring `audit.service.ts`'s `record()` and `behaviour-events.service
 * .ts`'s `recordEvent()`: a failure to notify must never fail the primary
 * action it's describing (e.g. accepting an Interest must still succeed
 * even if the notification insert or provider call fails).
 *
 * Delivery-status design (see schema.ts's notificationStatusEnum comment
 * for the state definitions):
 *  - IN_APP is never a "provider" call — the row's existence IS the
 *    delivery, so it's inserted straight to DELIVERED with deliveredAt
 *    set, no provider involved at all.
 *  - EMAIL/WHATSAPP/PUSH insert PENDING first, then attempt a real
 *    provider send and update the SAME row to SENT (success) or FAILED
 *    (thrown/unconfigured, with a non-secret failureReason) — never
 *    fabricating success for a channel with no real integration
 *    configured, the same honesty contract every OTP provider already
 *    keeps in this codebase.
 *
 * Idempotency: an optional `dedupeKey` is inserted first (before any
 * provider call is attempted) via `onConflictDoNothing` on the column's
 * unique index — a duplicate call with the same key is a true no-op
 * (returns `null`, no second row, no wasted provider call), never a
 * duplicate notification. Callers that don't care about dedup simply omit
 * it.
 *
 * devMode: unlike OTP (which reads an admin-configurable
 * `otp_configs.dev_mode` DB column), B7's notifications deliberately have
 * no such config table — the master brief explicitly asks for a minimal,
 * non-elaborate preference/config surface here. devMode is derived
 * straight from `NODE_ENV !== "production"` by default (matching
 * DevNotificationProvider's own hard guard), with an optional `devMode`
 * override on the input purely for tests to exercise the real,
 * unconfigured-provider "FAILED, never fabricated" path without having to
 * fake NODE_ENV=production end-to-end — production call sites never set
 * it.
 *
 * B11 additive touch (frozen since B7 — disclosed in BACKEND.md §55): PUSH
 * addressing now resolves real, registered device tokens from
 * `device_push_tokens` (see push-tokens.repository.ts) instead of the old
 * always-empty "no destination address" stub — see the PUSH branch inside
 * `notifyInternal` below. `send()` on the push provider still honestly
 * throws (no real vendor wired in, unchanged from B7); this only completes
 * the *addressing* half, exactly as the B11 task brief asks for. A user can
 * have multiple registered devices, so every currently-live token is
 * attempted; the row is SENT if at least one attempt succeeds, FAILED
 * (with the last attempt's reason) only if every attempt failed — matching
 * "notify this user" semantics for a multi-device user rather than
 * "notify exactly one address" the EMAIL/WHATSAPP branch assumes.
 */
import { getEnv } from "@/server/config/env";
import { AuthorizationError, ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import type { AuthContext } from "@/server/middleware/authenticate";
import { getNotificationProvider } from "./providers/factory";
import * as repo from "./notifications.repository";
import type { NotificationRow, NotificationDbChannel } from "./notifications.repository";
import { listActiveTokensForUser } from "@/server/modules/devices/push-tokens.repository";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

export interface NotifyInput {
  userId: string;
  channel: NotificationDbChannel;
  title: string;
  body: string;
  /** See notifications.repository.ts's insertNotification / schema.ts's
   * dedupeKeyIdx comment. */
  dedupeKey?: string;
  /** Test-only override — see this file's top-of-file comment. Never set
   * by a real call site. */
  devMode?: boolean;
  /** B18: security / payment / legal notices ignore the member's channel opt-outs. IN_APP is never suppressed. */
  essential?: boolean;
}

async function notifyInternal(input: NotifyInput): Promise<NotificationRow | null> {
  const isInApp = input.channel === "IN_APP";
  // B18: honour the member's per-channel opt-out for NON-essential EMAIL / PUSH / WHATSAPP messages.
  if (!isInApp && !input.essential && !(await repo.isChannelEnabled(input.userId, input.channel as "EMAIL" | "PUSH" | "WHATSAPP"))) {
    return null;
  }
  const inserted = await repo.insertNotification({
    userId: input.userId,
    channel: input.channel,
    title: input.title,
    body: input.body,
    dedupeKey: input.dedupeKey ?? null,
    deliveryStatus: isInApp ? "DELIVERED" : "PENDING",
    deliveredAt: isInApp ? new Date() : null,
  });
  if (!inserted) return null; // deduped — a row with this key already existed
  if (isInApp) return inserted;

  // Only EMAIL/WHATSAPP/PUSH reach here — SMS has no notifications
  // provider in B7 (see notifications.repository.ts's NotificationDbChannel
  // comment); nothing in this codebase calls notify() with channel:"SMS".
  const channel = input.channel as "EMAIL" | "WHATSAPP" | "PUSH";
  const devMode = input.devMode ?? getEnv().NODE_ENV !== "production";
  const provider = getNotificationProvider(channel, devMode);

  try {
    if (channel === "PUSH") {
      // B11: real addressing — every currently-live device registered for
      // this user (see push-tokens.repository.ts), never a single "to"
      // string (a user's notification isn't scoped to one device). If
      // there are none, this fails the exact same way EMAIL/WHATSAPP fail
      // with no email/mobile on file — a clean, honest ServiceUnavailableError,
      // never a fabricated success.
      const tokens = await listActiveTokensForUser(input.userId);
      if (tokens.length === 0) {
        throw new ServiceUnavailableError(`No destination address on file for ${channel} delivery.`);
      }
      let delivered = false;
      let lastFailureReason = "Delivery failed.";
      for (const token of tokens) {
        try {
          await provider.send({ to: token, title: input.title, body: input.body });
          delivered = true;
        } catch (sendErr) {
          lastFailureReason = sendErr instanceof ServiceUnavailableError ? sendErr.message : "Delivery failed.";
        }
      }
      if (!delivered) throw new ServiceUnavailableError(lastFailureReason);
      return (await repo.updateDeliveryStatus(inserted.id, "SENT", null)) ?? inserted;
    }

    const to = await repo.resolveDestination(input.userId, channel);
    if (!to) {
      throw new ServiceUnavailableError(`No destination address on file for ${channel} delivery.`);
    }
    await provider.send({ to, title: input.title, body: input.body });
    return (await repo.updateDeliveryStatus(inserted.id, "SENT", null)) ?? inserted;
  } catch (err) {
    const reason = err instanceof ServiceUnavailableError ? err.message : "Delivery failed.";
    return (await repo.updateDeliveryStatus(inserted.id, "FAILED", reason)) ?? inserted;
  }
}

export async function notify(input: NotifyInput): Promise<NotificationRow | null> {
  try {
    return await notifyInternal(input);
  } catch (err) {
    // Best-effort — see this file's top-of-file comment. A DB-level
    // failure here (rare — everything provider-related is already caught
    // above and turned into a FAILED row) must never propagate to the
    // caller's primary action.
    logError("notification-dispatch-failed", err, { userId: input.userId, channel: input.channel });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Member-facing: list / read state
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface NotificationsPage {
  items: NotificationRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listMyNotifications(ctx: AuthContext, page?: number, pageSize?: number): Promise<NotificationsPage> {
  const userId = requireMemberSubject(ctx);
  const p = page ?? 1;
  const ps = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { items, total } = await repo.listForUser(userId, p, ps);
  return { items, page: p, pageSize: ps, total, totalPages: Math.max(1, Math.ceil(total / ps)) };
}

export async function markNotificationRead(ctx: AuthContext, notificationId: string): Promise<NotificationRow> {
  const userId = requireMemberSubject(ctx);
  const existing = await repo.findById(notificationId);
  // Same IDOR defense every other B6/B7 module uses (identical error
  // whether the row doesn't exist or isn't this user's).
  if (!existing || existing.userId !== userId) {
    throw new AuthorizationError("You do not have permission to modify this notification.");
  }
  if (existing.isRead) return existing; // idempotent
  const updated = await repo.markRead(notificationId);
  return updated!;
}

export async function markAllNotificationsRead(ctx: AuthContext): Promise<number> {
  const userId = requireMemberSubject(ctx);
  return repo.markAllReadForUser(userId);
}

export async function unreadNotificationCount(ctx: AuthContext): Promise<number> {
  const userId = requireMemberSubject(ctx);
  return repo.countUnreadForUser(userId);
}
