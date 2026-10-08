/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
  // B1 §8 shipped baseline security headers + a static, permissive (`*`)
  // CORS header here. B10 replaces BOTH with a request-aware layer in
  // `src/middleware.ts` (env-configurable `ALLOWED_ORIGINS` CORS,
  // X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Cache-Control/
  // HSTS) — see that file's own top-of-file comment for the full
  // reasoning (a static `next.config.js` header value cannot vary per
  // request, which env-scoped CORS and correct OPTIONS-preflight
  // handling both need). Intentionally no `headers()` export here any
  // more, so the two layers can never emit duplicate/conflicting header
  // values for the same response.
  //
  // B16: that middleware only matches `/api/:path*`, so the website's own
  // HTML pages (member dashboard, admin panel, public site) were served
  // with no security headers at all. This block adds the same baseline to
  // every NON-API route (the negative lookahead keeps the two layers from
  // ever overlapping).
  //
  // PCP: a Content-Security-Policy is added for production builds only (the
  // dev server needs eval for hot reload). It is a BASELINE, not a nonce-based
  // policy: Next's inline bootstrap scripts need 'unsafe-inline' for script-src
  // until a per-request nonce middleware is built (documented follow-up), so
  // it does NOT stop an injected inline script — it does stop framing
  // (frame-ancestors 'none'), plugin content, <base> hijacking, form posts to
  // other origins, and loading script/connections from origins other than
  // this site and Razorpay Checkout. Next evaluates headers() at BUILD time,
  // so CSP_IMG_SRC_EXTRA (space-separated https origins, e.g. an S3/CDN host
  // that serves member photos) must be set when `npm run build` runs.
  async headers() {
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (process.env.NODE_ENV === "production") {
      baseline.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
      const extraImg = (process.env.CSP_IMG_SRC_EXTRA || "")
        .split(/\s+/)
        .filter((o) => /^https:\/\/[A-Za-z0-9.*-]+(:\d+)?$/.test(o));
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
        "style-src 'self' 'unsafe-inline'",
        `img-src ${["'self'", "data:", "blob:", "https://images.pexels.com", "https://cdn.razorpay.com", ...extraImg].join(" ")}`,
        "font-src 'self' data:",
        "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
        "frame-src https://api.razorpay.com https://checkout.razorpay.com",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://api.razorpay.com",
      ].join("; ");
      baseline.push({ key: "Content-Security-Policy", value: csp });
    }
    return [{ source: "/((?!api/).*)", headers: baseline }];
  },
};

module.exports = nextConfig;
