// 生成应用图标母版（2048px，2x 超采样）：macOS 风格圆角深色底 + 金色 gauge
// node scripts/gen-app-icon.js -> scripts/app-icon-master.png
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }

const S = 2048, SS = 2, N = S * SS; // 4096 采样
const cx = N / 2, cy = N / 2;
// macOS 圆角方形（半径约 22.4%）
const half = N / 2, rad = Math.round(N * 0.224);
function inRoundRect(x, y) {
  const qx = Math.abs(x - cx) - (half - rad), qy = Math.abs(y - cy) - (half - rad);
  if (qx <= 0 && qy <= 0) return true;
  if (qx > 0 && qy > 0) return qx * qx + qy * qy <= rad * rad;
  return false;
}
// gauge 几何（圆心略下移）
const gx = N / 2, gy = N * 0.54;
const rOut = N * 0.293, rIn = N * 0.228;
const rMid = (rOut + rIn) / 2, capR = (rOut - rIn) / 2;
const dotR = N * 0.036;
const ARC = 1.5 * Math.PI;
const caps = [
  [gx + rMid * Math.sin(0), gy - rMid * Math.cos(0)],
  [gx + rMid * Math.sin(ARC), gy - rMid * Math.cos(ARC)],
];
function angleCW(x, y) { const t = Math.atan2(x - gx, -(y - gy)); return t < 0 ? t + 2 * Math.PI : t; }
function lerp(a, b, k) { return a + (b - a) * k; }
// 金色渐变（起点亮 -> 收尾深）
const GOLD_A = [245, 201, 123], GOLD_B = [217, 119, 6];
const BG_A = [56, 56, 62], BG_B = [26, 26, 30]; // 深色纵渐变

const raw = Buffer.alloc((S * 4 + 1) * S);
let o = 0;
for (let py = 0; py < S; py++) {
  raw[o++] = 0;
  for (let px = 0; px < S; px++) {
    let inside = 0, bgK = 0, track = 0, arcHit = 0, arcK = 0, dot = 0, hi = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = px * SS + sx + 0.5, y = py * SS + sy + 0.5;
      if (!inRoundRect(x, y)) continue;
      inside++;
      bgK += (x + y) / (2 * N); // 对角渐变系数
      hi += Math.max(0, 1 - y / (N * 0.16)); // 顶部高光
      const d = Math.hypot(x - gx, y - gy);
      if (d >= rIn && d <= rOut) {
        track++;
        const t = angleCW(x, y);
        if (t <= ARC) { arcHit++; arcK += t / ARC; }
      }
      if (!arcHit) for (const [ccx, ccy] of caps) if (Math.hypot(x - ccx, y - ccy) <= capR) { arcHit++; arcK += 1; }
      if (d <= dotR) dot++;
    }
    const tot = SS * SS;
    if (inside === 0) { raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; continue; }
    const k = inside / tot;
    const bgk = bgK / inside;
    let r = lerp(BG_A[0], BG_B[0], bgk), g = lerp(BG_A[1], BG_B[1], bgk), b = lerp(BG_A[2], BG_B[2], bgk);
    const h = (hi / inside) * 0.35; // 高光强度
    r = lerp(r, 255, h); g = lerp(g, 255, h); b = lerp(b, 255, h);
    if (track / tot > 0) {
      const tk = track / tot;
      const gray = 255;
      r = lerp(r, gray, tk * 0.18); g = lerp(g, gray, tk * 0.18); b = lerp(b, gray, tk * 0.18);
      const ak = arcHit / tot;
      if (ak > 0) {
        const goldK = arcK / arcHit;
        const gr = lerp(GOLD_A[0], GOLD_B[0], goldK), gg = lerp(GOLD_A[1], GOLD_B[1], goldK), gb = lerp(GOLD_A[2], GOLD_B[2], goldK);
        r = lerp(r, gr, Math.min(1, ak)); g = lerp(g, gg, Math.min(1, ak)); b = lerp(b, gb, Math.min(1, ak));
      }
    }
    const dk = dot / tot;
    if (dk > 0) { r = lerp(r, 232, dk); g = lerp(g, 179, dk); b = lerp(b, 65, dk); }
    raw[o++] = Math.round(r); raw[o++] = Math.round(g); raw[o++] = Math.round(b);
    raw[o++] = Math.round(255 * k);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, 'app-icon-master.png'), png);
console.log('app-icon-master.png ' + S + 'x' + S);
