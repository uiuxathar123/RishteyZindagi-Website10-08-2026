/**
 * PCP: minimal AWS Signature Version 4 signer (header auth + query presign) used by the
 * S3-compatible storage provider. Implemented from the published algorithm
 * (docs.aws.amazon.com "Signature Version 4 signing process"); verified against AWS's
 * own `get-vanilla` test vector (tests/pcp-storage.test.ts) and against an
 * independent botocore-based verifier (moto) when available.
 * No dependency, no logging; secrets are only ever used as HMAC keys.
 */
import { createHash, createHmac } from "crypto";

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 requires (everything except unreserved characters). */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch) || (ch === "/" && !encodeSlash)) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function amzDateNow(d = new Date()): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), service), "aws4_request");
}

export interface SigV4Creds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

function canonicalQuery(params: Array<[string, string]>): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface SignedRequest {
  headers: Record<string, string>;
  /** Hex signature (exposed for test vectors). */
  signature: string;
}

/** Header-based signing. `url.pathname` must already be the percent-encoded path that will be sent. */
export function signRequest(
  creds: SigV4Creds,
  input: { method: string; url: URL; headers?: Record<string, string>; body?: Buffer | string; amzDate?: string; addContentSha256Header?: boolean }
): SignedRequest {
  const amzDate = input.amzDate ?? amzDateNow();
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(input.body ?? "");
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: input.url.host, "x-amz-date": amzDate };
  if (input.addContentSha256Header) headers["x-amz-content-sha256"] = payloadHash;

  const lower = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = lower.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = lower.map(([k]) => k).join(";");
  const query = canonicalQuery([...input.url.searchParams.entries()]);
  const canonicalRequest = [input.method.toUpperCase(), input.url.pathname || "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, date, creds.region, creds.service)).update(stringToSign).digest("hex");

  return {
    signature,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Query-string presigned URL (method GET/HEAD/…); payload is UNSIGNED. */
export function presignUrl(creds: SigV4Creds, input: { method: string; url: URL; expiresSeconds: number; amzDate?: string }): string {
  const amzDate = input.amzDate ?? amzDateNow();
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${creds.region}/${creds.service}/aws4_request`;
  const params: Array<[string, string]> = [...input.url.searchParams.entries()];
  params.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${creds.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"]
  );
  const query = canonicalQuery(params);
  const canonicalRequest = [input.method.toUpperCase(), input.url.pathname || "/", query, `host:${input.url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(creds.secretAccessKey, date, creds.region, creds.service)).update(stringToSign).digest("hex");
  return `${input.url.origin}${input.url.pathname}?${query}&X-Amz-Signature=${signature}`;
}
