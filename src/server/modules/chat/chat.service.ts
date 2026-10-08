/**
 * B7: Chat business rules.
 *
 * Documented judgment calls (all referenced again in BACKEND.md's B7
 * section):
 *
 *  - Chat creation timing: LAZY, created-on-demand the first time either
 *    matched party opens/sends into the chat (`openOrGetChat` below) —
 *    never automatic at match-creation time. Chosen specifically to avoid
 *    touching B6's frozen `interactions.service.ts` match-creation path at
 *    all; this file is the only new code involved.
 *  - "Chat eligibility = Mutual Match + Active Membership": a chat can
 *    only ever be opened between two users with a real `matches` row
 *    (`interactions.repository.ts`'s `findMatchByPair`, already exported,
 *    read-only reuse — no B6 file touched). Starting a NEW chat (no prior
 *    chat row for this match) additionally requires the requester to have
 *    an active membership (`membership-gate.ts`'s `hasActiveMembership`)
 *    — opening an EXISTING chat never re-checks membership, since reading
 *    history must stay available regardless of membership state (see the
 *    message-send vs message-read split below).
 *  - Membership-expiry rule: message-send and new-chat-creation both
 *    re-check `hasActiveMembership` fresh on every request (no caching —
 *    membership state can change at any moment). Message read/list/mark-
 *    read/unread-count never require active membership, only that the
 *    requester is a participant — existing conversation history is never
 *    hidden or deleted for an expired/no membership.
 *  - Blocked-pair rule: a block (either direction, `interactions.
 *    repository.ts`'s `isBlockedEitherDirection`, reused) blocks sending
 *    a NEW message and starting a NEW chat, exactly like membership above
 *    — existing chat history remains readable for continuity/moderation
 *    reasons, the same principle membership-expiry already established.
 *  - Suspended-sender handling: inherited, not special-cased — a
 *    suspended user fails `authenticate()`'s own existing "Account is not
 *    active" guard before any B7 handler ever runs (same precedent B6
 *    documented for its own suspended-user handling), so a suspended user
 *    cannot send OR read; the other, non-suspended party's own session is
 *    unaffected and can still read history.
 *  - Message ordering: newest-first (`sentAt DESC`) — page 1 is always
 *    the most recent page of the conversation, matching this codebase's
 *    dominant `desc(createdAt/updatedAt)` convention for list endpoints.
 *  - Read-state design: no schema change — `messages.readAt` (already
 *    real, per-message) is walked directly rather than adding a
 *    `chat_participants.last_read_at` cursor column, since a per-message
 *    walk is not meaningfully worse at this scale and avoids a frozen-
 *    table schema change for the same outcome.
 */
import { NotFoundError, AuthorizationError, ValidationError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as interactionsRepo from "@/server/modules/interactions/interactions.repository";
import { hasActiveMembership } from "@/server/modules/memberships/membership-gate";
import { recordEvent } from "@/server/modules/behaviour-events/behaviour-events.service";
import { notify } from "@/server/modules/notifications/notifications.service";
import * as repo from "./chat.repository";
import type { ChatRow, MessageRow, ChatSummaryRaw } from "./chat.repository";

const MEMBERSHIP_REQUIRED_MESSAGE = "An active membership is required to use chat.";
const BLOCKED_MESSAGE = "This action is not available between you and this user.";

function requireMemberSubject(ctx: AuthContext): string {
  if (ctx.subject.type !== "user") {
    throw new AuthorizationError("This endpoint is for member accounts only.");
  }
  return ctx.subject.id;
}

function assertNotSelf(userId: string, targetUserId: string): void {
  if (userId === targetUserId) throw new ValidationError("You cannot start a chat with your own account.");
}

/** Same IDOR defense every other B6/B7 module uses: identical error
 * whether the chat doesn't exist or the requester isn't a participant, so
 * a caller can never distinguish "not found" from "not yours" by probing
 * ids. */
async function assertParticipant(chatId: string, userId: string): Promise<void> {
  const isIn = await repo.isParticipant(chatId, userId);
  if (!isIn) throw new AuthorizationError("You do not have permission to access this chat.");
}

// ---------------------------------------------------------------------------
// Open / get-or-create
// ---------------------------------------------------------------------------

export interface ChatWithCounterpart {
  chat: ChatRow;
  counterpartUserId: string;
}

export async function openOrGetChat(ctx: AuthContext, counterpartUserId: string): Promise<ChatWithCounterpart> {
  const userId = requireMemberSubject(ctx);
  assertNotSelf(userId, counterpartUserId);

  const match = await interactionsRepo.findMatchByPair(userId, counterpartUserId);
  if (!match) throw new NotFoundError("No match exists with this user.");

  const existing = await repo.findChatByMatchId(match.id);
  if (!existing) {
    // Only a genuinely NEW chat is gated — see this file's top-of-file
    // comment.
    const blocked = await interactionsRepo.isBlockedEitherDirection(userId, counterpartUserId);
    if (blocked) throw new AuthorizationError(BLOCKED_MESSAGE);

    const active = await hasActiveMembership(userId);
    if (!active) throw new AuthorizationError(MEMBERSHIP_REQUIRED_MESSAGE);
  }

  const { chat, created } = await repo.createChatForMatch(match.id, match.userAId, match.userBId);

  if (created) {
    await recordEvent({ actorUserId: userId, targetUserId: counterpartUserId, eventType: "CHAT_INITIATED", metadata: { chatId: chat.id } });
    await notify({
      userId: counterpartUserId,
      channel: "IN_APP",
      title: "New chat started",
      body: "You have a new chat waiting for your first message.",
      dedupeKey: `chat_initiated:${chat.id}`,
    });
  }

  return { chat, counterpartUserId };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listMyChats(ctx: AuthContext): Promise<ChatSummaryRaw[]> {
  const userId = requireMemberSubject(ctx);
  return repo.listMyChatSummaries(userId);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_MESSAGE_LENGTH = 2000;

export interface MessagesPage {
  items: MessageRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Read-side: participant-only, no membership/block gate — see this
 * file's top-of-file comment. */
export async function listMessages(ctx: AuthContext, chatId: string, page?: number, pageSize?: number): Promise<MessagesPage> {
  const userId = requireMemberSubject(ctx);
  await assertParticipant(chatId, userId);
  const p = page ?? 1;
  const ps = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { items, total } = await repo.listMessages(chatId, p, ps);
  return { items, page: p, pageSize: ps, total, totalPages: Math.max(1, Math.ceil(total / ps)) };
}

export async function sendMessage(ctx: AuthContext, chatId: string, body: string): Promise<MessageRow> {
  const userId = requireMemberSubject(ctx);
  await assertParticipant(chatId, userId);

  const counterpartId = await repo.getOtherParticipant(chatId, userId);
  if (counterpartId) {
    const blocked = await interactionsRepo.isBlockedEitherDirection(userId, counterpartId);
    if (blocked) throw new AuthorizationError(BLOCKED_MESSAGE);
  }

  const active = await hasActiveMembership(userId);
  if (!active) throw new AuthorizationError(MEMBERSHIP_REQUIRED_MESSAGE);

  const message = await repo.insertMessage(chatId, userId, body);
  await repo.touchLastMessageAt(chatId, message.sentAt);

  if (counterpartId) {
    await notify({
      userId: counterpartId,
      channel: "IN_APP",
      title: "New message",
      body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
      dedupeKey: `chat_message:${message.id}`,
    });
  }

  return message;
}

export async function markChatRead(ctx: AuthContext, chatId: string): Promise<number> {
  const userId = requireMemberSubject(ctx);
  await assertParticipant(chatId, userId);
  return repo.markChatReadForUser(chatId, userId);
}

export async function unreadMessageCount(ctx: AuthContext): Promise<number> {
  const userId = requireMemberSubject(ctx);
  return repo.countUnreadForUser(userId);
}
