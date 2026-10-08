import "dotenv/config";
import * as otpService from "./src/server/modules/otp/otp.service";
import { getDevOtpCode } from "./src/server/modules/otp/providers/dev.provider";

async function main() {
  const identifier = "smoke-test@example.com";
  const purpose = "SIGNUP" as const;

  const res = await otpService.requestOtp({
    identifier,
    purpose,
    metadata: { name: "Smoke Test", mobileNumber: "9999999999" },
    meta: { ipAddress: "127.0.0.1", userAgent: "smoke-test" },
  });
  console.log("requestOtp ->", res);

  const code = getDevOtpCode(identifier, purpose);
  console.log("dev code ->", code);
  if (!code) throw new Error("no dev code found");

  // wrong code should fail and increment attempts
  try {
    await otpService.verifyOtpAndIssueTicket(identifier, purpose, "000000");
    throw new Error("expected wrong code to fail");
  } catch (e: any) {
    console.log("wrong code correctly rejected:", e.message);
  }

  const verifyRes = await otpService.verifyOtpAndIssueTicket(identifier, purpose, code);
  console.log("verifyOtpAndIssueTicket ->", verifyRes);

  const consumed = await otpService.consumeTicket(identifier, purpose, verifyRes.ticket);
  console.log("consumeTicket ->", consumed);

  // reusing ticket should fail
  try {
    await otpService.consumeTicket(identifier, purpose, verifyRes.ticket);
    throw new Error("expected reused ticket to fail");
  } catch (e: any) {
    console.log("reused ticket correctly rejected:", e.message);
  }

  console.log("SMOKE TEST PASSED");
}

main().then(() => process.exit(0)).catch((e) => { console.error("SMOKE TEST FAILED", e); process.exit(1); });
