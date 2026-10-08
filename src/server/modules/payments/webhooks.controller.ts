import type { NextRequest } from "next/server";
import { ok } from "@/server/lib/response";
import { ValidationError } from "@/server/lib/errors";
import { MAX_WEBHOOK_BYTES, handlePhonePeWebhook, handleRazorpayWebhook } from "./webhooks.service";

/** Reads the RAW bytes (signature verification needs them exactly as sent), refusing oversize bodies up front. */
async function readRaw(req: NextRequest): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) throw new ValidationError("Webhook body is too large.");
  return Buffer.from(await req.arrayBuffer());
}

export async function razorpayWebhookHandler(req: NextRequest) {
  const result = await handleRazorpayWebhook(await readRaw(req), req.headers);
  return ok(result, "Webhook received.");
}

export async function phonepeWebhookHandler(req: NextRequest) {
  const result = await handlePhonePeWebhook(await readRaw(req), req.headers);
  return ok(result, "Webhook received.");
}
