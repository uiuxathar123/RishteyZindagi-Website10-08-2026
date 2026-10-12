import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { UnauthorizedRedirect } from "@/components/session/SessionProvider";
import { SiteStatusBanner } from "@/components/layout/SiteStatusBanner";

const SITE_URL = "https://www.rishteyzindagi.com";

/**
 * Self-hosted static font files (see src/app/fonts/ — pulled from the
 * @fontsource distribution of each family, OFL-licensed, full text
 * alongside the files) via next/font/local: zero runtime requests to
 * Google Fonts, no flash of unstyled text, and it builds identically
 * whether the network is wide open or fully locked down. Playfair
 * Display carries every heading and serif accent; DM Sans carries all
 * body copy and UI chrome. Both expose the CSS custom properties
 * tailwind.config.ts's fontFamily tokens already read, so every
 * `font-serif` / `font-sans` utility class picks these up automatically.
 */
const dmSans = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "./fonts/dm-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/dm-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/dm-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const playfairDisplay = localFont({
  variable: "--font-serif",
  display: "swap",
  src: [
    { path: "./fonts/playfair-display-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/playfair-display-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/playfair-display-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/playfair-display-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "./fonts/playfair-display-latin-500-italic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/playfair-display-latin-600-italic.woff2", weight: "600", style: "italic" },
    { path: "./fonts/playfair-display-latin-700-italic.woff2", weight: "700", style: "italic" },
    { path: "./fonts/playfair-display-latin-800-italic.woff2", weight: "800", style: "italic" },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "RishteyZindagi.com — Premium Indian & NRI Matrimonial Platform",
    template: "%s | RishteyZindagi.com",
  },
  description:
    "Find a meaningful connection. Build a beautiful future. RishteyZindagi.com is a premium, verified matrimonial platform serving India, UAE, Saudi Arabia, Qatar and Kuwait — celebrating 10 years of bringing hearts together.",
  keywords: [
    "matrimonial site",
    "Indian matrimony",
    "NRI matrimony",
    "shaadi",
    "rishta",
    "marriage bureau",
  ],
  openGraph: {
    type: "website",
    siteName: "RishteyZindagi.com",
    title: "RishteyZindagi.com — Premium Indian & NRI Matrimonial Platform",
    description: "Find a meaningful connection. Build a beautiful future.",
    url: SITE_URL,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "RishteyZindagi.com" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RishteyZindagi.com — Premium Indian & NRI Matrimonial Platform",
    description: "Find a meaningful connection. Build a beautiful future.",
  },
  alternates: { canonical: "/" },
};

/**
 * Bare shell only — html/body, fonts, and site-wide metadata. The public
 * marketing chrome (Header/Footer) lives in `(marketing)/layout.tsx`;
 * `/dashboard` and `/admin` mount their own app shells instead, so a
 * logged-in member or staff screen never renders the public nav by
 * accident. Every child layout is responsible for its own skip-link and
 * `#main-content` landmark.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(dmSans.variable, playfairDisplay.variable)}>
      <body className="flex min-h-screen flex-col font-sans">
        <UnauthorizedRedirect />
        <SiteStatusBanner />
        {children}
      </body>
    </html>
  );
}
