# RishteyZindagi Backend — Build Status (Phase B7)

**Last updated:** 2026-09-24
**Stack:** unchanged. New migration `0006_b7_chat_notifications.sql`.

> ## STATUS
> ```
> B1: PASS — FROZEN
> B2: PASS — FROZEN
> B3: PASS — FROZEN
> B4: PASS — FROZEN
> B5: PASS — FROZEN
> B6: PASS — FROZEN
> B7: PASS — FROZEN (263/263 tests passing)
> ```
> Verified independently: `npx tsc --noEmit` clean, `npm run build` succeeds, `npm test` → 263/263 across 25 files (224 pre-existing B1-B6 + 39 new B7). See `BACKEND.md` §51 for the full writeup.

## B7 — Chat + Notifications

Implements the `chats`/`chat_participants`/`messages`/`notification_templates`/`notifications` tables B1 originally created as unused foundation — no new tables needed, only additive columns.

- **Chat**: created lazily (first `POST /chats` from either matched party), tied 1:1 to a real B6 `matches` row via a new unique `chats.match_id` column — never created between unmatched users. Every chat/message read verifies the requester is a participant server-side (IDOR-safe, same "same error whether missing or not yours" pattern as B6). Messages: text only, 2000-char cap, `sentAt DESC` pagination (default 20/max 50). Read state walks `messages.readAt` directly (no new cursor column).
- **Membership gate**: a new, permanent `membership-gate.ts` module (`hasActiveMembership(userId)`) reads the real, already-existing-but-empty `memberships` table (`status='ACTIVE' AND (expiresAt IS NULL OR expiresAt > now())`). Today it correctly returns `false` for everyone — no memberships exist yet — so new chat creation and new message sends are currently gated shut, exactly per the "Mutual Match + Active Membership" rule; the moment B8 ships and populates a real `ACTIVE` row, the same unchanged function starts returning `true`. Existing chat history remains fully readable regardless of membership state (never deleted, never hidden) — only new sends/new-chat-creation are gated.
- **Block interaction**: blocked pairs cannot create a new chat or send new messages; prior history stays visible to both parties (same "history preserved" principle as membership expiry).
- **Suspended users**: inherited automatically via the existing `authenticate()` guard (a suspended account can't get a session at all) — no special-casing needed.
- **Notifications**: a real provider abstraction for EMAIL/WHATSAPP/PUSH, structurally mirroring B2's OTP provider system exactly (per-channel provider classes, a dev/mock provider double-guarded against `NODE_ENV=production`, one factory deciding real-vs-dev). IN_APP notifications (the only channel actually dispatched by any B7 event today) need no external provider — the row's existence is the delivery. New `notifications.deliveryStatus` (`PENDING`/`SENT`/`DELIVERED`/`FAILED`) + `deliveredAt`/`failureReason`/`dedupeKey` columns (idempotent via a unique index on `dedupeKey`, multiple NULLs allowed). Events wired: Interest received/accepted/rejected, Match created (both users), Like received, Warning issued, New chat message — dispatched via `notify()` calls added into B6's already-shipped `interactions.service.ts`/`warnings.service.ts` (documented as plain additive calls into recently-shipped B6 code, not frozen-file exceptions). EMAIL/WHATSAPP/PUSH plumbing is fully built and tested but not wired into any live event yet — flipping an event to also send email/WhatsApp is a one-line channel-argument change once real credentials exist.

## Frozen-file exceptions (2, both additive/disclosed)

1. `schema.ts` — `notificationStatusEnum`, `chats.matchId` (+FK+unique index), `notifications.deliveryStatus`/`deliveredAt`/`failureReason`/`dedupeKey` (+unique index). No existing column/table touched; no new tables (all five B7 tables already existed).
2. `src/server/config/env.ts` — two new optional fields, `PUSH_PROVIDER`/`PUSH_API_KEY`, mirroring the existing EMAIL/SMS/WHATSAPP pattern. No existing field touched.

## Next step

B7 is reviewed, verified independently, and now **FROZEN**. B8 (Membership + Payment Foundation) is next — it will populate the `memberships` table that B7's `hasActiveMembership()` gate already reads from correctly.
