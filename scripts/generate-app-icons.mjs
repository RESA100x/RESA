// Builds the 1024x1024 app-icon master (`app-icon.png`) for RESA.
//
// The brand mark lives in public/logo.png as a flat navy glyph on a teal disc.
// The packaged icon needs to be a tile, so the disc is squared off with a
// rounded-square background sampled from the disc itself, which leaves the
// brand mark untouched and adds no visible seam. The master is written in the
// PNG shape `tauri icon` expects, and both steps are wrapped in one script:
//
//   npm run icons:app
//
// `tauri icon` regenerates every src-tauri/icons file (Windows, macOS, Linux,
// iOS and Android) from that single master, so re-running both steps is all a
// brand change needs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sourceFile = join(root, 'public', 'logo.png');
const outFile = join(root, 'app-icon.png');

const SIZE = 1024;
// Windows tiles round their corners by roughly a fifth of the edge; the same
// ratio still reads as a tile at 32px.
const CORNER_RADIUS = Math.round(SIZE * 0.2);
// Supersampling factor for the rounded-corner coverage, so the tile edges are
// anti-aliased instead of stair-stepped.
const SAMPLES = 4;

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        value += distances[0] <= distances[1] && distances[0] <= distances[2]
          ? left
          : distances[1] <= distances[2] ? up : upLeft;
      }
      current[i] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      data[target] = current[x * channels];
      data[target + 1] = current[x * channels + 1];
      data[target + 2] = current[x * channels + 2];
      data[target + 3] = channels === 4 ? current[x * channels + 3] : 255;
    }
    previous = current;
  }
  return { width, height, data };
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length, 0);
    header.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
    return Buffer.concat([header, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Area-weighted resample, so the mark stays crisp when the square source is
// scaled to the icon grid.
function resample(source, size) {
  const { width, height, data } = source;
  const out = new Uint8Array(size * size * 4);
  const scaleX = width / size;
  const scaleY = height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < Math.min(y1, height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, width); sx += 1) {
          const index = (sy * width + sx) * 4;
          const alpha = data[index + 3] / 255;
          r += data[index] * alpha;
          g += data[index + 1] * alpha;
          b += data[index + 2] * alpha;
          a += data[index + 3];
          count += 1;
        }
      }
      const target = (y * size + x) * 4;
      const alpha = a / count;
      const unpremultiply = alpha > 0 ? 255 / alpha : 0;
      out[target] = Math.round(Math.min(255, (r / count) * unpremultiply));
      out[target + 1] = Math.round(Math.min(255, (g / count) * unpremultiply));
      out[target + 2] = Math.round(Math.min(255, (b / count) * unpremultiply));
      out[target + 3] = Math.round(alpha);
    }
  }
  return out;
}

// The disc's flat fill is sampled where the glyph never reaches: a band just
// under the top edge of the mark, centred horizontally.
function sampleDiscColour(source) {
  const { width, height, data } = source;
  const x0 = Math.round(width * 0.44);
  const x1 = Math.round(width * 0.56);
  const y0 = Math.round(height * 0.03);
  const y1 = Math.round(height * 0.065);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 250) continue;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      count += 1;
    }
  }
  if (count === 0) throw new Error('could not sample the brand colour from the logo');
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function roundedRectCoverage(x, y) {
  const radius = CORNER_RADIUS;
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    const py = y + (sy + 0.5) / SAMPLES;
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const px = x + (sx + 0.5) / SAMPLES;
      const dx = px < radius ? radius - px : px > SIZE - radius ? px - (SIZE - radius) : 0;
      const dy = py < radius ? radius - py : py > SIZE - radius ? py - (SIZE - radius) : 0;
      if (dx === 0 || dy === 0 || dx * dx + dy * dy <= radius * radius) hits += 1;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

const source = decodePng(readFileSync(sourceFile));
if (source.width !== source.height) throw new Error('the brand mark must be square');
const [red, green, blue] = sampleDiscColour(source);
const mark = resample(source, SIZE);
const icon = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const index = (y * SIZE + x) * 4;
    const tileAlpha = roundedRectCoverage(x, y);
    const markAlpha = mark[index + 3] / 255;
    const alpha = markAlpha + tileAlpha * (1 - markAlpha);
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const markValue = mark[index + channel] * markAlpha;
      const tileValue = [red, green, blue][channel] * tileAlpha * (1 - markAlpha);
      icon[index + channel] = Math.round((markValue + tileValue) / alpha);
    }
    icon[index + 3] = Math.round(alpha * 255);
  }
}

writeFileSync(outFile, encodePng({ width: SIZE, height: SIZE, data: icon }));
console.log(`wrote ${outFile} (${SIZE}x${SIZE}, #${[red, green, blue].map((v) => v.toString(16).padStart(2, '0')).join('')} tile)`);
console.log('next: npm run tauri icon app-icon.png');
