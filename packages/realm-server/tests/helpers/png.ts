import { inflateSync } from 'zlib';

export interface RgbaImage {
  width: number;
  height: number;
  // Row-major RGBA, 4 bytes per pixel.
  data: Uint8Array;
}

// Decode a base64 PNG into raw RGBA pixels — enough of the format to
// pixel-compare two Chromium captures, without pulling in an image
// library (the header-only `decodePng` above shares this no-dependency
// stance). Handles what `page.screenshot` actually emits: 8-bit,
// non-interlaced, truecolor with (colorType 6) or without (colorType 2) an
// alpha channel. Anything else throws rather than silently misreading.
export function decodePngRGBA(base64: string): RgbaImage {
  let buf = Buffer.from(base64, 'base64');
  let signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !signature.every((byte, i) => buf[i] === byte)) {
    throw new Error('not a PNG');
  }
  let width = buf.readUInt32BE(16);
  let height = buf.readUInt32BE(20);
  let bitDepth = buf[24];
  let colorType = buf[25];
  let interlace = buf[28];
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }
  if (interlace !== 0) {
    throw new Error('interlaced PNGs are not supported');
  }
  let channels = colorType === 6 ? 4 : 3;

  // Concatenate the (possibly split) IDAT chunk payloads, then inflate.
  let idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    let length = buf.readUInt32BE(offset);
    let type = buf.toString('ascii', offset + 4, offset + 8);
    let dataStart = offset + 8;
    if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // skip data + CRC
  }
  let raw = inflateSync(Buffer.concat(idat));

  // Reverse the per-scanline PNG filters (spec §9.2). Each scanline is
  // prefixed with a 1-byte filter type; reconstruction reads already-decoded
  // bytes to the left (a=bpp back) and above (b=prior row), so it must run
  // top-to-bottom, left-to-right.
  let bpp = channels;
  let stride = width * bpp;
  let out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let paeth = (a: number, b: number, c: number) => {
    let p = a + b - c;
    let pa = Math.abs(p - a);
    let pb = Math.abs(p - b);
    let pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    let rowStart = y * (stride + 1);
    let filter = raw[rowStart];
    for (let i = 0; i < stride; i++) {
      let x = raw[rowStart + 1 + i];
      let a = i >= bpp ? cur[i - bpp] : 0;
      let b = prev[i];
      let c = i >= bpp ? prev[i - bpp] : 0;
      let recon: number;
      switch (filter) {
        case 0:
          recon = x;
          break;
        case 1:
          recon = x + a;
          break;
        case 2:
          recon = x + b;
          break;
        case 3:
          recon = x + ((a + b) >> 1);
          break;
        case 4:
          recon = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter type ${filter}`);
      }
      cur[i] = recon & 0xff;
    }
    // Expand the scanline into RGBA, filling alpha for truecolor sources.
    for (let px = 0; px < width; px++) {
      let src = px * bpp;
      let dst = (y * width + px) * 4;
      out[dst] = cur[src];
      out[dst + 1] = cur[src + 1];
      out[dst + 2] = cur[src + 2];
      out[dst + 3] = channels === 4 ? cur[src + 3] : 0xff;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

// The share of a capture's pixels that are the given color, give or take
// antialiasing: how much of the frame a known fill covers.
export function colorCoverage(
  base64: string,
  [r, g, b]: [number, number, number],
): number {
  let { data, width, height } = decodePngRGBA(base64);
  let matching = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i] - r) <= 2 &&
      Math.abs(data[i + 1] - g) <= 2 &&
      Math.abs(data[i + 2] - b) <= 2
    ) {
      matching++;
    }
  }
  return matching / (width * height);
}
