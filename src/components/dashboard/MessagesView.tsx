"use client";

import { ArrowLeft, Loader2, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionError } from "@/components/profile/ActionError";
import { memberHref } from "@/components/profile/ProfileCard";
import { cardAvatar, locationLine } from "@/components/profile/cardModel";
import { useProfileSummaries, type Summary } from "@/components/profile/useProfileSummaries";
import { ApiErrorView } from "@/components/ui/AsyncView";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { ApiError, isApiError } from "@/lib/api/errors";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatSummary, MatchView, MessageView, Page } from "@/lib/api/types";

const POLL_MS = 10_000;
/** While the live stream is connected the poll only acts as a safety net. */
const LIVE_POLL_MS = 45_000;
const THREAD_PAGE_SIZE = 30;
const MAX_LENGTH = 2000;

/** Runs `fn` every `ms` while the tab is visible (and once more when it becomes visible again). Cleans up on unmount. */
function usePolling(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => ref.current(), ms);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        ref.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}

function toError(e: unknown): ApiError {
  return isApiError(e) ? e : new ApiError({ status: 0, code: "UNKNOWN", message: "Something went wrong.", kind: "unknown" });
}

function mergeMessages(prev: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
}

function Thread({
  chat,
  summary,
  onBack,
  onChatsChanged,
}: {
  chat: ChatSummary;
  summary?: Summary;
  onBack: () => void;
  onChatsChanged: () => void;
}) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pages, setPages] = useState({ loaded: 1, total: 1 });
  const [olderPending, setOlderPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const alive = useRef(true);
  const markingRead = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const markRead = useCallback(async () => {
    if (markingRead.current) return;
    markingRead.current = true;
    try {
      await api.post(`/chats/${chat.id}/read`);
      if (alive.current) onChatsChanged();
    } catch {
      /* unread badge simply stays until the next poll */
    } finally {
      markingRead.current = false;
    }
  }, [chat.id, onChatsChanged]);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await api.get<Page<MessageView>>(`/chats/${chat.id}/messages`, { query: { page: 1, pageSize: THREAD_PAGE_SIZE } });
      if (!alive.current) return;
      setMessages((prev) => mergeMessages(prev, res.items));
      setPages((p) => ({ loaded: Math.max(p.loaded, 1), total: res.totalPages }));
      setLoadError(null);
      setLoaded(true);
      if (res.items.some((m) => !m.mine && !m.readAt)) void markRead();
    } catch (e) {
      if (!alive.current) return;
      const err = toError(e);
      if (err.kind !== "aborted") setLoadError(err);
      setLoaded(true);
    }
  }, [chat.id, markRead]);

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);
  const [live, setLive] = useState(false);
  // Callbacks go through refs so a re-render of the parent never tears the stream down.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const changedRef = useRef(onChatsChanged);
  changedRef.current = onChatsChanged;
  usePolling(() => void fetchLatest(), live ? LIVE_POLL_MS : POLL_MS);

  // B19: live delivery over Server-Sent Events (not a WebSocket). Falls back to polling whenever the stream is not open.
  useEffect(() => {
    if (!loaded || typeof EventSource === "undefined") return;
    const es = new EventSource(`/bff/chats/${chat.id}/stream`);
    es.addEventListener("ready", () => alive.current && setLive(true));
    es.addEventListener("message", (ev) => {
      if (!alive.current) return;
      try {
        const m = JSON.parse((ev as MessageEvent<string>).data) as MessageView;
        setMessages((prev) => mergeMessages(prev, [m]));
        if (!m.mine) void markReadRef.current();
        changedRef.current();
      } catch {
        /* a malformed event is ignored; the poll still catches up */
      }
    });
    // The browser reconnects by itself after a clean close; a hard failure (401/429/network) leaves it CLOSED.
    es.onerror = () => {
      if (!alive.current) return;
      if (es.readyState === EventSource.CLOSED) setLive(false);
    };
    return () => {
      es.close();
      setLive(false);
    };
  }, [loaded, chat.id]);

  // Keep the newest message in view unless the person scrolled up to read history.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    setOlderPending(true);
    try {
      const next = pages.loaded + 1;
      const el = scroller.current;
      const prevHeight = el?.scrollHeight ?? 0;
      stickToBottom.current = false;
      const res = await api.get<Page<MessageView>>(`/chats/${chat.id}/messages`, { query: { page: next, pageSize: THREAD_PAGE_SIZE } });
      if (!alive.current) return;
      setMessages((prev) => mergeMessages(prev, res.items));
      setPages({ loaded: next, total: res.totalPages });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e) {
      if (alive.current) setLoadError(toError(e));
    } finally {
      if (alive.current) setOlderPending(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.post<{ message: MessageView }>(`/chats/${chat.id}/messages`, { body: text });
      if (!alive.current) return;
      stickToBottom.current = true;
      setMessages((prev) => mergeMessages(prev, [res.message]));
      setDraft(""); // cleared only after the server accepted it
      onChatsChanged();
    } catch (err) {
      if (alive.current) setSendError(toError(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  const card = summary?.state === "ok" ? summary.card : undefined;
  const name = card?.displayName ?? chat.counterpart.name ?? "Member";

  return (
    <>
      <div className="flex items-center gap-3 border-b border-rz-border px-4 py-3">
        <button type="button" aria-label="Back to conversations" onClick={onBack} className="rz-focus flex h-9 w-9 items-center justify-center rounded-full text-rz-navy lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Avatar src={card?.photoSrc} alt={name} size="sm" fallbackSrc={card ? cardAvatar(card) : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-sm font-semibold text-rz-navy">{name}</p>
          <p className="truncate text-xs text-rz-muted">{card ? locationLine(card) : " "}</p>
        </div>
        {chat.counterpart.profileId && (
          <Link href={memberHref(chat.counterpart.profileId)} className="rz-focus shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-rz-maroon hover:bg-rz-maroon/5">
            View profile
          </Link>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label={`Conversation with ${name}`}
      >
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-rz-muted" role="status" aria-label="Loading messages">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : loadError && messages.length === 0 ? (
          <ApiErrorView error={loadError} onRetry={() => void fetchLatest()} />
        ) : (
          <>
            {pages.loaded < pages.total && (
              <div className="text-center">
                <Button type="button" size="sm" variant="outline" disabled={olderPending} onClick={() => void loadOlder()}>
                  {olderPending ? "Loading…" : "Load earlier messages"}
                </Button>
              </div>
            )}
            {messages.length === 0 && <p className="py-10 text-center text-sm text-rz-muted">No messages yet. Say hello!</p>}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm sm:max-w-[70%]", m.mine ? "rounded-br-sm bg-rz-maroon text-white" : "rounded-bl-sm bg-rz-cream text-rz-text")}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cn("mt-1 text-[10.5px]", m.mine ? "text-white/70" : "text-rz-muted")}>
                    {formatDateTime(m.sentAt)}
                    {m.mine && m.readAt ? " · Read" : ""}
                  </p>
                </div>
              </div>
            ))}
            {loadError && (
              <p role="alert" className="text-center text-xs text-rz-danger">
                Couldn&apos;t refresh: {loadError.friendlyMessage}
              </p>
            )}
          </>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-rz-border p-3">
        <div className="flex items-center gap-2">
          <Input aria-label="Type a message" placeholder="Type a message…" value={draft} maxLength={MAX_LENGTH} onChange={(e) => setDraft(e.target.value)} className="h-11" disabled={sending} />
          <Button type="submit" size="md" aria-label="Send message" disabled={!draft.trim() || sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2} />}
          </Button>
        </div>
        <ActionError error={sendError} className="mt-2 text-xs text-rz-danger" />
        <p className="mt-2 text-[11px] text-rz-muted">Messages refresh automatically every few seconds (no live push yet).</p>
      </form>
    </>
  );
}

export function MessagesView() {
  const chatsQ = useAsync((signal) => api.get<{ chats: ChatSummary[] }>("/chats", { signal }), []);
  const matchesQ = useAsync((signal) => api.get<{ matches: MatchView[] }>("/interactions/matches", { signal }), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ApiError | null>(null);
  const withParam = useSearchParams().get("with");
  const handledWith = useRef<string | null>(null);

  const chats = useMemo(
    () => [...(chatsQ.data?.chats ?? [])].sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime()),
    [chatsQ.data]
  );
  const summaries = useProfileSummaries([...chats.map((c) => c.counterpart.profileId), ...(matchesQ.data?.matches ?? []).map((m) => m.counterpart.profileId)]);
  const reloadChats = chatsQ.reload;
  const active = chats.find((c) => c.id === selectedId) ?? null;

  const reloadMatches = matchesQ.reload;
  usePolling(() => {
    reloadChats();
    reloadMatches();
  }, POLL_MS);

  /** Open (or create) the chat with a matched member. */
  const openWith = useCallback(
    async (counterpartUserId: string) => {
      setOpening(counterpartUserId);
      setOpenError(null);
      try {
        const res = await api.post<{ chat: { id: string } }>("/chats", { counterpartUserId });
        reloadChats();
        setSelectedId(res.chat.id);
      } catch (e) {
        setOpenError(toError(e));
      } finally {
        setOpening(null);
      }
    },
    [reloadChats]
  );

  useEffect(() => {
    if (withParam && handledWith.current !== withParam) {
      handledWith.current = withParam;
      void openWith(withParam);
    }
  }, [withParam, openWith]);

  // On wide screens start with the most recent conversation open.
  useEffect(() => {
    if (!selectedId && chats.length > 0 && !withParam && typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSelectedId(chats[0].id);
    }
  }, [chats, selectedId, withParam]);

  const chatUserIds = new Set(chats.map((c) => c.counterpart.userId));
  const waiting = (matchesQ.data?.matches ?? []).filter((m) => !chatUserIds.has(m.counterpart.userId));

  if (chatsQ.data === null && chatsQ.loading) {
    return <div className="h-[420px] animate-pulse rounded-lg bg-rz-border/40" role="status" aria-label="Loading conversations" />;
  }
  if (chatsQ.data === null && chatsQ.error) return <ApiErrorView error={chatsQ.error} onRetry={chatsQ.reload} />;

  if (chats.length === 0 && waiting.length === 0) {
    return (
      <>
        {openError && <ActionError error={openError} className="mb-3 text-sm text-rz-danger" />}
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" strokeWidth={1.6} />}
          title="No conversations yet"
          description="Once you and a member are a mutual match, you can chat here. Chatting needs an active membership."
          action={<Link href="/dashboard/matches" className="rz-focus text-sm font-semibold text-rz-maroon underline underline-offset-2">Find matches</Link>}
        />
      </>
    );
  }

  return (
    <div>
      {openError && (
        <div className="mb-3 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-4 py-3">
          <ActionError error={openError} className="text-sm text-rz-danger" />
        </div>
      )}
      <div className="flex h-[calc(100vh-240px)] min-h-[440px] overflow-hidden rounded-lg border border-rz-border bg-white">
        <aside className={cn("w-full shrink-0 flex-col overflow-y-auto border-rz-border lg:flex lg:w-[300px] lg:border-r", active ? "hidden lg:flex" : "flex")}>
          <ul className="divide-y divide-rz-border">
            {chats.map((c) => {
              const s = c.counterpart.profileId ? summaries[c.counterpart.profileId] : undefined;
              const card = s?.state === "ok" ? s.card : undefined;
              const name = card?.displayName ?? c.counterpart.name ?? "Member";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    aria-current={selectedId === c.id ? "true" : undefined}
                    className={cn("rz-focus flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-rz-cream/60", selectedId === c.id && "bg-rz-cream/70")}
                  >
                    <Avatar src={card?.photoSrc} alt={name} size="md" fallbackSrc={card ? cardAvatar(card) : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-serif text-sm font-semibold text-rz-navy">{name}</span>
                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-rz-maroon px-1.5 text-[11px] font-bold text-white" aria-label={`${c.unreadCount} unread`}>
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-rz-muted">{c.lastMessageAt ? `Last message ${timeAgo(c.lastMessageAt)}` : "No messages yet"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {waiting.length > 0 && (
            <div className="border-t border-rz-border">
              <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-rz-muted">Matched, no chat yet</p>
              <ul className="divide-y divide-rz-border">
                {waiting.map((m) => {
                  const s = m.counterpart.profileId ? summaries[m.counterpart.profileId] : undefined;
                  const card = s?.state === "ok" ? s.card : undefined;
                  const name = card?.displayName ?? m.counterpart.name ?? "Member";
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar src={card?.photoSrc} alt={name} size="md" fallbackSrc={card ? cardAvatar(card) : undefined} />
                      <span className="min-w-0 flex-1 truncate font-serif text-sm font-semibold text-rz-navy">{name}</span>
                      <Button type="button" size="sm" variant="outline" disabled={opening === m.counterpart.userId} onClick={() => void openWith(m.counterpart.userId)}>
                        {opening === m.counterpart.userId ? "Opening…" : "Chat"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <section className={cn("min-w-0 flex-1 flex-col", active ? "flex" : "hidden lg:flex")}>
          {active ? (
            <Thread
              key={active.id}
              chat={active}
              summary={active.counterpart.profileId ? summaries[active.counterpart.profileId] : undefined}
              onBack={() => setSelectedId(null)}
              onChatsChanged={reloadChats}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-rz-muted">Select a conversation to view messages.</div>
          )}
        </section>
      </div>
    </div>
  );
}
