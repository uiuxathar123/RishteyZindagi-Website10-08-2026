/**
 * Safe local/dev storage adapter (B3 §15). Writes files under
 * `.storage-local/` at the project root — never committed (see
 * .gitignore), never claimed to be a production object store. Used
 * whenever STORAGE_PROVIDER is unset or "local" (see factory.ts); a real
 * environment should configure a real provider before this code path is
 * ever hit in production (see factory.ts's production guard).
 */
import { promises as fs } from "fs";
import path from "path";
import { assertSafeStorageKey } from "./storage-key";
import type { StorageProvider, StorageUploadInput, StorageReadResult } from "./storage.types";

const ROOT = path.resolve(process.cwd(), ".storage-local");

function resolveSafePath(key: string): string {
  // Defense against a key containing "../" segments — every key this
  // module ever generates itself is a random UUID-based path (see
  // profiles.service.ts), but this guard makes path traversal
  // structurally impossible regardless of what's passed in.
  assertSafeStorageKey(key); // PCP: strict allow-list on top of the resolve() containment check below
  const resolved = path.resolve(ROOT, key);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error("Invalid storage key.");
  }
  return resolved;
}

export class LocalDiskStorageProvider implements StorageProvider {
  readonly name = "local";

  isConfigured(): boolean {
    // Always usable — it's the filesystem, not an external credentialed
    // service. (Distinct from OTP providers, which need real API keys.)
    return true;
  }

  async upload(input: StorageUploadInput): Promise<{ key: string }> {
    const filePath = resolveSafePath(input.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.buffer);
    // Content type isn't a first-class thing a raw filesystem stores —
    // persisted separately in profile_photos.mimeType and re-attached on
    // read by the caller (see storage.service.ts's readPhotoFile).
    return { key: input.key };
  }

  async read(key: string): Promise<StorageReadResult | null> {
    try {
      const filePath = resolveSafePath(key);
      const buffer = await fs.readFile(filePath);
      return { buffer, contentType: "application/octet-stream" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(resolveSafePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
