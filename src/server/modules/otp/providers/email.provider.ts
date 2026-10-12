/**
 * EMAIL OTP provider — real SMTP delivery via nodemailer (src/server/lib/mailer.ts).
 * Configure with SMTP_HOST (+ SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS) and
 * EMAIL_FROM. `isConfigured()` only checks presence; a wrong password still fails
 * honestly at `send()` time. The code is placed in the message body and nowhere
 * else (not logged, not stored in plaintext).
 */
import { ServiceUnavailableError } from "@/server/lib/errors";
import { isMailerConfigured, missingMailerSettings, sendMail } from "@/server/lib/mailer";
import type { OtpProvider, OtpSendParams } from "./types";
import { resolveOtpDestination } from "./destination";

const PURPOSE_LABEL: Record<string, string> = {
  SIGNUP: "complete your sign-up",
  LOGIN: "sign in",
  FORGOT_PASSWORD: "reset your password",
  NEW_DEVICE: "verify this new device",
  ACCOUNT_RECOVERY: "recover your account",
  ADMIN_MFA: "finish signing in to the Admin Panel",
  CONTACT_CHANGE: "confirm your new contact details",
};

export class EmailOtpProvider implements OtpProvider {
  readonly method = "EMAIL" as const;

  isConfigured(): boolean {
    return isMailerConfigured();
  }

  async send(params: OtpSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError(`Email OTP delivery is not configured. Set ${missingMailerSettings().join(" and ")}.`);
    }
    const dest = await resolveOtpDestination(params.to, params.purpose);
    if (!dest.email) throw new ServiceUnavailableError("No e-mail address is available to deliver this code to.");
    const minutes = Math.max(1, Math.round(params.expirySeconds / 60));
    const what = PURPOSE_LABEL[params.purpose] ?? "continue";
    await sendMail(
      {
        to: dest.email,
        subject: "Your RishteyZindagi verification code",
        text: `Your RishteyZindagi verification code to ${what} is ${params.code}.\n\nIt expires in ${minutes} minute${minutes === 1 ? "" : "s"}. Never share this code with anyone — we will never ask for it.\n\nIf you did not request this, you can ignore this e-mail.`,
      },
      "otp"
    );
  }
}
