/**
 * B3 §13: "Do not trust filename extension. Validate actual content type
 * as far as the current upload architecture allows." This sniffs the
 * actual file bytes (magic numbers) rather than trusting the client's
 * declared MIME type or the filename extension, and extracts pixel
 * dimensions directly from the file's own header where the format makes
 * that cheap to do without a full image-decoding library (no image
 * library is a dependency of this project — see BACKEND.md's B3 section
 * for why: dimension/content-type validation is done from raw bytes
 * instead).
 */

export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp";

export interface DetectedImage {
  contentType: DetectedImageType;
  width: number | null;
  height: number | null;
}

function isPng(buf: Buffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buf.length >= 8 && sig.every((b, i) => buf[i] === b);
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  // IHDR is always the first chunk, at a fixed offset for a well-formed PNG.
  if (buf.length < 24) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  // Walk JFIF markers looking for a Start-Of-Frame (SOF0/1/2/3, excluding
  // DHT/JPG extension markers) segment, which carries height/width.
  let offset = 2; // skip initial 0xFFD8
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // Standalone markers with no length/payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/** Returns null if the buffer doesn't match any supported image format's
 * magic bytes — callers should reject the upload in that case. Dimensions
 * are best-effort: null when the format's header can't be cheaply parsed
 * (currently WEBP), which callers treat as "skip dimension validation for
 * this file" rather than a rejection, per the B3 brief's "as far as
 * technically practical" hedge. */
export function inspectImage(buf: Buffer): DetectedImage | null {
  if (isPng(buf)) {
    const dims = readPngDimensions(buf);
    return { contentType: "image/png", width: dims?.width ?? null, height: dims?.height ?? null };
  }
  if (isJpeg(buf)) {
    const dims = readJpegDimensions(buf);
    return { contentType: "image/jpeg", width: dims?.width ?? null, height: dims?.height ?? null };
  }
  if (isWebp(buf)) {
    return { contentType: "image/webp", width: null, height: null };
  }
  return null;
}
