export interface FaqItem {
  question: string;
  answer: string;
  category: "Getting Started" | "Matching" | "Membership & Billing" | "Safety & Privacy";
}

export const FAQS: FaqItem[] = [
  {
    category: "Getting Started",
    question: "How does profile verification work?",
    answer:
      "Every new profile is reviewed by our verification team before it appears in search results. We check photo authenticity, contact details and basic information to keep the platform genuine.",
  },
  {
    category: "Getting Started",
    question: "How long does creating a profile take?",
    answer: "Most members finish the essentials in about 10 minutes. You can save progress and come back to add more detail — education, family background, photos — any time.",
  },
  {
    category: "Getting Started",
    question: "Can I use RishteyZindagi outside India?",
    answer:
      "Yes. We serve members across India, UAE, Saudi Arabia, Qatar and Kuwait, with search filters designed for both domestic and NRI matchmaking.",
  },
  {
    category: "Matching",
    question: "How is my match percentage calculated?",
    answer:
      "We weigh your stated partner preferences most heavily — age, religion, education, profession, location and lifestyle — with behavioural signals used only to fine-tune the ordering of recommendations.",
  },
  {
    category: "Matching",
    question: "Can I change my partner preferences later?",
    answer: "Yes, at any time from Settings → Partner Preferences — your recommendations update immediately.",
  },
  {
    category: "Membership & Billing",
    question: "What happens to my chats if my membership expires?",
    answer:
      "Existing conversations become read-only — you can still see your message history, but sending new messages requires renewing your membership.",
  },
  {
    category: "Membership & Billing",
    question: "Which payment methods are supported?",
    answer: "We support UPI, cards, net banking and popular wallets in India, and international cards for Gulf members, via a secure, verified payment gateway.",
  },
  {
    category: "Membership & Billing",
    question: "Can I get an invoice for my payment?",
    answer: "Yes — every payment generates an invoice you can view or download as a PDF from Settings → Invoice History.",
  },
  {
    category: "Safety & Privacy",
    question: "Is my contact information visible to everyone?",
    answer:
      "No — you control who can see your phone number, email and photos in your privacy settings. Contact details are only shared once you choose to reveal them to a specific match.",
  },
  {
    category: "Safety & Privacy",
    question: "How do I report or block someone?",
    answer: "Open their profile or your conversation and choose Report or Block — our safety team reviews every report, usually within 24 hours.",
  },
  {
    category: "Safety & Privacy",
    question: "Can I delete my account, and can I undo it?",
    answer:
      "Yes — account deletion is available in Settings. Deleted accounts enter a 30-day recovery window before permanent deletion, during which you can restore your account by logging in again.",
  },
];
