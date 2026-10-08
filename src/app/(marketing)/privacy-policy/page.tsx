import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How RishteyZindagi collects, uses, and protects your personal information.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="1 September 2026"
      intro="This Privacy Policy explains what information RishteyZindagi.com collects, how we use it, and the choices you have. This template is provided as a starting point for the product and should be reviewed by qualified legal counsel before publication."
      sections={[
        {
          id: "information-we-collect",
          title: "1. Information we collect",
          content: (
            <ul>
              <li>Profile details you provide: name, age, contact information, education, profession, family details and photos.</li>
              <li>Partner preferences and search activity, used to generate match recommendations.</li>
              <li>Communications with other members and with our support team.</li>
              <li>Payment and billing information, processed through our payment gateway partners — we do not store full card details ourselves.</li>
              <li>Device and usage information, such as IP address, browser type, and app interactions.</li>
            </ul>
          ),
        },
        {
          id: "how-we-use-it",
          title: "2. How we use your information",
          content: (
            <ul>
              <li>To create and verify your profile, and to generate compatibility-based recommendations.</li>
              <li>To operate core features: search, interests, likes, shortlists, chat and notifications.</li>
              <li>To process membership payments and maintain accurate billing records.</li>
              <li>To keep the platform safe — investigating reports, warnings and suspensions.</li>
              <li>To send service updates, security alerts, and (where you&apos;ve opted in) marketing communications.</li>
            </ul>
          ),
        },
        {
          id: "sharing",
          title: "3. Who we share information with",
          content: (
            <p>
              We share the profile information you choose to make visible with other members according to
              your privacy settings. We share limited data with payment gateways to process transactions,
              and with OTP/communication providers (SMS, WhatsApp or email, depending on which channel is
              active) to verify your account. We do not sell your personal information to third parties.
            </p>
          ),
        },
        {
          id: "your-choices",
          title: "4. Your choices and rights",
          content: (
            <p>
              You can review and update your profile at any time, control who can see your photos and
              contact details, download your data, and request account deletion from Settings. Deleted
              accounts enter a 30-day recovery window before permanent deletion.
            </p>
          ),
        },
        {
          id: "data-security",
          title: "5. Data security",
          content: (
            <p>
              We use industry-standard safeguards to protect your information, including encrypted
              connections and restricted internal access. No system is completely secure, and we encourage
              you to use a strong, unique password and to never share OTPs with anyone.
            </p>
          ),
        },
        {
          id: "contact",
          title: "6. Contact us",
          content: (
            <p>
              Questions about this policy can be sent to{" "}
              <a href="mailto:privacy@rishteyzindagi.com" className="rz-focus text-rz-maroon underline">
                privacy@rishteyzindagi.com
              </a>.
            </p>
          ),
        },
      ]}
    />
  );
}
