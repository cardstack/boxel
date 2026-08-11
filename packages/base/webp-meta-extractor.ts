import { FileContentMismatchError } from './file-api';
import {
  prunedColorProfile,
  type ImageColorProfile,
} from './image-color-profile';

// WebP files start with "RIFF" (4 bytes) + file size (4 bytes) + "WEBP" (4 bytes)
const RIFF_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // "WEBP"

// Minimum bytes: 12 (RIFF header) + 4 (chunk FourCC) + enough for dimensions
const MIN_BYTES = 30;

function validateWebpSignature(bytes: Uint8Array): void {
  if (bytes.length < 12) {
    throw new FileContentMismatchError(
      'File is too small to be a valid WebP image',
    );
  }
  let isRiff = RIFF_SIGNATURE.every((b, i) => bytes[i] === b);
  let isWebp = WEBP_SIGNATURE.every((b, i) => bytes[i + 8] === b);

  if (!isRiff || !isWebp) {
    throw new FileContentMismatchError(
      'File does not have a valid WebP signature',
    );
  }
}

export function extractWebpDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validateWebpSignature(bytes);

  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'WebP file is too small to contain image dimensions',
    );
  }

  // Chunk FourCC starts at byte 12
  let chunkFourCC = String.fromCharCode(
    bytes[12]!,
    bytes[13]!,
    bytes[14]!,
    bytes[15]!,
  );

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (chunkFourCC === 'VP8 ') {
    // Lossy WebP — VP8 bitstream
    // Frame tag starts at offset 20 (after RIFF header + "VP8 " + chunk size)
    // Bytes 20-22: frame tag (3 bytes)
    // Bytes 23-25: start code 0x9D 0x01 0x2A
    // Bytes 26-27: width (little-endian, lower 14 bits)
    // Bytes 28-29: height (little-endian, lower 14 bits)
    if (bytes.length < 30) {
      throw new FileContentMismatchError(
        'VP8 chunk is too small to contain dimensions',
      );
    }
    let width = view.getUint16(26, true) & 0x3fff;
    let height = view.getUint16(28, true) & 0x3fff;
    return { width, height };
  }

  if (chunkFourCC === 'VP8L') {
    // Lossless WebP
    // Byte 21: signature byte 0x2F
    // Bytes 21-24: bitstream header containing width and height
    // Width:  bits 0-13 of the 32-bit LE value at offset 21 (after signature byte)
    // Height: bits 14-27
    if (bytes.length < 25) {
      throw new FileContentMismatchError(
        'VP8L chunk is too small to contain dimensions',
      );
    }
    let signature = bytes[20];
    if (signature !== 0x2f) {
      throw new FileContentMismatchError(
        'VP8L chunk has invalid signature byte',
      );
    }
    let bits = view.getUint32(21, true);
    let width = (bits & 0x3fff) + 1;
    let height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  if (chunkFourCC === 'VP8X') {
    // Extended WebP — VP8X chunk contains canvas dimensions
    // Bytes 20-23: flags (4 bytes)
    // Bytes 24-26: canvas width minus one (24-bit LE)
    // Bytes 27-29: canvas height minus one (24-bit LE)
    if (bytes.length < 30) {
      throw new FileContentMismatchError(
        'VP8X chunk is too small to contain dimensions',
      );
    }
    let width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    let height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { width, height };
  }

  throw new FileContentMismatchError(
    `WebP file has unrecognized chunk type: ${chunkFourCC}`,
  );
}

// Each WebP flavor declares alpha in its own place.
//
//   VP8   lossy — no alpha in the bitstream at all.
//   VP8L  lossless — bit 28 of the 32-bit little-endian header word that
//         follows the signature byte, the same word the dimensions come from.
//   VP8X  extended — bit 4 of the flags byte, set when a separate ALPH chunk
//         follows. This is also the flavor an animated or ICC-carrying file
//         uses, so it's the one where the flag actually varies.
//
// WebP is 8 bits per channel in every mode, so bit depth is a constant rather
// than something read from the file.
const VP8X_FLAGS_OFFSET = 20;
const VP8X_ALPHA_FLAG = 0x10;
const VP8X_ICC_FLAG = 0x20;
const VP8L_HEADER_OFFSET = 21;
const VP8L_ALPHA_BIT = 28;

export function extractWebpColorProfile(
  bytes: Uint8Array,
): ImageColorProfile | undefined {
  if (bytes.length < 16) {
    return undefined;
  }
  let chunkFourCC = String.fromCharCode(
    bytes[12]!,
    bytes[13]!,
    bytes[14]!,
    bytes[15]!,
  );
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hasAlpha: boolean;
  let iccProfile: string | undefined;
  if (chunkFourCC === 'VP8 ') {
    hasAlpha = false;
  } else if (chunkFourCC === 'VP8L' && bytes.length >= VP8L_HEADER_OFFSET + 4) {
    let header = view.getUint32(VP8L_HEADER_OFFSET, true);
    hasAlpha = ((header >>> VP8L_ALPHA_BIT) & 1) === 1;
  } else if (chunkFourCC === 'VP8X' && bytes.length > VP8X_FLAGS_OFFSET) {
    let flags = bytes[VP8X_FLAGS_OFFSET]!;
    hasAlpha = (flags & VP8X_ALPHA_FLAG) !== 0;
    // The flag says an ICC chunk is present but not which profile it holds;
    // naming it would mean parsing the chunk itself.
    iccProfile = (flags & VP8X_ICC_FLAG) !== 0 ? 'embedded' : undefined;
  } else {
    return undefined;
  }
  return prunedColorProfile({
    colorSpace: 'srgb',
    bitDepth: 8,
    channels: hasAlpha ? 4 : 3,
    hasAlpha,
    iccProfile,
  });
}
