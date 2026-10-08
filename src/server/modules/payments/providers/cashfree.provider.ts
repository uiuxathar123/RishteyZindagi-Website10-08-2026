/**
 * Cashfree Payments provider — SCAFFOLD, NOT IMPLEMENTED. See
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

export class CashfreeProvider implements PaymentGatewayProvider {
  readonly name = "Cashfree Payments";

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.CASHFREE_APP_ID) && Boolean(env.CASHFREE_SECRET_KEY);
  }

  private unavailable(): never {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError("Cashfree Payments is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.");
    }
    throw new ServiceUnavailableError("Cashfree Payments has credentials set but no real vendor integration is implemented yet.");
  }

  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    this.unavailable();
  }

  async verifyPayment(_params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    this.unavailable();
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.isConfigured()) return { ok: false, message: "Cashfree Payments is not configured." };
    return { ok: false, message: "Cashfree Payments has credentials set but no real vendor SDK is wired in — cannot verify a live connection." };
  }
}
