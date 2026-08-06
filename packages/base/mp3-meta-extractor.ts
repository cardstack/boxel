import {
  prunedEncoding,
  type AudioEncoding,
  type ChannelMode,
  type MediaTags,
} from './audio-metadata';
import { FileContentMismatchError } from './file-api';
import { parseId3v2Tags } from './id3v2-parser';
import { StreamingEnvelope } from './streaming-envelope';

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

// Bitrate index → kbps, keyed by MPEG version and layer. Index 0 means "free
// format" and 15 is reserved, so both are left as gaps rather than filled in.
const BITRATE_KBPS: Record<string, (number | undefined)[]> = {
  // MPEG 1
  '3-3': [
    undefined,
    32,
    64,
    96,
    128,
    160,
    192,
    224,
    256,
    288,
    320,
    352,
    384,
    416,
    448,
    undefined,
  ], // Layer I
  '3-2': [
    undefined,
    32,
    48,
    56,
    64,
    80,
    96,
    112,
    128,
    160,
    192,
    224,
    256,
    320,
    384,
    undefined,
  ], // Layer II
  '3-1': [
    undefined,
    32,
    40,
    48,
    56,
    64,
    80,
    96,
    112,
    128,
    160,
    192,
    224,
    256,
    320,
    undefined,
  ], // Layer III
  // MPEG 2 and 2.5 share one table
  '2-3': [
    undefined,
    32,
    48,
    56,
    64,
    80,
    96,
    112,
    128,
    144,
    160,
    176,
    192,
    224,
    256,
    undefined,
  ],
  '2-2': [
    undefined,
    8,
    16,
    24,
    32,
    40,
    48,
    56,
    64,
    80,
    96,
    112,
    128,
    144,
    160,
    undefined,
  ],
  '2-1': [
    undefined,
    8,
    16,
    24,
    32,
    40,
    48,
    56,
    64,
    80,
    96,
    112,
    128,
    144,
    160,
    undefined,
  ],
};

const CHANNEL_MODES: Record<number, { mode: ChannelMode; channels: number }> = {
  0: { mode: 'stereo', channels: 2 },
  1: { mode: 'joint-stereo', channels: 2 },
  2: { mode: 'dual-mono', channels: 2 },
  3: { mode: 'mono', channels: 1 },
};

const LAYER_NAMES: Record<number, string> = {
  [LAYER_I]: 'MPEG Layer I',
  [LAYER_II]: 'MPEG Layer II',
  [LAYER_III]: 'MP3 (MPEG Layer III)',
};

function bitrateTableKey(version: number, layer: number): string {
  // MPEG 2.5 uses MPEG 2's bitrate table.
  let versionKey = version === MPEG_VERSION_1 ? '3' : '2';
  return `${versionKey}-${layer}`;
}

// The first MPEG frame header states the sample rate, channel mode, layer, and
// that frame's bitrate. Whether the bitrate describes the file depends on
// whether a Xing/Info/VBRI header is present — the same header the duration
// reader looks for — so that determination is reported rather than assumed.
export function extractMp3Encoding(
  bytes: Uint8Array,
): AudioEncoding | undefined {
  let frameOffset = findFrameSync(bytes, id3v2TagSize(bytes));
  if (frameOffset === undefined) {
    return undefined;
  }
  let header = parseFrameHeader(bytes, frameOffset);
  if (!header) {
    return undefined;
  }
  let b2 = bytes[frameOffset + 2]!;
  let b3 = bytes[frameOffset + 3]!;
  let bitrateIndex = (b2 >> 4) & 0x0f;
  let bitrateKbps =
    BITRATE_KBPS[bitrateTableKey(header.version, header.layer)]?.[bitrateIndex];
  let channelMode = CHANNEL_MODES[(b3 >> 6) & 0x03];
  // A Xing/Info/VBRI header is what an encoder writes when the bitrate varies.
  let isVariableBitrate = findVbrTotalFrames(bytes, frameOffset) !== undefined;

  return prunedEncoding({
    container: 'MPEG',
    audioCodec: LAYER_NAMES[header.layer],
    sampleRateHz: header.sampleRate,
    bitrateBps: bitrateKbps === undefined ? undefined : bitrateKbps * 1000,
    isVariableBitrate,
    // MP3 is a lossy transform codec with no stored sample width, so bitDepth
    // stays unset rather than being filled with a plausible 16.
    channels: channelMode?.channels,
    channelMode: channelMode?.mode,
  });
}

export function extractMp3Tags(bytes: Uint8Array): MediaTags | undefined {
  return parseId3v2Tags(bytes);
}

// ── Amplitude envelope from side info, without decoding ──────────────────────
//
// Every Layer III frame carries a side-info block before its main data, and each
// granule/channel within it has an 8-bit `global_gain` — the quantizer step
// exponent used to requantize that granule:
//
//   sample = sign(is) · |is|^(4/3) · 2^((global_gain − 210) / 4)
//
// So `2^((global_gain − 210)/4)` is that granule's amplitude scale, readable by
// walking frame headers and picking 8 bits out of side info. No Huffman decode,
// no IMDCT, no synthesis filterbank, and no need to hold decoded audio.
//
// That matters because MP3 is by far the worst case for a full decode: float PCM
// costs `duration × sampleRate × channels × 4`, which for a 128 kbps stream is
// roughly twenty times the encoded size. This path is O(1) in memory regardless
// of duration.
//
// The tradeoff is that a quantizer scale is not calibrated amplitude. It tracks
// loudness well enough to draw, but its absolute values aren't comparable with a
// decoded RMS, so the envelope is normalized to the track's own peak and the
// absolute amplitude fields are left unset rather than reported wrongly.

// A granule is 576 samples; a Layer III frame holds two of them (one in MPEG-2).
const SAMPLES_PER_GRANULE = 576;

// The exponent offset in the requantization formula.
const GLOBAL_GAIN_BIAS = 210;

// `global_gain` sits 21 bits into each granule/channel side-info block, after
// part2_3_length (12) and big_values (9). Same in both MPEG generations.
const GLOBAL_GAIN_BIT_OFFSET = 21;

// Per granule/channel side-info block width. MPEG-2/2.5 spends four more bits on
// scalefac_compress and two fewer on the trailing flags.
const SIDE_INFO_BLOCK_BITS_V1 = 59;
const SIDE_INFO_BLOCK_BITS_V2 = 63;

function readBits(
  bytes: Uint8Array,
  base: number,
  bitOffset: number,
  count: number,
): number | undefined {
  let value = 0;
  for (let index = 0; index < count; index++) {
    let bit = bitOffset + index;
    let byteIndex = base + (bit >> 3);
    if (byteIndex >= bytes.length) {
      return undefined;
    }
    value = (value << 1) | ((bytes[byteIndex]! >> (7 - (bit & 7))) & 1);
  }
  return value;
}

// How long this frame is in bytes, which is what advances the walk to the next
// sync. Layer III packs 1152 samples per frame in MPEG-1 and 576 in MPEG-2/2.5,
// hence the different multipliers.
function frameLengthBytes(
  version: number,
  layer: number,
  bitrateKbps: number,
  sampleRate: number,
  hasPadding: boolean,
): number | undefined {
  if (bitrateKbps <= 0 || sampleRate <= 0 || layer !== LAYER_III) {
    return undefined;
  }
  let multiplier = version === MPEG_VERSION_1 ? 144 : 72;
  return (
    Math.floor((multiplier * bitrateKbps * 1000) / sampleRate) +
    (hasPadding ? 1 : 0)
  );
}

// Read every granule's gain out of one frame's side info.
function frameGlobalGains(
  bytes: Uint8Array,
  frameOffset: number,
  version: number,
  channelCount: number,
  hasCrc: boolean,
): number[] {
  // Side info follows the 4-byte header, plus a 2-byte CRC when present.
  let base = frameOffset + 4 + (hasCrc ? 2 : 0);
  let isMono = channelCount === 1;
  let gains: number[] = [];
  if (version === MPEG_VERSION_1) {
    // main_data_begin(9) + private_bits + scfsi(4 per channel)
    let start = 9 + (isMono ? 5 : 3) + 4 * channelCount;
    for (let granule = 0; granule < 2; granule++) {
      for (let channel = 0; channel < channelCount; channel++) {
        let block = granule * channelCount + channel;
        let gain = readBits(
          bytes,
          base,
          start + block * SIDE_INFO_BLOCK_BITS_V1 + GLOBAL_GAIN_BIT_OFFSET,
          8,
        );
        if (gain === undefined) {
          return gains;
        }
        gains.push(gain);
      }
    }
  } else {
    // MPEG-2/2.5 carries one granule and no scfsi.
    let start = 8 + (isMono ? 1 : 2);
    for (let channel = 0; channel < channelCount; channel++) {
      let gain = readBits(
        bytes,
        base,
        start + channel * SIDE_INFO_BLOCK_BITS_V2 + GLOBAL_GAIN_BIT_OFFSET,
        8,
      );
      if (gain === undefined) {
        return gains;
      }
      gains.push(gain);
    }
  }
  return gains;
}

export interface Mp3Envelope {
  bars: number[];
  granuleCount: number;
  frameCount: number;
  sampleRateHz?: number;
  durationSeconds?: number;
}

// Walk `bytes` frame by frame, folding each granule's gain into `envelope`.
// Returns how many granules were read.
function scanFrames(
  bytes: Uint8Array,
  startOffset: number,
  envelope: StreamingEnvelope,
): { granuleCount: number; sampleRate?: number; frameCount: number } {
  let offset = startOffset;
  let granuleCount = 0;
  let frameCount = 0;
  let sampleRate: number | undefined;

  while (offset + 4 <= bytes.length) {
    let atSync =
      bytes[offset] === FRAME_SYNC_FIRST &&
      (bytes[offset + 1]! & FRAME_SYNC_SECOND_MASK) === FRAME_SYNC_SECOND_MASK;
    let header = atSync ? parseFrameHeader(bytes, offset) : undefined;
    if (!header) {
      // Lost sync. Step forward and look again rather than abandoning the rest
      // of the file, which a single corrupt frame would otherwise cost.
      let resync = findFrameSync(bytes, offset + 1);
      if (resync === undefined) {
        break;
      }
      offset = resync;
      continue;
    }
    sampleRate ??= header.sampleRate;

    let b1 = bytes[offset + 1]!;
    let b2 = bytes[offset + 2]!;
    let b3 = bytes[offset + 3]!;
    let hasCrc = (b1 & 0x01) === 0;
    let bitrateIndex = (b2 >> 4) & 0x0f;
    let bitrateKbps =
      BITRATE_KBPS[bitrateTableKey(header.version, header.layer)]?.[
        bitrateIndex
      ];
    let hasPadding = ((b2 >> 1) & 0x01) === 1;
    let channelCount = ((b3 >> 6) & 0x03) === 3 ? 1 : 2;

    let length = frameLengthBytes(
      header.version,
      header.layer,
      bitrateKbps ?? 0,
      header.sampleRate,
      hasPadding,
    );
    if (length === undefined || length < 4) {
      break;
    }

    for (let gain of frameGlobalGains(
      bytes,
      offset,
      header.version,
      channelCount,
      hasCrc,
    )) {
      // Convert the log-domain quantizer exponent to a linear scale, then push
      // it as its own "RMS" so the shared accumulator's weighting applies.
      let amplitude = 2 ** ((gain - GLOBAL_GAIN_BIAS) / 4);
      envelope.push(amplitude * amplitude, 1, amplitude);
      granuleCount++;
    }

    frameCount++;
    offset += length;
  }

  return { granuleCount, sampleRate, frameCount };
}

// Build an amplitude envelope from a whole MP3 without decoding it.
//
// Bars are normalized to the track's own peak, because a quantizer scale has no
// absolute meaning — a renderer wants relative heights, and the calibrated
// figures a decoded envelope would carry are deliberately omitted rather than
// filled with numbers that don't mean the same thing.
export function extractMp3Envelope(
  bytes: Uint8Array,
  barCount: number,
): Mp3Envelope | undefined {
  let start = findFrameSync(bytes, id3v2TagSize(bytes));
  if (start === undefined) {
    return undefined;
  }
  let envelope = new StreamingEnvelope(barCount);
  let { granuleCount, sampleRate, frameCount } = scanFrames(
    bytes,
    start,
    envelope,
  );
  if (granuleCount === 0 || envelope.isEmpty) {
    return undefined;
  }

  let peak = envelope.peak;
  let bars = envelope.bars();
  let normalized =
    peak > 0
      ? bars.map((bar) => Math.round((bar / peak) * 10000) / 10000)
      : bars;

  // Granules are a fixed 576 samples, so the count gives a duration that agrees
  // with the frame walk without needing the Xing header the duration reader
  // depends on.
  let durationSeconds =
    sampleRate && sampleRate > 0
      ? Math.round(((granuleCount * SAMPLES_PER_GRANULE) / sampleRate) * 1000) /
        1000
      : undefined;

  return {
    bars: normalized,
    granuleCount,
    frameCount,
    ...(sampleRate === undefined ? {} : { sampleRateHz: sampleRate }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}
