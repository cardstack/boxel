// Standard MIDI File (SMF) reader.
//
// MIDI is not sampled audio: it is a note sequence that only becomes sound
// through a synthesizer, which is why it sits in its own family rather than
// under `AudioDef`. There is no sample rate, no bit depth, and no amplitude
// envelope to read — but there is a great deal the file states outright about
// what it will play.
//
// Pure `DataView`/`TextDecoder`, no DOM.

import { FileContentMismatchError } from './file-api';

const MTHD = [0x4d, 0x54, 0x68, 0x64]; // "MThd"
const MTRK = [0x4d, 0x54, 0x72, 0x6b]; // "MTrk"

const HEADER_CHUNK_BYTES = 14;

// Guards against a corrupt track count. Format 1 files with more than this are
// not something a realm is indexing.
const MAX_TRACKS = 256;

// Per track. A dense orchestral file runs to tens of thousands; this is a
// backstop against a corrupt length field spinning the event walk.
const MAX_EVENTS_PER_TRACK = 200_000;

// Bounded so a tempo-map-heavy file can't grow the index row without limit.
const MAX_TEMPO_ENTRIES = 32;
const MAX_SIGNATURE_ENTRIES = 16;

// The default when a file states no tempo, per the MIDI specification.
const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000; // 120 BPM

const META_EVENT = 0xff;
const META_END_OF_TRACK = 0x2f;
const META_SET_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;
const META_KEY_SIGNATURE = 0x59;

const STATUS_NOTE_OFF = 0x80;
const STATUS_NOTE_ON = 0x90;
const STATUS_POLY_AFTERTOUCH = 0xa0;
const STATUS_CONTROL_CHANGE = 0xb0;
const STATUS_PROGRAM_CHANGE = 0xc0;
const STATUS_CHANNEL_PRESSURE = 0xd0;
const STATUS_PITCH_BEND = 0xe0;
const STATUS_SYSEX = 0xf0;
const STATUS_SYSEX_ESCAPE = 0xf7;

// Channel 10 (index 9) is percussion by General MIDI convention, so a program
// number there names a drum kit rather than an instrument.
const PERCUSSION_CHANNEL = 9;

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

// Key signatures are stated as a count of sharps (positive) or flats (negative)
// plus a major/minor flag, rather than as a name.
const MAJOR_KEYS: Record<number, string> = {
  '-7': 'Cb major',
  '-6': 'Gb major',
  '-5': 'Db major',
  '-4': 'Ab major',
  '-3': 'Eb major',
  '-2': 'Bb major',
  '-1': 'F major',
  0: 'C major',
  1: 'G major',
  2: 'D major',
  3: 'A major',
  4: 'E major',
  5: 'B major',
  6: 'F# major',
  7: 'C# major',
};

const MINOR_KEYS: Record<number, string> = {
  '-7': 'Ab minor',
  '-6': 'Eb minor',
  '-5': 'Bb minor',
  '-4': 'F minor',
  '-3': 'C minor',
  '-2': 'G minor',
  '-1': 'D minor',
  0: 'A minor',
  1: 'E minor',
  2: 'B minor',
  3: 'F# minor',
  4: 'C# minor',
  5: 'G# minor',
  6: 'D# minor',
  7: 'A# minor',
};

export interface MidiMetadata {
  format?: number;
  ppq?: number;
  durationSeconds?: number;
  fileTrackCount?: number;
  // Tracks that actually sound a note, which is usually fewer than the file
  // declares — a format 1 file's first track conventionally holds only tempo
  // and time-signature data.
  trackCount?: number;
  noteCount?: number;
  tempoMap?: string[];
  timeSignatures?: string[];
  keySignatures?: string[];
  programs?: number[];
  channels?: number[];
  pitchRange?: string;
  hasPercussion?: boolean;
}

// A bounds-checked cursor over one track chunk.
class TrackReader {
  #bytes: Uint8Array;
  #cursor: number;
  #end: number;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.#bytes = bytes;
    this.#cursor = start;
    this.#end = end;
  }

  get exhausted(): boolean {
    return this.#cursor >= this.#end;
  }

  byte(): number | undefined {
    if (this.#cursor >= this.#end) {
      return undefined;
    }
    return this.#bytes[this.#cursor++];
  }

  peek(): number | undefined {
    return this.#cursor < this.#end ? this.#bytes[this.#cursor] : undefined;
  }

  skip(count: number): void {
    this.#cursor += count;
  }

  slice(count: number): Uint8Array | undefined {
    if (count < 0 || this.#cursor + count > this.#end) {
      return undefined;
    }
    let out = this.#bytes.subarray(this.#cursor, this.#cursor + count);
    this.#cursor += count;
    return out;
  }

  // MIDI's variable-length quantity: seven bits per byte, high bit set on every
  // byte but the last. Capped at four bytes, which is the spec's own maximum.
  variableLength(): number | undefined {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      let next = this.byte();
      if (next === undefined) {
        return undefined;
      }
      value = (value << 7) | (next & 0x7f);
      if ((next & 0x80) === 0) {
        return value;
      }
    }
    return undefined;
  }
}

function matchChunk(
  bytes: Uint8Array,
  offset: number,
  tag: readonly number[],
): boolean {
  if (offset + tag.length > bytes.length) {
    return false;
  }
  return tag.every((expected, index) => bytes[offset + index] === expected);
}

function noteName(pitch: number): string {
  // MIDI note 60 is middle C, conventionally written C4.
  let octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${octave}`;
}

function unique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

// One tempo change, as ticks-from-start plus the rate that takes effect there.
interface TempoChange {
  tick: number;
  microsecondsPerQuarter: number;
}

// Convert a tick position to seconds by walking the tempo map, since a file may
// change tempo any number of times and a single average would misreport a piece
// that speeds up.
function ticksToSeconds(
  ticks: number,
  ppq: number,
  tempoChanges: TempoChange[],
): number {
  if (ppq <= 0) {
    return 0;
  }
  let ordered = [...tempoChanges].sort((a, b) => a.tick - b.tick);
  let seconds = 0;
  let lastTick = 0;
  let rate = DEFAULT_MICROSECONDS_PER_QUARTER;
  for (let change of ordered) {
    if (change.tick >= ticks) {
      break;
    }
    seconds += ((change.tick - lastTick) / ppq) * (rate / 1_000_000);
    lastTick = change.tick;
    rate = change.microsecondsPerQuarter;
  }
  seconds += ((ticks - lastTick) / ppq) * (rate / 1_000_000);
  return seconds;
}

// Read a Standard MIDI File's structure and what it will play.
//
// Throws `FileContentMismatchError` when the file isn't SMF at all, matching how
// the other format readers signal a content mismatch so the extractor can fall
// back to the base FileDef. Anything malformed *within* a valid header degrades
// to partial metadata instead.
export function extractMidiMetadata(bytes: Uint8Array): MidiMetadata {
  if (!matchChunk(bytes, 0, MTHD)) {
    throw new FileContentMismatchError(
      'File does not begin with a MIDI "MThd" header chunk',
    );
  }
  if (bytes.length < HEADER_CHUNK_BYTES) {
    throw new FileContentMismatchError(
      'MIDI file is too small to contain a header chunk',
    );
  }
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let headerLength = view.getUint32(4);
  let format = view.getUint16(8);
  let declaredTracks = view.getUint16(10);
  let division = view.getUint16(12);

  // A negative division is SMPTE timecode rather than ticks-per-quarter. The
  // note data still reads; only the tick-to-seconds conversion doesn't apply,
  // so `ppq` is left unset rather than filled with a meaningless number.
  let isMetrical = (division & 0x8000) === 0;
  let ppq = isMetrical ? division & 0x7fff : undefined;

  let noteCount = 0;
  let soundingTracks = 0;
  let tempoChanges: TempoChange[] = [];
  let timeSignatures: string[] = [];
  let keySignatures: string[] = [];
  let programs: number[] = [];
  let channels: number[] = [];
  let lowestPitch: number | undefined;
  let highestPitch: number | undefined;
  let longestTrackTicks = 0;
  let hasPercussion = false;

  // Track chunks follow the header, whose declared length lets a file carry
  // header extensions this reader doesn't know about.
  let offset = 8 + headerLength;
  let trackIndex = 0;
  while (
    trackIndex < Math.min(declaredTracks || MAX_TRACKS, MAX_TRACKS) &&
    offset + 8 <= bytes.length
  ) {
    if (!matchChunk(bytes, offset, MTRK)) {
      // An unrecognized chunk type is legal and must be skipped by its length.
      let unknownLength = view.getUint32(offset + 4);
      offset += 8 + unknownLength;
      continue;
    }
    let trackLength = view.getUint32(offset + 4);
    let trackStart = offset + 8;
    let trackEnd = Math.min(trackStart + trackLength, bytes.length);
    offset = trackStart + trackLength;
    trackIndex++;

    let reader = new TrackReader(bytes, trackStart, trackEnd);
    let ticks = 0;
    let runningStatus: number | undefined;
    let trackSounds = false;

    for (let event = 0; event < MAX_EVENTS_PER_TRACK; event++) {
      if (reader.exhausted) {
        break;
      }
      let delta = reader.variableLength();
      if (delta === undefined) {
        break;
      }
      ticks += delta;

      let statusByte = reader.peek();
      if (statusByte === undefined) {
        break;
      }
      let status: number;
      if (statusByte >= 0x80) {
        status = statusByte;
        reader.skip(1);
        // Running status persists only across channel messages.
        if (status < STATUS_SYSEX) {
          runningStatus = status;
        }
      } else if (runningStatus !== undefined) {
        // A data byte where a status was expected means the previous status
        // repeats — the compression every real MIDI file relies on.
        status = runningStatus;
      } else {
        break;
      }

      if (status === META_EVENT) {
        let type = reader.byte();
        let length = reader.variableLength();
        if (type === undefined || length === undefined) {
          break;
        }
        let payload = reader.slice(length);
        if (!payload) {
          break;
        }
        if (type === META_END_OF_TRACK) {
          break;
        }
        if (type === META_SET_TEMPO && payload.length >= 3) {
          let microseconds =
            (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!;
          if (microseconds > 0 && tempoChanges.length < MAX_TEMPO_ENTRIES) {
            tempoChanges.push({
              tick: ticks,
              microsecondsPerQuarter: microseconds,
            });
          }
        } else if (type === META_TIME_SIGNATURE && payload.length >= 2) {
          // The denominator is stored as a power of two.
          let signature = `${payload[0]}/${2 ** payload[1]!}`;
          if (
            !timeSignatures.includes(signature) &&
            timeSignatures.length < MAX_SIGNATURE_ENTRIES
          ) {
            timeSignatures.push(signature);
          }
        } else if (type === META_KEY_SIGNATURE && payload.length >= 2) {
          // A signed byte: negative counts flats, positive counts sharps.
          let accidentals = (payload[0]! << 24) >> 24;
          let isMinor = payload[1] === 1;
          let key = (isMinor ? MINOR_KEYS : MAJOR_KEYS)[accidentals];
          if (
            key &&
            !keySignatures.includes(key) &&
            keySignatures.length < MAX_SIGNATURE_ENTRIES
          ) {
            keySignatures.push(key);
          }
        }
        continue;
      }

      if (status === STATUS_SYSEX || status === STATUS_SYSEX_ESCAPE) {
        let length = reader.variableLength();
        if (length === undefined || !reader.slice(length)) {
          break;
        }
        continue;
      }

      let command = status & 0xf0;
      let channel = status & 0x0f;
      if (
        command === STATUS_PROGRAM_CHANGE ||
        command === STATUS_CHANNEL_PRESSURE
      ) {
        // One data byte.
        let value = reader.byte();
        if (value === undefined) {
          break;
        }
        if (
          command === STATUS_PROGRAM_CHANGE &&
          channel !== PERCUSSION_CHANNEL
        ) {
          if (!programs.includes(value)) {
            programs.push(value);
          }
        }
        continue;
      }
      if (
        command === STATUS_NOTE_ON ||
        command === STATUS_NOTE_OFF ||
        command === STATUS_POLY_AFTERTOUCH ||
        command === STATUS_CONTROL_CHANGE ||
        command === STATUS_PITCH_BEND
      ) {
        // Two data bytes.
        let first = reader.byte();
        let second = reader.byte();
        if (first === undefined || second === undefined) {
          break;
        }
        // A note-on with zero velocity is the conventional note-off, and
        // counting it would double every note in most files.
        if (command === STATUS_NOTE_ON && second > 0) {
          noteCount++;
          trackSounds = true;
          if (!channels.includes(channel)) {
            channels.push(channel);
          }
          if (channel === PERCUSSION_CHANNEL) {
            hasPercussion = true;
          } else {
            lowestPitch =
              lowestPitch === undefined ? first : Math.min(lowestPitch, first);
            highestPitch =
              highestPitch === undefined
                ? first
                : Math.max(highestPitch, first);
          }
        }
        continue;
      }
      // An unrecognized status means the walk has desynchronized; the metadata
      // gathered so far still stands.
      break;
    }

    if (trackSounds) {
      soundingTracks++;
    }
    longestTrackTicks = Math.max(longestTrackTicks, ticks);
  }

  let durationSeconds =
    ppq && longestTrackTicks > 0
      ? Math.round(
          ticksToSeconds(longestTrackTicks, ppq, tempoChanges) * 1000,
        ) / 1000
      : undefined;

  let tempoMap = tempoChanges.map(
    (change) =>
      `${Math.round(60_000_000 / change.microsecondsPerQuarter)} BPM @ tick ${
        change.tick
      }`,
  );

  return {
    format,
    ppq,
    durationSeconds,
    fileTrackCount: declaredTracks,
    trackCount: soundingTracks,
    noteCount,
    tempoMap: tempoMap.length > 0 ? tempoMap : undefined,
    timeSignatures: timeSignatures.length > 0 ? timeSignatures : undefined,
    keySignatures: keySignatures.length > 0 ? keySignatures : undefined,
    programs: programs.length > 0 ? unique(programs) : undefined,
    channels:
      channels.length > 0 ? unique(channels).map((c) => c + 1) : undefined,
    pitchRange:
      lowestPitch !== undefined && highestPitch !== undefined
        ? `${noteName(lowestPitch)}–${noteName(highestPitch)}`
        : undefined,
    hasPercussion,
  };
}
