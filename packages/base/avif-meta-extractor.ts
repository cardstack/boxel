import { FileContentMismatchError } from './file-api';

// AVIF uses ISO Base Media File Format (ISOBMFF).
// The file starts with a "ftyp" box whose brand is "avif" or "avis".
// Image dimensions live in an "ispe" box at: meta > iprp > ipco > ispe.
const FTYP_MARKER = new Uint8Array([0x66, 0x74, 0x79, 0x70]); // "ftyp"
const AVIF_BRAND = new Uint8Array([0x61, 0x76, 0x69, 0x66]); // "avif"
const AVIS_BRAND = new Uint8Array([0x61, 0x76, 0x69, 0x73]); // "avis"

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

function readBoxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

// Walk sibling boxes within a region and return the offset range of the first
// box matching `targetType`, or undefined if not found.
function findBox(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  targetType: string,
): { start: number; end: number } | undefined {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    // size == 0 means the box extends to end of data
    let boxEnd = size === 0 ? end : offset + size;
    if (size !== 0 && size < 8) {
      break; // invalid box size
    }
    if (boxEnd > end) {
      break;
    }
    let type = readBoxType(bytes, offset + 4);
    if (type === targetType) {
      return { start: offset, end: boxEnd };
    }
    offset = boxEnd;
  }
  return undefined;
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

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Walk the ISOBMFF box tree: top-level → meta → iprp → ipco → ispe
  let meta = findBox(view, bytes, 0, bytes.length, 'meta');
  if (!meta) {
    throw new FileContentMismatchError(
      'AVIF file does not contain a meta box',
    );
  }

  // meta is a "full box": 8-byte header + 4-byte version/flags before children
  let iprp = findBox(view, bytes, meta.start + 12, meta.end, 'iprp');
  if (!iprp) {
    throw new FileContentMismatchError(
      'AVIF file does not contain an iprp box',
    );
  }

  let ipco = findBox(view, bytes, iprp.start + 8, iprp.end, 'ipco');
  if (!ipco) {
    throw new FileContentMismatchError(
      'AVIF file does not contain an ipco box',
    );
  }

  let ispe = findBox(view, bytes, ipco.start + 8, ipco.end, 'ispe');
  if (!ispe) {
    throw new FileContentMismatchError(
      'AVIF file does not contain image dimensions (ispe box not found)',
    );
  }

  // ispe: [size:4] [type:4] [version+flags:4] [width:4] [height:4] = 20 bytes
  if (ispe.end - ispe.start < 20) {
    throw new FileContentMismatchError('AVIF ispe box is truncated');
  }

  let width = view.getUint32(ispe.start + 12);
  let height = view.getUint32(ispe.start + 16);

  if (width === 0 || height === 0) {
    throw new FileContentMismatchError(
      'AVIF ispe box contains zero dimensions',
    );
  }

  return { width, height };
}
