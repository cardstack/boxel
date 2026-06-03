import { FileContentMismatchError } from './file-api';

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
