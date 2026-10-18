// Browser-side image compression before upload. A 12-megapixel phone photo
// (often 3-6 MB) becomes a ~1600px JPEG of a few hundred KB, so uploads are
// fast on mobile data and the server has far less to decode.

const MAX_WIDTH = 1600;
const KEEP_ORIGINAL_UNDER_BYTES = 1_000_000;

/** Returns a smaller JPEG copy of `file`, or the original if it's already small or can't be decoded. */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    if (bitmap.width <= MAX_WIDTH && file.size <= KEEP_ORIGINAL_UNDER_BYTES) return file;
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
