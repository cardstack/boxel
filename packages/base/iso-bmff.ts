// ISO Base Media File Format primitives.
//
// MP4, MOV, and M4A are the same container with different payloads, so the box
// walking is identical for all three — only the boxes each cares about differ.
// This module holds the shared mechanics; `m4a-meta-extractor` reads audio
// sample entries out of them and `mp4-meta-extractor` reads video tracks.
//
// Pure `DataView`/`TextDecoder` apart from the stream reader, which is the piece
// that lets a container be walked without holding it in memory.

import { FileContentMismatchError } from './file-api';

// ISO BMFF box header: 4 bytes size + 4 bytes type. Special sizes:
//   size == 0  → box extends to end of file
//   size == 1  → next 8 bytes are the real (64-bit) size
export const BOX_HEADER_BYTES = 8;
export const LARGE_SIZE_BYTES = 8;

export const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"
export const MOOV = [0x6d, 0x6f, 0x6f, 0x76]; // "moov"
export const MVHD = [0x6d, 0x76, 0x68, 0x64]; // "mvhd"

export interface BoxLocation {
  type: string;
  payloadOffset: number;
  payloadEnd: number;
  nextBoxOffset: number;
}

export function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

export function matchType(
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

export function readBoxAt(
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

export function findChildBox(
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

export function parseMvhd(
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

// Pull reader over a byte stream: lets the box walk read exact-length headers
// and reassemble the small `moov` box while skipping (discarding) the large
// `mdat` payload, so a long recording never has to be buffered whole.
export class ChunkReader {
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

// Follow a path of box types down from a container, e.g. moov → trak → mdia.
// Returns undefined rather than throwing when any step is missing or the tree
// is malformed: absent metadata is ordinary, and each format's container
// assertion is what decides whether a file is really ISO BMFF.
export function descend(
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

export function findMoov(
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
