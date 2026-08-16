// The MIDI family's renderer, projected into the four format shells by
// `FilePreviewStage`. A Standard MIDI File is symbolic performance data — which
// notes to play and when — with no sound until a synthesizer renders it, and no
// browser plays one from an `<audio>` element. So unlike `AudioPreview` this
// draws no player and no amplitude waveform: it presents what the sequence *is*.
//
// The distinct visual is a pitch band — the piano's span with the piece's own
// range shaded across it — over a summary of the facts the extract pass read
// from the header and event stream: tracks, notes, running time, tempo, key,
// meter, and the General MIDI voices the programs name. Everything shown is a
// field the `MidiMetadataField` already carries, so this stays a view of
// extracted data, never a re-parse.
import GlimmerComponent from '@glimmer/component';

import KeyboardMusicIcon from '@cardstack/boxel-icons/keyboard-music';
import { eq } from '@cardstack/boxel-ui/helpers';

import { formatClock } from './file-presentation';
import type { FilePreviewSignature } from './file-preview-stage';

// The General MIDI Level 1 sound set. A program number names one of these, so a
// bare "program 40" becomes "Violin" — the difference between a debug dump and a
// preview. Percussion (channel 10) is excluded upstream, where a program names a
// kit rather than an instrument.
const GM_INSTRUMENTS = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano',
  'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord',
  'Clavinet', 'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer', 'Drawbar Organ',
  'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ',
  'Accordion', 'Harmonica', 'Tango Accordion', 'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)', 'Electric Guitar (jazz)',
  'Electric Guitar (clean)', 'Electric Guitar (muted)', 'Overdriven Guitar',
  'Distortion Guitar', 'Guitar Harmonics', 'Acoustic Bass',
  'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2', 'Violin',
  'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings',
  'Orchestral Harp', 'Timpani', 'String Ensemble 1', 'String Ensemble 2',
  'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs',
  'Synth Voice', 'Orchestra Hit', 'Trumpet', 'Trombone', 'Tuba',
  'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1',
  'Synth Brass 2', 'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet', 'Piccolo', 'Flute',
  'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle',
  'Ocarina', 'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)',
  'Lead 4 (chiff)', 'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)',
  'Lead 8 (bass + lead)', 'Pad 1 (new age)', 'Pad 2 (warm)',
  'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)', 'Pad 6 (metallic)',
  'Pad 7 (halo)', 'Pad 8 (sweep)', 'FX 1 (rain)', 'FX 2 (soundtrack)',
  'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)',
  'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)', 'Sitar', 'Banjo',
  'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum',
  'Melodic Tom', 'Synth Drum', 'Reverse Cymbal', 'Guitar Fret Noise',
  'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter',
  'Applause', 'Gunshot',
];

// The piano's own span, MIDI 21 (A0) to 108 (C8), used to place the piece's
// pitch range proportionally across the band.
const PIANO_LOW = 21;
const PIANO_HIGH = 108;
const SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

// Parse a note name like `C2`, `F#4`, or `Bb5` to a MIDI number, or undefined
// when it isn't one. Only used to place the range band, so an unrecognized
// convention simply leaves the band unshaded rather than failing.
function noteToMidi(note: string): number | undefined {
  let match = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/.exec(note.trim());
  if (!match) {
    return undefined;
  }
  let base = SEMITONE[match[1]!.toUpperCase()];
  if (base === undefined) {
    return undefined;
  }
  let accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0;
  let octave = Number(match[3]);
  return (octave + 1) * 12 + base + accidental;
}

export class MidiPreview extends GlimmerComponent<FilePreviewSignature> {
  get midi(): any {
    return this.args.model?.midi;
  }

  get duration(): string {
    return formatClock(this.args.model?.durationSeconds);
  }

  get title(): string {
    return (
      this.args.model?.baseName || this.args.model?.name || 'MIDI sequence'
    );
  }

  // The single facts, each shown only when the header actually carried it, so a
  // sparse file reads as sparse rather than padded with zeros.
  get chips(): { label: string; value: string }[] {
    let m = this.midi;
    if (!m) {
      return [];
    }
    let chips: { label: string; value: string }[] = [];
    let add = (label: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') {
        chips.push({ label, value: String(value) });
      }
    };
    if (m.trackCount) {
      add('Tracks', m.trackCount);
    }
    if (m.noteCount) {
      add('Notes', m.noteCount.toLocaleString());
    }
    if (this.duration) {
      add('Length', this.duration);
    }
    let tempo = Array.from(m.tempoMap ?? [])[0];
    add('Tempo', tempo);
    let key = Array.from(m.keySignatures ?? [])[0];
    add('Key', key);
    let meter = Array.from(m.timeSignatures ?? [])[0];
    add('Meter', meter);
    add('Range', m.pitchRange);
    if (m.hasPercussion) {
      add('Kit', 'Percussion');
    }
    return chips;
  }

  // The General MIDI voices the piece names, deduped and bounded — a preview,
  // not an exhaustive event dump.
  get instruments(): string[] {
    let programs = Array.from(this.midi?.programs ?? []) as number[];
    let seen = new Set<string>();
    let names: string[] = [];
    for (let program of programs) {
      let name = GM_INSTRUMENTS[Number(program)];
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      if (names.length >= 10) {
        break;
      }
    }
    return names;
  }

  // The piece's pitch range as a fraction of the piano, or undefined when either
  // endpoint isn't a note name we recognize.
  get rangeBand(): { left: number; width: number } | undefined {
    let range = this.midi?.pitchRange;
    if (!range) {
      return undefined;
    }
    // Split only on the en/em dash the extractor joins with — an ASCII hyphen
    // is part of negative-octave note names like C-1.
    let parts = String(range).split(/\s*[–—]\s*/);
    if (parts.length !== 2) {
      return undefined;
    }
    let low = noteToMidi(parts[0]!);
    let high = noteToMidi(parts[1]!);
    if (low === undefined || high === undefined) {
      return undefined;
    }
    let span = PIANO_HIGH - PIANO_LOW;
    let clamp = (n: number) => Math.max(0, Math.min(100, ((n - PIANO_LOW) / span) * 100));
    let a = clamp(Math.min(low, high));
    let b = clamp(Math.max(low, high));
    return { left: a, width: Math.max(b - a, 1.5) };
  }

  get rangeStyle(): string {
    let band = this.rangeBand;
    return band ? `left:${band.left}%;width:${band.width}%` : '';
  }

  <template>
    {{#if (eq @mode 'fitted')}}
      <div class='midi-fitted' data-test-midi-fitted>
        <KeyboardMusicIcon class='midi-glyph' width='30' height='30' />
        <div class='midi-fit-facts'>
          {{#if this.duration}}
            <span
              class='midi-fit-clock'
              data-test-midi-duration
            >{{this.duration}}</span>
          {{/if}}
          {{#if this.midi.trackCount}}
            <span class='midi-fit-sub'>{{this.midi.trackCount}} tracks</span>
          {{/if}}
        </div>
      </div>
    {{else}}
      <div class='midi' data-mode={{@mode}} data-test-midi-preview>
        <div class='midi-head'>
          <KeyboardMusicIcon
            class='midi-head-glyph'
            width='18'
            height='18'
            aria-hidden='true'
          />
          <span class='midi-title' title={{this.title}}>{{this.title}}</span>
          {{#if this.duration}}
            <span
              class='midi-clock'
              data-test-midi-duration
            >{{this.duration}}</span>
          {{/if}}
        </div>

        <div class='pitch'>
          <div class='pitch-band'>
            {{#if this.rangeBand}}
              <div class='pitch-range' style={{this.rangeStyle}}></div>
            {{/if}}
          </div>
          <div class='pitch-axis'>
            <span>A0</span>
            <span>middle C</span>
            <span>C8</span>
          </div>
        </div>

        {{#if this.chips.length}}
          <dl class='chips'>
            {{#each this.chips as |chip|}}
              <div class='chip'>
                <dt>{{chip.label}}</dt>
                <dd>{{chip.value}}</dd>
              </div>
            {{/each}}
          </dl>
        {{/if}}

        {{#if this.instruments.length}}
          <div class='voices' data-test-midi-voices>
            <span class='voices-label'>Voices</span>
            <ul class='voices-list'>
              {{#each this.instruments as |name|}}
                <li>{{name}}</li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* Fitted: the keyboard glyph identifies the family; the running time and
         track count are the two facts a cell has room for. */
      .midi-fitted {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px;
        text-align: center;
      }
      .midi-glyph {
        color: var(--fd-accent, var(--primary, #7c5cff));
      }
      .midi-fit-facts {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        min-width: 0;
      }
      .midi-fit-clock {
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
      }
      .midi-fit-sub {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }

      /* Embedded/isolated */
      .midi {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px 14px 14px;
        background: var(--card, #fff);
        color: var(--card-foreground, var(--foreground));
        font-family: var(--font-sans);
        overflow: auto;
      }
      .midi-head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex-shrink: 0;
      }
      .midi-head-glyph {
        color: var(--fd-accent, var(--primary, #7c5cff));
        flex-shrink: 0;
      }
      .midi-title {
        font-size: 0.8125rem;
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .midi-clock {
        margin-left: auto;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }

      /* Pitch band: the piano's span, with the piece's range shaded across it —
         a proportional, honest stand-in for a piano-roll when only the range is
         known. */
      .pitch {
        flex-shrink: 0;
      }
      .pitch-band {
        position: relative;
        height: 34px;
        border-radius: 5px;
        border: 1px solid var(--border);
        overflow: hidden;
        /* An octave lattice: the twelve-semitone repeat reads as a keyboard. */
        background-color: var(--fd-stage, var(--muted, #eceef1));
        background-image: repeating-linear-gradient(
          90deg,
          transparent 0 calc(100% / 88 * 12 - 1px),
          var(--border) calc(100% / 88 * 12 - 1px) calc(100% / 88 * 12)
        );
      }
      .pitch-range {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--fd-accent, var(--primary, #7c5cff));
        opacity: 0.55;
        border-radius: 2px;
      }
      .pitch-axis {
        display: flex;
        justify-content: space-between;
        margin-top: 3px;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }

      /* Fact chips */
      .chips {
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px 8px;
        flex-shrink: 0;
      }
      .chip {
        display: flex;
        align-items: baseline;
        gap: 5px;
        padding: 3px 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--fd-stage, var(--muted, #eceef1));
      }
      .chip dt {
        font-family: var(--font-mono);
        font-size: 0.5rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .chip dd {
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      /* Voices */
      .voices {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-height: 0;
      }
      .voices-label {
        font-family: var(--font-mono);
        font-size: 0.53125rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .voices-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 6px;
      }
      .voices-list li {
        font-size: 0.6875rem;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--fd-accent-soft, rgb(124 92 255 / 12%));
        color: var(--foreground);
      }
    </style>
  </template>
}
