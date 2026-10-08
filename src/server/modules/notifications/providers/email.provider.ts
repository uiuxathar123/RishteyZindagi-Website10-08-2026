/**
 * Email notification provider — real SMTP delivery (nodemailer) through the same
 * mailer as the EMAIL OTP provider (src/server/lib/mailer.ts). Configure
 * SMTP_HOST (+ SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS) and EMAIL_FROM.
 * Never fakes success: unconfigured or a failed SMTP transaction throws.
 */
import { ServiceUnavailableError } from "@/server/lib/errors";
import { isMailerConfigured, sendMail } from "@/server/lib/mailer";
import type { NotificationProvider, NotificationSendParams } from "./types";

export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = "EMAIL" as const;

  isConfigured(): boolean {
    return isMailerConfigured();
  }

  async send(params: NotificationSendParams): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableError("Email notification delivery is not configured. Set SMTP_HOST and EMAIL_FROM.");
    }
    await sendMail({ to: params.to, subject: params.title, text: `${params.body}\n\n— RishteyZindagi` }, "notification");
  }
}
