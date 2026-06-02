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
  0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
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

function readUint64LEAsNumber(
  view: DataView,
  offset: number,
): number {
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
