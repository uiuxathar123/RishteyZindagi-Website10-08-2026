#!/usr/bin/env -S npx tsx
/**
 * Generates public/og-image.jpg (1200×630), the link-preview image named in src/app/layout.tsx's openGraph metadata.
 * JPEG on purpose: some social and chat apps still do not show WebP link previews.
 *   npx tsx scripts/make-og-image.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve(__dirname, "..", "public", "og-image.jpg");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF9EF"/>
      <stop offset="1" stop-color="#F4E5C4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="14" fill="#A51E3B"/>
  <rect x="0" y="616" width="1200" height="14" fill="#C99A45"/>
  <circle cx="1040" cy="150" r="210" fill="#A51E3B" opacity="0.06"/>
  <circle cx="1110" cy="520" r="160" fill="#C99A45" opacity="0.12"/>
  <g transform="translate(110 170)">
    <circle cx="48" cy="48" r="48" fill="#A51E3B"/>
    <path d="M48 74 C20 56 18 34 32 27 C40 23 46 27 48 33 C50 27 56 23 64 27 C78 34 76 56 48 74 Z" fill="#FFFFFF"/>
  </g>
  <text x="230" y="238" font-family="Georgia, 'Times New Roman', serif" font-size="68" font-weight="700" fill="#1C2D4F">Rishtey<tspan fill="#A51E3B">Zindagi</tspan>.com</text>
  <text x="112" y="350" font-family="Georgia, 'Times New Roman', serif" font-size="44" fill="#1C2D4F">Find a meaningful connection.</text>
  <text x="112" y="410" font-family="Georgia, 'Times New Roman', serif" font-size="44" fill="#1C2D4F">Build a beautiful future.</text>
  <text x="112" y="500" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#7A5A18">Premium Indian &amp; NRI Matrimonial Platform · Verified profiles · Personal Matchmaking</text>
</svg>`;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const info = await sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT);
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB)`);
})();
