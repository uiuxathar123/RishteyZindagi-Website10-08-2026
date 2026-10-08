/**
 * Razorpay provider — SCAFFOLD, NOT IMPLEMENTED. No real Razorpay SDK/API
 * call is wired into this sandbox, so every method always throws rather
 * than fabricating a successful order/verification, even when credentials
 * are present — the exact same honesty contract
 * src/server/modules/otp/providers/email.provider.ts already established
 * for OTP delivery. See providers/types.ts for the full interface
 * contract.
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

export class RazorpayProvider implements PaymentGatewayProvider {
  readonly name = "Razorpay";

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.RAZORPAY_KEY_ID) && Boolean(env.RAZORPAY_KEY_SECRET);
  }

  private unavailable(): never {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    }
    throw new ServiceUnavailableError("Razorpay has credentials set but no real vendor integration is implemented yet.");
  }

  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    this.unavailable();
  }

  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    this.unavailable();
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.isConfigured()) return { ok: false, message: "Razorpay is not configured." };
    return { ok: false, message: "Razorpay has credentials set but no real vendor SDK is wired in — cannot verify a live connection." };
  }
}
