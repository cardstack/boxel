import { FileContentMismatchError } from './file-api';
import {
  prunedColorProfile,
  type ImageColorProfile,
} from './image-color-profile';
import { animatedFromVerdict, type AnimationVerdict } from './image-animation';

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

// GIF block introducers, as they appear after the header and global color
// table.
const EXTENSION_INTRODUCER = 0x21;
const IMAGE_DESCRIPTOR = 0x2c;
const TRAILER = 0x3b;
const LOCAL_COLOR_TABLE_FLAG = 0x80;
const COLOR_TABLE_SIZE_MASK = 0x07;
const IMAGE_DESCRIPTOR_BYTES = 10;

// A GIF animates when it holds more than one image, and nothing short of
// walking its blocks says how many it holds: the NETSCAPE2.0 loop extension
// is conventional but optional, so a multi-frame GIF without it still plays
// once. The walk skips every extension and every frame's data sub-blocks,
// stopping at a second image descriptor (animated) or the trailer (still).
//
// `needs-bytes` when `bytes` runs out first — the caller's read window may end
// mid-frame. `undecidable` for bytes that aren't a GIF, or a block introducer
// the walk doesn't recognize, since reading further can't change either.
export function gifAnimationVerdict(bytes: Uint8Array): AnimationVerdict {
  let signatureBytes = Math.min(bytes.length, GIF89A_SIGNATURE.length);
  let isGifPrefix = [GIF87A_SIGNATURE, GIF89A_SIGNATURE].some((signature) =>
    signature.subarray(0, signatureBytes).every((b, i) => bytes[i] === b),
  );
  if (!isGifPrefix) {
    return 'undecidable';
  }
  if (bytes.length <= LOGICAL_SCREEN_PACKED_OFFSET + 2) {
    return 'needs-bytes';
  }
  let packed = bytes[LOGICAL_SCREEN_PACKED_OFFSET]!;
  let offset = LOGICAL_SCREEN_PACKED_OFFSET + 3;
  if (packed & GLOBAL_COLOR_TABLE_FLAG) {
    offset += 3 * 2 ** ((packed & GLOBAL_COLOR_TABLE_SIZE_MASK) + 1);
  }

  // Skips a run of data sub-blocks (each a length byte then that many bytes,
  // ended by a zero length), returning the offset past the terminator.
  let skipSubBlocks = (start: number): number | undefined => {
    let at = start;
    while (at < bytes.length) {
      let length = bytes[at]!;
      at += 1;
      if (length === 0) {
        return at;
      }
      at += length;
    }
    return undefined;
  };

  let frames = 0;
  while (offset < bytes.length) {
    let introducer = bytes[offset]!;
    if (introducer === TRAILER) {
      return 'still';
    }
    if (introducer === EXTENSION_INTRODUCER) {
      // Introducer, label, then the extension's sub-blocks.
      let next = skipSubBlocks(offset + 2);
      if (next === undefined) {
        return 'needs-bytes';
      }
      offset = next;
      continue;
    }
    if (introducer !== IMAGE_DESCRIPTOR) {
      return 'undecidable';
    }
    frames += 1;
    if (frames > 1) {
      return 'animated';
    }
    if (offset + IMAGE_DESCRIPTOR_BYTES > bytes.length) {
      return 'needs-bytes';
    }
    let descriptorPacked = bytes[offset + IMAGE_DESCRIPTOR_BYTES - 1]!;
    offset += IMAGE_DESCRIPTOR_BYTES;
    if (descriptorPacked & LOCAL_COLOR_TABLE_FLAG) {
      offset += 3 * 2 ** ((descriptorPacked & COLOR_TABLE_SIZE_MASK) + 1);
    }
    // The LZW minimum code size byte, then the frame's data sub-blocks.
    let next = skipSubBlocks(offset + 1);
    if (next === undefined) {
      return 'needs-bytes';
    }
    offset = next;
  }
  return 'needs-bytes';
}

export function extractGifAnimated(bytes: Uint8Array): boolean | undefined {
  return animatedFromVerdict(gifAnimationVerdict(bytes));
}
