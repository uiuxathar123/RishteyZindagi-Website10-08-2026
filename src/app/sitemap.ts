import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/data/blogPosts";

// Same canonical origin as the root layout's metadataBase.
const SITE_URL = "https://www.rishteyzindagi.com";

/** Public pages only — member, admin, checkout and API routes are never listed (see robots.ts). */
const PUBLIC_PAGES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/search", priority: 0.9, changeFrequency: "daily" },
  { path: "/membership", priority: 0.8, changeFrequency: "weekly" },
  { path: "/personal-matchmaking", priority: 0.8, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.7, changeFrequency: "monthly" },
  { path: "/success-stories", priority: 0.7, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/safety", priority: 0.6, changeFrequency: "monthly" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.4, changeFrequency: "yearly" },
  { path: "/signup", priority: 0.6, changeFrequency: "yearly" },
  { path: "/login", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PUBLIC_PAGES.map((p) => ({ url: `${SITE_URL}${p.path}`, changeFrequency: p.changeFrequency, priority: p.priority })),
    ...BLOG_POSTS.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
