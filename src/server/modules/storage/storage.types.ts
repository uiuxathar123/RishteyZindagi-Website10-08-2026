/**
 * B3: storage abstraction for profile photos (and anything binary a later
 * phase needs to store). Mirrors the B2 OTP-provider pattern deliberately
 * — one small interface, one factory that reads env config, and honest
 * failure when a provider isn't really wired up, rather than pretending a
 * cloud bucket exists when it doesn't.
 */

export interface StorageUploadInput {
  /** Suggested key/path — the provider may namespace it further, but must
   * return the key it actually used. */
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface StorageReadResult {
  buffer: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  isConfigured(): boolean;
  upload(input: StorageUploadInput): Promise<{ key: string }>;
  read(key: string): Promise<StorageReadResult | null>;
  delete(key: string): Promise<void>;
}
