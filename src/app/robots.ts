import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";


/** Search engines may index the public site; private areas stay out of results (they also require sign-in). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/dashboard", "/api/", "/bff/", "/membership/checkout", "/membership/payment-return", "/recover-account", "/forgot-password"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
