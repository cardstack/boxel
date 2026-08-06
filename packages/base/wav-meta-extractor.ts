import {
  channelModeForCount,
  parseTagYear,
  prunedEncoding,
  prunedTags,
  type AudioEncoding,
  type MediaTags,
} from './audio-metadata';
import { FileContentMismatchError } from './file-api';

// RIFF/WAVE 4-byte ASCII tags
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WAVE = [0x57, 0x41, 0x56, 0x45]; // "WAVE"
const FMT = [0x66, 0x6d, 0x74, 0x20]; // "fmt "
const DATA = [0x64, 0x61, 0x74, 0x61]; // "data"
const INFO = [0x49, 0x4e, 0x46, 0x4f]; // "INFO"

// RIFF (4) + size (4) + WAVE (4)
const RIFF_HEADER_BYTES = 12;

// fmt chunk layout (within chunk data):
//   2 bytes formatCode, 2 bytes numChannels,
//   4 bytes sampleRate, 4 bytes byteRate <-- the one we want
const BYTE_RATE_OFFSET_WITHIN_FMT = 8;

// Each chunk header: 4 bytes id + 4 bytes size
const CHUNK_HEADER_BYTES = 8;

function matchTag(
  bytes: Uint8Array,
  offset: number,
  tag: readonly number[],
): boolean {
  if (offset + tag.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < tag.length; i++) {
    if (bytes[offset + i] !== tag[i]) {
      return false;
    }
  }
  return true;
}

function validateWavSignature(bytes: Uint8Array): void {
  if (bytes.length < RIFF_HEADER_BYTES) {
    throw new FileContentMismatchError(
      'File is too small to be a valid WAV file',
    );
  }
  if (!matchTag(bytes, 0, RIFF)) {
    throw new FileContentMismatchError(
      'File does not start with a RIFF header',
    );
  }
  if (!matchTag(bytes, 8, WAVE)) {
    throw new FileContentMismatchError('File is not a WAVE RIFF container');
  }
}

export function extractWavDuration(bytes: Uint8Array): { duration: number } {
  validateWavSignature(bytes);

  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate: number | undefined;
  let dataSize: number | undefined;

  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    // Chunk size is little-endian and excludes the 8-byte chunk header.
    let chunkSize = view.getUint32(offset + 4, true);

    if (matchTag(bytes, offset, FMT)) {
      let byteRateOffset =
        offset + CHUNK_HEADER_BYTES + BYTE_RATE_OFFSET_WITHIN_FMT;
      if (byteRateOffset + 4 > bytes.length) {
        throw new FileContentMismatchError('WAV fmt chunk is truncated');
      }
      byteRate = view.getUint32(byteRateOffset, true);
    } else if (matchTag(bytes, offset, DATA)) {
      dataSize = chunkSize;
      // A valid WAVE places `fmt ` before `data`, so once we see `data` we
      // already have everything we need.
      break;
    }

    // RIFF chunks are word-aligned: an odd-sized chunk has a 1-byte pad.
    let advance = CHUNK_HEADER_BYTES + chunkSize + (chunkSize & 1);
    if (advance <= CHUNK_HEADER_BYTES) {
      // Malformed (size makes us not advance) — bail rather than loop.
      throw new FileContentMismatchError('WAV file contains a malformed chunk');
    }
    offset += advance;
  }

  if (byteRate === undefined || byteRate === 0) {
    throw new FileContentMismatchError(
      'WAV file is missing a fmt chunk with a non-zero byteRate',
    );
  }
  if (dataSize === undefined) {
    throw new FileContentMismatchError('WAV file is missing a data chunk');
  }

  return { duration: dataSize / byteRate };
}

// WAV format codes. Only the ones that describe how samples are stored matter
// here; an unrecognized code leaves the codec unnamed rather than guessed at.
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_MULAW = 0x0007;
// An "extensible" fmt chunk defers the real format to a GUID in its extension,
// but keeps the sample layout in the same place, so the layout still reads.
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

const WAVE_CODECS: Record<number, string> = {
  [WAVE_FORMAT_PCM]: 'PCM',
  [WAVE_FORMAT_IEEE_FLOAT]: 'IEEE float',
  [WAVE_FORMAT_ALAW]: 'A-law',
  [WAVE_FORMAT_MULAW]: 'μ-law',
  [WAVE_FORMAT_EXTENSIBLE]: 'PCM (extensible)',
};

// LIST-INFO chunk ids, mapped onto the shared tag shape.
const INFO_ALIASES: Record<string, keyof MediaTags> = {
  INAM: 'trackTitle',
  IART: 'artist',
  IPRD: 'album',
  IMUS: 'composer',
  ICRD: 'year',
  ITRK: 'track',
  IPRT: 'track',
  IGNR: 'genre',
  ICMT: 'comment',
};

// A LIST-INFO entry longer than this is not a descriptive tag.
const MAX_INFO_ENTRY_BYTES = 8192;

// Walk the top-level RIFF chunks, handing each to `visit`. Shared by the readers
// below so the word-alignment and malformed-size rules live in one place.
//
// Unlike the duration reader this never throws: a chunk walk that desynchronizes
// partway through has still yielded whatever it saw, and absent metadata is
// ordinary.
function walkRiffChunks(
  bytes: Uint8Array,
  visit: (id: string, dataStart: number, dataSize: number) => void,
): void {
  if (bytes.length < RIFF_HEADER_BYTES) {
    return;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    let chunkSize = view.getUint32(offset + 4, true);
    let id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    visit(id, offset + CHUNK_HEADER_BYTES, chunkSize);
    // RIFF chunks are word-aligned: an odd-sized chunk carries a 1-byte pad.
    let advance = CHUNK_HEADER_BYTES + chunkSize + (chunkSize & 1);
    if (advance <= CHUNK_HEADER_BYTES) {
      return;
    }
    offset += advance;
  }
}

// The `fmt ` chunk states the sample layout outright, so WAV is the one audio
// format where every encoding fact is directly declared rather than derived.
export function extractWavEncoding(
  bytes: Uint8Array,
): AudioEncoding | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let encoding: AudioEncoding | undefined;
  walkRiffChunks(bytes, (id, dataStart, dataSize) => {
    if (id !== 'fmt ' || encoding || dataSize < 16) {
      return;
    }
    if (dataStart + 16 > bytes.length) {
      return;
    }
    let formatCode = view.getUint16(dataStart, true);
    let channels = view.getUint16(dataStart + 2, true);
    let sampleRate = view.getUint32(dataStart + 4, true);
    let byteRate = view.getUint32(dataStart + 8, true);
    let bitsPerSample = view.getUint16(dataStart + 14, true);
    encoding = prunedEncoding({
      container: 'WAV',
      audioCodec: WAVE_CODECS[formatCode],
      sampleRateHz: sampleRate > 0 ? sampleRate : undefined,
      // PCM is constant-rate by definition, so the byte rate is the whole
      // stream's bitrate rather than one frame's.
      bitrateBps: byteRate > 0 ? byteRate * 8 : undefined,
      isVariableBitrate: byteRate > 0 ? false : undefined,
      bitDepth: bitsPerSample > 0 ? bitsPerSample : undefined,
      channels: channels > 0 ? channels : undefined,
      channelMode: channelModeForCount(channels > 0 ? channels : undefined),
    });
  });
  return encoding;
}

// WAV's optional LIST-INFO chunk. Each entry is a 4-character id, a
// little-endian size, and NUL-padded Latin-1 text.
export function extractWavTags(bytes: Uint8Array): MediaTags | undefined {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let latin1 = new TextDecoder('latin1');
  let collected: MediaTags = {};
  let yearText: string | undefined;

  walkRiffChunks(bytes, (id, dataStart, dataSize) => {
    if (id !== 'LIST' || dataSize < 4) {
      return;
    }
    let listEnd = Math.min(dataStart + dataSize, bytes.length);
    if (
      !INFO.every((expected, index) => bytes[dataStart + index] === expected)
    ) {
      // A LIST chunk can also hold cue labels or adtl data; only INFO carries
      // descriptive tags.
      return;
    }
    let cursor = dataStart + 4;
    while (cursor + CHUNK_HEADER_BYTES <= listEnd) {
      let entryId = String.fromCharCode(...bytes.subarray(cursor, cursor + 4));
      let entrySize = view.getUint32(cursor + 4, true);
      let valueStart = cursor + CHUNK_HEADER_BYTES;
      if (entrySize <= 0 || valueStart + entrySize > listEnd) {
        return;
      }
      if (entrySize <= MAX_INFO_ENTRY_BYTES) {
        let raw = bytes.subarray(valueStart, valueStart + entrySize);
        let terminator = raw.indexOf(0);
        let value = latin1
          .decode(terminator === -1 ? raw : raw.subarray(0, terminator))
          .trim();
        let target = INFO_ALIASES[entryId];
        if (value && target) {
          if (target === 'year') {
            yearText ??= value;
          } else if (collected[target] === undefined) {
            (collected as Record<string, string>)[target] = value;
          }
        }
      }
      cursor = valueStart + entrySize + (entrySize & 1);
    }
  });

  let year = parseTagYear(yearText);
  return prunedTags({
    ...collected,
    ...(year === undefined ? {} : { year }),
    scheme: 'riff-info',
  });
}
