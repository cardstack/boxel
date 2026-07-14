---
validated: source-proven
---

# integrate-tone-js-via-cdn — Tone.js inside a card, loaded once via `<script>` tag

**What this gives you:** A full music-toolkit (`Tone.Synth`, `Tone.PolySynth`, `Tone.Sequence`, `Tone.Transport`, effects chains, samplers) inside a Boxel card. Same lifecycle shape as `integrate-three-js-via-cdn` and `integrate-web-audio-synthesis`.

**When to use:** Anything sound-design-heavy — drum machines, melodic interfaces, harmonic explainers, generative ambient cards, sound-effect previews. Pick Tone.js over raw Web Audio when you want polyphony, scheduled sequences, or effects (reverb, delay, distortion) without hand-rolling them.

**The insight:** Tone.js ships a UMD build that registers `window.Tone`. The simplest reliable way to use it inside a Boxel card is to inject a `<script>` tag the first time the card needs sound, await `script.onload`, and read from `(globalThis as any).Tone`. (Direct ESM import — `import * as Tone from 'https://esm.run/tone@14'` — works in dev, but realm-server module loading has historically been finicky with CDN ESM. The script-tag approach is what the live drum-sequencer card uses.)

Two browser quirks shape the lifecycle:

1. **Autoplay policy.** `Tone.start()` (which resumes the audio context) MUST be called from a user gesture handler — the first button click is the canonical place. Call on every play; it's idempotent.
2. **Web Audio resource accounting.** `Tone.Synth`, `Tone.Reverb`, etc. allocate audio nodes. Call `.dispose()` in `willDestroy` so the graph collapses when the card unmounts.

## Recipe shape

```ts
const TONE_CDN_URL = 'https://unpkg.com/tone@14.7.77/build/Tone.js';
let toneLoaderPromise: Promise<void> | null = null;

function loadToneJs(): Promise<void> {
  if ((globalThis as any).Tone) return Promise.resolve();
  if (toneLoaderPromise) return toneLoaderPromise;
  toneLoaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TONE_CDN_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return toneLoaderPromise;
}

const tone = () => (globalThis as any).Tone;
```

```ts
// In the Component:
private synth: any = null;

async initialize() {
  await loadToneJs();
  const Tone = tone();
  this.synth = new Tone.PolySynth(Tone.Synth).toDestination();
  this.ready = true;
}

play = async (note: string) => {
  const Tone = tone();
  await Tone.start();                       // autoplay gate
  this.synth.triggerAttackRelease(note, '8n');
};

willDestroy() {
  super.willDestroy();
  this.synth?.dispose();                    // free Web Audio nodes
}
```

## Conventions

- **Pin the CDN version.** `tone@14.7.77` not `tone@14`. Unpinned URLs silently break when the upstream library publishes a major version.
- **Module-scope the loader.** One `loadToneJs()` promise per browser session; subsequent cards reuse the cached `window.Tone`.
- **One audio context across cards.** Two cards using Tone in the same session share `Tone.context`. That's normally what you want; if not, create a private `new Tone.Context()` and pass it explicitly.
- **`Tone.start()` is idempotent.** Call it on every play handler — it resolves immediately when the context is already running.

## Gotchas

- **Autoplay-blocked silence.** Without `await Tone.start()` inside a user gesture, the first sound is silent and the browser logs an `AudioContext was not allowed to start` warning. Always include it.
- **Sequencer / sampler creation order.** Build `Tone.Sequence`, `Tone.Sampler`, etc. _after_ `Tone.start()`. They reference the global audio clock; created before resume, they sit silent until you tear them down and rebuild.
- **Dispose on unmount.** `Tone.Synth` and effects allocate Web Audio nodes that don't auto-collapse. Call `.dispose()` in `willDestroy` to avoid graph growth across format switches and navigation.
- **Sample loading is async.** `Tone.Sampler({ urls: ... })` returns immediately but isn't playable until the `onload` callback fires. Gate playback on a `@tracked samplesReady` flag.

## Source

- `app.boxel.ai/chris/heather-park/drum-sequencer.gts` — drum sequencer with `Tone.Sampler` loading kick/snare/hihat/clap samples. Script-tag loader at lines 624–658, sampler initialization at lines 661–701, cleanup at lines 711–719.

## See also

- `integrate-web-audio-synthesis` — when you don't need polyphony, sequences, or effects — raw `AudioContext` is lighter.
- `integrate-three-js-via-cdn` — same lifecycle shape (CDN load + module-scope promise + dispose on teardown) for a different library.
- Tone.js docs: <https://tonejs.github.io/docs/>.
