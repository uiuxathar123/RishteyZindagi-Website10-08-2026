/**
 * Paytm Payment Gateway provider — SCAFFOLD, NOT IMPLEMENTED. See
 * razorpay.provider.ts's file comment for the full honesty contract this
 * mirrors exactly.
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

export class PaytmProvider implements PaymentGatewayProvider {
  readonly name = "Paytm Payment Gateway";

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.PAYTM_MERCHANT_ID) && Boolean(env.PAYTM_MERCHANT_KEY);
  }

  private unavailable(): never {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError("Paytm Payment Gateway is not configured. Set PAYTM_MERCHANT_ID and PAYTM_MERCHANT_KEY.");
    }
    throw new ServiceUnavailableError("Paytm Payment Gateway has credentials set but no real vendor integration is implemented yet.");
  }

  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    this.unavailable();
  }

  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    this.unavailable();
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.isConfigured()) return { ok: false, message: "Paytm Payment Gateway is not configured." };
    return { ok: false, message: "Paytm Payment Gateway has credentials set but no real vendor SDK is wired in — cannot verify a live connection." };
  }
}
