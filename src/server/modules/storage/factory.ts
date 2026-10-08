/**
 * Storage provider factory (B3 §15/§28). `STORAGE_PROVIDER` is a B1 env
 * var that has existed since B1 but was never read by any code until now
 * — see .env.example. Only "local" (or unset, which defaults to "local")
 * is actually implemented; anything else fails loudly with
 * ServiceUnavailableError rather than silently falling back to local disk
 * or pretending a real cloud provider is wired up (same honesty posture
 * as B2's OTP providers — see src/server/modules/otp/providers/factory.ts).
 */
import { ServiceUnavailableError } from "@/server/lib/errors";
import { getEnv } from "@/server/config/env";
import type { StorageProvider } from "./storage.types";
import { LocalDiskStorageProvider } from "./local-disk.provider";
import { S3StorageProvider } from "./s3.provider";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;

  const configured = (getEnv().STORAGE_PROVIDER || "local").toLowerCase();

  if (configured === "local") {
    cached = new LocalDiskStorageProvider();
    return cached;
  }

  // PCP: S3-compatible object storage (AWS S3, MinIO, R2, Spaces, …).
  if (configured === "s3") {
    cached = new S3StorageProvider();
    return cached;
  }

  // A real provider (e.g. "cloudinary") was requested but no such
  // integration exists in this codebase yet — fail honestly rather than
  // silently using local disk (which would not survive across instances
  // and would contradict the configured intent) or fabricating success.
  throw new ServiceUnavailableError(
    `Storage provider "${configured}" is not implemented. Supported providers: "local" and "s3".`
  );
}

/** Test-only: clears the cached provider so tests can re-resolve it after
 * changing env, mirroring the OTP provider factory's test hook. */
export function __resetStorageProviderForTests() {
  cached = null;
}
