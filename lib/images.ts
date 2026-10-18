import sharp from "sharp";

/** Documents are stored at most this wide. Plenty for reading a payslip, and cheap to stamp. */
export const MAX_DOC_WIDTH = 1600;

/** Refuse images that would decode to more than this many pixels (decompression bombs). */
const MAX_INPUT_PIXELS = 60_000_000;

/**
 * Applies the EXIF rotation, shrinks to MAX_DOC_WIDTH and re-encodes. sharp
 * drops metadata by default, so GPS and camera details in phone photos are
 * removed before the file is stored.
 */
export async function normaliseUpload(bytes: Buffer, contentType: string) {
  const image = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_DOC_WIDTH, withoutEnlargement: true });
  if (contentType === "image/png") {
    return { bytes: await image.png({ compressionLevel: 9 }).toBuffer(), contentType: "image/png", ext: "png" };
  }
  return { bytes: await image.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: "image/jpeg", ext: "jpg" };
}
