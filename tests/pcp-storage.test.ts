/**
 * Production Completion Phase — storage: key safety, SigV4 correctness, and the S3 provider.
 *
 * The S3 provider is exercised against a local moto server (python), whose S3 endpoint verifies
 * every request signature with botocore's SigV4 implementation — an independent check of
 * our hand-written signer. If moto is not installed the S3 integration block is SKIPPED
 * (reported as skipped, never as passed). A real AWS/MinIO/R2 bucket is NOT contacted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import path from "path";
import net from "net";
import { amzDateNow, presignUrl, signRequest, uriEncode } from "@/server/lib/sigv4";
import { assertSafeStorageKey } from "@/server/modules/storage/storage-key";
import { LocalDiskStorageProvider } from "@/server/modules/storage/local-disk.provider";
import { inspectImage } from "@/server/modules/storage/image-inspect";

describe("SigV4 signer", () => {
  it("[sigv4-aws-vector] reproduces AWS's published `get-vanilla` test-suite signature", () => {
    const r = signRequest(
      { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" },
      { method: "GET", url: new URL("https://example.amazonaws.com/"), amzDate: "20150830T123600Z" }
    );
    expect(r.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(r.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
  });

  it("[sigv4-encoding] uriEncode follows RFC 3986 (space → %20, + → %2B, unicode as UTF-8, slash kept only on request)", () => {
    expect(uriEncode("a b+c/é")).toBe("a%20b%2Bc%2F%C3%A9");
    expect(uriEncode("a/b", false)).toBe("a/b");
    expect(uriEncode("A-z_0.9~")).toBe("A-z_0.9~");
  });

  it("[sigv4-presign-shape] presigned URLs carry the signed query parameters and never the secret", () => {
    const url = presignUrl(
      { accessKeyId: "AK", secretAccessKey: "SECRET-SECRET", region: "ap-south-1", service: "s3" },
      { method: "GET", url: new URL("https://b.s3.ap-south-1.amazonaws.com/photos/x.png"), expiresSeconds: 300, amzDate: amzDateNow() }
    );
    expect(url).toMatch(/X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    expect(url).toMatch(/X-Amz-Expires=300/);
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    expect(url).not.toContain("SECRET-SECRET");
  });
});

describe("storage key safety (path traversal)", () => {
  const bad = ["", "../etc/passwd", "photos/../../x", "/abs/path", "photos//x", "photos/./x", "a\\b", "a\u0000b", "photos/x y", "photos/%2e%2e/x", ".hidden", "x".repeat(600), "photos/.."];
  it("[key-rejects-traversal] hostile keys are refused", () => {
    for (const k of bad) expect(() => assertSafeStorageKey(k), JSON.stringify(k)).toThrow();
  });
  it("[key-accepts-app-keys] the keys the app generates are accepted", () => {
    for (const k of ["photos/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/0f8fad5b-d9cb-469f-a165-70867728950e.jpg", "invoices/0f8fad5b-d9cb-469f-a165-70867728950e.pdf"]) {
      expect(() => assertSafeStorageKey(k)).not.toThrow();
    }
  });
  it("[key-local-provider-guard] the local provider enforces the same rule on read / delete / upload", async () => {
    const p = new LocalDiskStorageProvider();
    await expect(p.read("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(p.delete("photos/../../x")).rejects.toThrow(/Invalid storage key/);
    await expect(p.upload({ key: "/tmp/evil", buffer: Buffer.from("x"), contentType: "text/plain" })).rejects.toThrow(/Invalid storage key/);
  });
});

describe("upload content validation (magic bytes)", () => {
  it("[magic-bytes] content that is not a real image is rejected whatever the client claims; real signatures are accepted", () => {
    expect(inspectImage(Buffer.from("<?php echo 1; ?>"))).toBeNull();
    expect(inspectImage(Buffer.from("GIF89a....."))).toBeNull();
    expect(inspectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]))?.contentType).toBe("image/jpeg");
  });
});

// ---------------------------------------------------------------------------
const hasMoto = spawnSync("which", ["moto_server"]).status === 0;
const PORT = 45877;
const BUCKET = "rz-test-bucket";

function waitForPort(port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("moto did not start"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

describe.skipIf(!hasMoto)("S3 provider vs moto (independent SigV4 verification)", () => {
  let moto: ChildProcess;
  let creds = { id: "", secret: "" };

  async function provider(over: Record<string, string> = {}) {
    vi.resetModules();
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("STORAGE_BUCKET", BUCKET);
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${PORT}`);
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "true");
    vi.stubEnv("S3_ACCESS_KEY_ID", creds.id);
    vi.stubEnv("S3_SECRET_ACCESS_KEY", creds.secret);
    for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
    const { S3StorageProvider } = await import("@/server/modules/storage/s3.provider");
    return new S3StorageProvider();
  }

  beforeAll(async () => {
    moto = spawn("moto_server", ["-p", String(PORT)], { env: { ...process.env, INITIAL_NO_AUTH_ACTION_COUNT: "3" }, stdio: "ignore" });
    await waitForPort(PORT);
    const out = spawnSync("python3", [path.resolve(__dirname, "helpers/moto-bootstrap.py"), String(PORT), BUCKET], { encoding: "utf8" });
    if (out.status !== 0) throw new Error("moto bootstrap failed: " + out.stderr);
    const [id, secret] = out.stdout.trim().split(" ");
    creds = { id, secret };
  }, 60000);
  afterAll(() => {
    vi.unstubAllEnvs();
    moto?.kill();
  });

  it("[s3-roundtrip] upload → read → delete with correct content type; missing key → null; delete is idempotent", async () => {
    const s3 = await provider();
    expect(s3.isConfigured()).toBe(true);
    const key = "photos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png";
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]);
    await s3.upload({ key, buffer: body, contentType: "image/png" });
    const got = await s3.read(key);
    expect(got?.contentType).toBe("image/png");
    expect(Buffer.compare(got!.buffer, body)).toBe(0);
    await s3.delete(key);
    expect(await s3.read(key)).toBeNull();
    await expect(s3.delete(key)).resolves.toBeUndefined();
    expect(await s3.read("photos/never/existed.png")).toBeNull();
  });

  it("[s3-keys-with-dots-dashes] keys with dots, dashes and underscores sign correctly", async () => {
    const s3 = await provider();
    const key = "invoices/INV_2026-10.v2-final.pdf";
    await s3.upload({ key, buffer: Buffer.from("%PDF-1.4 test"), contentType: "application/pdf" });
    expect((await s3.read(key))?.buffer.toString()).toBe("%PDF-1.4 test");
    await s3.delete(key);
  });

  it("[s3-wrong-secret-rejected] a wrong secret key is refused by the server (SignatureDoesNotMatch) and surfaces as a safe 503", async () => {
    const s3 = await provider({ S3_SECRET_ACCESS_KEY: "definitely-not-the-secret-0123456789" });
    await expect(s3.upload({ key: "photos/x/y.png", buffer: Buffer.from("x"), contentType: "image/png" })).rejects.toMatchObject({ statusCode: 503 });
    const health = await s3.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).not.toContain("definitely-not-the-secret");
  });

  it("[s3-private-presigned] objects are not publicly readable; the presigned URL equals botocore's reference signature; ttl is capped", async () => {
    const s3 = await provider();
    const key = "photos/aaaa/bbbb.jpg";
    await s3.upload({ key, buffer: Buffer.from("secret-photo-bytes"), contentType: "image/jpeg" });
    const anon = await fetch(`http://127.0.0.1:${PORT}/${BUCKET}/${key}`);
    expect(anon.status).toBe(403);
    const url = await s3.getSignedUrl(key, 60);
    expect(url).not.toContain(creds.secret);
    // moto's IAM layer cannot verify query-string auth, so compare with botocore's reference
    // implementation for the same credentials, URL, expiry and timestamp.
    const amz = /X-Amz-Date=(\d{8}T\d{6}Z)/.exec(url)![1];
    const ref = spawnSync(
      "python3",
      [path.resolve(__dirname, "helpers/presign-ref.py"), creds.id, creds.secret, "us-east-1", `http://127.0.0.1:${PORT}/${BUCKET}/${key}`, "60", amz],
      { encoding: "utf8" }
    );
    expect(ref.status, ref.stderr).toBe(0);
    const q = (u: string) => Object.fromEntries(new URL(u).searchParams.entries());
    expect(q(url)).toEqual(q(ref.stdout.trim()));
    // ttl is capped at 15 minutes
    expect(await s3.getSignedUrl(key, 99999)).toMatch(/X-Amz-Expires=900/);
    await s3.delete(key);
  });

  it("[s3-health] health check passes with good credentials", async () => {
    const s3 = await provider();
    expect((await s3.healthCheck()).ok).toBe(true);
  });
});

// These checks fail before any request is sent (missing settings, an http endpoint in production,
// a hostile key) or never send one (provider selection), so they need no moto server and always run.
// The endpoint points at the moto port with nothing listening: had a request been sent, it would
// fail with "could not be reached" instead of the error each test expects.
describe("S3 provider checks that need no server", () => {
  async function provider(over: Record<string, string> = {}) {
    vi.resetModules();
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("STORAGE_BUCKET", BUCKET);
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${PORT}`);
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "true");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key-id");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-access-key");
    for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
    const { S3StorageProvider } = await import("@/server/modules/storage/s3.provider");
    return new S3StorageProvider();
  }

  // Each test starts from the real environment and fresh modules (getEnv and the provider factory
  // cache what they read), so no test depends on another's stubs or on the order they run in.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("[s3-traversal] hostile keys never reach the network", async () => {
    const s3 = await provider();
    await expect(s3.read("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(s3.upload({ key: "/abs", buffer: Buffer.from("x"), contentType: "text/plain" })).rejects.toThrow(/Invalid storage key/);
  });

  it("[s3-unconfigured-fails-closed] missing settings → isConfigured() false and operations throw 503 (no silent local-disk fallback)", async () => {
    const s3 = await provider({ S3_SECRET_ACCESS_KEY: "", S3_ACCESS_KEY_ID: "" });
    expect(s3.isConfigured()).toBe(false);
    await expect(s3.read("photos/x/y.png")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("[s3-production-requires-https] production refuses a plain-http endpoint", async () => {
    const s3 = await provider({ NODE_ENV: "production" });
    await expect(s3.read("photos/x/y.png")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("[s3-factory] STORAGE_PROVIDER=s3 selects the S3 provider", async () => {
    await provider();
    const { getStorageProvider } = await import("@/server/modules/storage/factory");
    expect(getStorageProvider().name).toBe("s3");
  });
});
