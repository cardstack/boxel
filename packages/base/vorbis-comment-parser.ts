// Vorbis comments: the tagging convention FLAC and Ogg (Vorbis and Opus) share.
//
// The structure is a vendor string followed by a count and then that many
// `FIELD=value` entries, each length-prefixed with a 32-bit little-endian count.
// Field names are case-insensitive ASCII; values are UTF-8.
//
// Pure `DataView`/`TextDecoder`, no DOM — the same reason the rest of the
// `*-meta-extractor` modules are.

import { parseTagYear, prunedTags, type MediaTags } from './audio-metadata';

// A tag block with more entries than this is corrupt or hostile. Real files run
// to a few dozen; embedded artwork travels as a separate FLAC picture block or
// an Ogg `METADATA_BLOCK_PICTURE` entry, which this deliberately skips.
const MAX_COMMENT_ENTRIES = 512;

// One entry longer than this is not a descriptive tag. Caps the worst case when
// a length prefix is garbage, and skips base64 artwork rather than decoding it
// into a string nobody reads.
const MAX_ENTRY_BYTES = 16_384;

const UTF8 = new TextDecoder('utf-8', { fatal: false });

// The comment keys worth persisting, mapped onto the shared tag shape. Anything
// else in the block is left alone: a realm's files carry all sorts of
// application-specific keys, and hoovering them into fields nobody declared
// would bloat every index row.
const FIELD_ALIASES: Record<string, keyof MediaTags> = {
  TITLE: 'trackTitle',
  ARTIST: 'artist',
  ALBUM: 'album',
  ALBUMARTIST: 'albumArtist',
  'ALBUM ARTIST': 'albumArtist',
  COMPOSER: 'composer',
  DATE: 'year',
  YEAR: 'year',
  ORIGINALDATE: 'year',
  TRACKNUMBER: 'track',
  TRACK: 'track',
  DISCNUMBER: 'disc',
  DISC: 'disc',
  GENRE: 'genre',
  COMMENT: 'comment',
  DESCRIPTION: 'comment',
};

export interface VorbisComments {
  vendor?: string;
  tags?: MediaTags;
}

// Parse a Vorbis comment block starting at `offset`. Returns undefined when the
// block isn't readable — a truncated or absent tag block is ordinary, not an
// error, so nothing throws.
export function parseVorbisComments(
  bytes: Uint8Array,
  offset: number,
  // Where the block ends. FLAC knows this from its metadata block header; Ogg
  // passes the end of the packet.
  end: number = bytes.byteLength,
): VorbisComments | undefined {
  let limit = Math.min(end, bytes.byteLength);
  if (offset < 0 || offset + 8 > limit) {
    return undefined;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let vendorLength = view.getUint32(offset, true);
  let cursor = offset + 4;
  if (vendorLength > MAX_ENTRY_BYTES || cursor + vendorLength + 4 > limit) {
    return undefined;
  }
  let vendor = UTF8.decode(
    bytes.subarray(cursor, cursor + vendorLength),
  ).trim();
  cursor += vendorLength;

  let entryCount = view.getUint32(cursor, true);
  cursor += 4;
  if (entryCount > MAX_COMMENT_ENTRIES) {
    return undefined;
  }

  let collected: MediaTags = {};
  let years: string[] = [];
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 4 > limit) {
      break;
    }
    let entryLength = view.getUint32(cursor, true);
    cursor += 4;
    if (entryLength > MAX_ENTRY_BYTES) {
      // Almost certainly embedded artwork or a corrupt length. Skipping the
      // payload keeps the walk in sync when the length is merely large.
      cursor += entryLength;
      continue;
    }
    if (cursor + entryLength > limit) {
      break;
    }
    let entry = UTF8.decode(bytes.subarray(cursor, cursor + entryLength));
    cursor += entryLength;

    let separator = entry.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    let key = entry.slice(0, separator).trim().toUpperCase();
    let value = entry.slice(separator + 1).trim();
    if (!value) {
      continue;
    }
    let target = FIELD_ALIASES[key];
    if (!target) {
      continue;
    }
    if (target === 'year') {
      years.push(value);
      continue;
    }
    // First occurrence wins. Vorbis permits repeated keys for genuinely
    // multi-valued fields (two ARTISTs on a collaboration), and joining them
    // into one string would invent a credit the file didn't state.
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

  let tags = prunedTags({ ...collected, scheme: 'vorbis-comment' });
  return vendor || tags
    ? { ...(vendor ? { vendor } : {}), ...(tags ? { tags } : {}) }
    : undefined;
}
