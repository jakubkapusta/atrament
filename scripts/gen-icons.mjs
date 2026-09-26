// Renders PNG app icons (ink drop on warm paper) without dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function shade(u, v) {
  const d = Math.hypot(u - 0.5, v - 0.42);
  let col = mix([251, 246, 238], [185, 173, 156], clamp((d - 0.2) / 0.6));
  // drop: circle bottom + pointed top
  const cx = 0.5, cy = 0.605, R = 0.227;
  const dx = u - cx, dy = v - cy;
  let inside = Math.hypot(dx, dy) < R;
  if (!inside && v < cy && v > 0.18) {
    const t = (cy - v) / (cy - 0.18);
    const half = R * Math.sqrt(Math.max(0, 1 - t)) * (1 - t * 0.15);
    inside = Math.abs(dx) < half;
  }
  if (inside) {
    const l = clamp(Math.hypot(u - 0.44, v - 0.52) / 0.3);
    col = mix([90, 124, 240], [10, 19, 64], l);
    const h = Math.hypot((u - 0.42) / 0.05, (v - 0.56) / 0.08);
    if (h < 1) col = mix(col, [255, 255, 255], 0.55 * (1 - h * h));
  }
  return col.map((c) => Math.round(c));
}
for (const s of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s, shade));
console.log('icons written');
