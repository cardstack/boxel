import {
  channelModeForCount,
  parseTagYear,
  prunedEncoding,
  prunedTags,
  type AudioEncoding,
  type MediaTags,
} from './audio-metadata';
import { FileContentMismatchError } from './file-api';
import { StreamingEnvelope } from './streaming-envelope';

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

// ── Single-pass streaming read ───────────────────────────────────────────────
//
// WAV is the one audio format that needs no decoder for its envelope: the `data`
// chunk *is* the PCM. Decoding it through Web Audio would buffer the whole file
// and then allocate a second float copy of it, to arrive at samples the file
// already contained.
//
// So this walks the container once, off the stream, keeping only a bounded
// header buffer and one chunk of payload at a time. Duration, encoding, tags,
// and the amplitude envelope all come out of that single pass — which also means
// one fetch rather than the two the buffered path needed.
//
// Because these are real samples rather than a quantizer proxy, the envelope is
// true RMS on the same scale a decoded one would produce, so `peakAmplitude` and
// `rmsAmplitude` are meaningful and no normalization is needed.

// How much header to buffer while looking for `fmt ` and `data`. Broadcast WAVE
// metadata (bext, iXML) can push `data` a long way in, but a header past this is
// not something to hold in memory during indexing.
const WAV_STREAM_HEADER_LIMIT = 1_048_576;

// Trailing chunks — a LIST-INFO block written after the audio, which some
// encoders do — are captured up to this much. Bounded because it accumulates
// while the payload streams past.
const WAV_STREAM_TRAILER_LIMIT = 262_144;

// Samples pushed per envelope unit. Small enough that a bar boundary lands
// close to where an exact windowing would put it, large enough that the
// per-push overhead disappears against the sample loop.
const ENVELOPE_WINDOW_FRAMES = 1024;

export interface WavStreamResult {
  duration?: number;
  encoding?: AudioEncoding;
  tags?: MediaTags;
  envelope?: {
    bars: number[];
    peak: number;
    rms: number;
    sampleCount: number;
  };
}

interface PcmFormat {
  formatCode: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

// Read one sample and return it as a float in [-1, 1]. Each PCM width has its
// own convention: 8-bit is unsigned around a 128 midpoint, everything wider is
// two's-complement signed, and format 3 is already float.
function readSample(
  view: DataView,
  offset: number,
  format: PcmFormat,
): number | undefined {
  if (format.formatCode === WAVE_FORMAT_IEEE_FLOAT) {
    if (format.bitsPerSample === 32) {
      return view.getFloat32(offset, true);
    }
    if (format.bitsPerSample === 64) {
      return view.getFloat64(offset, true);
    }
    return undefined;
  }
  switch (format.bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      // No getInt24, so assemble it and sign-extend the 24th bit.
      let raw =
        view.getUint8(offset) |
        (view.getUint8(offset + 1) << 8) |
        (view.getUint8(offset + 2) << 16);
      let signed = (raw << 8) >> 8;
      return signed / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      return undefined;
  }
}

// Fold a run of PCM bytes into the envelope. Returns how many bytes were
// consumed; a trailing partial frame is left for the next call to prepend, so a
// sample split across two stream chunks isn't dropped or misread.
function consumePcm(
  bytes: Uint8Array,
  format: PcmFormat,
  envelope: StreamingEnvelope,
  carry: { squareSum: number; count: number; peak: number; frames: number },
): number {
  let bytesPerSample = format.bitsPerSample / 8;
  let frameBytes = bytesPerSample * format.channels;
  if (frameBytes <= 0) {
    return bytes.length;
  }
  let wholeFrames = Math.floor(bytes.length / frameBytes);
  if (wholeFrames === 0) {
    return 0;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let frame = 0; frame < wholeFrames; frame++) {
    let base = frame * frameBytes;
    for (let channel = 0; channel < format.channels; channel++) {
      let sample = readSample(view, base + channel * bytesPerSample, format);
      if (sample === undefined) {
        return wholeFrames * frameBytes;
      }
      carry.squareSum += sample * sample;
      carry.count++;
      let magnitude = Math.abs(sample);
      if (magnitude > carry.peak) {
        carry.peak = magnitude;
      }
    }
    carry.frames++;
    if (carry.frames >= ENVELOPE_WINDOW_FRAMES) {
      envelope.push(carry.squareSum, carry.count, carry.peak);
      carry.squareSum = 0;
      carry.count = 0;
      carry.frames = 0;
    }
  }
  return wholeFrames * frameBytes;
}

function formatFrom(bytes: Uint8Array, offset: number): PcmFormat | undefined {
  if (offset + 16 > bytes.length) {
    return undefined;
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: PcmFormat = {
    formatCode: view.getUint16(offset, true),
    channels: view.getUint16(offset + 2, true),
    sampleRate: view.getUint32(offset + 4, true),
    bitsPerSample: view.getUint16(offset + 14, true),
    blockAlign: view.getUint16(offset + 12, true),
  };
  return format.channels > 0 && format.bitsPerSample > 0 ? format : undefined;
}

// Walk a WAVE container off the stream, producing everything in one pass.
export async function extractWavFromStream(
  stream: ReadableStream<Uint8Array> | Uint8Array,
  barCount: number,
): Promise<WavStreamResult> {
  let envelope = new StreamingEnvelope(barCount);
  let carry = { squareSum: 0, count: 0, peak: 0, frames: 0 };

  // Everything before the `data` payload, held so the chunk walk can parse it
  // once complete.
  let headerParts: Uint8Array[] = [];
  let headerLength = 0;
  // Everything after it, for encoders that write LIST-INFO at the end.
  let trailerParts: Uint8Array[] = [];
  let trailerLength = 0;

  let format: PcmFormat | undefined;
  let dataBytesSeen = 0;
  let declaredDataSize: number | undefined;
  let inData = false;
  // Bytes of an incomplete PCM frame carried across a stream-chunk boundary.
  let partialFrame = new Uint8Array(0);

  let concat = (parts: Uint8Array[], length: number) => {
    let out = new Uint8Array(length);
    let offset = 0;
    for (let part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };

  // Once the header is complete, parse `fmt ` out of it so PCM can be folded as
  // it arrives rather than buffered.
  let resolveFormat = () => {
    if (format) {
      return;
    }
    let header = concat(headerParts, headerLength);
    walkRiffChunks(header, (id, dataStart, dataSize) => {
      if (id === 'fmt ' && !format && dataSize >= 16) {
        format = formatFrom(header, dataStart);
      }
    });
  };

  let handle = (chunk: Uint8Array) => {
    let cursor = 0;
    while (cursor < chunk.length) {
      if (!inData) {
        // Still collecting the header. Look for the `data` chunk header inside
        // what we have so far; until it appears, keep buffering.
        if (headerLength >= WAV_STREAM_HEADER_LIMIT) {
          return;
        }
        let take = Math.min(
          chunk.length - cursor,
          WAV_STREAM_HEADER_LIMIT - headerLength,
        );
        headerParts.push(chunk.slice(cursor, cursor + take));
        headerLength += take;
        cursor += take;

        let header = concat(headerParts, headerLength);
        let dataStart: number | undefined;
        walkRiffChunks(header, (id, start, size) => {
          if (id === 'data' && dataStart === undefined) {
            dataStart = start;
            declaredDataSize = size;
          }
        });
        if (dataStart === undefined) {
          continue;
        }
        // The payload begins inside what we just buffered. Trim the header to
        // end there and replay the remainder as PCM.
        inData = true;
        headerParts = [header.slice(0, dataStart)];
        headerLength = dataStart;
        resolveFormat();
        // Anything already buffered past the `data` header is payload — but only
        // up to the size the chunk declares. A LIST-INFO block written after the
        // audio sits in the same buffer, and folding it in would read a tag
        // block as a burst of samples.
        let buffered = header.subarray(dataStart);
        let payloadRoom =
          declaredDataSize === undefined
            ? buffered.length
            : Math.min(buffered.length, declaredDataSize);
        let payload = buffered.subarray(0, payloadRoom);
        let past = buffered.subarray(payloadRoom);
        if (format && payload.length > 0) {
          let consumed = consumePcm(payload, format, envelope, carry);
          dataBytesSeen += consumed;
          partialFrame = payload.slice(consumed);
        }
        if (past.length > 0 && trailerLength < WAV_STREAM_TRAILER_LIMIT) {
          let take = Math.min(
            past.length,
            WAV_STREAM_TRAILER_LIMIT - trailerLength,
          );
          trailerParts.push(past.slice(0, take));
          trailerLength += take;
        }
        continue;
      }

      // Streaming the payload.
      let remaining = chunk.subarray(cursor);
      cursor = chunk.length;
      let payloadRoom =
        declaredDataSize === undefined
          ? remaining.length
          : Math.max(0, declaredDataSize - dataBytesSeen - partialFrame.length);
      let payloadPart = remaining.subarray(
        0,
        Math.min(remaining.length, payloadRoom),
      );
      let afterPayload = remaining.subarray(payloadPart.length);

      if (payloadPart.length > 0 && format) {
        let combined =
          partialFrame.length > 0
            ? new Uint8Array([...partialFrame, ...payloadPart])
            : payloadPart;
        let consumed = consumePcm(combined, format, envelope, carry);
        dataBytesSeen += consumed;
        partialFrame = combined.slice(consumed);
      }

      if (afterPayload.length > 0 && trailerLength < WAV_STREAM_TRAILER_LIMIT) {
        let take = Math.min(
          afterPayload.length,
          WAV_STREAM_TRAILER_LIMIT - trailerLength,
        );
        trailerParts.push(afterPayload.slice(0, take));
        trailerLength += take;
      }
    }
  };

  if (stream instanceof Uint8Array) {
    handle(stream);
  } else {
    let reader = stream.getReader();
    try {
      for (;;) {
        let { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          handle(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Flush whatever the last window didn't fill.
  if (carry.count > 0) {
    envelope.push(carry.squareSum, carry.count, carry.peak);
  }

  resolveFormat();
  let header = concat(headerParts, headerLength);
  // Tags may sit before the payload or after it; parse both regions. A trailing
  // block needs the RIFF preamble prepended so the chunk walk can start.
  let tags = extractWavTags(header);
  if (!tags && trailerLength > 0) {
    let trailer = concat(trailerParts, trailerLength);
    let synthetic = new Uint8Array(RIFF_HEADER_BYTES + trailer.length);
    synthetic.set(
      header.subarray(0, Math.min(RIFF_HEADER_BYTES, header.length)),
    );
    synthetic.set(trailer, RIFF_HEADER_BYTES);
    tags = extractWavTags(synthetic);
  }

  let encoding = extractWavEncoding(header);
  let byteRate =
    format && format.sampleRate > 0
      ? (format.sampleRate * format.channels * format.bitsPerSample) / 8
      : undefined;
  let totalDataBytes = declaredDataSize ?? dataBytesSeen;
  let duration =
    byteRate && byteRate > 0 ? totalDataBytes / byteRate : undefined;

  return {
    ...(duration === undefined ? {} : { duration }),
    ...(encoding ? { encoding } : {}),
    ...(tags ? { tags } : {}),
    ...(envelope.isEmpty
      ? {}
      : {
          envelope: {
            bars: envelope.bars(),
            peak: Math.round(envelope.peak * 10000) / 10000,
            rms: Math.round(envelope.overallRms * 10000) / 10000,
            sampleCount: carry.count,
          },
        }),
  };
}
