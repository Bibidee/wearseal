import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type); const body = Buffer.concat([t, data]); const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), data.length + 8); return out;
}
function png(scratch) {
  const w = 320, h = 220, pixels = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const body = x > 35 && x < 285 && y > 45 && y < 180;
    const lens = (x - 160) ** 2 + (y - 112) ** 2 < 42 ** 2;
    const top = x > 110 && x < 210 && y > 28 && y < 55;
    const i = (y * w + x) * 3;
    pixels[i] = body ? (lens ? 45 : top ? 35 : 210) : 245;
    pixels[i + 1] = body ? (lens ? 55 : top ? 45 : 220) : 245;
    pixels[i + 2] = body ? (lens ? 70 : top ? 55 : 230) : 245;
    if (scratch && x > 105 && x < 215 && y === Math.floor(70 + (x - 105) * 0.45)) { pixels[i] = 180; pixels[i + 1] = 20; pixels[i + 2] = 20; }
  }
  const raw = Buffer.alloc((h * (1 + w * 3)));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; pixels.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3); }
  const header = Buffer.alloc(13); header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/fixtures', { recursive: true });
writeFileSync('public/fixtures/checkout.png', png(false));
writeFileSync('public/fixtures/return.png', png(true));
