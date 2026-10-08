import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "RishteyZindagi's refund and cancellation policy for membership plans.",
  alternates: { canonical: "/refund-policy" },
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="1 September 2026"
      intro="This policy explains when a membership payment is eligible for a refund. This template is provided as a starting point and should be reviewed by qualified legal counsel and aligned with local consumer protection law before publication."
      sections={[
        {
          id: "general",
          title: "1. General policy",
          content: <p>Membership fees are generally non-refundable once a plan has been activated, since access to chat, unlimited interests and advanced search begins immediately upon successful payment verification.</p>,
        },
        {
          id: "eligible-cases",
          title: "2. Cases eligible for a refund",
          content: (
            <ul>
              <li>A duplicate charge caused by a payment gateway or technical error.</li>
              <li>A membership charged after your account was already suspended or permanently removed by us.</li>
              <li>A charge you did not authorise, reported within 7 days of the transaction.</li>
            </ul>
          ),
        },
        {
          id: "how-to-request",
          title: "3. How to request a refund",
          content: <p>Contact our support team from Settings → Support, or email billing@rishteyzindagi.com with your invoice number. We review requests within 5 business days and notify you of the outcome by email.</p>,
        },
        {
          id: "processing-time",
          title: "4. Processing time",
          content: <p>Approved refunds are credited to your original payment method within 7–10 business days, depending on your bank or payment provider.</p>,
        },
        {
          id: "cancellation",
          title: "5. Cancelling auto-renewal",
          content: <p>If your plan is set to auto-renew, you can cancel any time before the renewal date from Settings → Membership to avoid the next charge. Cancelling does not refund the current billing period.</p>,
        },
      ]}
    />
  );
}
