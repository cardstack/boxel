import { FileContentMismatchError } from './file-api';
import {
  prunedColorProfile,
  type ImageColorProfile,
} from './image-color-profile';
import { animatedFromVerdict, type AnimationVerdict } from './image-animation';

// PNG 8-byte magic signature
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Minimum bytes needed: 8 (signature) + 8 (IHDR chunk header) + 8 (width + height)
const MIN_BYTES = 24;

function validatePngSignature(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new FileContentMismatchError(
      'File is too small to be a valid PNG image',
    );
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new FileContentMismatchError(
        'File does not have a valid PNG signature',
      );
    }
  }
}

export function extractPngDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validatePngSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'PNG file is too small to contain IHDR chunk',
    );
  }

  // Width is at bytes 16-19, height at 20-23 (big-endian uint32)
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = view.getUint32(16);
  let height = view.getUint32(20);

  return { width, height };
}

// IHDR color type is a bit field: 1 = palette used, 2 = color used, 4 = alpha
// channel present. Only five of the eight combinations are legal, and each
// fixes the channel count.
//
// `colorSpace` here names the channel *model*, not a colorimetric profile.
// IHDR proves grayscale/indexed outright, but for truecolor (2/6) it says only
// "three or four channels of color" — sRGB versus Display P3 versus an embedded
// ICC profile is stated in an `sRGB`/`iCCP`/`cICP` chunk past IHDR that this
// header-only read never reaches. So truecolor leaves `colorSpace` unset rather
// than guess `srgb`; `channels` already records that it's RGB(A).
const PNG_COLOR_TYPES: Record<
  number,
  { colorSpace?: string; channels: number; hasAlpha: boolean }
> = {
  0: { colorSpace: 'grayscale', channels: 1, hasAlpha: false },
  2: { channels: 3, hasAlpha: false },
  // Palette entries are themselves RGB triples, so the samples are indices but
  // the rendered color is three-channel.
  3: { colorSpace: 'indexed', channels: 3, hasAlpha: false },
  4: { colorSpace: 'grayscale-alpha', channels: 2, hasAlpha: true },
  6: { channels: 4, hasAlpha: true },
};

// IHDR byte offsets, continuing past the dimensions read above.
const IHDR_BIT_DEPTH_OFFSET = 24;
const IHDR_COLOR_TYPE_OFFSET = 25;

// PNG states its encoding outright in IHDR, which is always the first chunk, so
// this needs no scanning — but callers must read at least 26 bytes.
//
// One deliberate omission: a `tRNS` chunk can make an indexed or truecolor PNG
// transparent without the alpha bit being set in the color type. Finding it
// means walking chunks past IHDR, so `hasAlpha` here reports the alpha
// *channel*, and an image whose transparency comes from `tRNS` reads as false.
export function extractPngColorProfile(
  bytes: Uint8Array,
): ImageColorProfile | undefined {
  if (bytes.length <= IHDR_COLOR_TYPE_OFFSET) {
    return undefined;
  }
  let bitDepth = bytes[IHDR_BIT_DEPTH_OFFSET]!;
  let colorType = PNG_COLOR_TYPES[bytes[IHDR_COLOR_TYPE_OFFSET]!];
  return prunedColorProfile({
    colorSpace: colorType?.colorSpace,
    // Legal PNG bit depths are 1, 2, 4, 8, and 16; anything else means we're
    // not looking at a real IHDR.
    bitDepth: [1, 2, 4, 8, 16].includes(bitDepth) ? bitDepth : undefined,
    channels: colorType?.channels,
    hasAlpha: colorType?.hasAlpha,
  });
}

// Every chunk is a 4-byte length and 4-byte type, its data, then a 4-byte CRC.
const CHUNK_HEADER_BYTES = 8;
const CHUNK_CRC_BYTES = 4;

// An animated PNG (APNG) declares itself with an `acTL` chunk, which the spec
// requires to precede the first `IDAT`. So a chunk walk from IHDR decides it:
// `acTL` first means animated, `IDAT` first means a still. Only the ancillary
// chunks between them (`iCCP`, `sRGB`, `pHYs`, text, …) are walked past, and
// each is skipped by its declared length without reading its data.
//
// `needs-bytes` when `bytes` ends before either chunk — the caller's read
// window may stop inside a large ancillary chunk. `undecidable` for bytes that
// aren't a PNG, or a chunk type that isn't four ASCII letters, since the chunk
// framing can't be trusted past that point.
const CHUNK_TYPE_RE = /^[A-Za-z]{4}$/;

export function pngAnimationVerdict(bytes: Uint8Array): AnimationVerdict {
  let signatureBytes = Math.min(bytes.length, PNG_SIGNATURE.length);
  for (let i = 0; i < signatureBytes; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return 'undecidable';
    }
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    let length = view.getUint32(offset);
    let type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    if (!CHUNK_TYPE_RE.test(type)) {
      return 'undecidable';
    }
    if (type === 'acTL') {
      return 'animated';
    }
    if (type === 'IDAT' || type === 'IEND') {
      return 'still';
    }
    offset += CHUNK_HEADER_BYTES + length + CHUNK_CRC_BYTES;
  }
  return 'needs-bytes';
}

export function extractPngAnimated(bytes: Uint8Array): boolean | undefined {
  return animatedFromVerdict(pngAnimationVerdict(bytes));
}
