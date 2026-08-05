import { FileContentMismatchError } from './file-api';
import {
  prunedColorProfile,
  type ImageColorProfile,
} from './image-color-profile';

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

// Every sibling box of a given type within a region. `findBox` returns only the
// first, which is right for the single `ispe` that carries dimensions but wrong
// for `auxC`: an alpha plane is one of several item properties and need not come
// first.
function findAllBoxes(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  targetType: string,
): { start: number; end: number }[] {
  let found: { start: number; end: number }[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let boxEnd = size === 0 ? end : offset + size;
    if ((size !== 0 && size < 8) || boxEnd > end) {
      break;
    }
    if (readBoxType(bytes, offset + 4) === targetType) {
      found.push({ start: offset, end: boxEnd });
    }
    offset = boxEnd;
  }
  return found;
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
    throw new FileContentMismatchError('AVIF file does not contain a meta box');
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

// The URN an `auxC` box carries when the auxiliary image it describes is an
// alpha plane. AVIF stores transparency as a separate coded image rather than a
// fourth channel of the primary one, so this is the only reliable signal.
const ALPHA_AUX_TYPE = 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha';

// CICP colour primaries, from the `colr`/`nclx` box. These are the four an
// encoder realistically writes; anything else is left unnamed rather than
// guessed at.
const CICP_PRIMARIES: Record<number, string> = {
  1: 'srgb', // BT.709
  9: 'rec2020',
  11: 'display-p3', // DCI-P3
  12: 'display-p3', // Display P3 (P3-D65)
};

// AVIF states its encoding across three item-property boxes rather than one
// header: `pixi` for bit depth and channel count, `colr` for the color space,
// and `auxC` for whether a separate alpha plane exists. All three sit under
// meta > iprp > ipco, so one walk collects them.
//
// Returns undefined when the box tree isn't reachable — the dimension reader is
// what decides whether that constitutes a content mismatch.
export function extractAvifColorProfile(
  bytes: Uint8Array,
): ImageColorProfile | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let meta = findBox(view, bytes, 0, bytes.length, 'meta');
  if (!meta) {
    return undefined;
  }
  // meta is a "full box": 8-byte header plus 4 bytes of version/flags.
  let iprp = findBox(view, bytes, meta.start + 12, meta.end, 'iprp');
  let ipco = iprp
    ? findBox(view, bytes, iprp.start + 8, iprp.end, 'ipco')
    : undefined;
  if (!ipco) {
    return undefined;
  }
  let properties = ipco.start + 8;

  // pixi: [size:4] [type:4] [version+flags:4] [num_channels:1] [depth × n]
  let bitDepth: number | undefined;
  let channels: number | undefined;
  let pixi = findBox(view, bytes, properties, ipco.end, 'pixi');
  if (pixi && pixi.end - pixi.start >= 14) {
    let channelCount = view.getUint8(pixi.start + 12);
    if (
      channelCount > 0 &&
      pixi.start + 13 + channelCount <= pixi.end &&
      pixi.start + 13 + channelCount <= bytes.length
    ) {
      channels = channelCount;
      // Every channel carries its own depth; they agree in every real encoder
      // output, so the first is representative.
      bitDepth = view.getUint8(pixi.start + 13);
    }
  }

  // colr: [size:4] [type:4] [colour_type:4] then, for 'nclx',
  // [primaries:2] [transfer:2] [matrix:2] [full_range:1]
  let colorSpace: string | undefined;
  let iccProfile: string | undefined;
  for (let colr of findAllBoxes(view, bytes, properties, ipco.end, 'colr')) {
    if (colr.end - colr.start < 12) {
      continue;
    }
    let colourType = readBoxType(bytes, colr.start + 8);
    if (colourType === 'nclx' && colr.end - colr.start >= 14) {
      colorSpace ??= CICP_PRIMARIES[view.getUint16(colr.start + 12)];
    } else if (colourType === 'rICC' || colourType === 'prof') {
      // The profile bytes themselves are here, but naming the profile means
      // parsing an ICC header; recording that one is embedded is the honest
      // summary.
      iccProfile ??= 'embedded';
    }
  }

  let hasAlpha = findAllBoxes(view, bytes, properties, ipco.end, 'auxC').some(
    (auxC) => {
      // auxC: [size:4] [type:4] [version+flags:4] [aux_type: NUL-terminated]
      let start = auxC.start + 12;
      if (start >= auxC.end) {
        return false;
      }
      let text = new TextDecoder('latin1').decode(
        bytes.subarray(start, Math.min(auxC.end, bytes.length)),
      );
      return text.startsWith(ALPHA_AUX_TYPE);
    },
  );

  return prunedColorProfile({
    colorSpace: colorSpace ?? (channels === 1 ? 'grayscale' : undefined),
    bitDepth,
    channels,
    // An `auxC` alpha plane is positive evidence; its absence within a header
    // window that may have been truncated is not, so only report the positive.
    hasAlpha: hasAlpha ? true : undefined,
    iccProfile,
  });
}
