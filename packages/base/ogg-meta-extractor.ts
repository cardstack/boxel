import { FileContentMismatchError } from './file-api';

// Ogg page capture pattern: "OggS"
const OGGS = [0x4f, 0x67, 0x67, 0x53];

// Ogg page header fixed bytes before the segment table
const OGG_PAGE_HEADER_BYTES = 27;

// Granule position field offset inside an Ogg page header
const GRANULE_POSITION_OFFSET = 6;

// Codec identification magics on the first page's data packet
const VORBIS_ID_MAGIC = [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]; // "\x01vorbis"
const OPUS_ID_MAGIC = [
  0x4f,
  0x70,
  0x75,
  0x73,
  0x48,
  0x65,
  0x61,
  0x64, // "OpusHead"
];

// Opus always outputs at 48 kHz, regardless of the encoder input sample rate
const OPUS_OUTPUT_SAMPLE_RATE = 48000;

function matchBytes(
  bytes: Uint8Array,
  offset: number,
  target: readonly number[],
): boolean {
  if (offset + target.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < target.length; i++) {
    if (bytes[offset + i] !== target[i]) {
      return false;
    }
  }
  return true;
}

function readUint64LEAsNumber(view: DataView, offset: number): number {
  let low = view.getUint32(offset, true);
  let high = view.getUint32(offset + 4, true);
  // Granule positions for any plausible audio length fit in a JS number.
  return high * 0x1_0000_0000 + low;
}

function findLastOggSPage(bytes: Uint8Array): number | undefined {
  // Scan backwards from the tail; the final page is at most ~64 KB from EOF
  // in any realistic file, but we scan as far as needed.
  for (let i = bytes.length - 4; i >= 0; i--) {
    if (
      bytes[i] === OGGS[0] &&
      bytes[i + 1] === OGGS[1] &&
      bytes[i + 2] === OGGS[2] &&
      bytes[i + 3] === OGGS[3]
    ) {
      return i;
    }
  }
  return undefined;
}

function firstPageDataOffset(bytes: Uint8Array): number {
  // Header is 27 bytes + page_segments lacing values
  if (bytes.length < OGG_PAGE_HEADER_BYTES) {
    throw new FileContentMismatchError(
      'OGG file is truncated before the first page header',
    );
  }
  let pageSegments = bytes[26]!;
  let dataOffset = OGG_PAGE_HEADER_BYTES + pageSegments;
  if (dataOffset > bytes.length) {
    throw new FileContentMismatchError(
      'OGG file is truncated within the first page segment table',
    );
  }
  return dataOffset;
}

interface CodecInfo {
  outputSampleRate: number;
  preSkipSamples: number;
}

function readCodecInfo(bytes: Uint8Array, dataOffset: number): CodecInfo {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (matchBytes(bytes, dataOffset, VORBIS_ID_MAGIC)) {
    // Vorbis identification header:
    //   7 bytes magic, 4 bytes version, 1 byte channels, 4 bytes sample rate
    let sampleRateOffset = dataOffset + 12;
    if (sampleRateOffset + 4 > bytes.length) {
      throw new FileContentMismatchError(
        'OGG Vorbis identification header is truncated',
      );
    }
    let sampleRate = view.getUint32(sampleRateOffset, true);
    if (sampleRate === 0) {
      throw new FileContentMismatchError(
        'OGG Vorbis identification header reports a zero sample rate',
      );
    }
    return { outputSampleRate: sampleRate, preSkipSamples: 0 };
  }

  if (matchBytes(bytes, dataOffset, OPUS_ID_MAGIC)) {
    // Opus identification header:
    //   8 bytes magic, 1 byte version, 1 byte channel count,
    //   2 bytes pre-skip (LE)
    let preSkipOffset = dataOffset + 10;
    if (preSkipOffset + 2 > bytes.length) {
      throw new FileContentMismatchError(
        'OGG Opus identification header is truncated',
      );
    }
    let preSkip = view.getUint16(preSkipOffset, true);
    return {
      outputSampleRate: OPUS_OUTPUT_SAMPLE_RATE,
      preSkipSamples: preSkip,
    };
  }

  throw new FileContentMismatchError(
    'OGG file contains an unsupported codec (expected Vorbis or Opus)',
  );
}

export function extractOggDuration(bytes: Uint8Array): { duration: number } {
  if (!matchBytes(bytes, 0, OGGS)) {
    throw new FileContentMismatchError(
      'File does not start with an Ogg "OggS" page',
    );
  }

  let dataOffset = firstPageDataOffset(bytes);
  let { outputSampleRate, preSkipSamples } = readCodecInfo(bytes, dataOffset);

  let lastPageOffset = findLastOggSPage(bytes);
  if (lastPageOffset === undefined) {
    throw new FileContentMismatchError(
      'OGG file does not contain a parseable page header',
    );
  }
  if (lastPageOffset + GRANULE_POSITION_OFFSET + 8 > bytes.length) {
    throw new FileContentMismatchError(
      'OGG file final page header is truncated',
    );
  }

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let granule = readUint64LEAsNumber(
    view,
    lastPageOffset + GRANULE_POSITION_OFFSET,
  );

  // Per Opus/Vorbis spec, pre-skip samples are not part of the playable
  // duration. For Vorbis this is 0.
  let playable = Math.max(0, granule - preSkipSamples);
  return { duration: playable / outputSampleRate };
}

// Enough of the file's start to cover the first page header (27 bytes + up to
// 255 lacing values) plus the Vorbis/Opus identification packet that follows.
const OGG_HEAD_BYTES = 4096;

// The final page's "OggS" sits at most one max-size Ogg page (27 + 255 +
// 255*255 = 65307 bytes) before EOF in a well-formed stream. A tail window at
// least that large always contains the last page header and its granule
// position. Files with more than this much trailing data after the last Ogg
// page (non-standard) fall back to the buffered AudioDef path with no
// duration, rather than being mis-parsed.
const OGG_TAIL_BYTES = 65536;

function concatParts(parts: Uint8Array[], length: number): Uint8Array {
  if (parts.length === 1) {
    return parts[0]!;
  }
  let out = new Uint8Array(length);
  let offset = 0;
  for (let part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Streaming counterpart to `extractOggDuration`. The duration only needs the
// first page (codec id / sample rate) and the final page (granule position) —
// the head and tail of the file. We retain a small head buffer and a rolling
// tail window, letting the audio payload in between stream past without being
// buffered, so peak memory is ~`OGG_TAIL_BYTES` rather than the whole file. A
// `Uint8Array` input (already-buffered bytes) is parsed directly.
export async function extractOggDurationFromStream(
  stream: ReadableStream<Uint8Array> | Uint8Array,
): Promise<{ duration: number }> {
  if (stream instanceof Uint8Array) {
    return extractOggDuration(stream);
  }

  let reader = stream.getReader();
  let headParts: Uint8Array[] = [];
  let headLen = 0;
  let tailParts: Uint8Array[] = [];
  let tailLen = 0;
  try {
    for (;;) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      // Accumulate the head until we have enough to parse the first page.
      // Cap what we keep at OGG_HEAD_BYTES and copy it (slice, not subarray)
      // so a large first chunk isn't pinned in memory by the head view.
      if (headLen < OGG_HEAD_BYTES) {
        let take = Math.min(value.length, OGG_HEAD_BYTES - headLen);
        headParts.push(value.slice(0, take));
        headLen += take;
      }
      // Maintain a rolling window of the last OGG_TAIL_BYTES bytes. Keeping
      // memory bounded by the window rather than the chunking requires handling
      // a single oversized chunk explicitly: copy just its tail and drop the
      // rest (a subarray would pin the whole chunk's buffer). Smaller chunks
      // accumulate, dropping whole front chunks once the remainder still covers
      // the window — so the tail stays under 2 * OGG_TAIL_BYTES.
      if (value.length >= OGG_TAIL_BYTES) {
        tailParts = [value.slice(value.length - OGG_TAIL_BYTES)];
        tailLen = OGG_TAIL_BYTES;
      } else {
        tailParts.push(value);
        tailLen += value.length;
        while (
          tailParts.length > 1 &&
          tailLen - tailParts[0]!.length >= OGG_TAIL_BYTES
        ) {
          tailLen -= tailParts[0]!.length;
          tailParts.shift();
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      // Reader already drained to EOF (or released); cancelling is a no-op.
    });
  }

  let head = concatParts(headParts, headLen);
  let tail = concatParts(tailParts, tailLen);

  if (!matchBytes(head, 0, OGGS)) {
    throw new FileContentMismatchError(
      'File does not start with an Ogg "OggS" page',
    );
  }

  let dataOffset = firstPageDataOffset(head);
  let { outputSampleRate, preSkipSamples } = readCodecInfo(head, dataOffset);

  // The last "OggS" in the whole file is at or after the final page's start,
  // which lies within the retained tail window — so scanning the window
  // backward yields the same page the buffered parser would find.
  let lastPageOffset = findLastOggSPage(tail);
  if (lastPageOffset === undefined) {
    throw new FileContentMismatchError(
      'OGG file does not contain a parseable page header',
    );
  }
  if (lastPageOffset + GRANULE_POSITION_OFFSET + 8 > tail.length) {
    throw new FileContentMismatchError(
      'OGG file final page header is truncated',
    );
  }

  let view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let granule = readUint64LEAsNumber(
    view,
    lastPageOffset + GRANULE_POSITION_OFFSET,
  );

  let playable = Math.max(0, granule - preSkipSamples);
  return { duration: playable / outputSampleRate };
}
