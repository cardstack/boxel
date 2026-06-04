import { FileContentMismatchError } from './file-api';

// MPEG audio frame sync: 11 bits set (0xFFE..). In practice the next bits
// disambiguate MPEG version / layer, so we match the first byte as 0xFF and
// require bits 0xE0 of the second.
const FRAME_SYNC_FIRST = 0xff;
const FRAME_SYNC_SECOND_MASK = 0xe0;

// ID3v2 tag header is "ID3" + 2-byte version + 1 byte flags + 4 bytes
// sync-safe size (7 bits per byte).
const ID3V2_HEADER_BYTES = 10;

// MPEG version field
const MPEG_VERSION_2_5 = 0;
const MPEG_VERSION_2 = 2;
const MPEG_VERSION_1 = 3;

// Layer field
const LAYER_III = 1;
const LAYER_II = 2;
const LAYER_I = 3;

// Sample-rate table, indexed by [version][sampleRateIdx]
const SAMPLE_RATES: Record<number, number[]> = {
  [MPEG_VERSION_1]: [44100, 48000, 32000],
  [MPEG_VERSION_2]: [22050, 24000, 16000],
  [MPEG_VERSION_2_5]: [11025, 12000, 8000],
};

// Samples per frame, indexed by [version][layer]
function samplesPerFrame(version: number, layer: number): number | undefined {
  if (layer === LAYER_I) {
    return 384;
  }
  if (version === MPEG_VERSION_1) {
    return layer === LAYER_II || layer === LAYER_III ? 1152 : undefined;
  }
  // MPEG2 / MPEG2.5
  if (layer === LAYER_II) {
    return 1152;
  }
  if (layer === LAYER_III) {
    return 576;
  }
  return undefined;
}

function parseSyncSafeSize(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 21) |
    (bytes[offset + 1]! << 14) |
    (bytes[offset + 2]! << 7) |
    bytes[offset + 3]!
  );
}

function id3v2TagSize(bytes: Uint8Array): number {
  if (bytes.length < ID3V2_HEADER_BYTES) {
    return 0;
  }
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    // not "ID3"
    return 0;
  }
  let size = parseSyncSafeSize(bytes, 6);
  return ID3V2_HEADER_BYTES + size;
}

function findFrameSync(
  bytes: Uint8Array,
  startOffset: number,
): number | undefined {
  for (let i = startOffset; i < bytes.length - 1; i++) {
    if (
      bytes[i] === FRAME_SYNC_FIRST &&
      (bytes[i + 1]! & FRAME_SYNC_SECOND_MASK) === FRAME_SYNC_SECOND_MASK
    ) {
      return i;
    }
  }
  return undefined;
}

interface FrameHeader {
  version: number;
  layer: number;
  sampleRate: number;
  samplesPerFrame: number;
}

function parseFrameHeader(
  bytes: Uint8Array,
  offset: number,
): FrameHeader | undefined {
  if (offset + 4 > bytes.length) {
    return undefined;
  }
  let b1 = bytes[offset + 1]!;
  let b2 = bytes[offset + 2]!;

  let version = (b1 >> 3) & 0x03;
  let layer = (b1 >> 1) & 0x03;
  let sampleRateIdx = (b2 >> 2) & 0x03;

  if (version === 1) {
    // reserved
    return undefined;
  }
  if (layer === 0) {
    // reserved
    return undefined;
  }
  let rates = SAMPLE_RATES[version];
  if (!rates || sampleRateIdx === 3) {
    return undefined;
  }
  let sampleRate = rates[sampleRateIdx];
  if (!sampleRate) {
    return undefined;
  }
  let samples = samplesPerFrame(version, layer);
  if (!samples) {
    return undefined;
  }
  return { version, layer, sampleRate, samplesPerFrame: samples };
}

// Scan a window after the frame header for "Xing"/"Info"/"VBRI" tags. Their
// exact offset depends on MPEG version + channel mode; scanning is robust and
// the window is small (<= 64 bytes).
const VBR_TAG_SCAN_BYTES = 64;

function findVbrTotalFrames(
  bytes: Uint8Array,
  frameStart: number,
): number | undefined {
  let scanStart = frameStart + 4;
  let scanEnd = Math.min(bytes.length - 4, scanStart + VBR_TAG_SCAN_BYTES);
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = scanStart; i <= scanEnd; i++) {
    let tag = String.fromCharCode(
      bytes[i]!,
      bytes[i + 1]!,
      bytes[i + 2]!,
      bytes[i + 3]!,
    );
    if (tag === 'Xing' || tag === 'Info') {
      // Xing/Info header layout:
      //   4 bytes tag, 4 bytes flags, then optional fields gated by flags.
      // Flags bit 0 == frames present (frame count is the next 4 bytes BE).
      if (i + 12 > bytes.length) {
        return undefined;
      }
      let flags = view.getUint32(i + 4);
      if ((flags & 0x01) === 0) {
        return undefined;
      }
      return view.getUint32(i + 8);
    }
    if (tag === 'VBRI') {
      // VBRI: 4 tag, 2 version, 2 delay, 2 quality, 4 bytes total,
      // then 4 bytes total frame count.
      if (i + 18 > bytes.length) {
        return undefined;
      }
      return view.getUint32(i + 14);
    }
  }
  return undefined;
}

export function extractMp3Duration(bytes: Uint8Array): { duration: number } {
  // Skip any ID3v2 tag. ID3v2.4 can be huge (embedded artwork etc.), so the
  // caller must read enough bytes for the tag + first frame.
  let cursor = id3v2TagSize(bytes);

  let frameOffset = findFrameSync(bytes, cursor);
  if (frameOffset === undefined) {
    throw new FileContentMismatchError(
      'MP3 file does not contain an MPEG audio frame in the read window',
    );
  }
  let header = parseFrameHeader(bytes, frameOffset);
  if (!header) {
    throw new FileContentMismatchError(
      'MP3 file has an invalid MPEG frame header',
    );
  }

  let totalFrames = findVbrTotalFrames(bytes, frameOffset);
  if (totalFrames === undefined || totalFrames === 0) {
    // No VBR header — CBR or stripped. A precise duration requires scanning
    // every frame, which we deliberately avoid in the extract window. Fall
    // back to the AudioDef base by signalling mismatch.
    throw new FileContentMismatchError(
      'MP3 file has no Xing/Info/VBRI header to derive frame count',
    );
  }

  return {
    duration: (totalFrames * header.samplesPerFrame) / header.sampleRate,
  };
}
