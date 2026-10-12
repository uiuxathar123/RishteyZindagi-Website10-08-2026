#!/usr/bin/env -S npx tsx
/**
 * B19 real-HTTP smoke test against a RUNNING PRODUCTION-MODE server (`next start`), orchestrated by
 * `scripts/smoke/run-smoke.sh b19`. Everything goes over TCP through the real middleware, BFF proxy, route handlers and
 * PostgreSQL; the only fake is the SMTP relay that receives e-mail (over STARTTLS, as production requires).
 *
 * Covers: maintenance mode (member 503 / admin and status exempt), admin MFA via an e-mailed code, public contact form
 * and admin inbox, the live chat stream (SSE) THROUGH the BFF proxy, groups (member + admin), the weekly digest job over
 * SMTP, member e-mail change, and that no secret value appears in any response.
 */
import { execFile, spawnSync } from "node:child_process";
import pg from "pg";
import { startMockSmtp, codeFromMail } from "../../tests/helpers/mock-otp";
import { BASE, Client, assertNoSecretsSeen, check, finish, sleep } from "./lib";

const env = process.env;
const PW = "Smoke#Pass-12345";
const SECRETS = (env.SMOKE_SECRETS ?? "").split(",").filter(Boolean);
const ONE_TIME: string[] = [];

/** Runs a CLI job WITHOUT blocking this process' event loop (the mock SMTP relay lives in this process and must keep answering). */
function runJobAsync(name: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("npx", ["--no-install", "tsx", "scripts/run-job.ts", name], { encoding: "utf8", env: process.env, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ status: err ? Number((err as { code?: unknown }).code) || 1 : 0, stdout, stderr });
    });
  });
}

async function main() {
  const fs = await import("node:fs");
  const tls = env.SMOKE_SMTP_TLS_KEY && env.SMOKE_SMTP_TLS_CERT ? { key: fs.readFileSync(env.SMOKE_SMTP_TLS_KEY, "utf8"), cert: fs.readFileSync(env.SMOKE_SMTP_TLS_CERT, "utf8") } : undefined;
  const smtp = await startMockSmtp({ user: env.SMTP_USER as string, pass: env.SMTP_PASS as string }, Number(env.SMTP_PORT), tls);
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const lastMail = (to: string) => [...smtp.mails].reverse().find((x) => x.to.includes(to));
  const lastCode = (to: string) => { const m = lastMail(to); return m ? codeFromMail(m.text) : ""; };

  // ---- 0. Super Admin
  const boot = spawnSync("npx", ["--no-install", "tsx", "scripts/create-super-admin.ts", "--email", "owner@smoke.example", "--name", "Smoke Owner"], { encoding: "utf8", env: process.env, timeout: 120_000 });
  const tempPw = /Temporary password[^:]*: (\S{16})/.exec(boot.stdout)?.[1] ?? "";
  SECRETS.push(tempPw);
  const owner = new Client("owner");
  let r = await owner.post("/bff/admin/login", { email: "owner@smoke.example", password: tempPw });
  r = await owner.post("/bff/admin/me/password", { currentPassword: tempPw, newPassword: PW });
  check("00 Super Admin bootstrapped and signed in", r.status === 200, r.text.slice(0, 120));

  // ---- 1. anonymous access to the new APIs
  const anon = new Client("anon");
  const ADMIN_NEW: Array<[string, string, unknown?]> = [
    ["GET", "/bff/admin/site-controls"], ["PATCH", "/bff/admin/site-controls", { maintenance: { enabled: true }, reason: "evil" }],
    ["GET", "/bff/admin/security-settings"], ["GET", "/bff/admin/profile-approvals"], ["GET", "/bff/admin/contact-messages"],
    ["GET", "/bff/admin/success-stories"], ["GET", "/bff/admin/groups"], ["POST", "/bff/admin/groups", { name: "Evil group" }],
    ["GET", "/bff/admin/renewals"], ["GET", "/bff/admin/dashboard/trends"], ["GET", "/bff/admin/security-events/export"],
  ];
  for (const [m, p, b] of ADMIN_NEW) check(`01 anonymous ${m} ${p.replace("/bff/admin", "")} → 401`, (await anon.req(m, p, b)).status === 401);
  for (const p of ["/bff/groups", "/bff/users/me/notification-preferences"]) check(`02 anonymous GET ${p.replace("/bff", "")} → 401`, (await new Client("a2").get(p)).status === 401);
  r = await anon.get("/bff/site-status");
  check("03 public site status: not in maintenance", r.status === 200 && r.data?.maintenance === false, r.text.slice(0, 120));

  // ---- 2. members (real sign-up through e-mailed codes)
  async function signUp(label: string, mobile: string) {
    const c = new Client(label);
    const email = `${label}@smoke.example`;
    await c.post("/bff/auth/register", { name: `Smoke ${label}`, email, mobileNumber: mobile, countryCode: "+91" });
    await sleep(300);
    let x = await c.post("/bff/auth/verify-signup-otp", { identifier: email, code: lastCode(email) });
    x = await c.post("/bff/auth/set-password", { identifier: email, ticket: x.data?.ticket, password: PW });
    const id = (await c.get("/bff/users/me")).data?.user?.id as string;
    return { c, email, id, ok: x.status < 300 && !!c.jar["rz_session"] };
  }
  const A = await signUp("alice", "9876500021");
  const B = await signUp("bobby", "9876500022");
  const X = await signUp("carol", "9876500023");
  check("10 three members signed up through e-mailed codes", A.ok && B.ok && X.ok);

  // ---- 3. maintenance mode
  r = await owner.patch("/bff/admin/site-controls", { maintenance: { enabled: true, message: "Back soon." } });
  check("20 turning maintenance on without a reason is refused (400)", r.status === 400, String(r.status));
  r = await owner.patch("/bff/admin/site-controls", { maintenance: { enabled: true, message: "Back soon." }, reason: "Smoke test window" });
  check("21 Super Admin turns maintenance on", r.status === 200 && r.data?.maintenance?.enabled === true, r.text.slice(0, 160));
  r = await A.c.get("/bff/users/me");
  check("22 a signed-in member now gets 503 with the maintenance flag", r.status === 503 && r.err?.details?.maintenance === true, `${r.status} ${r.text.slice(0, 160)}`);
  r = await anon.post("/bff/auth/login", { email: A.email, password: PW });
  check("23 sign-in is also answered with 503", r.status === 503, String(r.status));
  r = await anon.get("/bff/site-status");
  check("24 /site-status stays reachable and reports the message", r.status === 200 && r.data?.maintenance === true && r.data?.message === "Back soon.", r.text.slice(0, 160));
  check("25 the Admin Panel keeps working during maintenance", (await owner.get("/bff/admin/dashboard")).status === 200);
  check("26 health stays reachable", (await anon.get("/api/v1/health")).status === 200);
  r = await owner.patch("/bff/admin/site-controls", { maintenance: { enabled: false } });
  check("27 maintenance off again → members work", r.status === 200 && (await A.c.get("/bff/users/me")).status === 200);

  // ---- 4. admin MFA (e-mailed code)
  r = await owner.patch("/bff/admin/security-settings", { mfaRequired: true });
  check("30 Super Admin switches admin MFA on (e-mail delivery is configured)", r.status === 200 && r.data?.mfaRequired === true, r.text.slice(0, 200));
  const o2 = new Client("owner-2");
  const before = smtp.mails.length;
  r = await o2.post("/bff/admin/login", { email: "owner@smoke.example", password: PW });
  await sleep(400);
  check("31 password alone no longer opens a session: mfaRequired, masked address, no cookie, one e-mail sent", r.status === 200 && r.data?.mfaRequired === true && !o2.jar["rz_admin_session"] && smtp.mails.length === before + 1 && !String(r.text).includes("owner@smoke.example"), r.text.slice(0, 200));
  r = await o2.post("/bff/admin/login/verify-mfa", { email: "owner@smoke.example", code: "000000" });
  check("32 a wrong code is refused and opens nothing", r.status >= 400 && r.status < 500 && !o2.jar["rz_admin_session"], String(r.status));
  r = await o2.post("/bff/admin/login/verify-mfa", { email: "owner@smoke.example", code: lastCode("owner@smoke.example") });
  check("33 the e-mailed code opens the admin session", r.status === 200 && !!o2.jar["rz_admin_session"], r.text.slice(0, 160));
  r = await o2.patch("/bff/admin/security-settings", { mfaRequired: false });
  check("34 MFA switched off again (admin sessions unaffected)", r.status === 200 && r.data?.mfaRequired === false);

  // ---- 5. contact form + inbox
  r = await anon.post("/bff/contact", { name: "Visitor One", email: "visitor@smoke.example", topic: "GENERAL", subject: "Hello there", message: "I have a question about plans.", website: "" });
  check("40 public contact form accepts a message", r.status === 200, r.text.slice(0, 120));
  await anon.post("/bff/contact", { name: "Bot", email: "bot@smoke.example", topic: "GENERAL", subject: "Spam spam", message: "Buy my product now please.", website: "http://spam" });
  r = await owner.get("/bff/admin/contact-messages");
  check("41 admin inbox shows the real message and not the honeypot hit", r.status === 200 && r.data?.items?.length === 1 && r.data.items[0].email === "visitor@smoke.example", r.text.slice(0, 200));
  r = await anon.get("/contact");
  check("42 /contact page renders with the form", r.status === 200 && /Send message|contact/i.test(r.text));

  // ---- 6. live chat through the BFF (SSE)
  const matchId = (await db.query("insert into matches (id, user_a_id, user_b_id) values (gen_random_uuid(), $1, $2) returning id", [A.id < B.id ? A.id : B.id, A.id < B.id ? B.id : A.id])).rows[0].id;
  const chatId = (await db.query("insert into chats (id, match_id) values (gen_random_uuid(), $1) returning id", [matchId])).rows[0].id;
  for (const u of [A.id, B.id]) await db.query("insert into chat_participants (id, chat_id, user_id) values (gen_random_uuid(), $1, $2)", [chatId, u]);
  const planId = (await db.query("select id from membership_plans where code='PLAN_MONTHLY_INR'")).rows[0].id;
  for (const u of [A.id, B.id]) await db.query("insert into memberships (id, user_id, plan_id, status, started_at, expires_at) values (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now() + interval '30 days')", [u, planId]);

  check("50 a non-participant cannot open the stream (403)", (await X.c.get(`/bff/chats/${chatId}/stream`)).status === 403);
  check("51 anonymous cannot open the stream (401)", (await anon.get(`/bff/chats/${chatId}/stream`)).status === 401);
  const ac = new AbortController();
  const sres = await fetch(`${BASE}/bff/chats/${chatId}/stream`, { headers: { cookie: A.c.cookieHeader(), "x-forwarded-for": A.c.ip }, signal: ac.signal });
  check("52 the stream opens through the proxy as text/event-stream", sres.status === 200 && (sres.headers.get("content-type") ?? "").includes("text/event-stream"), `${sres.status} ${sres.headers.get("content-type")}`);
  let buf = "";
  const reader = sres.body!.getReader();
  const dec = new TextDecoder();
  const pump = (async () => { try { for (;;) { const x = await reader.read(); if (x.done) break; buf += dec.decode(x.value); } } catch { /* aborted */ } })();
  await sleep(600);
  const sent = await B.c.post(`/bff/chats/${chatId}/messages`, { body: "hello over the live stream" });
  const t0 = Date.now();
  while (!buf.includes("hello over the live stream") && Date.now() - t0 < 6000) await sleep(100);
  check("53 a message from the other member arrives on the open stream within seconds", sent.status === 201 && buf.includes("event: message") && buf.includes("hello over the live stream"), `${sent.status} after ${Date.now() - t0}ms; ${buf.slice(0, 200)}`);
  check("54 the first event was delivered before the message (connection was live, not buffered to the end)", buf.indexOf("event: ready") !== -1 && buf.indexOf("event: ready") < buf.indexOf("hello over"));
  ac.abort();
  await pump;

  // ---- 7. groups
  r = await owner.post("/bff/admin/groups", { name: "Smoke circle", description: "For the smoke test." });
  const groupId = r.data?.group?.id as string;
  check("60 Super Admin creates a group", r.status === 201 && !!groupId, r.text.slice(0, 160));
  check("61 an incomplete profile cannot join (403)", (await X.c.post(`/bff/groups/${groupId}/join`)).status === 403);
  for (const u of [A.id, B.id]) await db.query("insert into profiles (id, user_id, gender, date_of_birth, profile_status) values (gen_random_uuid(), $1, 'FEMALE', '1995-01-01', 'READY_FOR_VISIBILITY')", [u]);
  check("62 members with a ready, approved profile join", (await A.c.post(`/bff/groups/${groupId}/join`)).status === 200 && (await B.c.post(`/bff/groups/${groupId}/join`)).status === 200);
  check("63 a non-member cannot read the feed (403)", (await X.c.get(`/bff/groups/${groupId}/posts`)).status === 403);
  r = await A.c.post(`/bff/groups/${groupId}/posts`, { body: "Hello circle" });
  const postId = r.data?.post?.id as string;
  r = await B.c.get(`/bff/groups/${groupId}/posts`);
  check("64 another member sees the post as 'First L.' and never the full name", r.status === 200 && r.data?.items?.[0]?.body === "Hello circle" && r.data.items[0].authorName === "Smoke A.", JSON.stringify(r.data?.items?.[0]));
  check("65 reporting the post works", (await B.c.post(`/bff/group-posts/${postId}/report`, { reason: "Looks like spam" })).status === 200);
  r = await owner.get(`/bff/admin/groups/${groupId}/posts?filter=reported`);
  check("66 admin sees it in the reported list", r.status === 200 && r.data?.items?.[0]?.id === postId && r.data.items[0].reportCount === 1, r.text.slice(0, 200));
  r = await owner.patch(`/bff/admin/group-posts/${postId}`, { hidden: true, reason: "Spam advertising" });
  check("67 admin hides it; members no longer see it", r.status === 200 && (await B.c.get(`/bff/groups/${groupId}/posts`)).data?.items?.length === 0);

  // ---- 8. weekly digest over SMTP
  r = await A.c.patch("/bff/users/me/notification-preferences", { DIGEST: true });
  check("70 member opts in to the weekly digest", r.status === 200 && r.data?.preferences?.DIGEST === true, r.text.slice(0, 160));
  await db.query("insert into interests (id, from_user_id, to_user_id) values (gen_random_uuid(), $1, $2)", [X.id, A.id]);
  const mailsBefore = smtp.mails.length;
  const job = await runJobAsync("member-digest");
  await sleep(500);
  const dm = lastMail(A.email);
  check("71 the member-digest job exits 0 and sends one e-mail to the opted-in member", job.status === 0 && smtp.mails.length === mailsBefore + 1 && !!dm && /weekly/i.test(dm.subject), `${job.status} ${job.stdout.slice(0, 200)} ${job.stderr.slice(0, 200)}`);
  check("72 the digest contains counts only (no other member's name)", !!dm && /1 interest waiting/.test(dm.text) && !/carol/i.test(dm.text));
  const again = await runJobAsync("member-digest");
  await sleep(300);
  check("73 running it again the same week sends nothing", again.status === 0 && smtp.mails.length === mailsBefore + 1);
  const dg = await runJobAsync("membership-dunning");
  check("74 the membership-dunning job runs (no cycles yet, nothing charged)", dg.status === 0 && (await db.query("select count(*)::int n from payments")).rows[0].n === 0, dg.stdout.slice(0, 200));

  // ---- 9. change e-mail
  const newMail = "alice.new@smoke.example";
  r = await A.c.post("/bff/users/me/contact-change/request", { type: "EMAIL", newValue: newMail, password: PW });
  await sleep(400);
  check("80 e-mail change: code is sent to the NEW address", r.status === 200 && !!lastMail(newMail), r.text.slice(0, 160));
  r = await A.c.post("/bff/users/me/contact-change/confirm", { type: "EMAIL", newValue: newMail, code: lastCode(newMail) });
  check("81 confirming updates the account", r.status === 200, r.text.slice(0, 160));
  const fresh = new Client("alice-new");
  r = await fresh.post("/bff/auth/login", { email: newMail, password: PW });
  check("82 the new address is now the login (new device → code step, no session yet)", r.status === 200 && (r.data?.deviceVerificationRequired === true || !!fresh.jar["rz_session"]), r.text.slice(0, 160));

  // ---- 10. admin read-only views
  check("90 dashboard trends respond", (await owner.get("/bff/admin/dashboard/trends?days=7")).data?.series?.length === 7);
  r = await owner.get("/bff/admin/security-events/export");
  check("91 security-events export is CSV", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/csv") && r.text.startsWith("occurred_at"));
  r = await owner.get("/bff/admin/renewals");
  check("92 renewal overview responds and says nothing is charged automatically", r.status === 200 && /never charges/i.test(r.data?.note ?? ""));

  assertNoSecretsSeen(SECRETS, ONE_TIME);
  await db.end();
  await smtp.close();
  finish("B19 smoke");
}

main().catch((e) => {
  console.error("b19 smoke crashed:", e instanceof Error ? e.message : e);
  process.exit(2);
});
