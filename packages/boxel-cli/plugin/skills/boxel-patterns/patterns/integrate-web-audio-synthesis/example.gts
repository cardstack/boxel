import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { on } from '@ember/modifier';

// 🧩 PATTERN: synthesized sound feedback with no library.
//
// `AudioContext` ships in every modern browser. A short oscillator +
// a gain envelope is enough for click / success / error / win tones —
// the same recipe powers the avatar creator's `playClickSound`.
//
// Module-level singleton AudioContext: browsers cap the number of
// contexts (often 6) and resume them per user gesture. One shared
// context across cards avoids the cap and the per-card resume dance.

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx) {
    const Ctor =
      window.AudioContext || (window as any).webkitAudioContext;
    _ctx = new Ctor();
  }
  return _ctx;
}

/**
 * Tiny helper for UI sound feedback. Each call builds a short
 * oscillator with a frequency sweep and an exponential gain decay,
 * starts it, schedules a stop, then lets the browser GC the nodes.
 */
function playTone(opts: {
  freqStart: number;
  freqEnd?: number;
  duration: number;
  volume?: number;
}): void {
  const { freqStart, duration } = opts;
  const freqEnd = opts.freqEnd ?? freqStart;
  const volume = opts.volume ?? 0.3;

  try {
    const ctx = getCtx();
    // Safari often suspends the context until a user gesture; resume
    // is idempotent and a no-op when running.
    void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain).connect(ctx.destination);

    // Frequency envelope: sweep from start → end across the duration.
    osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(freqEnd, 1),
        ctx.currentTime + duration,
      );
    }

    // Gain envelope: 0 → volume in 10ms (snappy attack), then
    // exponential decay to near-silence over `duration`.
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + duration,
    );

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio context creation can fail in private-browsing contexts
    // or before any user gesture — silently no-op.
  }
}

// Presets for UI feedback.
const click = () => playTone({ freqStart: 800, freqEnd: 400, duration: 0.1 });
const success = () =>
  playTone({ freqStart: 660, freqEnd: 880, duration: 0.2 });
const errorTone = () =>
  playTone({ freqStart: 220, freqEnd: 100, duration: 0.3, volume: 0.4 });

export class SoundFeedbackDemo extends CardDef {
  static displayName = 'Sound Feedback Demo';

  @field title = contains(StringField);

  static isolated = class Isolated extends Component<
    typeof SoundFeedbackDemo
  > {
    click = () => click();
    success = () => success();
    error = () => errorTone();

    <template>
      <div class='demo'>
        <h1>{{if @model.title @model.title 'Sound Feedback'}}</h1>
        <div class='buttons'>
          <button type='button' {{on 'click' this.click}}>Click</button>
          <button type='button' {{on 'click' this.success}}>Success</button>
          <button type='button' {{on 'click' this.error}}>Error</button>
        </div>
      </div>

      <style scoped>
        .demo {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          align-items: center;
        }
        .buttons {
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
      </style>
    </template>
  };
}

// --- Notes ---
//
// - `ctx.resume()` is idempotent. Calling it on every play is safe
//   and protects against the autoplay-blocked-until-gesture case.
//
// - `osc.stop(t)` schedules the stop in the audio clock's future;
//   the node is disposed by the engine after that — no manual
//   cleanup of short one-shot tones required.
//
// - For longer instruments (a pad held for seconds, a polyphonic
//   synth across many notes), keep an explicit handle and call
//   `osc.disconnect()` + `osc.stop()` from a Glimmer-modifier
//   teardown so the audio graph doesn't grow without bound.
//
// - Don't allocate `new AudioContext()` per call. The browser caps
//   the count; the module-level singleton above keeps it at one.
