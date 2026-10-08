/**
 * Local stand-ins for the OTP delivery vendors so the REAL adapters run in CI:
 *  - Fast2SMS: implements POST /dev/otp/send per the documented contract.
 *  - SMTP: a real SMTP server (smtp-server) that parses received mail (mailparser).
 * They prove the adapters follow the contract; they do NOT prove a live Fast2SMS
 * account / SMTP relay accepts the production credentials.
 */
import http from "http";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

export interface MockFast2Sms {
  baseUrl: string;
  calls: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }>;
  /** next response status; consumed once */
  failNext: { status: number } | null;
  hang: boolean;
  close(): Promise<void>;
}

export async function startMockFast2Sms(apiKey: string, port = 45873): Promise<MockFast2Sms> {
  const state: MockFast2Sms = {
    baseUrl: `http://127.0.0.1:${port}/dev`,
    calls: [],
    failNext: null,
    hang: false,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        /* ignore */
      }
      state.calls.push({ headers: req.headers, body });
      if (state.hang) return; // never answer
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (state.failNext) {
        const f = state.failNext;
        state.failNext = null;
        return send(f.status, { return: false, status_code: f.status, message: "simulated failure" });
      }
      if (req.method !== "POST" || req.url !== "/dev/otp/send") return send(404, { return: false, message: "not found" });
      if (req.headers.authorization !== apiKey) return send(401, { return: false, status_code: 401, message: "Invalid Authentication, Check Authorization Key" });
      const mobile = String(body.mobile ?? "");
      if (!/^[6-9]\d{9}$/.test(mobile) || !body.otp_id || (body.otp !== undefined && String(body.otp).length > 10)) {
        return send(400, { return: false, status_code: 400, message: "Invalid request" });
      }
      return send(200, { return: true, status_code: 200, request_id: "mock-req-" + state.calls.length, message: "OTP sent successfully" });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return state;
}

export interface MockSmtp {
  port: number;
  mails: Array<{ to: string[]; from: string; subject: string; text: string; auth: { user: string; pass: string } | null }>;
  rejectNext: boolean;
  close(): Promise<void>;
}

export async function startMockSmtp(
  creds: { user: string; pass: string },
  port = 45874,
  tls?: { key: string; cert: string }
): Promise<MockSmtp> {
  const state: MockSmtp = {
    port,
    mails: [],
    rejectNext: false,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  const server = new SMTPServer({
    secure: false,
    // With a certificate the server offers STARTTLS (the production-like path); without one it is plaintext-only.
    ...(tls ? { key: tls.key, cert: tls.cert } : { disabledCommands: ["STARTTLS"] }),
    allowInsecureAuth: !tls,
    authOptional: false,
    onAuth(auth, _session, cb) {
      if (auth.username === creds.user && auth.password === creds.pass) return cb(null, { user: auth.username });
      return cb(new Error("Invalid credentials"));
    },
    onData(stream, session, cb) {
      simpleParser(stream)
        .then((parsed) => {
          if (state.rejectNext) {
            state.rejectNext = false;
            const err = new Error("simulated rejection") as Error & { responseCode: number };
            err.responseCode = 550;
            return cb(err);
          }
          const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap((t) => t.value.map((v) => v.address ?? ""));
          state.mails.push({
            to,
            from: parsed.from?.value[0]?.address ?? "",
            subject: parsed.subject ?? "",
            text: parsed.text ?? "",
            auth: session.user ? { user: String(session.user), pass: creds.pass } : null,
          });
          cb();
        })
        .catch((e) => cb(e));
    },
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return state;
}

export function codeFromMail(text: string): string {
  const m = /\b(\d{4,10})\b/.exec(text.replace(/\d+ minutes?/g, ""));
  if (!m) throw new Error("no code in mail");
  return m[1];
}
