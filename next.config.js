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
  // ever overlapping). No CSP: Next's inline bootstrap scripts would need a
  // per-request nonce; that is a documented follow-up, not a regression.
  async headers() {
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (process.env.NODE_ENV === "production") {
      baseline.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
    }
    return [{ source: "/((?!api/).*)", headers: baseline }];
  },
};

module.exports = nextConfig;
