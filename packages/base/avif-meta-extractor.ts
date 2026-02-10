import { FileContentMismatchError } from './file-api';

// AVIF uses ISO Base Media File Format (ISOBMFF).
// The file starts with a "ftyp" box whose brand is "avif" or "avis".
// Image dimensions live in an "ispe" (ImageSpatialExtentsProperty) box.
const FTYP_MARKER = new Uint8Array([0x66, 0x74, 0x79, 0x70]); // "ftyp"
const AVIF_BRAND = new Uint8Array([0x61, 0x76, 0x69, 0x66]); // "avif"
const AVIS_BRAND = new Uint8Array([0x61, 0x76, 0x69, 0x73]); // "avis"
const ISPE_MARKER = new Uint8Array([0x69, 0x73, 0x70, 0x65]); // "ispe"

// Minimum: ftyp box header (8) + major brand (4) = 12 bytes
const MIN_BYTES = 12;

function matchBytes(
  bytes: Uint8Array,
  offset: number,
  pattern: Uint8Array,
): boolean {
  if (offset + pattern.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) {
      return false;
    }
  }
  return true;
}

function validateAvifSignature(bytes: Uint8Array): void {
  if (bytes.length < MIN_BYTES) {
    throw new FileContentMismatchError(
      'File is too small to be a valid AVIF image',
    );
  }

  // ftyp box: [size: 4] ["ftyp": 4] [major_brand: 4] [minor_version: 4] [compatible_brands...]
  if (!matchBytes(bytes, 4, FTYP_MARKER)) {
    throw new FileContentMismatchError(
      'File does not have a valid AVIF signature',
    );
  }

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ftypSize = view.getUint32(0);
  if (ftypSize < MIN_BYTES || ftypSize > bytes.length) {
    ftypSize = Math.min(bytes.length, 64);
  }

  // Check major brand (offset 8) and compatible brands (offset 16+) for "avif" or "avis"
  let hasAvifBrand = false;

  if (matchBytes(bytes, 8, AVIF_BRAND) || matchBytes(bytes, 8, AVIS_BRAND)) {
    hasAvifBrand = true;
  }

  if (!hasAvifBrand) {
    for (let offset = 16; offset + 4 <= ftypSize; offset += 4) {
      if (
        matchBytes(bytes, offset, AVIF_BRAND) ||
        matchBytes(bytes, offset, AVIS_BRAND)
      ) {
        hasAvifBrand = true;
        break;
      }
    }
  }

  if (!hasAvifBrand) {
    throw new FileContentMismatchError('File does not have a valid AVIF brand');
  }
}

export function extractAvifDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  validateAvifSignature(bytes);

  // Scan for the ispe box: [size: 4] ["ispe": 4] [version+flags: 4] [width: 4] [height: 4]
  // Total ispe box size = 20 bytes
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i <= bytes.length - 20; i++) {
    if (matchBytes(bytes, i + 4, ISPE_MARKER)) {
      let width = view.getUint32(i + 12);
      let height = view.getUint32(i + 16);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }

  throw new FileContentMismatchError(
    'AVIF file does not contain image dimensions (ispe box not found)',
  );
}
