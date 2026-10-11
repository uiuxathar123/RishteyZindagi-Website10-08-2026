/**
 * B19: live message delivery over Server-Sent Events (SSE).
 *
 * HONEST NAMING: this is SSE, not a WebSocket. Next.js route handlers cannot upgrade a connection, and SSE needs no extra
 * server. The client (`MessagesView`) opens this stream and keeps its existing 10-second poll as a fallback, so chat still
 * works when a proxy buffers or drops event streams.
 *
 * How it works
 *  - Authenticated and participant-checked ONCE at connect (same IDOR rule as every chat endpoint: one error whether the
 *    chat does not exist or is not yours).
 *  - The stream then reads the database every POLL_MS for messages after its cursor. Using the database as the source of
 *    truth (rather than an in-process event bus) keeps it correct with several app instances.
 *  - Each connection lives at most MAX_LIFETIME_MS; the browser's EventSource reconnects on its own with `Last-Event-ID`,
 *    which re-runs authentication — so a suspended account or revoked session loses the stream within a minute.
 *  - At most MAX_STREAMS_PER_USER open streams per member (per instance).
 *  - Events carry exactly what the paged API returns for a message. No new data is exposed.
 */
import { AuthorizationError, RateLimitError } from "@/server/lib/errors";
import type { AuthContext } from "@/server/middleware/authenticate";
import * as repo from "./chat.repository";
import * as dto from "./chat.dto";

export const STREAM_POLL_MS = Number(process.env.CHAT_STREAM_POLL_MS ?? 1500);
export const STREAM_MAX_LIFETIME_MS = Number(process.env.CHAT_STREAM_MAX_LIFETIME_MS ?? 55_000);
export const STREAM_HEARTBEAT_MS = 15_000;
export const MAX_STREAMS_PER_USER = 4;
const BATCH = 50;

const open = new Map<string, number>();

export function __openStreamCountForTests(): number {
  let n = 0;
  for (const v of open.values()) n += v;
  return n;
}

function acquire(userId: string): void {
  const n = open.get(userId) ?? 0;
  if (n >= MAX_STREAMS_PER_USER) throw new RateLimitError("Too many open chat connections. Close another tab and try again.");
  open.set(userId, n + 1);
}
function release(userId: string): void {
  const n = (open.get(userId) ?? 1) - 1;
  if (n <= 0) open.delete(userId);
  else open.set(userId, n);
}

export async function openMessageStream(ctx: AuthContext, chatId: string, lastEventId: string | null, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (ctx.subject.type !== "user") throw new AuthorizationError("This endpoint is for member accounts only.");
  const userId = ctx.subject.id;
  if (!(await repo.isParticipant(chatId, userId))) throw new AuthorizationError("You do not have permission to access this chat.");

  // Clock first, then the cursor: a message created in between is picked up by the time-based fallback below.
  const sinceIso = await repo.dbNowIso();
  let cursor: string | null = lastEventId && /^[0-9a-f-]{36}$/i.test(lastEventId) && (await repo.messageExistsInChat(chatId, lastEventId)) ? lastEventId : await repo.latestMessageId(chatId);
  const seen = new Set<string>();

  acquire(userId);
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const startedAt = Date.now();
  let lastWrite = Date.now();

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    release(userId);
    try {
      controllerRef?.close();
    } catch {
      /* already closed */
    }
  };
  const write = (s: string) => {
    if (closed) return;
    try {
      controllerRef?.enqueue(enc.encode(s));
      lastWrite = Date.now();
    } catch {
      close();
    }
  };

  const tick = async () => {
    if (closed) return;
    try {
      const rows = cursor ? await repo.messagesAfterId(chatId, cursor, BATCH) : await repo.messagesSinceDbTime(chatId, sinceIso, BATCH);
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        cursor = row.id;
        write(`id: ${row.id}\nevent: message\ndata: ${JSON.stringify(dto.toMessageView(row, userId))}\n\n`);
      }
      if (seen.size > 500) {
        const keep = [...seen].slice(-100);
        seen.clear();
        keep.forEach((k) => seen.add(k));
      }
      if (Date.now() - lastWrite >= STREAM_HEARTBEAT_MS) write(`: keep-alive\n\n`);
    } catch {
      // A transient database error ends this connection quietly; the client reconnects (and falls back to polling meanwhile).
      close();
      return;
    }
    if (closed) return;
    if (Date.now() - startedAt >= STREAM_MAX_LIFETIME_MS) {
      write(`event: reconnect\ndata: {}\n\n`);
      close();
      return;
    }
    timer = setTimeout(tick, STREAM_POLL_MS);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) return close();
      write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
      timer = setTimeout(tick, 0);
    },
    cancel() {
      close();
    },
  });
}
