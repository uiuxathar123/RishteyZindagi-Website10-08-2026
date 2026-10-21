/**
 * Profile photo conversion (src/server/modules/storage/photo-convert.ts): every accepted upload is decoded and
 * re-encoded as WebP, with EXIF orientation applied, metadata removed, large photos scaled down, and corrupt or
 * oversized input rejected as a 400 validation error. No database or storage is involved here.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertPhotoToWebp, MAX_OUTPUT_DIMENSION } from "@/server/modules/storage/photo-convert";
import { inspectImage } from "@/server/modules/storage/image-inspect";
import { tinyPngBuffer } from "./helpers/profile-fixtures";

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 90 } } });

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A well-formed PNG header (valid IHDR CRC) that claims the given size but carries only one pixel of data. */
function headerOnlyPng(width: number, height: number): Buffer {
  const png = tinyPngBuffer(1, 1);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29); // CRC over "IHDR" + its 13 data bytes
  return png;
}

async function expectRejected(input: Buffer, message: RegExp) {
  await expect(convertPhotoToWebp(input)).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR", message: expect.stringMatching(message) });
}

describe("profile photo WebP conversion", () => {
  it("[webp-formats] JPEG, PNG and WebP uploads all come out as real WebP with matching dimensions", async () => {
    const inputs = {
      jpeg: await solid(640, 480).jpeg().toBuffer(),
      png: tinyPngBuffer(300, 300),
      webp: await solid(500, 400).webp().toBuffer(),
    };
    for (const [name, input] of Object.entries(inputs)) {
      const out = await convertPhotoToWebp(input);
      expect(out.contentType, name).toBe("image/webp");
      expect(inspectImage(out.buffer)?.contentType, name).toBe("image/webp"); // RIFF....WEBP magic bytes
      const meta = await sharp(out.buffer).metadata();
      expect(meta.format, name).toBe("webp");
      expect([meta.width, meta.height], name).toEqual([out.width, out.height]);
      expect([out.sourceWidth, out.sourceHeight], name).toEqual([out.width, out.height]); // small inputs are not resized
    }
  });

  it("[webp-orientation-metadata] EXIF orientation is applied and EXIF/GPS/ICC metadata is not carried over", async () => {
    // 400x300 pixels tagged "rotate 90° clockwise" (orientation 6) displays as 300x400.
    const input = await solid(400, 300)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-owner", Artist: "camera-owner" } } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await convertPhotoToWebp(input);
    expect([out.width, out.height]).toEqual([300, 400]);
    expect([out.sourceWidth, out.sourceHeight]).toEqual([300, 400]);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.buffer.includes(Buffer.from("secret-owner"))).toBe(false);
  });

  it("[webp-downscale] large photos are scaled to fit the maximum dimension; aspect ratio is kept", async () => {
    const out = await convertPhotoToWebp(await solid(4000, 3000).jpeg({ quality: 70 }).toBuffer());
    expect(Math.max(out.width, out.height)).toBe(MAX_OUTPUT_DIMENSION);
    expect([out.width, out.height]).toEqual([2048, 1536]);
    expect([out.sourceWidth, out.sourceHeight]).toEqual([4000, 3000]);
  });

  it("[webp-corrupt] non-images and corrupt or truncated images are rejected with a clear validation error", async () => {
    await expectRejected(Buffer.from("not an image at all"), /couldn't read this image/);
    const jpeg = await solid(640, 480).jpeg().toBuffer();
    await expectRejected(jpeg.subarray(0, Math.floor(jpeg.length / 3)), /couldn't read this image/); // truncated mid-scan
    const png = tinyPngBuffer(300, 300);
    const brokenPng = Buffer.from(png);
    brokenPng.fill(0x41, 60, 90); // corrupt the compressed pixel data
    await expectRejected(brokenPng, /couldn't read this image/);
    await expectRejected(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /couldn't read this image/);
  });

  it("[webp-pixel-limit] a file that claims an enormous pixel count is refused before it is decoded", async () => {
    await expectRejected(headerOnlyPng(20000, 20000), /too many pixels/); // 400 megapixels
    await expectRejected(headerOnlyPng(40001, 1000), /too many pixels/);
  });
});
