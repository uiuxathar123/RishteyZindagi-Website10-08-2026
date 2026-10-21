#!/usr/bin/env -S npx tsx
/**
 * Converts member photos that were stored before uploads were converted to WebP (JPEG / PNG rows) to WebP, with the
 * exact converter new uploads use (storage/photo-convert.ts: EXIF orientation applied, longest side ≤ 2048 px,
 * quality 82). The photo's id and URL do not change, so every page keeps working.
 *
 *   npx tsx scripts/convert-photos-to-webp.ts --target=dev --dry-run   list what would be converted
 *   npx tsx scripts/convert-photos-to-webp.ts --target=dev             convert
 *
 * Guard rails: local database only, and only rishteyzindagi_dev / rishteyzindagi_test (from .env / .env.test). The
 * original file is NOT deleted (its storage key is kept in the audit entry), so a conversion can be undone by hand.
 * A photo whose file is missing or unreadable is skipped and reported, never half-updated. Safe to re-run.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  })
);
const target = args.get("target");
if (target !== "dev" && target !== "test") {
  console.error("Usage: npx tsx scripts/convert-photos-to-webp.ts --target=dev|test [--dry-run]");
  process.exit(1);
}
const DRY = args.has("dry-run");
const ROOT = path.resolve(__dirname, "..");
loadEnv({ path: path.join(ROOT, target === "test" ? ".env.test" : ".env"), override: true });
const EXPECTED_DB = target === "test" ? "rishteyzindagi_test" : "rishteyzindagi_dev";

function guard() {
  if (process.env.NODE_ENV === "production") throw new Error("Refused: NODE_ENV=production.");
  const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`Refused: database host "${host}" is not this machine.`);
  if (db !== EXPECTED_DB) throw new Error(`Refused: database is "${db}", expected ${EXPECTED_DB}.`);
  return db;
}

async function main() {
  const dbName = guard();
  const { eq, ne } = await import("drizzle-orm");
  const { db } = await import("../src/server/db/client");
  const { profilePhotos } = await import("../src/server/db/schema");
  const { getStorageProvider } = await import("../src/server/modules/storage/factory");
  const { convertPhotoToWebp } = await import("../src/server/modules/storage/photo-convert");
  const { record } = await import("../src/server/modules/audit/audit.service");

  const rows = await db.select().from(profilePhotos).where(ne(profilePhotos.mimeType, "image/webp"));
  console.log(`Target: ${dbName}. Photos not yet WebP: ${rows.length}`);
  const storage = getStorageProvider();
  let converted = 0;
  let savedBytes = 0;
  const skipped: string[] = [];
  for (const p of rows) {
    if (!p.storageKey) {
      skipped.push(`${p.id}: no stored file`);
      continue;
    }
    const file = await storage.read(p.storageKey).catch(() => null);
    if (!file) {
      skipped.push(`${p.id}: file missing (${p.storageKey})`);
      continue;
    }
    let out;
    try {
      out = await convertPhotoToWebp(file.buffer);
    } catch (e) {
      skipped.push(`${p.id}: unreadable (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const newKey = p.storageKey.replace(/\.[a-z0-9]+$/i, "") + ".webp";
    const before = file.buffer.length;
    console.log(`  ${p.id}  ${p.mimeType} ${Math.round(before / 1024)} KB -> webp ${Math.round(out.buffer.length / 1024)} KB (${out.width}x${out.height})`);
    if (DRY) continue;
    await storage.upload({ key: newKey, buffer: out.buffer, contentType: out.contentType });
    await db
      .update(profilePhotos)
      .set({ storageKey: newKey, mimeType: out.contentType, fileSizeBytes: out.buffer.length, width: out.width, height: out.height, updatedAt: new Date() })
      .where(eq(profilePhotos.id, p.id));
    await record({
      actorType: "SYSTEM",
      action: "profile_photo.converted_to_webp",
      entityType: "profile_photo",
      entityId: p.id,
      metadata: { fromMime: p.mimeType, fromKey: p.storageKey, toKey: newKey, fromBytes: before, toBytes: out.buffer.length },
    });
    converted++;
    savedBytes += before - out.buffer.length;
  }
  if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
  console.log(DRY ? "Dry run: nothing changed." : `Converted ${converted} photos to WebP (saved ${Math.round(savedBytes / 1024)} KB). Originals kept.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("STOPPED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
