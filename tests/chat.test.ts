/**
 * B7: Chat business rules — creation-from-a-real-match-only, participant
 * IDOR, membership gating (new-chat/new-send only, never history reads),
 * blocked-pair denial (send blocked, history stays readable), pagination,
 * read state, and unread counts.
 *
 * There are legitimately zero active memberships anywhere in this system
 * until B8 (Membership + Payment Foundation) ships its purchase flow —
 * every test below that needs an ACTIVE membership seeds one directly via
 * `activateMembershipForTests` (tests/helpers/reset-db.ts), a test-only
 * fixture inserter, not something B8 is expected to have "shipped" yet.
 * See membership-gate.ts's own doc comment for why this is the correct,
 * honest state of the real table today.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { POST as sendInterest } from "@/app/api/v1/interactions/interests/route";
import { PATCH as respondInterest } from "@/app/api/v1/interactions/interests/[interestId]/route";
import { POST as blockUser } from "@/app/api/v1/interactions/blocks/route";
import { POST as openChat, GET as listMyChats } from "@/app/api/v1/chats/route";
import { GET as unreadChatCount } from "@/app/api/v1/chats/unread-count/route";
import { GET as listMessages, POST as sendMessage } from "@/app/api/v1/chats/[chatId]/messages/route";
import { POST as markChatRead } from "@/app/api/v1/chats/[chatId]/read/route";
import { __resetRateLimitsForTests } from "@/server/middleware/rate-limit";
import {
  resetTransactionalTables,
  resetAdminUsers,
  resetOtpConfigForTests,
  resetMatchingWeightsForTests,
  activateMembershipForTests,
  expireMembershipForTests,
} from "./helpers/reset-db";
import { req, resolveReferenceIds, buildReadyProfile, type ReferenceIds } from "./helpers/profile-fixtures";

function ireq(url: string, body: unknown, token: string, method = "POST") {
  return req(url, body, { token, method });
}
function greq(url: string, token?: string) {
  return req(url, undefined, { token, method: "GET" });
}

async function twoReadyUsers(refs: ReferenceIds, prefix: string) {
  const a = await buildReadyProfile(`${prefix}-a`, refs, { gender: "FEMALE" });
  const b = await buildReadyProfile(`${prefix}-b`, refs, { gender: "MALE" });
  return { a, b };
}

/** Sends+accepts a real Interest end-to-end so `a` and `b` become a real
 * mutual Match — chat can only ever be opened from a real match, so every
 * chat test builds one this way rather than inserting a `matches` row
 * directly.
 *
 * B8 note: sendInterest now requires the SENDER to have an active
 * membership (see interactions.service.ts's pre-approved B8 touch). `a`
 * is given one just long enough to send the interest, then it's EXPIRED
 * again immediately — every "no membership" premise elsewhere in this
 * file (e.g. [chat-create-no-membership]) is about the CHAT gate, not
 * the interest-send gate, so this fixture must leave `a` exactly as
 * membership-less as it was before B8, once the match exists. */
async function createMatchedPair(refs: ReferenceIds, prefix: string) {
  const { a, b } = await twoReadyUsers(refs, prefix);
  await activateMembershipForTests(a.member.userId);
  const sendRes = await sendInterest(ireq("http://localhost/api/v1/interactions/interests", { toUserId: b.member.userId }, a.member.sessionToken));
  const { data: sendData } = await sendRes.json();
  await respondInterest(
    ireq(`http://localhost/api/v1/interactions/interests/${sendData.interest.id}`, { status: "ACCEPTED" }, b.member.sessionToken, "PATCH"),
    { params: { interestId: sendData.interest.id } }
  );
  await expireMembershipForTests(a.member.userId);
  return { a, b };
}

describe("B7 chat", () => {
  let refs: ReferenceIds;

  beforeEach(async () => {
    await resetTransactionalTables();
    await resetAdminUsers();
    await resetOtpConfigForTests();
    await resetMatchingWeightsForTests();
    __resetRateLimitsForTests();
    refs = await resolveReferenceIds();
  });

  // --- Creation --------------------------------------------------------

  it("[chat-requires-match] cannot open a chat with someone you have no match with", async () => {
    const { a, b } = await twoReadyUsers(refs, "chat-nomatch");
    await activateMembershipForTests(a.member.userId);
    const res = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
    expect(res.status).toBe(404);
  });

  it("[chat-cannot-self] cannot open a chat with yourself", async () => {
    const { a } = await twoReadyUsers(refs, "chat-self");
    await activateMembershipForTests(a.member.userId);
    const res = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: a.member.userId }, a.member.sessionToken));
    expect(res.status).toBe(400);
  });

  it("[chat-create-no-membership] a real match without an active membership cannot open a NEW chat", async () => {
    const { a, b } = await createMatchedPair(refs, "chat-nomember");
    const res = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
    expect(res.status).toBe(403);
  });

  it("[chat-create-with-membership] a real match with an active membership opens a chat, idempotently", async () => {
    const { a, b } = await createMatchedPair(refs, "chat-create");
    await activateMembershipForTests(a.member.userId);

    const res1 = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
    expect(res1.status).toBe(201);
    const { data: data1 } = await res1.json();
    expect(data1.chat.counterpart.userId).toBe(b.member.userId);

    // Second open (even from the OTHER party, who has no membership) must
    // return the SAME chat, never a duplicate — opening an EXISTING chat
    // never re-checks membership.
    const res2 = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: a.member.userId }, b.member.sessionToken));
    expect(res2.status).toBe(201);
    const { data: data2 } = await res2.json();
    expect(data2.chat.id).toBe(data1.chat.id);
  });

  it("[chat-blocked-create] a blocked pair cannot open a NEW chat even if matched", async () => {
    const { a, b } = await createMatchedPair(refs, "chat-blockcreate");
    await activateMembershipForTests(a.member.userId);
    await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

    const res = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
    expect(res.status).toBe(403);
  });

  // --- Sending / IDOR ----------------------------------------------------

  async function openedChat(prefix: string) {
    const { a, b } = await createMatchedPair(refs, prefix);
    await activateMembershipForTests(a.member.userId);
    const res = await openChat(ireq("http://localhost/api/v1/chats", { counterpartUserId: b.member.userId }, a.member.sessionToken));
    const { data } = await res.json();
    return { a, b, chatId: data.chat.id as string };
  }

  it("[chat-send-happy] a participant with active membership can send a message", async () => {
    const { a, b, chatId } = await openedChat("chat-send");
    const res = await sendMessage(
      ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "Hello there!" }, a.member.sessionToken),
      { params: { chatId } }
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.message.body).toBe("Hello there!");
    expect(data.message.senderUserId).toBe(a.member.userId);
    expect(data.message.mine).toBe(true);
    void b;
  });

  it("[chat-message-empty] an empty/whitespace-only message is rejected", async () => {
    const { a, chatId } = await openedChat("chat-empty");
    const res = await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "   " }, a.member.sessionToken), {
      params: { chatId },
    });
    expect(res.status).toBe(400);
  });

  it("[chat-message-too-long] a message over 2000 characters is rejected", async () => {
    const { a, chatId } = await openedChat("chat-long");
    const res = await sendMessage(
      ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "x".repeat(2001) }, a.member.sessionToken),
      { params: { chatId } }
    );
    expect(res.status).toBe(400);
  });

  it("[chat-idor-send] a third user (not a participant) cannot send into someone else's chat", async () => {
    const { chatId } = await openedChat("chat-idorsend");
    const stranger = await buildReadyProfile("chat-idorsend-c", refs, { gender: "FEMALE" });
    await activateMembershipForTests(stranger.member.userId);
    const res = await sendMessage(
      ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "sneaky" }, stranger.member.sessionToken),
      { params: { chatId } }
    );
    expect(res.status).toBe(403);
  });

  it("[chat-idor-list] a third user cannot list messages of someone else's chat", async () => {
    const { chatId } = await openedChat("chat-idorlist");
    const stranger = await buildReadyProfile("chat-idorlist-c", refs, { gender: "FEMALE" });
    const res = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages`, stranger.member.sessionToken), {
      params: { chatId },
    });
    expect(res.status).toBe(403);
  });

  it("[chat-idor-unknown-chat] a random uuid chat id gives the identical error as an unowned real one", async () => {
    const { a } = await twoReadyUsers(refs, "chat-idorunknown");
    const res = await listMessages(greq(`http://localhost/api/v1/chats/00000000-0000-0000-0000-000000000000/messages`, a.member.sessionToken), {
      params: { chatId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(403);
  });

  // --- Blocked pair ------------------------------------------------------

  it("[chat-blocked-send] a blocked pair cannot send a new message, but existing history stays readable", async () => {
    const { a, b, chatId } = await openedChat("chat-blocksend");
    await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "before the block" }, a.member.sessionToken), {
      params: { chatId },
    });

    await blockUser(ireq("http://localhost/api/v1/interactions/blocks", { targetUserId: b.member.userId }, a.member.sessionToken));

    const sendAfterBlock = await sendMessage(
      ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "after the block" }, a.member.sessionToken),
      { params: { chatId } }
    );
    expect(sendAfterBlock.status).toBe(403);

    const historyRes = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages`, a.member.sessionToken), {
      params: { chatId },
    });
    expect(historyRes.status).toBe(200);
    const { data } = await historyRes.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].body).toBe("before the block");
  });

  // --- Membership expiry ---------------------------------------------------

  it("[chat-membership-expired] existing chat history stays visible after membership expiry, but a new send is blocked", async () => {
    const { a, chatId } = await openedChat("chat-expiry");
    await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "while active" }, a.member.sessionToken), {
      params: { chatId },
    });

    await expireMembershipForTests(a.member.userId);

    const sendAfterExpiry = await sendMessage(
      ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "after expiry" }, a.member.sessionToken),
      { params: { chatId } }
    );
    expect(sendAfterExpiry.status).toBe(403);

    const historyRes = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages`, a.member.sessionToken), {
      params: { chatId },
    });
    expect(historyRes.status).toBe(200);
    const { data } = await historyRes.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].body).toBe("while active");
  });

  // --- Pagination / ordering -----------------------------------------------

  it("[chat-pagination] messages paginate, newest-first, with correct totals", async () => {
    const { a, chatId } = await openedChat("chat-page");
    for (let i = 1; i <= 5; i++) {
      await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: `msg ${i}` }, a.member.sessionToken), {
        params: { chatId },
      });
    }

    const page1 = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages?page=1&pageSize=2`, a.member.sessionToken), {
      params: { chatId },
    });
    const { data: d1 } = await page1.json();
    expect(d1.total).toBe(5);
    expect(d1.totalPages).toBe(3);
    expect(d1.items.map((m: { body: string }) => m.body)).toEqual(["msg 5", "msg 4"]);

    const page2 = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages?page=2&pageSize=2`, a.member.sessionToken), {
      params: { chatId },
    });
    const { data: d2 } = await page2.json();
    expect(d2.items.map((m: { body: string }) => m.body)).toEqual(["msg 3", "msg 2"]);
  });

  // --- Read state / unread counts ------------------------------------------

  it("[chat-unread-count] unread count reflects messages sent by the counterpart, not by me", async () => {
    const { a, b, chatId } = await openedChat("chat-unread");
    await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "from a" }, a.member.sessionToken), {
      params: { chatId },
    });

    const bCountRes = await unreadChatCount(greq("http://localhost/api/v1/chats/unread-count", b.member.sessionToken));
    const { data: bCount } = await bCountRes.json();
    expect(bCount.count).toBe(1);

    const aCountRes = await unreadChatCount(greq("http://localhost/api/v1/chats/unread-count", a.member.sessionToken));
    const { data: aCount } = await aCountRes.json();
    expect(aCount.count).toBe(0);
  });

  it("[chat-mark-read] marking a chat as read zeroes the unread count and sets readAt", async () => {
    const { a, b, chatId } = await openedChat("chat-markread");
    await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "from a" }, a.member.sessionToken), {
      params: { chatId },
    });

    const markRes = await markChatRead(ireq(`http://localhost/api/v1/chats/${chatId}/read`, undefined, b.member.sessionToken), {
      params: { chatId },
    });
    expect(markRes.status).toBe(200);
    const { data: markData } = await markRes.json();
    expect(markData.updated).toBe(1);

    const countRes = await unreadChatCount(greq("http://localhost/api/v1/chats/unread-count", b.member.sessionToken));
    const { data: countData } = await countRes.json();
    expect(countData.count).toBe(0);

    // Idempotent — marking again with nothing unread updates 0 rows, not
    // an error.
    const markAgain = await markChatRead(ireq(`http://localhost/api/v1/chats/${chatId}/read`, undefined, b.member.sessionToken), {
      params: { chatId },
    });
    expect(markAgain.status).toBe(200);
    const { data: markAgainData } = await markAgain.json();
    expect(markAgainData.updated).toBe(0);
  });

  // --- List my chats ---------------------------------------------------

  it("[chat-list-mine] listing my chats returns the counterpart and unread count", async () => {
    const { a, b, chatId } = await openedChat("chat-listmine");
    // `a` is the one with the active membership (see openedChat) — `a`
    // sends, so `b`'s unread count should reflect it.
    await sendMessage(ireq(`http://localhost/api/v1/chats/${chatId}/messages`, { body: "hi" }, a.member.sessionToken), {
      params: { chatId },
    });

    const res = await listMyChats(greq("http://localhost/api/v1/chats", b.member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.chats).toHaveLength(1);
    expect(data.chats[0].counterpart.userId).toBe(a.member.userId);
    expect(data.chats[0].unreadCount).toBe(1);
  });

  it("[chat-list-mine-empty] a user with no chats gets an empty list, not an error", async () => {
    const lone = await buildReadyProfile("chat-listempty", refs, { gender: "FEMALE" });
    const res = await listMyChats(greq("http://localhost/api/v1/chats", lone.member.sessionToken));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.chats).toEqual([]);
  });

  // --- Read-side does not require authentication as an unauthenticated caller --

  it("[chat-unauthenticated] every chat endpoint requires authentication", async () => {
    const { chatId } = await openedChat("chat-unauth");
    const res = await listMessages(greq(`http://localhost/api/v1/chats/${chatId}/messages`), { params: { chatId } });
    expect(res.status).toBe(401);
  });
});
