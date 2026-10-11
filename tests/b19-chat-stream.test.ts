/**
 * B19 — live chat delivery over Server-Sent Events (SSE; NOT a WebSocket).
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.CHAT_STREAM_POLL_MS = "150";
  process.env.CHAT_STREAM_MAX_LIFETIME_MS = "2500";
});

import { NextRequest } from "next/server";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { POST as openChat } from "@/app/api/v1/chats/route";
import { POST as sendMessage } from "@/app/api/v1/chats/[chatId]/messages/route";
import { GET as streamRoute } from "@/app/api/v1/chats/[chatId]/stream/route";
import { __openStreamCountForTests, MAX_STREAMS_PER_USER } from "@/server/modules/chat/chat-stream";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import { resetTransactionalTables, resetAdminUsers, resetOtpConfigForTests, resetMatchingWeightsForTests, activateMembershipForTests } from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

const U = "http://localhost/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chatPair(refs: ReferenceIds, prefix: string) {
  const a = await buildReadyProfile(`${prefix}-a`, refs, { gender: "FEMALE" });
  const b = await buildReadyProfile(`${prefix}-b`, refs, { gender: "MALE" });
  await activateMembershipForTests(a.member.userId);
  await activateMembershipForTests(b.member.userId);
  const sent = await (await sendInterest(req(`${U}/interactions/interests`, { toUserId: b.member.userId }, { token: a.member.sessionToken, method: "POST" }))).json();
  await respondInterest(req(`${U}/interactions/interests/${sent.data.interest.id}`, { status: "ACCEPTED" }, { token: b.member.sessionToken, method: "PATCH" }), { params: { interestId: sent.data.interest.id } });
  const chat = (await (await openChat(req(`${U}/chats`, { counterpartUserId: b.member.userId }, { token: a.member.sessionToken, method: "POST" }))).json()).data.chat;
  return { a, b, chatId: chat.id as string };
}
const say = (token: string, chatId: string, body: string) => sendMessage(req(`${U}/chats/${chatId}/messages`, { body }, { token, method: "POST" }), { params: { chatId } });

function open(chatId: string, token?: string, opts: { lastEventId?: string; ac?: AbortController } = {}) {
  const ac = opts.ac ?? new AbortController();
  const r = new NextRequest(`${U}/chats/${chatId}/stream`, {
    method: "GET",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.lastEventId ? { "last-event-id": opts.lastEventId } : {}) },
    signal: ac.signal,
  });
  return { ac, res: streamRoute(r, { params: { chatId } }) };
}

/** Reads the SSE body until `done(text)` is true or `ms` elapse. */
async function readUntil(res: Response, done: (text: string) => boolean, ms = 4000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const end = Date.now() + ms;
  while (Date.now() < end && !done(text)) {
    const r = await Promise.race([reader.read(), sleep(Math.max(1, end - Date.now())).then(() => null)]);
    if (!r || r.done) break;
    text += dec.decode(r.value);
  }
  reader.releaseLock();
  return text;
}
const messagesIn = (text: string) => [...text.matchAll(/event: message\ndata: (.+)\n/g)].map((m) => JSON.parse(m[1]) as { id: string; body: string; mine: boolean });

let refs: ReferenceIds;
beforeEach(async () => {
  await resetTransactionalTables();
  await resetAdminUsers();
  await resetOtpConfigForTests();
  await resetMatchingWeightsForTests();
  __resetRateLimitsForTests();
  refs = await resolveReferenceIds();
});

describe("chat stream (SSE)", () => {
  it("[cs-authz] needs a session; a non-participant gets the same 403 as the REST endpoints", async () => {
    const { chatId } = await chatPair(refs, "cs-authz");
    const stranger = await buildReadyProfile("cs-authz-x", refs, { gender: "MALE" });
    expect((await open(chatId).res).status).toBe(401);
    expect((await open(chatId, stranger.member.sessionToken).res).status).toBe(403);
    expect((await open("not-a-uuid", stranger.member.sessionToken).res).status).toBe(400);
    expect(__openStreamCountForTests()).toBe(0);
  });

  it("[cs-live] a message sent by the other member arrives on the open stream, without replaying history;", async () => {
    const { a, b, chatId } = await chatPair(refs, "cs-live");
    await say(a.member.sessionToken, chatId, "old message before connect");
    const { ac, res } = open(chatId, b.member.sessionToken);
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    await sleep(300);
    await say(a.member.sessionToken, chatId, "hello live");
    const text = await readUntil(r, (t) => messagesIn(t).length >= 1);
    const got = messagesIn(text);
    expect(got.map((m) => m.body)).toEqual(["hello live"]);
    expect(got[0].mine).toBe(false);
    ac.abort();
    await sleep(100);
    expect(__openStreamCountForTests()).toBe(0);
  });

  it("[cs-resume] Last-Event-ID resumes after that message: nothing missed, nothing repeated", async () => {
    const { a, b, chatId } = await chatPair(refs, "cs-resume");
    const m1 = (await (await say(a.member.sessionToken, chatId, "one")).json()).data.message;
    await say(a.member.sessionToken, chatId, "two");
    await say(a.member.sessionToken, chatId, "three");
    const { ac, res } = open(chatId, b.member.sessionToken, { lastEventId: m1.id });
    const text = await readUntil(await res, (t) => messagesIn(t).length >= 2);
    expect(messagesIn(text).map((m) => m.body)).toEqual(["two", "three"]);
    ac.abort();
  });

  it("[cs-first-message] a chat that is still empty at connect delivers its first message", async () => {
    const { a, b, chatId } = await chatPair(refs, "cs-first");
    const { ac, res } = open(chatId, b.member.sessionToken);
    const r = await res;
    await sleep(300);
    await say(a.member.sessionToken, chatId, "first ever");
    expect(messagesIn(await readUntil(r, (t) => messagesIn(t).length >= 1)).map((m) => m.body)).toEqual(["first ever"]);
    ac.abort();
  });

  it("[cs-lifetime] the server ends each connection after its lifetime with a reconnect hint and frees the slot", async () => {
    const { b, chatId } = await chatPair(refs, "cs-life");
    const { res } = open(chatId, b.member.sessionToken);
    const text = await readUntil(await res, (t) => t.includes("event: reconnect"), 6000);
    expect(text).toContain("event: ready");
    expect(text).toContain("event: reconnect");
    await sleep(100);
    expect(__openStreamCountForTests()).toBe(0);
  });

  it("[cs-cap] a member cannot hold more than the allowed number of open streams", async () => {
    const { b, chatId } = await chatPair(refs, "cs-cap");
    const opened = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      const o = open(chatId, b.member.sessionToken);
      expect((await o.res).status).toBe(200);
      opened.push(o);
    }
    expect((await open(chatId, b.member.sessionToken).res).status).toBe(429);
    opened.forEach((o) => o.ac.abort());
    await sleep(150);
    expect(__openStreamCountForTests()).toBe(0);
    const after = open(chatId, b.member.sessionToken);
    expect((await after.res).status).toBe(200);
    after.ac.abort();
    await sleep(50);
    expect(__openStreamCountForTests()).toBe(0);
  });
});
