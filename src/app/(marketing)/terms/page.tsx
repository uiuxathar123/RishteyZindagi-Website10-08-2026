import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of RishteyZindagi.com.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="1 September 2026"
      intro="These Terms govern your use of RishteyZindagi.com and our mobile app. By creating a profile, you agree to these Terms. This template is provided as a starting point and should be reviewed by qualified legal counsel before publication."
      sections={[
        {
          id: "eligibility",
          title: "1. Eligibility",
          content: <p>You must be at least 18 years old and legally able to marry to create a profile on RishteyZindagi. Profiles must represent the member themselves, or be created by an immediate family member on their behalf with their knowledge and consent.</p>,
        },
        {
          id: "account-accuracy",
          title: "2. Account accuracy",
          content: <p>You agree to provide accurate, current information and to keep it updated. Misrepresenting your identity, marital status, or other material facts is a violation of these Terms and may result in suspension.</p>,
        },
        {
          id: "acceptable-use",
          title: "3. Acceptable use",
          content: (
            <ul>
              <li>No harassment, abusive language, or unwanted repeated contact toward other members.</li>
              <li>No solicitation, advertising, or requests for money or financial information.</li>
              <li>No impersonation of another person, or creation of duplicate/fake profiles.</li>
              <li>No use of the platform for any purpose other than genuine matrimonial searching.</li>
            </ul>
          ),
        },
        {
          id: "membership",
          title: "4. Membership & payments",
          content: <p>Paid memberships unlock features described on our Membership page for the stated duration. Membership is activated only after your payment is verified on our systems. Fees are non-refundable except as described in our Refund Policy.</p>,
        },
        {
          id: "suspension",
          title: "5. Suspension & termination",
          content: <p>We may warn, suspend, or permanently remove any account that violates these Terms, receives multiple credible reports from other members, or engages in fraudulent or unsafe behaviour. You may delete your account at any time from Settings.</p>,
        },
        {
          id: "liability",
          title: "6. Limitation of liability",
          content: <p>RishteyZindagi facilitates introductions between members; we do not guarantee compatibility, relationship outcomes, or the accuracy of information members provide about themselves. Members are responsible for exercising their own judgment, particularly before meeting in person or sharing personal or financial information.</p>,
        },
        {
          id: "changes",
          title: "7. Changes to these Terms",
          content: <p>We may update these Terms from time to time. Material changes will be communicated in-app or by email before they take effect.</p>,
        },
      ]}
    />
  );
}
