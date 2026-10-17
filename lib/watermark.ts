/** Reads pixel width/height from PNG or JPEG bytes without any image library. */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wraps the document image in an SVG with a repeating diagonal watermark and
 * a footer naming the listing, the viewer and the time. The watermark is part
 * of the image itself, so a saved or screenshotted copy carries it.
 */
export function watermarkedSvg(opts: {
  bytes: Buffer;
  contentType: string;
  text: string;
  footer: string;
}): string {
  const size = imageSize(opts.bytes) ?? { w: 1000, h: 1300 };
  const w = Math.max(200, size.w);
  const h = Math.max(200, size.h);
  const footerH = Math.round(Math.max(36, w / 22));
  const totalH = h + footerH;
  const fs = Math.max(14, Math.round(w / 30));
  const b64 = opts.bytes.toString("base64");
  const line = esc(`${opts.text}   •   ${opts.text}   •   ${opts.text}`);
  const rows: string[] = [];
  for (let y = -h; y < h * 2; y += fs * 4) {
    rows.push(
      `<text x="${-w}" y="${y}" font-size="${fs}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#b91c1c" fill-opacity="0.30">${line}</text>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${totalH}" width="${w}" height="${totalH}">
  <rect width="${w}" height="${totalH}" fill="#ffffff"/>
  <image href="data:${esc(opts.contentType)};base64,${b64}" xlink:href="data:${esc(opts.contentType)};base64,${b64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
  <g transform="rotate(-30 ${w / 2} ${h / 2})">${rows.join("")}</g>
  <rect x="0" y="${h}" width="${w}" height="${footerH}" fill="#0f172a"/>
  <text x="${w / 2}" y="${h + footerH * 0.64}" text-anchor="middle" font-size="${Math.round(footerH * 0.42)}" font-family="Arial, Helvetica, sans-serif" fill="#ffffff">${esc(opts.footer)}</text>
</svg>`;
}

export function messageSvg(title: string, detail: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
  <rect width="800" height="400" fill="#fef2f2"/>
  <text x="400" y="190" text-anchor="middle" font-size="40" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#b91c1c">${esc(title)}</text>
  <text x="400" y="240" text-anchor="middle" font-size="20" font-family="Arial, Helvetica, sans-serif" fill="#7f1d1d">${esc(detail)}</text>
</svg>`;
}
