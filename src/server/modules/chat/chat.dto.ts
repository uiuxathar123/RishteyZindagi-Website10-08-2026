/**
 * B7: response shaping for chat endpoints — a lightweight shape (mirrors
 * interactions.dto.ts's own "not a full profile view" posture). A client
 * wanting the counterpart's full profile follows up with the existing
 * `GET /profiles/:profileId`.
 */
import * as interactionsRepo from "@/server/modules/interactions/interactions.repository";
import type { ChatRow, MessageRow, ChatSummaryRaw } from "./chat.repository";

export interface CounterpartRef {
  userId: string;
  name: string | null;
  /** B16: the counterpart's profile id (null if none) — see
   * interactions.dto.ts's CounterpartRef. */
  profileId: string | null;
}

export interface ChatView {
  id: string;
  matchId: string;
  createdAt: string;
  lastMessageAt: string | null;
  counterpart: CounterpartRef;
}

export interface ChatSummaryView extends ChatView {
  unreadCount: number;
}

export interface MessageView {
  id: string;
  chatId: string;
  senderUserId: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  /** True when the viewer sent this message — lets a client render
   * "mine" vs "theirs" bubbles without re-deriving it from senderUserId
   * client-side. */
  mine: boolean;
}

export async function toChatView(chat: ChatRow, counterpartUserId: string): Promise<ChatView> {
  const nameMap = await interactionsRepo.resolveDisplayNames([counterpartUserId]);
  const profileMap = await interactionsRepo.resolveProfileIds([counterpartUserId]);
  return {
    id: chat.id,
    matchId: chat.matchId,
    createdAt: chat.createdAt.toISOString(),
    lastMessageAt: chat.lastMessageAt ? chat.lastMessageAt.toISOString() : null,
    counterpart: {
      userId: counterpartUserId,
      name: nameMap.get(counterpartUserId) ?? null,
      profileId: profileMap.get(counterpartUserId) ?? null,
    },
  };
}

export async function toChatSummaryViews(rows: ChatSummaryRaw[]): Promise<ChatSummaryView[]> {
  const counterpartIds = rows.map((r) => r.counterpartUserId).filter((id): id is string => !!id);
  const nameMap = await interactionsRepo.resolveDisplayNames(counterpartIds);
  const profileMap = await interactionsRepo.resolveProfileIds(counterpartIds);
  return rows.map((r) => ({
    id: r.chat.id,
    matchId: r.chat.matchId,
    createdAt: r.chat.createdAt.toISOString(),
    lastMessageAt: r.chat.lastMessageAt ? r.chat.lastMessageAt.toISOString() : null,
    counterpart: {
      userId: r.counterpartUserId ?? "",
      name: r.counterpartUserId ? nameMap.get(r.counterpartUserId) ?? null : null,
      profileId: r.counterpartUserId ? profileMap.get(r.counterpartUserId) ?? null : null,
    },
    unreadCount: r.unreadCount,
  }));
}

export function toMessageView(row: MessageRow, viewerUserId: string): MessageView {
  return {
    id: row.id,
    chatId: row.chatId,
    senderUserId: row.senderUserId,
    body: row.body,
    sentAt: row.sentAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    mine: row.senderUserId === viewerUserId,
  };
}

export function toMessageViews(rows: MessageRow[], viewerUserId: string): MessageView[] {
  return rows.map((r) => toMessageView(r, viewerUserId));
}
