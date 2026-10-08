/**
 * PCP: S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces,
 * Backblaze B2 S3, …) selected with STORAGE_PROVIDER=s3.
 *
 * Configuration (environment only — never stored in the database, never returned by an API):
 *   STORAGE_BUCKET          bucket name (existing variable)
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *   S3_REGION               e.g. ap-south-1
 *   S3_ENDPOINT             optional; default https://s3.<region>.amazonaws.com (https required in production)
 *   S3_FORCE_PATH_STYLE     "true" for MinIO-style `<endpoint>/<bucket>/<key>` addressing
 *
 * Security
 *  - Objects are PRIVATE: the provider never sets a public ACL and the app serves
 *    files only through its own authenticated routes (profiles/photos/:id/file,
 *    invoices/:id/download). `getSignedUrl()` offers a short-lived (≤ 15 min) SigV4
 *    presigned GET for cases that need direct access.
 *  - Every key passes the same allow-list as the local provider (no `..`, no
 *    leading slash, no odd characters) before any request is built.
 *  - Requests are signed with SigV4 (src/server/lib/sigv4.ts), time-limited, never
 *    follow redirects, and never log keys, signatures or bodies.
 *  - Reads are capped (20 MB) so a corrupt/huge object cannot exhaust memory.
 *
 * Whether a given vendor/bucket accepts the credentials is NOT verified until real
 * credentials are used (REQUIRES EXTERNAL CREDENTIALS); the protocol is verified in
 * CI against an independent SigV4 verifier (see tests/pcp-storage.test.ts).
 */
import { getEnv } from "@/server/config/env";
import { ServiceUnavailableError } from "@/server/lib/errors";
import { logError } from "@/server/lib/logger";
import { presignUrl, signRequest, uriEncode } from "@/server/lib/sigv4";
import { assertSafeStorageKey } from "./storage-key";
import type { StorageProvider, StorageReadResult, StorageUploadInput } from "./storage.types";

const MAX_READ_BYTES = 20 * 1024 * 1024;
const MAX_PRESIGN_SECONDS = 900;

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  missingSettings(): string[] {
    const env = getEnv();
    const m: string[] = [];
    if (!env.STORAGE_BUCKET) m.push("STORAGE_BUCKET");
    if (!env.S3_ACCESS_KEY_ID) m.push("S3_ACCESS_KEY_ID");
    if (!env.S3_SECRET_ACCESS_KEY) m.push("S3_SECRET_ACCESS_KEY");
    if (!env.S3_REGION) m.push("S3_REGION");
    return m;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  private creds() {
    const env = getEnv();
    if (!this.isConfigured()) throw new ServiceUnavailableError(`S3 storage is not configured. Set ${this.missingSettings().join(", ")}.`);
    return { accessKeyId: env.S3_ACCESS_KEY_ID as string, secretAccessKey: env.S3_SECRET_ACCESS_KEY as string, region: env.S3_REGION as string, service: "s3" };
  }

  private urlFor(key: string | null): URL {
    const env = getEnv();
    const bucket = env.STORAGE_BUCKET as string;
    const endpoint = (env.S3_ENDPOINT || `https://s3.${env.S3_REGION}.amazonaws.com`).replace(/\/+$/, "");
    if (env.NODE_ENV === "production" && !endpoint.startsWith("https://")) {
      throw new ServiceUnavailableError("S3_ENDPOINT must use https in production.");
    }
    const base = new URL(endpoint);
    const encodedKey = key === null ? "" : key.split("/").map((s) => uriEncode(s)).join("/");
    const pathStyle = (env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true";
    if (pathStyle) {
      base.pathname = `/${uriEncode(bucket)}${encodedKey ? "/" + encodedKey : ""}`.replace(/\/+/g, "/");
    } else {
      base.hostname = `${bucket}.${base.hostname}`;
      base.pathname = `/${encodedKey}`;
    }
    return base;
  }

  private async call(method: string, key: string | null, opts: { body?: Buffer; contentType?: string; timeoutMs?: number } = {}) {
    const creds = this.creds();
    const url = this.urlFor(key);
    const headers: Record<string, string> = {};
    if (opts.contentType) headers["content-type"] = opts.contentType;
    const signed = signRequest(creds, { method, url, headers, body: opts.body, addContentSha256Header: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      const { host: _host, ...sendHeaders } = signed.headers; // fetch sets Host itself
      void _host;
      return await fetch(url, {
        method,
        headers: sendHeaders,
        body: opts.body ? new Uint8Array(opts.body) : undefined,
        redirect: "error",
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      logError("s3-request-failed", new Error(aborted ? "timeout" : "network"), { method });
      throw new ServiceUnavailableError(aborted ? "Object storage did not respond in time." : "Object storage could not be reached.");
    } finally {
      clearTimeout(timer);
    }
  }

  async upload(input: StorageUploadInput): Promise<{ key: string }> {
    assertSafeStorageKey(input.key);
    const res = await this.call("PUT", input.key, { body: input.buffer, contentType: input.contentType });
    if (res.status < 200 || res.status >= 300) {
      logError("s3-upload-failed", new Error(`S3 answered HTTP ${res.status}`), { httpStatus: res.status });
      throw new ServiceUnavailableError("The file could not be stored right now.");
    }
    return { key: input.key };
  }

  async read(key: string): Promise<StorageReadResult | null> {
    assertSafeStorageKey(key);
    const res = await this.call("GET", key);
    if (res.status === 404) return null;
    if (res.status !== 200) {
      logError("s3-read-failed", new Error(`S3 answered HTTP ${res.status}`), { httpStatus: res.status });
      throw new ServiceUnavailableError("The file could not be read right now.");
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_READ_BYTES) throw new ServiceUnavailableError("The stored file is too large to serve.");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_READ_BYTES) throw new ServiceUnavailableError("The stored file is too large to serve.");
    return { buffer, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    const res = await this.call("DELETE", key);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      logError("s3-delete-failed", new Error(`S3 answered HTTP ${res.status}`), { httpStatus: res.status });
      throw new ServiceUnavailableError("The file could not be deleted right now.");
    }
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeStorageKey(key);
    const ttl = Math.max(1, Math.min(Math.floor(ttlSeconds), MAX_PRESIGN_SECONDS));
    return presignUrl(this.creds(), { method: "GET", url: this.urlFor(key), expiresSeconds: ttl });
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: `Not configured (missing: ${this.missingSettings().join(", ")}).` };
    try {
      const res = await this.call("HEAD", null, { timeoutMs: 8000 });
      if (res.status === 200) return { ok: true, message: "Bucket reachable with the configured credentials." };
      if (res.status === 403) return { ok: false, message: "The bucket rejected the credentials (HTTP 403)." };
      if (res.status === 404) return { ok: false, message: "The bucket does not exist (HTTP 404)." };
      return { ok: false, message: `The bucket answered HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Object storage could not be reached." };
    }
  }
}
