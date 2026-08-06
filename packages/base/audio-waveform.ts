// Decode audio and reduce it to a bounded amplitude envelope.
//
// This is the fallback path, used by the formats that genuinely need a decoder:
// FLAC, Ogg, and M4A. It relies on Web Audio, which is available because the
// extract pass runs in the prerenderer's headless Chrome — but it is the one
// audio fact that can legitimately be unavailable, so failure is recorded on the
// field rather than thrown.
//
// MP3 does not come through here. Its envelope is read straight from quantizer
// gains in each frame's side info, with no decoder and flat memory; see
// `extractMp3Envelope`. The reduction below is still what defines what a bar
// means, and both paths produce the same `WaveformMetadata` shape.
//
// The envelope is deliberately *not* a downsample of the opening seconds. It is
// resampled across the whole signal, so a waveform drawn from it is recognizably
// the shape of the track rather than the shape of its intro.

// Fixed bar count so the stored payload is bounded regardless of duration: a
// three-hour recording costs the same as a three-second one. 96 is enough to
// read as a waveform at collection-cell width without being wasteful.
export const WAVEFORM_BAR_COUNT = 96;

// Names the reduction so a stored envelope stays interpretable. Bump it when the
// algorithm changes so a consumer can tell an old envelope from a new one.
export const WAVEFORM_ALGORITHM = 'rms-peak-v1';

// The envelope MP3 produces by reading quantizer gains out of frame side info
// rather than decoding. Recorded distinctly because its bars are normalized to
// the track's own peak rather than being calibrated amplitudes, so a consumer
// comparing two files can tell it apart from a decoded envelope.
export const WAVEFORM_ALGORITHM_SIDE_INFO = 'mp3-side-info-v1';

// Refuse to decode past this, measured on the *encoded* size because that is
// what's known before committing to a decode.
//
// This applies to FLAC, Ogg, and M4A — the formats that still need a real
// decoder. MP3 no longer does: it reads its envelope out of frame side info
// (see `extractMp3Envelope`) and streams with flat memory, which is why it is
// exempt. That matters because MP3 was by far the worst case here, at roughly
// twenty times the encoded size once decoded to float PCM against four to six
// for the rest.
//
// The number that matters is still the decoded one: float PCM costs
// `duration x sampleRate x channels x 4` bytes. A 16 MB FLAC is around three
// minutes, decoding to ~60 MB inside the shared prerender pool alongside every
// other render — enough for ordinary music and speech while refusing masters
// that would decode to gigabytes.
//
// Over the ceiling is not a failure: the file still indexes with every
// header-derived fact intact and records `skipped`, so a renderer can tell
// "too large to analyze" from "decode failed".
export const WAVEFORM_MAX_ENCODED_BYTES = 16 * 1024 * 1024;

export interface WaveformMetadata {
  decodeStatus: 'ok' | 'unsupported' | 'failed' | 'skipped';
  decodeError?: string;
  algorithm?: string;
  barsJson?: string;
  barCount?: number;
  durationSeconds?: number;
  sampleRateHz?: number;
  channelCount?: number;
  peakAmplitude?: number;
  rmsAmplitude?: number;
}

// The slice of `AudioBuffer` this needs, declared structurally so the module has
// no dependency on DOM lib types and stays testable with a plain object.
export interface DecodedAudioLike {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

function rounded(value: number, digits = 5): number {
  let factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Reduce decoded PCM to `barCount` amplitude values.
//
// Each bar is the RMS of its window, not the peak: RMS tracks perceived loudness,
// so quiet passages stay visibly quiet, whereas a peak-per-bar envelope saturates
// to a solid block on anything mastered loud. The overall peak is reported
// separately for callers that need headroom.
//
// All channels contribute to every bar. Reading only channel 0 would silently
// misrepresent a track whose content is panned.
export function analyzeDecodedAudio(
  audio: DecodedAudioLike,
  barCount = WAVEFORM_BAR_COUNT,
): WaveformMetadata {
  let channels = Math.max(1, audio.numberOfChannels);
  let totalSamples = audio.length;
  if (totalSamples <= 0 || barCount <= 0) {
    return {
      decodeStatus: 'ok',
      algorithm: WAVEFORM_ALGORITHM,
      barsJson: '[]',
      barCount: 0,
      durationSeconds: rounded(audio.duration, 3),
      sampleRateHz: audio.sampleRate,
      channelCount: audio.numberOfChannels,
      peakAmplitude: 0,
      rmsAmplitude: 0,
    };
  }

  let channelData: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) {
    channelData.push(audio.getChannelData(channel));
  }

  // Window boundaries are computed from the sample index rather than accumulated,
  // so rounding never drifts and the last window always reaches the final sample.
  let bars: number[] = [];
  let overallPeak = 0;
  let overallSquareSum = 0;
  let overallCount = 0;

  for (let bar = 0; bar < barCount; bar++) {
    let start = Math.floor((bar * totalSamples) / barCount);
    let end = Math.floor(((bar + 1) * totalSamples) / barCount);
    if (end <= start) {
      end = Math.min(start + 1, totalSamples);
    }
    let squareSum = 0;
    let count = 0;
    for (let channel = 0; channel < channels; channel++) {
      let samples = channelData[channel];
      if (!samples) {
        continue;
      }
      for (let index = start; index < end && index < samples.length; index++) {
        let sample = samples[index]!;
        squareSum += sample * sample;
        count++;
        let magnitude = Math.abs(sample);
        if (magnitude > overallPeak) {
          overallPeak = magnitude;
        }
      }
    }
    overallSquareSum += squareSum;
    overallCount += count;
    bars.push(count > 0 ? rounded(Math.sqrt(squareSum / count), 4) : 0);
  }

  return {
    decodeStatus: 'ok',
    algorithm: WAVEFORM_ALGORITHM,
    barsJson: JSON.stringify(bars),
    barCount: bars.length,
    durationSeconds: rounded(audio.duration, 3),
    sampleRateHz: audio.sampleRate,
    channelCount: audio.numberOfChannels,
    peakAmplitude: rounded(overallPeak, 4),
    rmsAmplitude:
      overallCount > 0
        ? rounded(Math.sqrt(overallSquareSum / overallCount), 4)
        : 0,
  };
}

// The Web Audio surface this needs, declared structurally for the same reason as
// `DecodedAudioLike`: reaching for the global `AudioContext` type would put a DOM
// dependency in a module the non-browser paths also load.
interface AudioDecoderLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudioLike>;
  close?: () => Promise<void> | void;
}

type AudioDecoderConstructor = new (options?: {
  sampleRate?: number;
}) => AudioDecoderLike;

function audioDecoderConstructor(): AudioDecoderConstructor | undefined {
  let scope = globalThis as unknown as {
    OfflineAudioContext?: unknown;
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  // An OfflineAudioContext decodes without touching an output device, which is
  // what a headless indexing pass wants — a live AudioContext would try to open
  // hardware. Fall back to the real thing where offline isn't available.
  let candidate =
    scope.OfflineAudioContext ?? scope.AudioContext ?? scope.webkitAudioContext;
  return typeof candidate === 'function'
    ? (candidate as AudioDecoderConstructor)
    : undefined;
}

// Decode `bytes` and reduce them to an envelope. Never throws: every failure
// mode becomes a recorded status, because a file whose audio won't decode should
// still index with its header-derived metadata intact.
export async function extractAudioWaveform(
  bytes: Uint8Array,
  barCount = WAVEFORM_BAR_COUNT,
): Promise<WaveformMetadata> {
  if (bytes.byteLength === 0) {
    return { decodeStatus: 'skipped', decodeError: 'File is empty' };
  }
  if (bytes.byteLength > WAVEFORM_MAX_ENCODED_BYTES) {
    return {
      decodeStatus: 'skipped',
      decodeError: `File exceeds the ${Math.floor(
        WAVEFORM_MAX_ENCODED_BYTES / (1024 * 1024),
      )} MB decode ceiling`,
    };
  }
  let Decoder = audioDecoderConstructor();
  if (!Decoder) {
    return {
      decodeStatus: 'unsupported',
      decodeError: 'Web Audio is not available in this environment',
    };
  }

  let context: AudioDecoderLike | undefined;
  try {
    context = new Decoder();
    // `decodeAudioData` detaches the buffer it is given, so hand it a copy —
    // otherwise the caller's bytes, which other extractors still need to read,
    // come back as a zero-length view.
    let copy = bytes.slice().buffer;
    let decoded = await context.decodeAudioData(copy);
    return analyzeDecodedAudio(decoded, barCount);
  } catch (error) {
    return {
      decodeStatus: 'failed',
      decodeError:
        error instanceof Error
          ? error.message
          : `Audio decode failed: ${String(error)}`,
    };
  } finally {
    try {
      await context?.close?.();
    } catch {
      // A context that won't close is not worth failing an index pass over.
    }
  }
}
