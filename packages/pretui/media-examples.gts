// Pretui — media-examples: fixtures for the media territory.
//
// A media kit whose examples only work online is a kit you cannot review on
// a plane, cannot test headlessly, and cannot trust. So the primary fixtures
// here are GENERATED at module scope and carry no network dependency at all:
//
//   • `TONE_WAV` — six seconds of real, playable PCM audio, synthesised as a
//     `data:audio/wav` URL. A speech-shaped desk note over the twelve-note
//     bed: formants, syllable pulses, phrase pauses. A raw sine run paints
//     twelve identical blocks; this one has to look like a waveform people
//     recognise. No `Math.random`, no `Date.now`, no fetch: the same bytes
//     on every machine and every reindex.
//   • `SOURCING_VTT` — a real WebVTT file, also a data URL, compiled from
//     the same cue list the transcript renders. One source of truth for the
//     browser's caption channel and ours.
//   • `platePoster(...)` — deterministic SVG posters, so a grid of assets
//     has pictures without shipping a single binary.
//
// The colour literals in the generated SVGs are CONTENT, not styling: they
// stand in for photographs. Nothing in a component reads them, and the
// no-hand-authored-colours rule is about component CSS.
//
// The video fixture is the one exception and is marked as such: there is no
// way to synthesise an mp4 in twenty lines. It points at the public test
// asset Media Chrome's own documentation uses, and every demo takes it as a
// replaceable knob. Offline it exercises the error channel, which is a
// perfectly good thing for a demo to show.
import { seedFrom } from './examples';
import type { MediaTrackSpec, TranscriptCue } from './components/media-player';
import { formatClock } from './internal/reading-format';
import type { MediaAssetSpec } from './internal/media-viewer';

// ── A playable tone, from arithmetic ─────────────────────────────────────

const TONE_RATE = 22050;
const TONE_NOTE_SECONDS = 0.5;
// A plain modal run. Fixed, so the waveform is byte-identical everywhere.
const TONE_NOTES = [
  392, 440, 523.25, 587.33, 659.25, 523.25, 440, 392, 349.23, 392, 440, 523.25,
];
// Phrase energy for the six one-second cues in SOURCING_TRANSCRIPT — buyer
// lines hit harder, the close tapers. Index is floor(t).
const TONE_PHRASE = [0.82, 0.7, 1, 0.56, 0.94, 0.46];

/** Seconds of audio in `TONE_WAV`. */
export const TONE_SECONDS = TONE_NOTES.length * TONE_NOTE_SECONDS;

/** Speech-shaped amplitude at time `t` (seconds). Deterministic: the same
 * syllable pulses and pauses on every machine, so the painted peaks stay
 * a desk note rather than twelve equal bricks. */
function toneEnvelope(t: number): number {
  const phrase = Math.min(TONE_PHRASE.length - 1, Math.floor(t));
  const local = t - Math.floor(t);
  const attack = Math.min(1, local / 0.045);
  const release = Math.min(1, Math.max(0, (0.9 - local) / 0.08));
  const pause = local > 0.86 ? 0.12 : 1;
  const rate = 4.15 + (phrase % 3) * 0.38;
  const syllable = Math.sin(Math.PI * rate * local);
  const pulse = 0.22 + 0.78 * syllable * syllable;
  return TONE_PHRASE[phrase] * attack * release * pause * pulse;
}

/** One PCM sample in [-1, 1]: the note bed, two formants, a sibilant on
 * the syllable attack, and a thin room tone so quiet gaps still draw. */
function toneSample(t: number): number {
  const note = TONE_NOTES[Math.min(TONE_NOTES.length - 1, Math.floor(t / TONE_NOTE_SECONDS))];
  const env = toneEnvelope(t);
  const twoPi = 2 * Math.PI * t;
  const bed =
    0.62 * Math.sin(twoPi * note) +
    0.22 * Math.sin(twoPi * note * 2) +
    0.1 * Math.sin(twoPi * note * 3);
  const formant =
    0.16 * Math.sin(twoPi * 720) * env + 0.09 * Math.sin(twoPi * 1380) * env;
  const sibilant = 0.07 * Math.sin(twoPi * 4100) * env * env;
  const room = 0.035 * Math.sin(twoPi * 68) + 0.02 * Math.sin(twoPi * 190);
  const value = bed * env + formant + sibilant + room;
  return Math.max(-1, Math.min(1, value * 0.78));
}

function toneWav(): string {
  const samples = Math.round(TONE_RATE * TONE_SECONDS);
  const dataBytes = samples * 2;
  const bytes: number[] = [];
  const ascii = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      bytes.push(text.charCodeAt(i));
    }
  };
  const u32 = (n: number) => {
    bytes.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  };
  const u16 = (n: number) => {
    bytes.push(n & 255, (n >>> 8) & 255);
  };
  const i16 = (n: number) => {
    const v = n < 0 ? n + 65536 : n;
    bytes.push(v & 255, (v >>> 8) & 255);
  };
  // Canonical 44-byte RIFF/WAVE header: PCM, mono, 16-bit signed.
  ascii('RIFF');
  u32(36 + dataBytes);
  ascii('WAVE');
  ascii('fmt ');
  u32(16);
  u16(1);
  u16(1);
  u32(TONE_RATE);
  u32(TONE_RATE * 2);
  u16(2);
  u16(16);
  ascii('data');
  u32(dataBytes);
  for (let i = 0; i < samples; i++) {
    i16(Math.round(toneSample(i / TONE_RATE) * 32767));
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.slice(i, i + 4096));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Six seconds of playable audio, with no network and no binary in tree. */
export const TONE_WAV: string = toneWav();

// ── The transcript, and the VTT compiled from it ─────────────────────────

/** The sourcing desk, dictating a lot note over the tone. Cue boundaries
 * line up with the twelve half-second notes. */
export const SOURCING_TRANSCRIPT: readonly TranscriptCue[] = [
  {
    start: 0,
    end: 1,
    speaker: 'Desk',
    text: 'Lot B-1180, second flush, booked against the Kandy line.',
  },
  {
    start: 1,
    end: 2,
    speaker: 'Desk',
    text: 'Twenty-six chests landed, two held back for the cupping table.',
  },
  {
    start: 2,
    end: 3,
    speaker: 'Buyer',
    text: 'Colour is right. The liquor reads a shade thin against last season.',
  },
  {
    start: 3,
    end: 4,
    speaker: 'Desk',
    text: 'Noted. I will flag it on the manifest before it goes out.',
  },
  {
    start: 4,
    end: 5,
    speaker: 'Buyer',
    text: 'Price holds. Take the whole line and we settle on Friday.',
  },
  {
    start: 5,
    end: 6,
    speaker: 'Desk',
    text: 'Agreed — the whole line, Friday. Recording ends.',
  },
];

function vttTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor(whole / 60) % 60).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`;
}

/** Compile cues to a WebVTT document. The transcript and the browser's own
 * caption track then cannot disagree, which is the bug every hand-written
 * example in this space eventually ships. */
export function vttFrom(cues: readonly TranscriptCue[]): string {
  const body = cues
    .map((cue, i) => {
      const who = cue.speaker ? `<v ${cue.speaker}>` : '';
      return `${i + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${who}${cue.text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** The same cues as a `data:text/vtt` URL, ready for a `<track src>`. */
export const SOURCING_VTT: string = `data:text/vtt;charset=utf-8,${encodeURIComponent(
  vttFrom(SOURCING_TRANSCRIPT),
)}`;

/** One English captions track, offline. */
export const SOURCING_TRACKS: readonly MediaTrackSpec[] = [
  {
    src: SOURCING_VTT,
    label: 'English',
    srclang: 'en',
    kind: 'captions',
    isDefault: true,
  },
];

// ── Deterministic SVG posters ────────────────────────────────────────────

const PLATE_INKS = [
  ['#1f2933', '#7b8794'],
  ['#26343f', '#8aa1a8'],
  ['#2f2a3a', '#9a8fb0'],
  ['#33291f', '#b09a7d'],
  ['#1f3329', '#7fae94'],
];

/** A poster that looks composed rather than generated: two-tone ground, a
 * horizon, one disc. Seeded from the label, so the same asset always wears
 * the same plate. */
export function platePoster(label: string, ratio = '16 / 9'): string {
  const seed = seedFrom(label);
  const parts = ratio.split('/');
  const w = 640;
  const h = Math.round(
    (640 * (Number(parts[1]) || 9)) / (Number(parts[0]) || 16),
  );
  const inks = PLATE_INKS[seed % PLATE_INKS.length];
  const horizon = Math.round(h * (0.42 + ((seed >>> 3) % 24) / 100));
  const cx = Math.round(w * (0.24 + ((seed >>> 7) % 52) / 100));
  const r = Math.round(h * (0.1 + ((seed >>> 11) % 12) / 100));
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${inks[0]}"/>`,
    `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="${inks[1]}" opacity="0.35"/>`,
    `<circle cx="${cx}" cy="${horizon}" r="${r}" fill="${inks[1]}" opacity="0.85"/>`,
    `<rect y="${horizon}" width="${w}" height="1.5" fill="${inks[1]}"/>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── The one networked fixture ────────────────────────────────────────────

/** Public test clip used by Media Chrome's own documentation. Every demo
 * takes it as a knob; offline, the player lands on its error channel. */
export const SAMPLE_VIDEO_SRC =
  'https://stream.mux.com/A3VXy02VoUinw01pwyomEO3bHnG4P32xzV7u1j1FSzjNg/high.mp4';

/** A generated poster rather than a fetched thumbnail, so the reserved
 * space is filled even with no network. */
export const SAMPLE_VIDEO_POSTER: string = platePoster('tea-trade-reel');

// ── An asset shelf for the grid and the viewer ───────────────────────────

const SHELF: Array<[string, string, string, number, number, number]> = [
  ['Kandy plate 04', 'jpg', 'image/jpeg', 1600, 1067, 842_000],
  ['Dust grade macro', 'jpg', 'image/jpeg', 1400, 1400, 1_140_000],
  ['Chest 118 stencil', 'png', 'image/png', 900, 1200, 318_000],
  ['Estate reel', 'mp4', 'video/mp4', 1920, 1080, 18_400_000],
  ['Cupping notes', 'wav', 'audio/wav', 0, 0, 1_320_000],
  ['Auction floor', 'jpg', 'image/jpeg', 2000, 1333, 1_680_000],
  ['Crate, exploded', 'glb', 'model/gltf-binary', 0, 0, 4_900_000],
  ['Grading chart', 'png', 'image/png', 1200, 800, 210_000],
];

/** Eight assets across four kinds, so `MediaViewer` routing and `AssetGrid`
 * both have something honest to chew on — including one kind (`model`) that
 * deliberately has no adapter yet. */
export const SAMPLE_ASSETS: readonly MediaAssetSpec[] = SHELF.map(
  ([name, ext, mime, width, height, bytes]) => {
    const kindRatio = width && height ? `${width} / ${height}` : '16 / 9';
    const timeBased = mime.startsWith('audio') || mime.startsWith('video');
    return {
      src: mime.startsWith('audio')
        ? TONE_WAV
        : mime.startsWith('video')
          ? SAMPLE_VIDEO_SRC
          : `https://assets.example.invalid/sourcing/${encodeURIComponent(name)}.${ext}`,
      name,
      mimeType: mime,
      thumbnail: platePoster(name, kindRatio),
      poster: platePoster(name, kindRatio),
      alt: `${name} — a generated stand-in plate`,
      width: width || undefined,
      height: height || undefined,
      bytes,
      duration: timeBased ? TONE_SECONDS : undefined,
      tracks: timeBased ? SOURCING_TRACKS : undefined,
      transcript: timeBased ? SOURCING_TRANSCRIPT : undefined,
      meta: {
        Format: ext.toUpperCase(),
        Origin: 'Sourcing desk',
        Duration: timeBased ? formatClock(TONE_SECONDS) : '—',
      },
    };
  },
);

/** The audio asset on its own, for the single-asset demos. */
export const TONE_ASSET: MediaAssetSpec = {
  src: TONE_WAV,
  name: 'Lot B-1180 — desk note',
  mimeType: 'audio/wav',
  thumbnail: platePoster('Lot B-1180 — desk note', '1 / 1'),
  duration: TONE_SECONDS,
  bytes: TONE_RATE * TONE_SECONDS * 2 + 44,
  tracks: SOURCING_TRACKS,
  transcript: SOURCING_TRANSCRIPT,
  meta: {
    Format: 'WAV · 22 kHz · 16-bit mono',
    Origin: 'Synthesised in media-examples.gts',
    Duration: formatClock(TONE_SECONDS),
  },
};
