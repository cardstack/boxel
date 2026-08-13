import {
  channelModeForCount,
  parseTagYear,
  prunedEncoding,
  prunedTags,
  type AudioEncoding,
  type MediaTags,
} from './audio-metadata';
import { FileContentMismatchError } from './file-api';
import {
  BOX_HEADER_BYTES,
  ChunkReader,
  FTYP,
  LARGE_SIZE_BYTES,
  MOOV,
  MVHD,
  descend,
  findChildBox,
  findMoov,
  matchType,
  parseMvhd,
  readBoxAt,
  typeAt,
  type BoxLocation,
} from './iso-bmff';

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
    throw new FileContentMismatchError('MP4 file does not contain a moov box');
  }
  return durationFromMoov(bytes, view, moov);
}

// Given a located `moov` box, find its `mvhd` child and convert the
// timescale/duration pair into seconds. Shared by the whole-buffer
// (`extractM4aDuration`) and streaming (`extractM4aDurationFromStream`) entry
// points so both agree on the parse.
function durationFromMoov(
  bytes: Uint8Array,
  view: DataView,
  moov: BoxLocation,
): { duration: number } {
  let mvhd = findChildBox(
    bytes,
    view,
    moov.payloadOffset,
    moov.payloadEnd,
    MVHD,
  );
  if (!mvhd) {
    throw new FileContentMismatchError('MP4 file does not contain a mvhd box');
  }

  let { timescale, duration } = parseMvhd(bytes, view, mvhd);
  if (timescale === 0) {
    throw new FileContentMismatchError('MP4 mvhd reports a zero timescale');
  }
  return { duration: duration / timescale };
}

// Parse duration from a standalone `moov` box (its own bytes, header at offset
// 0) reassembled by the streaming walk.
function durationFromMoovBox(moovBytes: Uint8Array): { duration: number } {
  let view = new DataView(
    moovBytes.buffer,
    moovBytes.byteOffset,
    moovBytes.byteLength,
  );
  let moov = readBoxAt(moovBytes, view, 0, moovBytes.length);
  if (!moov || moov.type !== 'moov') {
    throw new FileContentMismatchError('MP4 moov box is malformed');
  }
  return durationFromMoov(moovBytes, view, moov);
}

// Streaming counterpart to `extractM4aDuration`. Walks top-level boxes off the
// stream, retaining only the `moov` box and discarding everything else (most
// importantly the `mdat` media payload), so peak memory is ~`moov` rather than
// the whole file. A `Uint8Array` input (already-buffered bytes) is parsed
// directly. Works for both fast-start files (`moov` near the start, where the
// walk stops early) and iPhone / Voice Memo files (`moov` at the end, where
// the preceding `mdat` is skipped chunk by chunk).
// Returns the retained `moov` box alongside the duration. It is the only part of
// the file the metadata readers need — `extractM4aEncoding` and
// `extractM4aTags` scan for `moov` from offset zero, and a lone moov box is one
// at offset zero — so one walk serves all three and the def needs no second
// stream, which the extract runner would satisfy by re-fetching the whole file.
export async function extractM4aDurationFromStream(
  stream: ReadableStream<Uint8Array> | Uint8Array,
): Promise<{ duration: number; moov: Uint8Array }> {
  if (stream instanceof Uint8Array) {
    return { ...extractM4aDuration(stream), moov: stream };
  }

  let reader = new ChunkReader(stream);
  try {
    let isFirstBox = true;
    for (;;) {
      let header = await reader.readExact(BOX_HEADER_BYTES);
      if (!header) {
        // Clean EOF on a box boundary with no `moov` seen.
        break;
      }
      let headerView = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      );
      let size = headerView.getUint32(0);
      let type = typeAt(header, 4);
      let headerSize = BOX_HEADER_BYTES;
      let largeSize: Uint8Array | undefined;

      if (size === 1) {
        // 64-bit extended size lives in the next 8 bytes.
        let ext = await reader.readExact(LARGE_SIZE_BYTES);
        if (!ext) {
          throw new FileContentMismatchError(
            `MP4 ${type} box declares a 64-bit size but is truncated`,
          );
        }
        largeSize = ext;
        let largeView = new DataView(
          ext.buffer,
          ext.byteOffset,
          ext.byteLength,
        );
        let hi = largeView.getUint32(0);
        let lo = largeView.getUint32(4);
        size = hi * 0x1_0000_0000 + lo;
        headerSize = BOX_HEADER_BYTES + LARGE_SIZE_BYTES;
      }

      if (size !== 0 && size < headerSize) {
        throw new FileContentMismatchError(
          `MP4 ${type} box declares an impossible size`,
        );
      }

      if (isFirstBox) {
        // Match extractM4aDuration: a real MP4/M4A starts with `ftyp`, so a
        // mismatch can fall back to a less specific FileDef gracefully.
        if (type !== 'ftyp') {
          throw new FileContentMismatchError(
            'MP4 file does not start with an ftyp box',
          );
        }
        isFirstBox = false;
      }

      if (type === 'moov') {
        // Reassemble the box bytes (header + payload) so the offset-based
        // parser can run against it directly.
        let payload =
          size === 0
            ? await reader.readRemaining()
            : await reader.readExact(size - headerSize);
        if (!payload) {
          throw new FileContentMismatchError('MP4 moov box is truncated');
        }
        let moovBytes = new Uint8Array(headerSize + payload.length);
        moovBytes.set(header, 0);
        if (largeSize) {
          moovBytes.set(largeSize, BOX_HEADER_BYTES);
        }
        moovBytes.set(payload, headerSize);
        return { ...durationFromMoovBox(moovBytes), moov: moovBytes };
      }

      if (size === 0) {
        // A non-`moov` box that runs to end of file means no `moov` follows.
        break;
      }
      if (!(await reader.skip(size - headerSize))) {
        // Truncated mid-box: no `moov`.
        break;
      }
    }
    throw new FileContentMismatchError('MP4 file does not contain a moov box');
  } finally {
    await reader.cancel();
  }
}

// Codec identity comes from the sample-entry box type itself: `mp4a` for
// AAC/ALAC-in-MP4, `alac` for Apple Lossless. Only the ones an .m4a realistically
// carries are named; anything else leaves the codec unset.
const SAMPLE_ENTRY_CODECS: Record<string, string> = {
  mp4a: 'AAC',
  alac: 'ALAC (Apple Lossless)',
};

// The audio sample entry inside stsd states channel count, sample size, and
// sample rate. Layout after the box header: 6 reserved, 2 data reference index,
// 8 reserved, 2 channel count, 2 sample size, 2 pre-defined, 2 reserved, then
// the sample rate as a 16.16 fixed-point value.
const SAMPLE_ENTRY_CHANNELS_OFFSET = 16;
const SAMPLE_ENTRY_SAMPLE_SIZE_OFFSET = 18;
const SAMPLE_ENTRY_SAMPLE_RATE_OFFSET = 24;

export function extractM4aEncoding(
  bytes: Uint8Array,
): AudioEncoding | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let moov = findMoov(bytes, view);
  if (!moov) {
    return undefined;
  }
  let stsd = descend(bytes, view, moov.payloadOffset, moov.payloadEnd, [
    'trak',
    'mdia',
    'minf',
    'stbl',
    'stsd',
  ]);
  if (!stsd) {
    return undefined;
  }
  // stsd is a full box: 4 bytes version/flags, then a 4-byte entry count before
  // the sample entries themselves.
  let entryStart = stsd.payloadOffset + 8;
  let entry: { type: string; payloadOffset: number } | undefined;
  try {
    let box = readBoxAt(bytes, view, entryStart, stsd.payloadEnd);
    if (box) {
      entry = { type: box.type, payloadOffset: box.payloadOffset };
    }
  } catch {
    return undefined;
  }
  if (!entry) {
    return undefined;
  }
  let base = entry.payloadOffset;
  if (base + SAMPLE_ENTRY_SAMPLE_RATE_OFFSET + 4 > bytes.length) {
    return undefined;
  }
  let channels = view.getUint16(base + SAMPLE_ENTRY_CHANNELS_OFFSET);
  let sampleSize = view.getUint16(base + SAMPLE_ENTRY_SAMPLE_SIZE_OFFSET);
  // 16.16 fixed point: the integer part is the upper 16 bits.
  let sampleRate = view.getUint16(base + SAMPLE_ENTRY_SAMPLE_RATE_OFFSET);
  let isLossless = entry.type === 'alac';

  return prunedEncoding({
    container: 'MP4',
    audioCodec: SAMPLE_ENTRY_CODECS[entry.type],
    sampleRateHz: sampleRate > 0 ? sampleRate : undefined,
    isVariableBitrate: true,
    // A lossy AAC stream has no stored sample width; the field is present in the
    // box but describes nothing, so only report it for lossless.
    bitDepth: isLossless && sampleSize > 0 ? sampleSize : undefined,
    channels: channels > 0 ? channels : undefined,
    channelMode: channelModeForCount(channels > 0 ? channels : undefined),
  });
}

// iTunes-style metadata atoms, mapped onto the shared tag shape. The leading
// byte of the four-character name is the © sign (0xa9) for the standard set.
const ATOM_ALIASES: Record<string, keyof MediaTags> = {
  '\u00a9nam': 'trackTitle',
  '\u00a9ART': 'artist',
  '\u00a9alb': 'album',
  aART: 'albumArtist',
  '\u00a9wrt': 'composer',
  '\u00a9day': 'year',
  '\u00a9gen': 'genre',
  '\u00a9cmt': 'comment',
  trkn: 'track',
  disk: 'disc',
};

// The `data` box's type indicator: 1 means UTF-8 text, 0 means binary, and the
// integer types are used by trkn/disk.
const DATA_TYPE_UTF8 = 1;

const MAX_ATOM_BYTES = 8192;

export function extractM4aTags(bytes: Uint8Array): MediaTags | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let moov = findMoov(bytes, view);
  if (!moov) {
    return undefined;
  }
  let meta = descend(bytes, view, moov.payloadOffset, moov.payloadEnd, [
    'udta',
    'meta',
  ]);
  if (!meta) {
    return undefined;
  }
  // `meta` is a full box: skip its 4 bytes of version/flags before its children.
  let ilst = descend(bytes, view, meta.payloadOffset + 4, meta.payloadEnd, [
    'ilst',
  ]);
  if (!ilst) {
    return undefined;
  }

  let utf8 = new TextDecoder('utf-8', { fatal: false });
  let collected: MediaTags = {};
  let yearText: string | undefined;
  let cursor = ilst.payloadOffset;

  while (cursor < ilst.payloadEnd) {
    let atom: ReturnType<typeof readBoxAt>;
    try {
      atom = readBoxAt(bytes, view, cursor, ilst.payloadEnd);
    } catch {
      break;
    }
    if (!atom) {
      break;
    }
    let name = typeAt(bytes, cursor + 4);
    let target = ATOM_ALIASES[name];
    if (target && atom.payloadEnd - atom.payloadOffset <= MAX_ATOM_BYTES) {
      let data = descend(bytes, view, atom.payloadOffset, atom.payloadEnd, [
        'data',
      ]);
      if (data && data.payloadOffset + 8 <= data.payloadEnd) {
        // A data box holds 1 byte reserved + 3 bytes type indicator, then 4
        // bytes of locale, before the value.
        let typeIndicator = view.getUint32(data.payloadOffset) & 0x00ffffff;
        let valueStart = data.payloadOffset + 8;
        if (target === 'track' || target === 'disc') {
          // trkn/disk are pairs of integers: a leading padding short, the
          // number, then the total. Rendered as "n/total" to match how every
          // other convention states it.
          if (valueStart + 6 <= data.payloadEnd) {
            let number = view.getUint16(valueStart + 2);
            let total = view.getUint16(valueStart + 4);
            if (number > 0 && collected[target] === undefined) {
              collected[target] =
                total > 0 ? `${number}/${total}` : `${number}`;
            }
          }
        } else if (typeIndicator === DATA_TYPE_UTF8) {
          let value = utf8
            .decode(bytes.subarray(valueStart, data.payloadEnd))
            .trim();
          if (value) {
            if (target === 'year') {
              yearText ??= value;
            } else if (collected[target] === undefined) {
              (collected as Record<string, string>)[target] = value;
            }
          }
        }
      }
    }
    cursor = atom.nextBoxOffset;
  }

  let year = parseTagYear(yearText);
  return prunedTags({
    ...collected,
    ...(year === undefined ? {} : { year }),
    scheme: 'mp4-atoms',
  });
}
