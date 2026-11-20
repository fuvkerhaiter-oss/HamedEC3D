/**
 * Server-side image validation + normalization with sharp: verifies the real format from the bytes (not the
 * file name or declared MIME), applies EXIF orientation, downsizes oversized images and re-encodes to WebP
 * (metadata stripped). Accepts JPEG, PNG, WebP and AVIF.
 */
import sharp, { type Metadata } from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // after optional client-side compression
export const MAX_EDGE = 2400; // longest side of the stored image
export const MIN_EDGE = 100;
export const ACCEPTED_TYPES = ["image/webp", "image/jpeg", "image/png", "image/avif"] as const;

export class ImageValidationError extends Error {
  override name = "ImageValidationError";
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/webp";
  sourceFormat: "jpeg" | "png" | "webp" | "avif";
}

export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageValidationError("The file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageValidationError(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: "error", limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new ImageValidationError("This file is not a readable image.");
  }
  const fmt = meta.format === "heif" && meta.compression === "av1" ? "avif" : meta.format;
  if (fmt !== "jpeg" && fmt !== "png" && fmt !== "webp" && fmt !== "avif") {
    throw new ImageValidationError("Unsupported format. Use WebP, JPEG, PNG or AVIF.");
  }
  if ((meta.pages ?? 1) > 1) throw new ImageValidationError("Animated images are not supported.");
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (w < MIN_EDGE || h < MIN_EDGE) throw new ImageValidationError(`Image is too small (${w}×${h}); at least ${MIN_EDGE}×${MIN_EDGE} px.`);
  const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, bytes: data.length, mimeType: "image/webp", sourceFormat: fmt };
}
