import { FileContentMismatchError } from './file-api';
import {
  prunedColorProfile,
  type ImageColorProfile,
} from './image-color-profile';

// GIF files start with either "GIF87a" or "GIF89a" (6 bytes)
const GIF87A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_SIGNATURE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

// Minimum bytes needed: 6 (signature) + 4 (width + height)
const MIN_BYTES = 10;

function validateGifSignature(bytes: Uint8Array): void {
  if (bytes.length < 6) {
    throw new FileContentMismatchError(
      'File is too small to be a valid GIF image',
    );
  }

  let isGif87a = GIF87A_SIGNATURE.every((b, i) => bytes[i] === b);
  let isGif89a = GIF89A_SIGNATURE.every((b, i) => bytes[i] === b);

  if (!isGif87a && !isGif89a) {
    throw new FileContentMismatchError(
      'File does not have a valid GIF signature',
    );
  }
}

export function extractGifDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validateGifSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'GIF file is too small to contain image dimensions',
    );
  }

  // Width is at bytes 6-7, height at 8-9 (little-endian uint16)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = view.getUint16(6, true);
  let height = view.getUint16(8, true);

  return { width, height };
}

// Byte 10 of the logical screen descriptor packs the global color table flag
// (bit 7) and, in bits 0-2, the table's size as an exponent: N means 2^(N+1)
// entries, so a value of 7 is the full 256-color table.
const LOGICAL_SCREEN_PACKED_OFFSET = 10;
const GLOBAL_COLOR_TABLE_FLAG = 0x80;
const GLOBAL_COLOR_TABLE_SIZE_MASK = 0x07;

// GIF is always palette-indexed 8-bit RGB. What the header reveals beyond that
// is how many palette entries the image actually uses, which is the honest
// answer to its bit depth — a 16-color GIF is 4-bit.
//
// Transparency is deliberately reported as unknown rather than false: a GIF's
// transparent color is declared in a Graphic Control Extension well past this
// header, so claiming `hasAlpha: false` here would be a guess dressed as a fact.
// Callers must read at least 11 bytes.
export function extractGifColorProfile(
  bytes: Uint8Array,
): ImageColorProfile | undefined {
  if (bytes.length <= LOGICAL_SCREEN_PACKED_OFFSET) {
    return undefined;
  }
  let packed = bytes[LOGICAL_SCREEN_PACKED_OFFSET]!;
  let hasGlobalColorTable = (packed & GLOBAL_COLOR_TABLE_FLAG) !== 0;
  return prunedColorProfile({
    colorSpace: 'indexed',
    bitDepth: hasGlobalColorTable
      ? (packed & GLOBAL_COLOR_TABLE_SIZE_MASK) + 1
      : undefined,
    channels: 3,
  });
}
