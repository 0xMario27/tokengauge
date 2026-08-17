// 生成菜单栏 gauge 模板图标（黑+alpha，macOS 自动适配深浅色菜单栏）
// 用法：node scripts/gen-tray-icon.js  ->  输出 base64（写入 src/main.ts）
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }

// 22pt 画布，8x 超采样抗锯齿
const S = 22, SS = 8, N = S * SS;
const cx = N / 2, cy = N / 2;
const rOut = 9.5 * SS, rIn = 7.2 * SS; // 环形轨道
const rMid = (rOut + rIn) / 2, capR = (rOut - rIn) / 2;
const ARC = 1.5 * Math.PI; // 270° 进度弧（正上起顺时针）
const caps = [
  [cx + rMid * Math.sin(0), cy - rMid * Math.cos(0)],
  [cx + rMid * Math.sin(ARC), cy - rMid * Math.cos(ARC)],
];
function angleCW(x, y) { const t = Math.atan2(x - cx, -(y - cy)); return t < 0 ? t + 2 * Math.PI : t; }

const raw = Buffer.alloc((S * 4 + 1) * S);
let o = 0;
for (let py = 0; py < S; py++) {
  raw[o++] = 0; // filter: none
  for (let px = 0; px < S; px++) {
    let track = 0, arc = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = px * SS + sx + 0.5, y = py * SS + sy + 0.5;
      const d = Math.hypot(x - cx, y - cy);
      const inRing = d >= rIn && d <= rOut;
      let hitArc = false;
      if (inRing && angleCW(x, y) <= ARC) hitArc = true;
      if (!hitArc) for (const [ccx, ccy] of caps) if (Math.hypot(x - ccx, y - ccy) <= capR) { hitArc = true; break; }
      if (inRing) track++;
      if (hitArc) arc++;
    }
    const a = Math.max(Math.round(100 * (track / (SS * SS))), Math.round(255 * (arc / (SS * SS))));
    raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; raw[o++] = a;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

// 输出文件 + base64 + ASCII 预览自检
fs.writeFileSync(path.join(__dirname, 'tray-icon.png'), png);
console.log(png.toString('base64'));
const stride = S * 4 + 1;
let solid = 0, map = '';
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const a = raw[y * stride + 1 + x * 4 + 3];
    if (a > 200) solid++;
    map += a > 200 ? '#' : a > 60 ? '.' : ' ';
  }
  map += '\n';
}
console.error('solid px=' + solid + '\n' + map);
