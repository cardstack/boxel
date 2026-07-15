import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

// 🧩 PATTERN: Tone.js inside a card, loaded once via <script> tag.
//
// Tone.js ships a UMD build that registers `window.Tone`. The simplest
// reliable way to use it inside a Boxel card is to inject a <script>
// tag the first time the card needs sound, await `script.onload`, and
// then read from `(globalThis as any).Tone`.
//
// (You can also `import * as Tone from 'https://esm.run/tone@14'` —
// works in dev, but realm-server module loading has historically been
// finicky with CDN ESM. The <script> tag approach is the pattern that
// the live drum-sequencer card uses.)
//
// Browser autoplay policy: `Tone.start()` (which resumes the audio
// context) MUST be called from a user gesture handler — the first
// button click is the canonical place.

const TONE_CDN_URL = 'https://unpkg.com/tone@14.7.77/build/Tone.js';
let toneLoaderPromise: Promise<void> | null = null;

function loadToneJs(): Promise<void> {
  if ((globalThis as any).Tone) return Promise.resolve();
  if (toneLoaderPromise) return toneLoaderPromise;

  toneLoaderPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TONE_CDN_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
  return toneLoaderPromise;
}

function tone(): any {
  return (globalThis as any).Tone;
}

export class ChordPlayer extends CardDef {
  static displayName = 'Chord Player';

  @field title = contains(StringField);

  static isolated = class Isolated extends Component<typeof ChordPlayer> {
    @tracked ready = false;
    @tracked error: string | null = null;
    private synth: any = null;
    private reverb: any = null;

    constructor(owner: any, args: any) {
      super(owner, args);
      this.initialize();
    }

    private async initialize() {
      try {
        await loadToneJs();
        const Tone = tone();

        // PolySynth — many voices at once — through a reverb send to
        // give the chord a hall feel.
        this.reverb = new Tone.Reverb(2.5).toDestination();
        this.synth = new Tone.PolySynth(Tone.Synth).connect(this.reverb);
        this.ready = true;
      } catch (e: any) {
        this.error = e?.message ?? 'Failed to load Tone.js';
      }
    }

    play = async (chord: string[]) => {
      const Tone = tone();
      if (!Tone || !this.synth) return;
      // Autoplay gate — safe to call on every click.
      await Tone.start();
      this.synth.triggerAttackRelease(chord, '8n');
    };

    playC = () => this.play(['C4', 'E4', 'G4']);
    playF = () => this.play(['F4', 'A4', 'C5']);
    playG = () => this.play(['G4', 'B4', 'D5']);

    willDestroy() {
      super.willDestroy();
      // Tone.js objects allocate Web Audio nodes — dispose so the
      // graph collapses when the card unmounts.
      this.synth?.dispose();
      this.reverb?.dispose();
    }

    <template>
      <div class='chord-player'>
        <h1>{{if @model.title @model.title 'Chord Player'}}</h1>

        {{#if this.error}}
          <p class='error'>{{this.error}}</p>
        {{else if this.ready}}
          <div class='keys'>
            <button type='button' {{on 'click' this.playC}}>C major</button>
            <button type='button' {{on 'click' this.playF}}>F major</button>
            <button type='button' {{on 'click' this.playG}}>G major</button>
          </div>
        {{else}}
          <p>Loading Tone.js…</p>
        {{/if}}
      </div>

      <style scoped>
        .chord-player {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          align-items: center;
        }
        .keys {
          display: flex;
          gap: 0.75rem;
        }
        button {
          padding: 0.75rem 1.25rem;
          border-radius: 8px;
          border: 1px solid var(--border, #ccc);
          background: var(--card, white);
          cursor: pointer;
          font-size: 1rem;
        }
        .error {
          color: crimson;
        }
      </style>
    </template>
  };
}

// --- Notes ---
//
// - Same lifecycle shape as integrate-three-js-via-cdn — load once at
//   module scope, dispose in `willDestroy`. The difference is Tone
//   allocates Web Audio nodes (oscillators, gain, effect chains)
//   rather than GPU resources.
//
// - Pin the version in the CDN URL (`tone@14.7.77`). Unpinned URLs
//   silently break when the upstream library publishes a major.
//
// - For transports, sequences, and samplers, build them after
//   `Tone.start()`. They reference the global audio clock; created
//   before resume, they sit silent.
//
// - Audio context is shared across cards. Two cards using Tone in the
//   same session connect to the same `Tone.context`. That's normally
//   what you want; if not, create a private `new Tone.Context()` and
//   pass it explicitly.
