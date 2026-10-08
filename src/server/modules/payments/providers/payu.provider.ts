/**
 * PayU provider — SCAFFOLD, NOT IMPLEMENTED. See razorpay.provider.ts's
 * file comment for the full honesty contract this mirrors exactly.
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import type {
  PaymentGatewayProvider,
  CreateOrderParams,
  CreateOrderResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  TestConnectionResult,
} from "./types";

export class PayUProvider implements PaymentGatewayProvider {
  readonly name = "PayU";

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.PAYU_MERCHANT_KEY) && Boolean(env.PAYU_SALT);
  }

  private unavailable(): never {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError("PayU is not configured. Set PAYU_MERCHANT_KEY and PAYU_SALT.");
    }
    throw new ServiceUnavailableError("PayU has credentials set but no real vendor integration is implemented yet.");
  }

  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    this.unavailable();
  }

  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    this.unavailable();
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.isConfigured()) return { ok: false, message: "PayU is not configured." };
    return { ok: false, message: "PayU has credentials set but no real vendor SDK is wired in — cannot verify a live connection." };
  }
}
