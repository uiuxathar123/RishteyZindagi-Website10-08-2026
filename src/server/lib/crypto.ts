/**
 * B8: symmetric encryption for payment-gateway credentials at rest
 * (`payment_gateways.config`'s encrypted blob — see
 * gateway-config.service.ts). AES-256-GCM via Node's built-in `crypto`
 * module — no new dependency needed, same "reuse what's already in the
 * runtime" posture as otp-hash.ts's use of `crypto` for hashing/random.
 *
 * Never call `encrypt`/`decrypt` with anything but
 * `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` (see env.ts) — gateway-config
 * .service.ts is the only caller, and it throws ServiceUnavailableError
 * rather than ever calling `encrypt` with that key unset (see this
 * file's `requireEncryptionKey`).
 *
 * Format: `<ivHex>:<authTagHex>:<ciphertextHex>` — a single opaque string
 * safe to store directly inside a jsonb field. Never logged; never
 * returned to any API response (see gateway-config.dto.ts, which never
 * serializes the raw `config` column at all).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { ServiceUnavailableError } from "./errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // recommended GCM IV length
const KEY_LENGTH_BYTES = 32; // AES-256

function requireEncryptionKey(rawKey: string | undefined): Buffer {
  if (!rawKey) {
    throw new ServiceUnavailableError(
      "Payment credential encryption is not configured. Set PAYMENT_CREDENTIALS_ENCRYPTION_KEY before saving gateway credentials."
    );
  }
  const key = Buffer.from(rawKey, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new ServiceUnavailableError(
      "PAYMENT_CREDENTIALS_ENCRYPTION_KEY is set but is not a valid 64-character hex string (32 bytes)."
    );
  }
  return key;
}

export function encrypt(plaintext: string, rawKey: string | undefined): string {
  const key = requireEncryptionKey(rawKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decrypt(payload: string, rawKey: string | undefined): string {
  const key = requireEncryptionKey(rawKey);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new ServiceUnavailableError("Stored payment credential blob is malformed.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
