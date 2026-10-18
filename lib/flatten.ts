import sharp from "sharp";
import { GLYPHS, UNITS_PER_EM } from "@/lib/glyphs";
import { MAX_DOC_WIDTH } from "@/lib/images";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textWidth(text: string, size: number) {
  let w = 0;
  for (const ch of text) w += (GLYPHS[ch] ?? GLYPHS["?"])[1];
  return (w * size) / UNITS_PER_EM;
}

/** Draws text as vector paths, so no fonts are needed on the server. */
function textPaths(text: string, x: number, baseline: number, size: number, fill: string, opacity = 1) {
  const scale = size / UNITS_PER_EM;
  let advance = 0;
  const parts: string[] = [];
  for (const ch of text) {
    const [d, adv] = GLYPHS[ch] ?? GLYPHS["?"];
    if (d) parts.push(`<path transform="translate(${advance} 0)" d="${esc(d)}"/>`);
    advance += adv;
  }
  return `<g fill="${fill}" fill-opacity="${opacity}" transform="translate(${x.toFixed(1)} ${baseline.toFixed(1)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})">${parts.join("")}</g>`;
}

/**
 * Burns the watermark into the image pixels on the server and returns a JPEG.
 * The agent's browser only ever receives the stamped image, never the original.
 */
export async function flattenWatermark(opts: { bytes: Buffer; text: string; footer: string }): Promise<Buffer> {
  // Uploads are already resized; this also caps files stored before that change.
  const base = sharp(opts.bytes, { failOn: "none" }).rotate().resize({ width: MAX_DOC_WIDTH, withoutEnlargement: true });
  const { data, info } = await base.toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const footerH = Math.round(Math.max(36, w / 22));
  const fs = Math.max(14, Math.round(w / 30));
  const line = `${opts.text}   •   ${opts.text}   •   ${opts.text}`;
  const rows: string[] = [];
  for (let y = -h; y < h * 2; y += fs * 4) {
    rows.push(textPaths(line, -w, y, fs, "#b91c1c", 0.32));
  }
  const footerSize = Math.round(footerH * 0.42);
  const footerX = Math.max(8, (w - textWidth(opts.footer, footerSize)) / 2);
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + footerH}" viewBox="0 0 ${w} ${h + footerH}">
  <defs><clipPath id="doc"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath></defs>
  <g clip-path="url(#doc)"><g transform="rotate(-30 ${w / 2} ${h / 2})">${rows.join("")}</g></g>
  ${textPaths(opts.footer, footerX, h + footerH * 0.66, footerSize, "#ffffff")}
</svg>`;

  return sharp(data)
    .extend({ bottom: footerH, background: { r: 15, g: 23, b: 42, alpha: 1 } })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
}
