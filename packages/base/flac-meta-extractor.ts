import {
  channelModeForCount,
  prunedEncoding,
  type AudioEncoding,
  type MediaTags,
} from './audio-metadata';
import { FileContentMismatchError } from './file-api';
import { parseVorbisComments } from './vorbis-comment-parser';

// FLAC stream marker: "fLaC"
const FLAC_MARKER = [0x66, 0x4c, 0x61, 0x43];

// Metadata block header: 1 byte (last-flag + block type) + 3 bytes length
const METADATA_BLOCK_HEADER_BYTES = 4;

// STREAMINFO block: minBlockSize(2) + maxBlockSize(2) + minFrameSize(3) +
// maxFrameSize(3) + packed sampleRate/channels/bps/totalSamples(8) + MD5(16)
const STREAMINFO_BLOCK_BYTES = 34;

const STREAMINFO_BLOCK_TYPE = 0;

// Offset of the packed 64-bit "sampleRate | channels | bps | totalSamples"
// field within a STREAMINFO block's data.
const PACKED_FIELD_OFFSET = 10;

function matchMarker(bytes: Uint8Array): boolean {
  if (bytes.length < FLAC_MARKER.length) {
    return false;
  }
  for (let i = 0; i < FLAC_MARKER.length; i++) {
    if (bytes[i] !== FLAC_MARKER[i]) {
      return false;
    }
  }
  return true;
}

export function extractFlacDuration(bytes: Uint8Array): { duration: number } {
  if (!matchMarker(bytes)) {
    throw new FileContentMismatchError(
      'File does not have a valid FLAC stream marker',
    );
  }

  let blockHeaderOffset = FLAC_MARKER.length;
  if (
    blockHeaderOffset + METADATA_BLOCK_HEADER_BYTES + STREAMINFO_BLOCK_BYTES >
    bytes.length
  ) {
    throw new FileContentMismatchError(
      'FLAC file is too small to contain a STREAMINFO block',
    );
  }

  // The first metadata block must be STREAMINFO (FLAC spec §8).
  let blockType = bytes[blockHeaderOffset]! & 0x7f;
  if (blockType !== STREAMINFO_BLOCK_TYPE) {
    throw new FileContentMismatchError(
      'FLAC file does not begin with a STREAMINFO block',
    );
  }

  let streaminfoOffset = blockHeaderOffset + METADATA_BLOCK_HEADER_BYTES;
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Packed layout across 8 bytes starting at PACKED_FIELD_OFFSET:
  //   bits  0..19  sampleRate (Hz)
  //   bits 20..22  channels - 1
  //   bits 23..27  bitsPerSample - 1
  //   bits 28..63  totalSamples
  let p = streaminfoOffset + PACKED_FIELD_OFFSET;
  let b10 = bytes[p]!;
  let b11 = bytes[p + 1]!;
  let b12 = bytes[p + 2]!;
  let sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);

  // High 4 bits of totalSamples sit in the low nibble of byte 13; the low
  // 32 bits are bytes 14..17 read big-endian.
  let totalSamplesHigh = bytes[p + 3]! & 0x0f;
  let totalSamplesLow = view.getUint32(p + 4);
  // 36 bits fits comfortably in a JS number (< 2^53).
  let totalSamples = totalSamplesHigh * 0x1_0000_0000 + totalSamplesLow;

  if (sampleRate === 0) {
    throw new FileContentMismatchError(
      'FLAC STREAMINFO reports a zero sample rate',
    );
  }
  if (totalSamples === 0) {
    // Per spec totalSamples=0 means "unknown" — not an error we can recover
    // from at extract time, so fall back to AudioDef without duration.
    throw new FileContentMismatchError(
      'FLAC STREAMINFO does not declare a total sample count',
    );
  }

  return { duration: totalSamples / sampleRate };
}

const VORBIS_COMMENT_BLOCK_TYPE = 4;

// How much of the file the tag read needs.
//
// STREAMINFO is only 42 bytes in, but VORBIS_COMMENT is not: metadata blocks
// appear in whatever order the encoder wrote them, and a SEEKTABLE — which most
// rippers emit — sits ahead of the comments at 18 bytes per seek point, putting
// them tens of kilobytes deep. A realistic tag set is itself well over half a
// kilobyte once a vendor string, MusicBrainz ids, and ReplayGain values are
// counted.
//
// A window that falls short doesn't error, it just silently yields no tags, so
// this is sized to clear an ordinary seek table and comment block by a wide
// margin. A file with cover art ahead of its comments can still exceed it; the
// cost of missing that is tags, not correctness.
export const FLAC_METADATA_WINDOW_BYTES = 1_048_576;

// Guards the walk when a block length is garbage. A real file has a handful.
const MAX_METADATA_BLOCKS = 128;

// Walk FLAC's metadata blocks. Each header is four bytes: one flag bit marking
// the last block, seven bits of block type, then a 24-bit big-endian length.
//
// Never throws — an absent or truncated block is ordinary, and the duration
// reader is what decides whether a file is really FLAC.
function walkFlacBlocks(
  bytes: Uint8Array,
  visit: (blockType: number, dataStart: number, dataLength: number) => void,
): void {
  if (!matchMarker(bytes)) {
    return;
  }
  let cursor = FLAC_MARKER.length;
  for (let block = 0; block < MAX_METADATA_BLOCKS; block++) {
    if (cursor + METADATA_BLOCK_HEADER_BYTES > bytes.length) {
      return;
    }
    let header = bytes[cursor]!;
    let isLast = (header & 0x80) !== 0;
    let blockType = header & 0x7f;
    let length =
      (bytes[cursor + 1]! << 16) |
      (bytes[cursor + 2]! << 8) |
      bytes[cursor + 3]!;
    let dataStart = cursor + METADATA_BLOCK_HEADER_BYTES;
    visit(blockType, dataStart, length);
    if (isLast) {
      return;
    }
    cursor = dataStart + length;
  }
}

// STREAMINFO states the sample layout outright. FLAC is lossless, so there is no
// meaningful constant bitrate to report — the compressed rate varies with the
// signal, and the file never states it.
export function extractFlacEncoding(
  bytes: Uint8Array,
): AudioEncoding | undefined {
  if (
    !matchMarker(bytes) ||
    FLAC_MARKER.length + METADATA_BLOCK_HEADER_BYTES + STREAMINFO_BLOCK_BYTES >
      bytes.length
  ) {
    return undefined;
  }
  if ((bytes[FLAC_MARKER.length]! & 0x7f) !== STREAMINFO_BLOCK_TYPE) {
    return undefined;
  }
  let p =
    FLAC_MARKER.length + METADATA_BLOCK_HEADER_BYTES + PACKED_FIELD_OFFSET;
  // bits 0..19 sampleRate, 20..22 channels-1, 23..27 bitsPerSample-1
  let sampleRate =
    (bytes[p]! << 12) | (bytes[p + 1]! << 4) | (bytes[p + 2]! >> 4);
  let channels = ((bytes[p + 2]! >> 1) & 0x07) + 1;
  let bitsPerSample =
    (((bytes[p + 2]! & 0x01) << 4) | (bytes[p + 3]! >> 4)) + 1;

  return prunedEncoding({
    container: 'FLAC',
    audioCodec: 'FLAC',
    sampleRateHz: sampleRate > 0 ? sampleRate : undefined,
    isVariableBitrate: true,
    bitDepth: bitsPerSample,
    channels,
    channelMode: channelModeForCount(channels),
  });
}

export function extractFlacTags(bytes: Uint8Array): MediaTags | undefined {
  let tags: MediaTags | undefined;
  walkFlacBlocks(bytes, (blockType, dataStart, dataLength) => {
    if (blockType !== VORBIS_COMMENT_BLOCK_TYPE || tags) {
      return;
    }
    tags = parseVorbisComments(bytes, dataStart, dataStart + dataLength)?.tags;
  });
  return tags;
}
