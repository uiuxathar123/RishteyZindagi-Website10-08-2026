#!/usr/bin/env -S npx tsx
/**
 * PCP section J — off-box backup transport to S3-compatible storage (AWS S3, R2, MinIO, …).
 *
 *   npx tsx scripts/backup-offsite.ts check
 *   npx tsx scripts/backup-offsite.ts put  <file>            upload <file> (+ <file>.sha256 if present)
 *   npx tsx scripts/backup-offsite.ts get  <name> <dest>     download one object
 *
 * Uses its OWN settings (never the media bucket's — backups belong in a separate bucket
 * with separate credentials, ideally in another account/region and with versioning /
 * object-lock enabled):
 *   BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
 *   BACKUP_S3_ENDPOINT (optional), BACKUP_S3_PREFIX (default "db-backups/"),
 *   BACKUP_S3_FORCE_PATH_STYLE=true (MinIO style).
 *
 * Listing objects is deliberately not provided (use your provider console / CLI): the list
 * request could not be verified against the independent SigV4 checker used in tests.
 * `put` verifies the upload by HEAD (size must match). Secrets are never printed. The
 * file is buffered in memory, so it is capped at 1 GiB — larger databases should use
 * BACKUP_OFFSITE=dir (a mounted remote filesystem) or a multipart-capable tool.
 * Whether a particular vendor accepts the credentials is NOT VERIFIED until real
 * credentials are used; the protocol is exercised against moto in tests/pcp-backup.test.ts.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { signRequest, uriEncode } from "../src/server/lib/sigv4";

const MAX_BYTES = 1024 * 1024 * 1024;

function cfg() {
  const e = process.env;
  const missing = ["BACKUP_S3_BUCKET", "BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !e[k]);
  if (missing.length) {
    console.error(`backup-offsite: missing settings: ${missing.join(", ")}`);
    process.exit(3);
  }
  const prefix = (e.BACKUP_S3_PREFIX ?? "db-backups/").replace(/^\/+/, "");
  return {
    bucket: e.BACKUP_S3_BUCKET as string,
    region: e.BACKUP_S3_REGION as string,
    endpoint: (e.BACKUP_S3_ENDPOINT || `https://s3.${e.BACKUP_S3_REGION}.amazonaws.com`).replace(/\/+$/, ""),
    pathStyle: (e.BACKUP_S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    prefix: prefix && !prefix.endsWith("/") ? prefix + "/" : prefix,
    creds: { accessKeyId: e.BACKUP_S3_ACCESS_KEY_ID as string, secretAccessKey: e.BACKUP_S3_SECRET_ACCESS_KEY as string, region: e.BACKUP_S3_REGION as string, service: "s3" },
  };
}

function urlFor(c: ReturnType<typeof cfg>, key: string | null, query = ""): URL {
  if (process.env.NODE_ENV === "production" && !c.endpoint.startsWith("https://")) {
    console.error("backup-offsite: BACKUP_S3_ENDPOINT must be https in production.");
    process.exit(3);
  }
  const base = new URL(c.endpoint);
  const k = key === null ? "" : key.split("/").map((s) => uriEncode(s)).join("/");
  if (c.pathStyle) base.pathname = `/${uriEncode(c.bucket)}${k ? "/" + k : ""}`.replace(/\/+/g, "/");
  else {
    base.hostname = `${c.bucket}.${base.hostname}`;
    base.pathname = `/${k}`;
  }
  if (query) base.search = query;
  return base;
}

async function s3(c: ReturnType<typeof cfg>, method: string, key: string | null, opts: { body?: Buffer; query?: string; headers?: Record<string, string> } = {}) {
  const url = urlFor(c, key, opts.query ?? "");
  const signed = signRequest(c.creds, { method, url, headers: opts.headers, body: opts.body, addContentSha256Header: true });
  const { host: _h, ...headers } = signed.headers;
  void _h;
  return fetch(url, { method, headers, body: opts.body ? new Uint8Array(opts.body) : undefined, redirect: "error", signal: AbortSignal.timeout(10 * 60_000) });
}

const safeName = (n: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(n);

async function put(c: ReturnType<typeof cfg>, file: string) {
  const name = path.basename(file);
  if (!safeName(name)) throw new Error("unsafe backup file name");
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) throw new Error(`file is larger than the 1 GiB single-request limit (${stat.size} bytes)`);
  const body = fs.readFileSync(file);
  const sha = createHash("sha256").update(body).digest("hex");
  const key = c.prefix + name;
  const res = await s3(c, "PUT", key, { body, headers: { "content-type": "application/octet-stream", "x-amz-meta-sha256": sha } });
  if (res.status < 200 || res.status >= 300) throw new Error(`upload failed (HTTP ${res.status})`);
  const head = await s3(c, "HEAD", key);
  if (head.status !== 200 || Number(head.headers.get("content-length")) !== body.length) throw new Error("upload verification failed (HEAD size mismatch)");
  console.log(`backup-offsite: uploaded ${name} (${body.length} bytes, sha256 ${sha.slice(0, 12)}…) and verified by HEAD`);
  const side = file + ".sha256";
  if (fs.existsSync(side)) {
    const r = await s3(c, "PUT", key + ".sha256", { body: fs.readFileSync(side), headers: { "content-type": "text/plain" } });
    if (r.status < 200 || r.status >= 300) throw new Error(`checksum upload failed (HTTP ${r.status})`);
  }
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const c = cfg();
  if (cmd === "check") {
    const r = await s3(c, "HEAD", null);
    if (r.status !== 200) throw new Error(`bucket check failed (HTTP ${r.status})`);
    console.log("backup-offsite: bucket reachable with the configured credentials");
  } else if (cmd === "put" && a) {
    await put(c, a);
  } else if (cmd === "get" && a && b) {
    if (!safeName(a)) throw new Error("unsafe name");
    const r = await s3(c, "GET", c.prefix + a);
    if (r.status !== 200) throw new Error(`download failed (HTTP ${r.status})`);
    fs.writeFileSync(b, Buffer.from(await r.arrayBuffer()), { mode: 0o600 });
    console.log(`backup-offsite: downloaded ${a}`);
  } else {
    console.error("usage: backup-offsite.ts check | put <file> | get <name> <dest>");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("backup-offsite: " + (err instanceof Error ? err.message : "failed"));
  process.exit(1);
});
