import {
  channelModeForCount,
  parseTagYear,
  prunedEncoding,
  prunedTags,
  type AudioEncoding,
  type MediaTags,
} from './audio-metadata';
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
      throw new FileContentMismatchError('MP4 mvhd (v0) box is truncated');
    }
    let timescale = view.getUint32(cursor + 8);
    let duration = view.getUint32(cursor + 12);
    return { timescale, duration };
  }

  if (version === 1) {
    // creation(8) + modification(8) + timescale(4) + duration(8)
    if (cursor + 28 > mvhd.payloadEnd) {
      throw new FileContentMismatchError('MP4 mvhd (v1) box is truncated');
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

// Pull reader over a byte stream: lets the box walk read exact-length headers
// and reassemble the small `moov` box while skipping (discarding) the large
// `mdat` payload, so a long recording never has to be buffered whole.
class ChunkReader {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #queue: Uint8Array[] = [];
  #queued = 0;
  #done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.#reader = stream.getReader();
  }

  // Pull one more chunk into the queue. Returns false at end of stream.
  async #pull(): Promise<boolean> {
    if (this.#done) {
      return false;
    }
    let { done, value } = await this.#reader.read();
    if (done) {
      this.#done = true;
      return false;
    }
    if (value && value.length) {
      this.#queue.push(value);
      this.#queued += value.length;
    }
    return true;
  }

  // Read exactly `n` bytes as a contiguous array, or null if the stream ends
  // before `n` bytes are available.
  async readExact(n: number): Promise<Uint8Array | null> {
    while (this.#queued < n) {
      if (!(await this.#pull())) {
        return null;
      }
    }
    return this.#take(n);
  }

  // Discard exactly `n` bytes without retaining them. Returns false if the
  // stream ends first.
  async skip(n: number): Promise<boolean> {
    while (n > 0) {
      if (this.#queued === 0 && !(await this.#pull())) {
        return false;
      }
      let head = this.#queue[0]!;
      if (head.length <= n) {
        this.#queue.shift();
        this.#queued -= head.length;
        n -= head.length;
      } else {
        this.#queue[0] = head.subarray(n);
        this.#queued -= n;
        n = 0;
      }
    }
    return true;
  }

  // Read whatever bytes remain in the stream (used for a `moov` box whose size
  // field says "extends to end of file").
  async readRemaining(): Promise<Uint8Array> {
    while (await this.#pull()) {
      // keep buffering
    }
    return this.#take(this.#queued);
  }

  #take(n: number): Uint8Array {
    let out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      let head = this.#queue[0]!;
      let need = n - off;
      if (head.length <= need) {
        out.set(head, off);
        off += head.length;
        this.#queue.shift();
        this.#queued -= head.length;
      } else {
        out.set(head.subarray(0, need), off);
        off += need;
        this.#queue[0] = head.subarray(need);
        this.#queued -= need;
      }
    }
    return out;
  }

  async cancel(): Promise<void> {
    try {
      await this.#reader.cancel();
    } catch {
      // A consumer that already finished reading may have released the lock;
      // cancelling then is a harmless no-op.
    }
  }
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
export async function extractM4aDurationFromStream(
  stream: ReadableStream<Uint8Array> | Uint8Array,
): Promise<{ duration: number }> {
  if (stream instanceof Uint8Array) {
    return extractM4aDuration(stream);
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
        return durationFromMoovBox(moovBytes);
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

// Follow a path of box types down from a container, e.g. moov → trak → mdia.
// Returns undefined rather than throwing when any step is missing or the tree is
// malformed: absent metadata is ordinary, and the duration reader is what decides
// whether a file is really MP4.
function descend(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  path: string[],
): { payloadOffset: number; payloadEnd: number } | undefined {
  let cursorStart = start;
  let cursorEnd = end;
  for (let type of path) {
    let target = [...type].map((c) => c.charCodeAt(0));
    let found: { payloadOffset: number; payloadEnd: number } | undefined;
    try {
      found = findChildBox(bytes, view, cursorStart, cursorEnd, target);
    } catch {
      return undefined;
    }
    if (!found) {
      return undefined;
    }
    cursorStart = found.payloadOffset;
    cursorEnd = found.payloadEnd;
  }
  return { payloadOffset: cursorStart, payloadEnd: cursorEnd };
}

function findMoov(
  bytes: Uint8Array,
  view: DataView,
): { payloadOffset: number; payloadEnd: number } | undefined {
  try {
    return findChildBox(bytes, view, 0, bytes.length, MOOV);
  } catch {
    return undefined;
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
