/**
 * Profile photos are decoded and re-encoded as WebP before they are stored,
 * so what is served is always an image the server itself produced: the
 * original bytes (and anything hidden in them) are never kept. The decode
 * is also the real content check: a file that only carries image magic
 * bytes but does not decode is rejected.
 *
 * - Input must already have passed inspectImage() (JPEG, PNG or WebP magic
 *   bytes); SVG and other formats never reach this point.
 * - Decoding is capped at MAX_INPUT_PIXELS so a small, highly compressed
 *   file cannot expand into an enormous bitmap (decompression bomb).
 * - EXIF orientation is applied, then all metadata (EXIF, GPS, XMP, ICC) is
 *   dropped from the output.
 * - Large photos are scaled down to fit MAX_OUTPUT_DIMENSION; smaller ones
 *   are never enlarged. Animated input keeps only its first frame.
 */
import sharp from "sharp";
import { ValidationError } from "@/server/lib/errors";

/** 40 megapixels — beyond any phone camera — decoded at most once per upload. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Longest side of the stored photo, in pixels. */
export const MAX_OUTPUT_DIMENSION = 2048;
export const WEBP_QUALITY = 82;

export interface ConvertedPhoto {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  /** Dimensions of the uploaded image after EXIF orientation, before scaling. */
  sourceWidth: number;
  sourceHeight: number;
}

const UNREADABLE = "We couldn't read this image. Please upload a valid JPEG, PNG or WEBP photo.";
const TOO_LARGE = `This image has too many pixels. Please upload a photo of at most ${MAX_INPUT_PIXELS / 1_000_000} megapixels.`;

function isPixelLimitError(err: unknown): boolean {
  return err instanceof Error && /pixel limit/i.test(err.message);
}

export async function convertPhotoToWebp(input: Buffer): Promise<ConvertedPhoto> {
  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const, animated: false };

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch (err) {
    throw new ValidationError(isPixelLimitError(err) ? TOO_LARGE : UNREADABLE);
  }
  if (!meta.width || !meta.height || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
    throw new ValidationError(UNREADABLE);
  }
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new ValidationError(TOO_LARGE);
  // EXIF orientations 5-8 rotate by 90 degrees, swapping width and height.
  const swapped = (meta.orientation ?? 1) >= 5;
  const sourceWidth = swapped ? meta.height : meta.width;
  const sourceHeight = swapped ? meta.width : meta.height;

  try {
    const { data, info } = await sharp(input, options)
      .rotate()
      .resize({ width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    if (info.format !== "webp" || data.length === 0) throw new Error("encoder produced no WebP output");
    return { buffer: data, contentType: "image/webp", width: info.width, height: info.height, sourceWidth, sourceHeight };
  } catch (err) {
    // A truncated or corrupt file often passes the header read and fails here, while decoding pixels.
    throw new ValidationError(isPixelLimitError(err) ? TOO_LARGE : UNREADABLE);
  }
}
