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

// What one file's decode may cost in memory.
//
// The ceiling is on *decoded* bytes rather than encoded ones, because encoded
// size predicts decoded size very badly. Float PCM costs
// `duration x sampleRate x channels x 4`, so the expansion factor is
// `(sampleRate x channels x 32) / bitrate` — which is about 4x for FLAC but 22x
// for AAC and up to 48x for low-bitrate Opus. A single encoded ceiling that
// looks reasonable against FLAC therefore admits a decode an order of magnitude
// larger for a lossy stream: at 16 MB encoded, FLAC decodes to ~64 MB while
// 64 kbps Opus decodes to ~768 MB.
//
// Predicting the decoded size costs nothing, because every caller has already
// read the duration, sample rate, and channel count from the container's header
// before it gets here. So the budget is applied to the figure that actually
// matters, and each format lands wherever its own codec puts it.
//
// 128 MB admits roughly five minutes of 44.1 kHz stereo — comfortably every
// ordinary song — while refusing the long recordings that would dominate a
// prerender page's memory alongside every other render sharing the pool.
export const WAVEFORM_MAX_DECODED_BYTES = 128 * 1024 * 1024;

// Decoded PCM is 32-bit float per sample per channel.
const BYTES_PER_DECODED_SAMPLE = 4;

// A backstop for the case the decoded size can't be predicted — a container that
// stated no sample rate, say. Deliberately generous, because it is a proxy for
// the real constraint rather than the constraint itself.
export const WAVEFORM_MAX_ENCODED_BYTES = 32 * 1024 * 1024;

// What the container says this file will cost once decoded, or undefined when it
// didn't say enough to tell.
export function predictedDecodedBytes(
  budget: DecodeBudget,
): number | undefined {
  let { durationSeconds, sampleRateHz, channels } = budget;
  if (
    durationSeconds === undefined ||
    sampleRateHz === undefined ||
    channels === undefined ||
    durationSeconds <= 0 ||
    sampleRateHz <= 0 ||
    channels <= 0
  ) {
    return undefined;
  }
  return durationSeconds * sampleRateHz * channels * BYTES_PER_DECODED_SAMPLE;
}

// What each caller knows before committing to a decode.
export interface DecodeBudget {
  durationSeconds?: number;
  sampleRateHz?: number;
  channels?: number;
  contentSize?: number;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Why this file shouldn't be decoded, or undefined to go ahead. Skipping is not
// a failure: the file still indexes with every header-derived fact intact, and
// `skipped` tells a renderer "too large to analyze" rather than "decode failed".
export function decodeSkipReason(budget: DecodeBudget): string | undefined {
  let predicted = predictedDecodedBytes(budget);
  if (predicted !== undefined) {
    return predicted > WAVEFORM_MAX_DECODED_BYTES
      ? `Decoding would need about ${megabytes(predicted)}, over the ${megabytes(
          WAVEFORM_MAX_DECODED_BYTES,
        )} ceiling`
      : undefined;
  }
  // Nothing to predict from, so fall back to the encoded proxy.
  return budget.contentSize !== undefined &&
    budget.contentSize > WAVEFORM_MAX_ENCODED_BYTES
    ? `File exceeds the ${megabytes(WAVEFORM_MAX_ENCODED_BYTES)} ceiling for audio of unknown duration`
    : undefined;
}

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

type OfflineAudioContextConstructor = new (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => AudioDecoderLike;

type AudioContextConstructor = new () => AudioDecoderLike;

// The band every Web Audio implementation must accept for a context's sample
// rate. A container may state a rate outside it (FLAC admits up to 655350 Hz);
// the context gets the nearest legal rate and `decodeAudioData` resamples the
// decoded audio to it, which an amplitude envelope doesn't notice.
const MIN_CONTEXT_SAMPLE_RATE_HZ = 8000;
const MAX_CONTEXT_SAMPLE_RATE_HZ = 96000;
const DEFAULT_CONTEXT_SAMPLE_RATE_HZ = 44100;

function contextSampleRate(sampleRateHz: number | undefined): number {
  if (
    sampleRateHz === undefined ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz <= 0
  ) {
    return DEFAULT_CONTEXT_SAMPLE_RATE_HZ;
  }
  return Math.min(
    Math.max(sampleRateHz, MIN_CONTEXT_SAMPLE_RATE_HZ),
    MAX_CONTEXT_SAMPLE_RATE_HZ,
  );
}

// Build a decoding context, or undefined where Web Audio is missing entirely.
//
// An OfflineAudioContext decodes without touching an output device, which is
// what a headless indexing pass wants — a live AudioContext would try to open
// hardware. Fall back to the real thing where offline isn't available.
//
// The offline constructor requires its render parameters up front. The render
// graph never runs — only `decodeAudioData` is used — so channel count and
// length are minimal; the sample rate is the one parameter that matters,
// because decoded audio is resampled to the context's rate. Callers pass the
// rate the container header stated so the analysis sees native resolution.
function makeAudioDecoder(
  sampleRateHz: number | undefined,
): AudioDecoderLike | undefined {
  let scope = globalThis as unknown as {
    OfflineAudioContext?: unknown;
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  if (typeof scope.OfflineAudioContext === 'function') {
    let Offline = scope.OfflineAudioContext as OfflineAudioContextConstructor;
    return new Offline(1, 1, contextSampleRate(sampleRateHz));
  }
  let Live = scope.AudioContext ?? scope.webkitAudioContext;
  return typeof Live === 'function'
    ? new (Live as AudioContextConstructor)()
    : undefined;
}

// Decode `bytes` and reduce them to an envelope. Never throws: every failure
// mode becomes a recorded status, because a file whose audio won't decode should
// still index with its header-derived metadata intact.
export async function extractAudioWaveform(
  bytes: Uint8Array,
  opts: { barCount?: number; sampleRateHz?: number } = {},
): Promise<WaveformMetadata> {
  let { barCount = WAVEFORM_BAR_COUNT, sampleRateHz } = opts;
  if (bytes.byteLength === 0) {
    return { decodeStatus: 'skipped', decodeError: 'File is empty' };
  }
  // A last-resort guard for a caller that skipped the budget check entirely.
  // The real decision is `decodeSkipReason`, which reasons about decoded rather
  // than encoded size.
  if (bytes.byteLength > WAVEFORM_MAX_ENCODED_BYTES) {
    return {
      decodeStatus: 'skipped',
      decodeError: `File exceeds the ${Math.round(
        WAVEFORM_MAX_ENCODED_BYTES / (1024 * 1024),
      )} MB unbudgeted ceiling`,
    };
  }
  let context: AudioDecoderLike | undefined;
  try {
    context = makeAudioDecoder(sampleRateHz);
    if (!context) {
      return {
        decodeStatus: 'unsupported',
        decodeError: 'Web Audio is not available in this environment',
      };
    }
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
