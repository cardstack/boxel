// ID3v2 tags, as MP3 files carry them. The tag sits at the very start of the
// file, ahead of the first MPEG frame, so `mp3-meta-extractor` already skips
// past it to find the audio — this reads what it skips.
//
// Pure `DataView`/`TextDecoder`, no DOM.

import { parseTagYear, prunedTags, type MediaTags } from './audio-metadata';

const ID3_IDENTIFIER = [0x49, 0x44, 0x33]; // "ID3"
const HEADER_BYTES = 10;

// A frame larger than this is embedded artwork (`APIC`) or a corrupt length.
// Descriptive text frames are far smaller.
const MAX_FRAME_BYTES = 65_536;

// Guards the walk when a size field is garbage. A real tag has a few dozen.
const MAX_FRAMES = 256;

// ID3v2 text frames declare their own encoding in a leading byte.
const ENCODING_LATIN1 = 0;
const ENCODING_UTF16_BOM = 1;
const ENCODING_UTF16_BE = 2;
const ENCODING_UTF8 = 3;

// v2.3/v2.4 four-character frame IDs, mapped onto the shared tag shape.
const FRAME_ALIASES: Record<string, keyof MediaTags> = {
  TIT2: 'trackTitle',
  TPE1: 'artist',
  TPE2: 'albumArtist',
  TALB: 'album',
  TCOM: 'composer',
  TRCK: 'track',
  TPOS: 'disc',
  TCON: 'genre',
  COMM: 'comment',
  // v2.4 replaced TYER with TDRC; files in the wild carry either.
  TDRC: 'year',
  TYER: 'year',
};

// The v2.2 equivalents, which use three-character IDs and a three-byte size.
const FRAME_ALIASES_V2: Record<string, keyof MediaTags> = {
  TT2: 'trackTitle',
  TP1: 'artist',
  TP2: 'albumArtist',
  TAL: 'album',
  TCM: 'composer',
  TRK: 'track',
  TPA: 'disc',
  TCO: 'genre',
  COM: 'comment',
  TYE: 'year',
};

// UTF-16 text is terminated by a NUL *pair*, everything else by a single NUL.
// Getting this wrong is what makes a UTF-16 tag read as one character.
function isWideEncoding(encoding: number): boolean {
  return encoding === ENCODING_UTF16_BOM || encoding === ENCODING_UTF16_BE;
}

function decoderLabelFor(encoding: number): string {
  switch (encoding) {
    case ENCODING_UTF16_BOM:
      // The BOM decides byte order; TextDecoder consumes and honors it.
      return 'utf-16';
    case ENCODING_UTF16_BE:
      return 'utf-16be';
    case ENCODING_UTF8:
      return 'utf-8';
    case ENCODING_LATIN1:
    default:
      // An unknown encoding byte is treated as Latin-1, which never throws and
      // leaves ASCII — what almost every such frame actually holds — intact.
      return 'latin1';
  }
}

// Decode one text run, stopping at its terminator. A v2.4 frame may hold several
// NUL-separated values; the first is the one to show, because joining them would
// invent a credit the file never stated.
function decodeRun(encoding: number, payload: Uint8Array): string {
  let end = payload.length;
  if (isWideEncoding(encoding)) {
    for (let index = 0; index + 1 < payload.length; index += 2) {
      if (payload[index] === 0 && payload[index + 1] === 0) {
        end = index;
        break;
      }
    }
  } else {
    let terminator = payload.indexOf(0);
    if (terminator !== -1) {
      end = terminator;
    }
  }
  let run = payload.subarray(0, end);
  try {
    return new TextDecoder(decoderLabelFor(encoding), { fatal: false })
      .decode(run)
      .trim();
  } catch {
    return new TextDecoder('latin1').decode(run).trim();
  }
}

// A text frame is an encoding byte followed by the text itself.
function decodeText(bytes: Uint8Array): string {
  if (bytes.length < 2) {
    return '';
  }
  return decodeRun(bytes[0]!, bytes.subarray(1));
}

// A COMM frame is an encoding byte, a three-byte language code, a terminated
// short description, and then the comment. The description is stepped over in
// bytes rather than in decoded text, so the terminator width is unambiguous.
function decodeComment(bytes: Uint8Array): string {
  if (bytes.length < 5) {
    return '';
  }
  let encoding = bytes[0]!;
  let cursor = 4;
  if (isWideEncoding(encoding)) {
    while (
      cursor + 1 < bytes.length &&
      !(bytes[cursor] === 0 && bytes[cursor + 1] === 0)
    ) {
      cursor += 2;
    }
    cursor += 2;
  } else {
    while (cursor < bytes.length && bytes[cursor] !== 0) {
      cursor += 1;
    }
    cursor += 1;
  }
  if (cursor >= bytes.length) {
    return '';
  }
  return decodeRun(encoding, bytes.subarray(cursor));
}

// Sizes in the v2.4 frame header and in every version's tag header are
// "syncsafe": seven bits per byte, so the bytes can never look like a frame sync.
function syncsafeSize(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! & 0x7f) << 21) |
    ((bytes[offset + 1]! & 0x7f) << 14) |
    ((bytes[offset + 2]! & 0x7f) << 7) |
    (bytes[offset + 3]! & 0x7f)
  );
}

// Read the ID3v2 tag at the start of `bytes`. Returns undefined when there is
// none, which is ordinary for a stripped or freshly encoded file.
export function parseId3v2Tags(bytes: Uint8Array): MediaTags | undefined {
  if (bytes.byteLength < HEADER_BYTES) {
    return undefined;
  }
  if (!ID3_IDENTIFIER.every((expected, index) => bytes[index] === expected)) {
    return undefined;
  }
  let majorVersion = bytes[3]!;
  let flags = bytes[5]!;
  let tagSize = syncsafeSize(bytes, 6);
  let tagEnd = Math.min(HEADER_BYTES + tagSize, bytes.byteLength);

  let cursor = HEADER_BYTES;
  // An extended header, when present, sits between the tag header and the first
  // frame and declares its own size.
  if ((flags & 0x40) !== 0) {
    if (cursor + 4 > tagEnd) {
      return undefined;
    }
    let extendedSize =
      majorVersion >= 4
        ? syncsafeSize(bytes, cursor)
        : new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          ).getUint32(cursor) + 4;
    cursor += extendedSize;
  }

  let isV22 = majorVersion === 2;
  let idLength = isV22 ? 3 : 4;
  let headerLength = isV22 ? 6 : 10;
  let aliases = isV22 ? FRAME_ALIASES_V2 : FRAME_ALIASES;
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let collected: MediaTags = {};
  let years: string[] = [];
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    if (cursor + headerLength > tagEnd) {
      break;
    }
    // A run of zero bytes is the tag's padding, not another frame.
    if (bytes[cursor] === 0) {
      break;
    }
    let id = String.fromCharCode(...bytes.subarray(cursor, cursor + idLength));
    let frameSize: number;
    if (isV22) {
      frameSize =
        (bytes[cursor + 3]! << 16) |
        (bytes[cursor + 4]! << 8) |
        bytes[cursor + 5]!;
    } else if (majorVersion >= 4) {
      frameSize = syncsafeSize(bytes, cursor + 4);
    } else {
      // v2.3 frame sizes are plain big-endian, not syncsafe.
      frameSize = view.getUint32(cursor + 4);
    }
    let payloadStart = cursor + headerLength;
    if (frameSize <= 0 || payloadStart + frameSize > tagEnd) {
      break;
    }
    cursor = payloadStart + frameSize;

    let target = aliases[id];
    if (!target || frameSize > MAX_FRAME_BYTES) {
      continue;
    }
    let payload = bytes.subarray(payloadStart, payloadStart + frameSize);
    let value =
      id === 'COMM' || id === 'COM'
        ? decodeComment(payload)
        : decodeText(payload);
    if (!value) {
      continue;
    }
    if (target === 'year') {
      years.push(value);
      continue;
    }
    if (collected[target] === undefined) {
      (collected as Record<string, string>)[target] = value;
    }
  }

  for (let candidate of years) {
    let year = parseTagYear(candidate);
    if (year !== undefined) {
      collected.year = year;
      break;
    }
  }

  return prunedTags({ ...collected, scheme: 'id3v2' });
}
