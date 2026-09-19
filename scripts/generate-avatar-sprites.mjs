/**
 * Generates the transparent PNG standing-character sprites used by the 3D
 * mission globe (`public/assets/avatars/avatar-male.png` / `avatar-female.png`).
 *
 * Pure Node (zlib only): draws each figure into a 4x supersampled RGBA buffer
 * from the same 128 x 192 design space the WebGL scene anchors sprites at
 * (feet on y = 192), box-downsamples for smooth edges, encodes a minimal PNG
 * (IHDR + IDAT + IEND) and self-verifies the result before finishing.
 *
 * Run: node scripts/generate-avatar-sprites.mjs
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESIGN_WIDTH = 128;
const DESIGN_HEIGHT = 192;
const SCALE = 4; // supersample factor
const WIDTH = DESIGN_WIDTH * SCALE;
const HEIGHT = DESIGN_HEIGHT * SCALE;
const OUTPUT_SIZE = 2; // box-downsample factor -> 256 x 384

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- Tiny software rasteriser (transparent background, opaque shapes) ------
const buffer = new Float64Array(WIDTH * HEIGHT * 4);

function channels(color) {
  const value = color.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function blend(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const [r, g, b] = channels(color);
  const index = (y * WIDTH + x) * 4;
  const covered = buffer[index + 3];
  // "over" operator with partial coverage: the destination only contributes
  // where it is already painted AND the new paint leaves it showing through.
  const coverage = alpha + covered * (1 - alpha);
  if (coverage <= 0) return;
  const destinationWeight = covered * (1 - alpha);
  buffer[index] = (r * alpha + buffer[index] * destinationWeight) / coverage;
  buffer[index + 1] = (g * alpha + buffer[index + 1] * destinationWeight) / coverage;
  buffer[index + 2] = (b * alpha + buffer[index + 2] * destinationWeight) / coverage;
  buffer[index + 3] = coverage;
}

function fillEllipse(cx, cy, rx, ry, color) {
  for (let y = Math.floor((cy - ry) * SCALE); y <= Math.ceil((cy + ry) * SCALE); y++) {
    for (let x = Math.floor((cx - rx) * SCALE); x <= Math.ceil((cx + rx) * SCALE); x++) {
      const dx = (x + 0.5) / SCALE - cx;
      const dy = (y + 0.5) / SCALE - cy;
      const distance = (dx / rx) ** 2 + (dy / ry) ** 2;
      blend(x, y, color, Math.max(0, Math.min(1, (1 - distance) * 4)));
    }
  }
}

function fillPolygon(points, color) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  for (let y = Math.floor(Math.min(...ys) * SCALE); y <= Math.ceil(Math.max(...ys) * SCALE); y++) {
    for (let x = Math.floor(Math.min(...xs) * SCALE); x <= Math.ceil(Math.max(...xs) * SCALE); x++) {
      const px = (x + 0.5) / SCALE;
      const py = (y + 0.5) / SCALE;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) blend(x, y, color, 1);
    }
  }
}

function strokeSegment(x1, y1, x2, y2, halfWidth, color) {
  const pad = halfWidth * 2;
  for (let y = Math.floor((Math.min(y1, y2) - pad) * SCALE); y <= Math.ceil((Math.max(y1, y2) + pad) * SCALE); y++) {
    for (let x = Math.floor((Math.min(x1, x2) - pad) * SCALE); x <= Math.ceil((Math.max(x1, x2) + pad) * SCALE); x++) {
      const px = (x + 0.5) / SCALE;
      const py = (y + 0.5) / SCALE;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
      const distance = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      blend(x, y, color, Math.max(0, Math.min(1, (halfWidth - distance) * 4)));
    }
  }
}

function strokePolyline(points, halfWidth, color) {
  for (let i = 0; i < points.length - 1; i++) {
    strokeSegment(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], halfWidth, color);
  }
}

// --- Character designs (128 x 192 design space, feet on y = 192) -----------
const INK = '#0f172a';
const PANTS = '#334155';

function smilePath(cy, radius) {
  const points = [];
  for (let step = 0; step <= 6; step++) {
    const angle = 0.35 + (step / 6) * (Math.PI - 0.7);
    points.push([64 + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function drawMale({ skin, hair, garment, accent }) {
  strokeSegment(40, 102, 28, 140, 7, skin); // arms
  strokeSegment(88, 102, 100, 140, 7, skin);
  fillPolygon([[44, 150], [61, 150], [61, 184], [44, 184]], PANTS); // legs
  fillPolygon([[67, 150], [84, 150], [84, 184], [67, 184]], PANTS);
  fillPolygon([[36, 182], [63, 182], [63, 192], [36, 192]], hair); // shoes
  fillPolygon([[65, 182], [92, 182], [92, 192], [65, 192]], hair);
  fillPolygon([[38, 84], [90, 84], [90, 154], [38, 154]], garment); // torso
  fillPolygon([[40, 146], [88, 146], [88, 153], [40, 153]], accent); // belt
  fillPolygon([[56, 68], [72, 68], [72, 92], [56, 92]], skin); // neck
  fillEllipse(64, 44, 26, 31, skin); // head
  fillEllipse(64, 34, 28, 26, hair); // hair cap
  fillEllipse(64, 48, 24, 24, skin); // face opening
  fillEllipse(54, 46, 2.6, 2.6, INK); // eyes
  fillEllipse(74, 46, 2.6, 2.6, INK);
  strokePolyline(smilePath(54, 8), 1.2, INK);
}

function drawFemale({ skin, hair, garment, accent }) {
  strokeSegment(40, 102, 28, 140, 6.5, skin); // arms
  strokeSegment(88, 102, 100, 140, 6.5, skin);
  fillPolygon([[48, 168], [61, 168], [61, 186], [48, 186]], skin); // legs
  fillPolygon([[67, 168], [80, 168], [80, 186], [67, 186]], skin);
  fillPolygon([[42, 182], [63, 182], [63, 192], [42, 192]], hair); // shoes
  fillPolygon([[65, 182], [86, 182], [86, 192], [65, 192]], hair);
  fillPolygon([[50, 96], [78, 96], [92, 170], [36, 170]], garment); // dress
  fillPolygon([[48, 104], [80, 104], [80, 111], [48, 111]], accent); // sash
  fillEllipse(64, 40, 30, 34, hair); // hair behind the shoulders
  fillPolygon([[34, 58], [44, 58], [44, 112], [34, 112]], hair); // side strands
  fillPolygon([[84, 58], [94, 58], [94, 112], [84, 112]], hair);
  fillPolygon([[56, 68], [72, 68], [72, 90], [56, 90]], skin); // neck
  fillEllipse(64, 46, 26, 31, skin); // head
  fillEllipse(64, 34, 29, 27, hair); // hair cap
  fillEllipse(64, 49, 23, 23, skin); // face opening
  fillEllipse(54, 47, 2.6, 2.6, INK); // eyes
  fillEllipse(74, 47, 2.6, 2.6, INK);
  strokePolyline(smilePath(56, 8), 1.2, INK);
}

// --- PNG encoding ----------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + width * 4) + 1 + x * 4;
      for (let channel = 0; channel < 4; channel++) {
        // Alpha is stored 0..1 in the buffer; PNG wants 0..255.
        const value = channel === 3 ? pixels[src + channel] * 255 : pixels[src + channel];
        raw[dst + channel] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function downsample() {
  const outWidth = WIDTH / OUTPUT_SIZE;
  const outHeight = HEIGHT / OUTPUT_SIZE;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let sy = 0; sy < OUTPUT_SIZE; sy++) {
          for (let sx = 0; sx < OUTPUT_SIZE; sx++) {
            sum += buffer[((y * OUTPUT_SIZE + sy) * WIDTH + x * OUTPUT_SIZE + sx) * 4 + channel];
          }
        }
        out[(y * outWidth + x) * 4 + channel] = sum / (OUTPUT_SIZE * OUTPUT_SIZE);
      }
    }
  }
  return out;
}

async function renderAndWrite(path, draw) {
  buffer.fill(0);
  draw();
  const outWidth = WIDTH / OUTPUT_SIZE;
  const outHeight = HEIGHT / OUTPUT_SIZE;
  const png = encodePng(downsample(), outWidth, outHeight);
  writeFileSync(path, png);

  // Self-verify: parse the IDAT back, inflate it, and probe known pixels.
  const bytes = readFileSync(path);
  const idatStart = bytes.indexOf(Buffer.from('IDAT')) + 4;
  const idatEnd = bytes.indexOf(Buffer.from('IEND')) - 4;
  const raw = inflateSync(bytes.subarray(idatStart, idatEnd));
  const stride = 1 + outWidth * 4;
  if (raw.length !== outHeight * stride) {
    throw new Error(`${path}: decoded ${raw.length} bytes, expected ${outHeight * stride}`);
  }
  const alphaAt = (x, y) => raw[y * stride + 1 + x * 4 + 3];
  if (alphaAt(2, 2) !== 0) throw new Error(`${path}: background is not transparent`);
  const headAlpha = alphaAt(Math.round(outWidth / 2), Math.round(outHeight * 0.25));
  if (headAlpha < 200) throw new Error(`${path}: head pixels are not opaque (alpha ${headAlpha})`);
  // Feet: both shoes must be opaque at the bottom edge (dead centre is the
  // deliberate gap between them).
  const footY = outHeight - 4;
  const leftFoot = alphaAt(Math.round(outWidth * 0.39), footY);
  const rightFoot = alphaAt(Math.round(outWidth * 0.61), footY);
  if (leftFoot < 200 || rightFoot < 200) {
    throw new Error(`${path}: feet pixels are not opaque (left ${leftFoot}, right ${rightFoot})`);
  }
  console.log(`wrote ${path} (${outWidth}x${outHeight}, transparency + coverage verified)`);
}

await renderAndWrite(resolve(root, 'public/assets/avatars/avatar-male.png'), () =>
  drawMale({ skin: '#E3BE9C', hair: '#3A2C20', garment: '#5A7D9A', accent: '#38BDF8' }));
await renderAndWrite(resolve(root, 'public/assets/avatars/avatar-female.png'), () =>
  drawFemale({ skin: '#F2D3B6', hair: '#4A3A2C', garment: '#C97B5A', accent: '#D4A359' }));

