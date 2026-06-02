import { FileContentMismatchError } from './file-api';

// ISO BMFF box header: 4 bytes size + 4 bytes type. Special sizes:
//   size == 0  → box extends to end of file
//   size == 1  → next 8 bytes are the real (64-bit) size
const BOX_HEADER_BYTES = 8;
const LARGE_SIZE_BYTES = 8;

const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"
const MOOV = [0x6d, 0x6f, 0x6f, 0x76]; // "moov"
const MVHD = [0x6d, 0x76, 0x68, 0x64]; // "mvhd"

interface BoxLocation {
  type: string;
  payloadOffset: number;
  payloadEnd: number;
  nextBoxOffset: number;
}

function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function matchType(
  bytes: Uint8Array,
  offset: number,
  target: readonly number[],
): boolean {
  return (
    bytes[offset] === target[0] &&
    bytes[offset + 1] === target[1] &&
    bytes[offset + 2] === target[2] &&
    bytes[offset + 3] === target[3]
  );
}

function readBoxAt(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  containerEnd: number,
): BoxLocation | undefined {
  if (offset + BOX_HEADER_BYTES > containerEnd) {
    return undefined;
  }
  let size = view.getUint32(offset);
  let type = typeAt(bytes, offset + 4);
  let headerSize = BOX_HEADER_BYTES;

  if (size === 1) {
    // 64-bit extended size
    if (offset + BOX_HEADER_BYTES + LARGE_SIZE_BYTES > containerEnd) {
      throw new FileContentMismatchError(
        `MP4 ${type} box declares a 64-bit size but is truncated`,
      );
    }
    let hi = view.getUint32(offset + BOX_HEADER_BYTES);
    let lo = view.getUint32(offset + BOX_HEADER_BYTES + 4);
    size = hi * 0x1_0000_0000 + lo;
    headerSize = BOX_HEADER_BYTES + LARGE_SIZE_BYTES;
  } else if (size === 0) {
    // Box extends to end of container
    size = containerEnd - offset;
  }

  if (size < headerSize) {
    throw new FileContentMismatchError(
      `MP4 ${type} box declares an impossible size`,
    );
  }
  let payloadOffset = offset + headerSize;
  let payloadEnd = offset + size;
  if (payloadEnd > containerEnd) {
    throw new FileContentMismatchError(
      `MP4 ${type} box extends past its container`,
    );
  }
  return { type, payloadOffset, payloadEnd, nextBoxOffset: payloadEnd };
}

function findChildBox(
  bytes: Uint8Array,
  view: DataView,
  containerStart: number,
  containerEnd: number,
  targetType: readonly number[],
): BoxLocation | undefined {
  let offset = containerStart;
  while (offset < containerEnd) {
    let box = readBoxAt(bytes, view, offset, containerEnd);
    if (!box) {
      return undefined;
    }
    if (matchType(bytes, offset + 4, targetType)) {
      return box;
    }
    offset = box.nextBoxOffset;
  }
  return undefined;
}

function parseMvhd(
  bytes: Uint8Array,
  view: DataView,
  mvhd: BoxLocation,
): { timescale: number; duration: number } {
  // mvhd payload:
  //   1 byte version + 3 bytes flags, then version-specific layout.
  let p = mvhd.payloadOffset;
  if (p + 4 > mvhd.payloadEnd) {
    throw new FileContentMismatchError('MP4 mvhd box is truncated');
  }
  let version = bytes[p]!;
  let cursor = p + 4; // skip version + flags

  if (version === 0) {
    // creation(4) + modification(4) + timescale(4) + duration(4)
    if (cursor + 16 > mvhd.payloadEnd) {
      throw new FileContentMismatchError(
        'MP4 mvhd (v0) box is truncated',
      );
    }
    let timescale = view.getUint32(cursor + 8);
    let duration = view.getUint32(cursor + 12);
    return { timescale, duration };
  }

  if (version === 1) {
    // creation(8) + modification(8) + timescale(4) + duration(8)
    if (cursor + 28 > mvhd.payloadEnd) {
      throw new FileContentMismatchError(
        'MP4 mvhd (v1) box is truncated',
      );
    }
    let timescale = view.getUint32(cursor + 16);
    let durHi = view.getUint32(cursor + 20);
    let durLo = view.getUint32(cursor + 24);
    let duration = durHi * 0x1_0000_0000 + durLo;
    return { timescale, duration };
  }

  throw new FileContentMismatchError(
    `MP4 mvhd box has unsupported version ${version}`,
  );
}

export function extractM4aDuration(bytes: Uint8Array): { duration: number } {
  if (bytes.length < BOX_HEADER_BYTES) {
    throw new FileContentMismatchError(
      'File is too small to be a valid MP4 container',
    );
  }

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // First top-level box should be `ftyp`. If it isn't we treat the file as
  // not really an MP4/M4A so a subclass-mismatch can fall back gracefully.
  if (!matchType(bytes, 4, FTYP)) {
    throw new FileContentMismatchError(
      'MP4 file does not start with an ftyp box',
    );
  }

  let moov = findChildBox(bytes, view, 0, bytes.length, MOOV);
  if (!moov) {
    throw new FileContentMismatchError(
      'MP4 file does not contain a moov box',
    );
  }
  let mvhd = findChildBox(bytes, view, moov.payloadOffset, moov.payloadEnd, MVHD);
  if (!mvhd) {
    throw new FileContentMismatchError(
      'MP4 file does not contain a mvhd box',
    );
  }

  let { timescale, duration } = parseMvhd(bytes, view, mvhd);
  if (timescale === 0) {
    throw new FileContentMismatchError(
      'MP4 mvhd reports a zero timescale',
    );
  }
  return { duration: duration / timescale };
}
