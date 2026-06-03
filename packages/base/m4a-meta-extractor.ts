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
    throw new FileContentMismatchError(
      'MP4 file does not contain a moov box',
    );
  } finally {
    await reader.cancel();
  }
}
