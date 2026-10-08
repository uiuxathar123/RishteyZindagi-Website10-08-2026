/**
 * Protocol-accurate local mock servers for Razorpay and PhonePe, implementing
 * only the documented endpoints/fields the adapters call (see the adapters'
 * header comments for the contract). They exist so the REAL adapter code —
 * HTTP, auth headers, request bodies, response parsing, timeouts — is exercised
 * end to end in CI. They prove the adapters follow the documented contract;
 * they do NOT prove the live vendor services accept the credentials (that
 * remains NOT VERIFIED / REQUIRES EXTERNAL CREDENTIALS).
 */
import http from "http";
import type { AddressInfo } from "net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void, port: number) {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
      handler(req, body, res);
    });
  });
  return new Promise<{ server: http.Server; requests: RecordedRequest[]; port: number }>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, requests, port: (server.address() as AddressInfo).port }));
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
export interface MockRazorpay {
  baseUrl: string;
  requests: RecordedRequest[];
  orders: Map<string, { id: string; amount: number; currency: string; receipt: string; status: string }>;
  /** payments attached to an order, as returned by GET /v1/orders/:id/payments */
  payments: Map<string, Array<Record<string, unknown>>>;
  refunds: Map<string, { id: string; payment_id: string; amount: number; status: string }>;
  failNext: { status: number } | null;
  capture(orderId: string, opts?: { amount?: number; id?: string; currency?: string }): string;
  setRefundStatus(refundId: string, status: "pending" | "processed" | "failed"): void;
  /** auto status given to refunds created from now on */
  newRefundStatus: "pending" | "processed" | "failed";
  close(): Promise<void>;
}

export async function startMockRazorpay(creds: { keyId: string; keySecret: string }, port = 45871): Promise<MockRazorpay> {
  const expected = "Basic " + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const state: MockRazorpay = {
    baseUrl: "",
    requests: [],
    orders: new Map(),
    payments: new Map(),
    refunds: new Map(),
    failNext: null,
    newRefundStatus: "pending",
    capture(orderId, opts = {}) {
      const order = state.orders.get(orderId)!;
      const id = opts.id ?? `pay_${Math.random().toString(36).slice(2, 12)}`;
      const list = state.payments.get(orderId) ?? [];
      list.push({
        id,
        entity: "payment",
        order_id: orderId,
        status: "captured",
        captured: true,
        amount: opts.amount ?? order.amount,
        currency: opts.currency ?? order.currency,
        method: "upi",
        email: "customer@example.com",
        contact: "+919999999999",
        vpa: "customer@upi",
        created_at: Math.floor(Date.now() / 1000),
      });
      state.payments.set(orderId, list);
      return id;
    },
    setRefundStatus(refundId, status) {
      const r = state.refunds.get(refundId);
      if (r) r.status = status;
    },
    async close() {
      await new Promise<void>((r) => srv.server.close(() => r()));
    },
  };
  const srv = await startServer((req, body, res) => {
    if (state.failNext) {
      const f = state.failNext;
      state.failNext = null;
      return json(res, f.status, { error: { code: "SERVER_ERROR", description: "simulated" } });
    }
    if (req.headers.authorization !== expected) {
      return json(res, 401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
    }
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    if (req.method === "POST" && path === "/v1/orders") {
      const b = JSON.parse(body);
      if (!Number.isInteger(b.amount) || b.amount < 100 || !b.currency || (b.receipt && String(b.receipt).length > 40)) {
        return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "invalid" } });
      }
      const id = `order_${Math.random().toString(36).slice(2, 14)}`;
      const order = { id, amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" };
      state.orders.set(id, order);
      return json(res, 200, { ...order, entity: "order", amount_paid: 0, amount_due: b.amount, attempts: 0, notes: b.notes ?? {}, created_at: Math.floor(Date.now() / 1000) });
    }
    if (req.method === "GET" && path === "/v1/orders") return json(res, 200, { entity: "collection", count: 0, items: [] });
    let m = /^\/v1\/orders\/([^/]+)\/payments$/.exec(path);
    if (req.method === "GET" && m) {
      if (!state.orders.has(m[1])) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "not found" } });
      const items = state.payments.get(m[1]) ?? [];
      return json(res, 200, { entity: "collection", count: items.length, items });
    }
    m = /^\/v1\/payments\/([^/]+)\/refund$/.exec(path);
    if (req.method === "POST" && m) {
      const b = JSON.parse(body);
      const id = `rfnd_${Math.random().toString(36).slice(2, 12)}`;
      const refund = { id, payment_id: m[1], amount: b.amount, status: state.newRefundStatus };
      state.refunds.set(id, refund);
      return json(res, 200, { entity: "refund", ...refund, receipt: b.receipt ?? null });
    }
    m = /^\/v1\/refunds\/([^/]+)$/.exec(path);
    if (req.method === "GET" && m) {
      const r = state.refunds.get(m[1]);
      return r ? json(res, 200, { entity: "refund", ...r }) : json(res, 400, { error: { code: "BAD_REQUEST_ERROR" } });
    }
    return json(res, 404, { error: { code: "NOT_FOUND" } });
  }, port);
  state.baseUrl = `http://127.0.0.1:${srv.port}`;
  state.requests = srv.requests;
  return state;
}

// ---------------------------------------------------------------------------
export interface MockPhonePe {
  payBase: string;
  authUrl: string;
  requests: RecordedRequest[];
  orders: Map<string, { merchantOrderId: string; amount: number; state: "PENDING" | "COMPLETED" | "FAILED"; redirectUrl: string }>;
  refunds: Map<string, { merchantRefundId: string; refundId: string; amount: number; state: "PENDING" | "COMPLETED" | "FAILED"; original: string }>;
  tokensIssued: number;
  setOrderState(merchantOrderId: string, state: "PENDING" | "COMPLETED" | "FAILED", amountOverride?: number): void;
  setRefundState(merchantRefundId: string, state: "PENDING" | "COMPLETED" | "FAILED"): void;
  close(): Promise<void>;
}

export async function startMockPhonePe(creds: { clientId: string; clientSecret: string; clientVersion: string }, port = 45872): Promise<MockPhonePe> {
  const TOKEN = "mock-phonepe-access-token";
  const state: MockPhonePe = {
    payBase: "",
    authUrl: "",
    requests: [],
    orders: new Map(),
    refunds: new Map(),
    tokensIssued: 0,
    setOrderState(id, s, amountOverride) {
      const o = state.orders.get(id)!;
      o.state = s;
      if (amountOverride !== undefined) o.amount = amountOverride;
    },
    setRefundState(id, s) {
      const r = state.refunds.get(id);
      if (r) r.state = s;
    },
    async close() {
      await new Promise<void>((r) => srv.server.close(() => r()));
    },
  };
  const srv = await startServer((req, body, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    if (req.method === "POST" && path === "/identity/v1/oauth/token") {
      const f = new URLSearchParams(body);
      if (
        req.headers["content-type"] !== "application/x-www-form-urlencoded" ||
        f.get("grant_type") !== "client_credentials" ||
        f.get("client_id") !== creds.clientId ||
        f.get("client_secret") !== creds.clientSecret ||
        f.get("client_version") !== creds.clientVersion
      ) {
        return json(res, 401, { code: "UNAUTHORIZED", message: "bad client" });
      }
      state.tokensIssued++;
      return json(res, 200, { access_token: TOKEN, encrypted_access_token: TOKEN, token_type: "O-Bearer", issued_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (req.headers.authorization !== `O-Bearer ${TOKEN}`) return json(res, 401, { code: "UNAUTHORIZED", message: "bad token" });

    if (req.method === "POST" && path === "/pg/checkout/v2/pay") {
      const b = JSON.parse(body);
      if (
        !b.merchantOrderId ||
        String(b.merchantOrderId).length > 63 ||
        !/^[A-Za-z0-9_-]+$/.test(b.merchantOrderId) ||
        !Number.isInteger(b.amount) ||
        b.amount < 100 ||
        b.paymentFlow?.type !== "PG_CHECKOUT" ||
        !b.paymentFlow?.merchantUrls?.redirectUrl
      ) {
        return json(res, 400, { code: "BAD_REQUEST", message: "Please check the inputs you have provided." });
      }
      if (state.orders.has(b.merchantOrderId)) return json(res, 400, { code: "BAD_REQUEST", message: "Please check the inputs you have provided." });
      const redirectUrl = `https://mercury-uat.phonepe.com/transact/uat_v2?token=mock-${b.merchantOrderId}`;
      state.orders.set(b.merchantOrderId, { merchantOrderId: b.merchantOrderId, amount: b.amount, state: "PENDING", redirectUrl });
      return json(res, 200, { orderId: `OMO${b.merchantOrderId.slice(-8)}`, state: "PENDING", expireAt: Date.now() + 1800_000, redirectUrl });
    }
    let m = /^\/pg\/checkout\/v2\/order\/([^/]+)\/status$/.exec(path);
    if (req.method === "GET" && m) {
      const o = state.orders.get(m[1]);
      if (!o) return json(res, 404, { code: "INVALID_MERCHANT_ORDER_ID", message: "No entry found for given merchant order id" });
      return json(res, 200, {
        orderId: `OMO${o.merchantOrderId.slice(-8)}`,
        state: o.state,
        amount: o.amount,
        expireAt: Date.now() + 1000,
        paymentDetails: o.state === "PENDING" ? [] : [{ transactionId: `OM${o.merchantOrderId.slice(-8)}`, paymentMode: "UPI_QR", timestamp: Date.now(), amount: o.amount, state: o.state, ...(o.state === "FAILED" ? { errorCode: "PAYMENT_ERROR" } : {}) }],
      });
    }
    if (req.method === "POST" && path === "/pg/payments/v2/refund") {
      const b = JSON.parse(body);
      const o = state.orders.get(b.originalMerchantOrderId);
      if (!o || o.state !== "COMPLETED" || !Number.isInteger(b.amount) || b.amount < 100 || b.amount > o.amount || !b.merchantRefundId) {
        return json(res, 400, { code: "BAD_REQUEST", message: "Please check the inputs you have provided." });
      }
      const refundId = `OMR${b.merchantRefundId.slice(-8)}`;
      state.refunds.set(b.merchantRefundId, { merchantRefundId: b.merchantRefundId, refundId, amount: b.amount, state: "PENDING", original: b.originalMerchantOrderId });
      return json(res, 200, { refundId, amount: b.amount, state: "PENDING" });
    }
    m = /^\/pg\/payments\/v2\/refund\/([^/]+)\/status$/.exec(path);
    if (req.method === "GET" && m) {
      const r = state.refunds.get(m[1]);
      if (!r) return json(res, 404, { code: "NOT_FOUND", message: "refund not found" });
      return json(res, 200, { originalMerchantOrderId: r.original, amount: r.amount, state: r.state, timestamp: Date.now(), refundId: r.refundId, ...(r.state === "FAILED" ? { errorCode: "REFUND_FAILED" } : {}) });
    }
    return json(res, 404, { code: "NOT_FOUND" });
  }, port);
  state.payBase = `http://127.0.0.1:${srv.port}/pg`;
  state.authUrl = `http://127.0.0.1:${srv.port}/identity/v1/oauth/token`;
  state.requests = srv.requests;
  return state;
}
