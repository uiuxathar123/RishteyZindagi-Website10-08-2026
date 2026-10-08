/** Contract mocks for WhatsApp Cloud API and Firebase Cloud Messaging HTTP v1 (incl. the Google OAuth JWT-bearer token endpoint). */
import http from "http";
import { createVerify } from "crypto";

function listen(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void, port: number) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks).toString("utf8"), res));
  });
  return new Promise<http.Server>((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export async function startMockWhatsApp(opts: { accessToken: string; phoneNumberId: string; version?: string }, port = 45875) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const state = { calls, failNext: 0, close: async () => void (await new Promise<void>((r) => server.close(() => r()))) };
  const server = await listen((req, body, res) => {
    const parsed = body ? JSON.parse(body) : {};
    calls.push({ path: req.url ?? "", body: parsed });
    if (state.failNext) {
      const s = state.failNext;
      state.failNext = 0;
      return json(res, s, { error: { message: "simulated", code: 131000 } });
    }
    if (req.headers.authorization !== `Bearer ${opts.accessToken}`) return json(res, 401, { error: { message: "Invalid OAuth access token." } });
    if (req.method !== "POST" || req.url !== `/${opts.version ?? "v21.0"}/${opts.phoneNumberId}/messages`) return json(res, 404, { error: { message: "unknown path" } });
    if (parsed.messaging_product !== "whatsapp" || !/^\d{10,15}$/.test(String(parsed.to)) || parsed.type !== "template" || !parsed.template?.name) {
      return json(res, 400, { error: { message: "(#100) Invalid parameter" } });
    }
    return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: parsed.to, wa_id: parsed.to }], messages: [{ id: "wamid.mock" }] });
  }, port);
  return state;
}

export async function startMockFcm(opts: { clientEmail: string; publicKeyPem: string; projectId: string }, port = 45876) {
  const sends: Array<{ token: string; title: string; body: string }> = [];
  const state = {
    sends,
    tokenRequests: 0,
    unregistered: new Set<string>(),
    failNext: 0,
    close: async () => void (await new Promise<void>((r) => server.close(() => r()))),
  };
  const server = await listen((req, body, res) => {
    if (req.method === "POST" && req.url === "/token") {
      state.tokenRequests++;
      const f = new URLSearchParams(body);
      const jwt = f.get("assertion") ?? "";
      const [h, c, s] = jwt.split(".");
      let ok = f.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" && Boolean(h && c && s);
      if (ok) {
        const claims = JSON.parse(Buffer.from(c, "base64url").toString());
        const sigOk = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(opts.publicKeyPem, Buffer.from(s, "base64url"));
        ok = sigOk && claims.iss === opts.clientEmail && claims.scope === "https://www.googleapis.com/auth/firebase.messaging" && claims.exp > claims.iat && claims.exp - claims.iat <= 3600;
      }
      return ok ? json(res, 200, { access_token: "mock-fcm-access-token", expires_in: 3600, token_type: "Bearer" }) : json(res, 400, { error: "invalid_grant" });
    }
    if (req.method === "POST" && req.url === `/v1/projects/${opts.projectId}/messages:send`) {
      if (state.failNext) {
        const s = state.failNext;
        state.failNext = 0;
        return json(res, s, { error: { status: "INTERNAL" } });
      }
      if (req.headers.authorization !== "Bearer mock-fcm-access-token") return json(res, 401, { error: { status: "UNAUTHENTICATED" } });
      const m = JSON.parse(body).message;
      if (state.unregistered.has(m.token)) return json(res, 404, { error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } });
      sends.push({ token: m.token, title: m.notification.title, body: m.notification.body });
      return json(res, 200, { name: `projects/${opts.projectId}/messages/mock` });
    }
    return json(res, 404, {});
  }, port);
  return state;
}
