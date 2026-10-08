/**
 * PhonePe adapter — PhonePe Payment Gateway "Standard Checkout" (the current
 * server-side API), implemented ONLY from the official reference
 * (https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/…):
 *
 *  - Token:  POST {identity}/v1/oauth/token, application/x-www-form-urlencoded
 *            client_id, client_version, client_secret, grant_type=client_credentials
 *            → {access_token, token_type:"O-Bearer", expires_at (epoch s), …}
 *            sandbox  https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token
 *            production https://api.phonepe.com/apis/identity-manager/v1/oauth/token
 *  - Pay:    POST {pg}/checkout/v2/pay   Authorization: O-Bearer <token>
 *            {merchantOrderId (<=63, only _ and - as specials), amount (paise, >=100),
 *             expireAfter (300–3600 s), paymentFlow:{type:"PG_CHECKOUT", merchantUrls:{redirectUrl}}}
 *            → {orderId, state:"PENDING", expireAt, redirectUrl}
 *  - Status: GET {pg}/checkout/v2/order/{merchantOrderId}/status?details=true
 *            → {orderId, state: PENDING|FAILED|COMPLETED, amount, paymentDetails[]}
 *  - Refund: POST {pg}/payments/v2/refund {merchantRefundId, originalMerchantOrderId, amount}
 *            → {refundId, amount, state}
 *  - Refund status: GET {pg}/payments/v2/refund/{merchantRefundId}/status
 *            → {state: PENDING|COMPLETED|FAILED, …}
 *            sandbox pg  https://api-preprod.phonepe.com/apis/pg-sandbox
 *            production pg https://api.phonepe.com/apis/pg
 *
 * Nothing outside that documented contract is assumed. The site-side
 * `merchantOrderId` is our internal transaction ref (so the status API is
 * addressed by a value WE own); it is stored as `payments.gateway_reference`.
 *
 * STATUS: VERIFIED against a protocol-accurate local mock server
 * (tests/pcp-payments-phonepe.test.ts). NOT VERIFIED against the live
 * PhonePe service (REQUIRES EXTERNAL CREDENTIALS: client id/secret/version
 * from the PhonePe Business Dashboard).
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { loadPhonePeCredentials, type PhonePeCredentials } from "../credentials";
import { httpRequest, pick, resolveBase } from "./http";
import type {
  PaymentGatewayProvider,
  CreateOrderParams,
  CreateOrderResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  TestConnectionResult,
  RefundParams,
  RefundResult,
  RefundOutcomeStatus,
} from "./types";

const PG_BASE = { sandbox: "https://api-preprod.phonepe.com/apis/pg-sandbox", production: "https://api.phonepe.com/apis/pg" } as const;
const AUTH_BASE = {
  sandbox: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
  production: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
} as const;

function pgBase(c: PhonePeCredentials): string {
  return resolveBase(getEnv().PHONEPE_API_BASE, PG_BASE[c.environment]);
}
function authUrl(c: PhonePeCredentials): string {
  return resolveBase(getEnv().PHONEPE_AUTH_BASE, AUTH_BASE[c.environment]);
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}
// Per-process cache keyed by credentials+environment (a token is not a secret worth persisting; re-fetching on restart is cheap).
const tokenCache = new Map<string, CachedToken>();

export function __clearPhonePeTokenCacheForTests() {
  tokenCache.clear();
}

async function getToken(c: PhonePeCredentials): Promise<string> {
  const cacheKey = `${c.environment}:${c.clientId}:${c.clientVersion}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token;

  const form = new URLSearchParams({
    client_id: c.clientId,
    client_version: c.clientVersion,
    client_secret: c.clientSecret,
    grant_type: "client_credentials",
  });
  const res = await httpRequest("PhonePe", authUrl(c), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const token = pick(res.json, "access_token");
  if (res.status !== 200 || typeof token !== "string") {
    throw new ServiceUnavailableError(res.status === 401 || res.status === 400 ? "PhonePe rejected the configured credentials." : `PhonePe could not issue an access token (HTTP ${res.status}).`);
  }
  const expiresAt = pick(res.json, "expires_at");
  const expiresAtMs = typeof expiresAt === "number" ? expiresAt * 1000 : Date.now() + 5 * 60_000;
  tokenCache.set(cacheKey, { token, expiresAtMs });
  return token;
}

async function requireCreds(): Promise<PhonePeCredentials> {
  const c = await loadPhonePeCredentials();
  if (!c) {
    throw new ServiceUnavailableError(
      "PhonePe is not configured. Save the client id/secret/version in Admin → Payments, or set PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET and PHONEPE_CLIENT_VERSION."
    );
  }
  return c;
}

async function authed(c: PhonePeCredentials) {
  return { Authorization: `O-Bearer ${await getToken(c)}`, "Content-Type": "application/json" };
}

function apiError(status: number, json: unknown, action: string): ServiceUnavailableError {
  if (status === 401) return new ServiceUnavailableError("PhonePe rejected the access token.");
  const code = pick(json, "code");
  return new ServiceUnavailableError(`PhonePe could not ${action} (HTTP ${status}${typeof code === "string" ? `, ${code}` : ""}).`);
}

function refundState(raw: unknown): RefundOutcomeStatus {
  if (raw === "COMPLETED") return "PROCESSED";
  if (raw === "FAILED") return "FAILED";
  // PENDING (and the not-in-the-reference "CONFIRMED"/"ACCEPTED" transitional states) are not final.
  return "PENDING";
}

export class PhonePeProvider implements PaymentGatewayProvider {
  readonly name = "PhonePe Payment Gateway";

  /** Sync env-only signal (legacy admin view / prod-readiness). Accurate DB+env answer: payment-config.service.ts. */
  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.PHONEPE_CLIENT_ID) && Boolean(env.PHONEPE_CLIENT_SECRET) && Boolean(env.PHONEPE_CLIENT_VERSION);
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const c = await requireCreds();
    if (params.currency !== "INR") throw new ServiceUnavailableError("PhonePe only supports INR payments.");
    if (params.amountInSmallestUnit < 100) throw new ServiceUnavailableError("PhonePe requires a minimum amount of ₹1.");
    const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
    const returnUrl = `${appUrl}/membership/payment-return${params.paymentId ? `?paymentId=${encodeURIComponent(params.paymentId)}` : ""}`;
    const res = await httpRequest("PhonePe", `${pgBase(c)}/checkout/v2/pay`, {
      method: "POST",
      headers: await authed(c),
      body: JSON.stringify({
        merchantOrderId: params.receiptRef,
        amount: params.amountInSmallestUnit,
        expireAfter: 1800,
        paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl: returnUrl } },
      }),
    });
    const redirectUrl = pick(res.json, "redirectUrl");
    if (res.status !== 200 || typeof redirectUrl !== "string") throw apiError(res.status, res.json, "create the payment");
    return {
      providerOrderId: params.receiptRef,
      raw: { phonepeOrderId: pick(res.json, "orderId"), state: pick(res.json, "state") },
      clientCheckout: { provider: "PHONEPE", redirectUrl },
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const c = await requireCreds();
    const res = await httpRequest(
      "PhonePe",
      `${pgBase(c)}/checkout/v2/order/${encodeURIComponent(params.providerOrderId)}/status?details=true`,
      { headers: await authed(c) }
    );
    if (res.status !== 200) throw apiError(res.status, res.json, "read the order status");
    const state = pick(res.json, "state");
    const amount = pick(res.json, "amount");
    const details = pick(res.json, "paymentDetails");
    const attempts = Array.isArray(details) ? details : [];
    const completedAttempt = attempts.find((a) => pick(a, "state") === "COMPLETED");
    if (state === "COMPLETED") {
      return {
        status: "SUCCESS",
        gatewayTransactionId: String(pick(completedAttempt, "transactionId") ?? pick(res.json, "orderId")),
        amountInSmallestUnit: typeof amount === "number" ? amount : typeof amount === "string" && /^\d+$/.test(amount) ? Number(amount) : undefined,
        currency: "INR",
        rawResponse: { state, orderId: pick(res.json, "orderId"), amount, paymentMode: pick(completedAttempt, "paymentMode") },
      };
    }
    if (state === "FAILED") {
      return { status: "FAILED", rawResponse: { state, orderId: pick(res.json, "orderId"), errorCode: pick(res.json, "errorCode") ?? pick(attempts[0], "errorCode") } };
    }
    return { status: "PENDING", rawResponse: { state } };
  }

  async testConnection(): Promise<TestConnectionResult> {
    const c = await loadPhonePeCredentials();
    if (!c) return { ok: false, message: "PhonePe is not configured." };
    try {
      tokenCache.delete(`${c.environment}:${c.clientId}:${c.clientVersion}`);
      await getToken(c); // read-only: an OAuth token request moves no money
      return { ok: true, message: `PhonePe issued an access token (${c.environment}).` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "PhonePe could not be reached." };
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const c = await requireCreds();
    const res = await httpRequest("PhonePe", `${pgBase(c)}/payments/v2/refund`, {
      method: "POST",
      headers: await authed(c),
      body: JSON.stringify({
        merchantRefundId: params.refundRef,
        originalMerchantOrderId: params.providerOrderId,
        amount: params.amountInSmallestUnit,
      }),
    });
    const refundId = pick(res.json, "refundId");
    if (res.status !== 200 || typeof refundId !== "string") throw apiError(res.status, res.json, "create the refund");
    return { providerRefundId: refundId, status: refundState(pick(res.json, "state")) };
  }

  async getRefundStatus(params: { providerRefundId: string; refundRef: string }): Promise<RefundResult> {
    const c = await requireCreds();
    const res = await httpRequest("PhonePe", `${pgBase(c)}/payments/v2/refund/${encodeURIComponent(params.refundRef)}/status`, {
      headers: await authed(c),
    });
    if (res.status !== 200) throw apiError(res.status, res.json, "read the refund status");
    const failure = pick(res.json, "errorCode");
    return {
      providerRefundId: params.providerRefundId,
      status: refundState(pick(res.json, "state")),
      failureReason: typeof failure === "string" ? failure : undefined,
    };
  }
}
