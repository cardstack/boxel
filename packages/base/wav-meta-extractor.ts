import { FileContentMismatchError } from './file-api';

// RIFF/WAVE 4-byte ASCII tags
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WAVE = [0x57, 0x41, 0x56, 0x45]; // "WAVE"
const FMT = [0x66, 0x6d, 0x74, 0x20]; // "fmt "
const DATA = [0x64, 0x61, 0x74, 0x61]; // "data"

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
    throw new FileContentMismatchError(
      'File is not a WAVE RIFF container',
    );
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
      throw new FileContentMismatchError(
        'WAV file contains a malformed chunk',
      );
    }
    offset += advance;
  }

  if (byteRate === undefined || byteRate === 0) {
    throw new FileContentMismatchError(
      'WAV file is missing a fmt chunk with a non-zero byteRate',
    );
  }
  if (dataSize === undefined) {
    throw new FileContentMismatchError(
      'WAV file is missing a data chunk',
    );
  }

  return { duration: dataSize / byteRate };
}
