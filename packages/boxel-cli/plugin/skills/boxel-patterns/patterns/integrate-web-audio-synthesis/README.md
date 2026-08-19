---
validated: source-proven
---

# integrate-web-audio-synthesis — `AudioContext` + oscillator + gain envelope, no library

**What this gives you:** Real-time sound synthesis (clicks, success tones, error buzzes, drum hits, UI feedback) inside a Boxel card, generated entirely in JavaScript. Zero audio assets, no library to load.

**When to use:**
- UI sound feedback — button clicks, success / error chirps, completion chimes.
- One-shot percussive sounds — drum machines, metronomes, timer alerts.
- Simple melodic sketches — toy synths, scale demonstrations.
- Any time `<audio src='click.mp3'>` would mean shipping an asset for two notes.

Pick `integrate-tone-js-via-cdn` instead when you need polyphony, scheduled sequences, samplers, or effects (reverb / delay / distortion).

**The insight:** A short oscillator + a gain envelope is enough for most UI sounds — the same recipe powers the avatar creator's `playClickSound`. Two browser quirks shape the design:

1. **Autoplay policy.** Browsers suspend the audio context until a user gesture. Call `ctx.resume()` before every play — it's idempotent.
2. **Resource accounting.** Browsers cap the number of `AudioContext` instances (often 6). One shared module-level singleton across cards avoids the cap and the per-card resume dance.

`osc.stop(t)` schedules the stop in the audio clock's future; the engine disposes the node after that. For one-shot tones, no manual cleanup is required.

## Recipe shape

```ts
let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    _ctx = new Ctor();
  }
  return _ctx;
}

function playTone(opts: {
  freqStart: number; freqEnd?: number;
  duration: number; volume?: number;
}) {
  const { freqStart, duration } = opts;
  const freqEnd = opts.freqEnd ?? freqStart;
  const volume = opts.volume ?? 0.3;
  try {
    const ctx = getCtx();
    void ctx.resume();                              // safe to call every time
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);

    osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(freqEnd, 1), ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch { /* private browsing, no user gesture yet — silent no-op */ }
}
```

## Preset library

A small set of feedback tones covers most UI needs:

```ts
const click   = () => playTone({ freqStart: 800, freqEnd: 400, duration: 0.1 });
const success = () => playTone({ freqStart: 660, freqEnd: 880, duration: 0.2 });
const error   = () => playTone({ freqStart: 220, freqEnd: 100, duration: 0.3, volume: 0.4 });
const tick    = () => playTone({ freqStart: 1200, duration: 0.04 });
```

Sweep direction sets the affect: ↗ rising = success / win, ↘ falling = click / dismiss, deep falling = error.

## Conventions

- **Singleton context.** Don't allocate `new AudioContext()` per call — the browser caps the count. The module-level `_ctx` keeps it at one across all cards in the session.
- **`ctx.resume()` on every play.** Idempotent and protects against the autoplay-blocked-until-gesture case.
- **`osc.stop(t)` schedules disposal.** The node is disposed by the engine after that audio-clock time; no manual cleanup of short one-shot tones required.
- **Try/catch the whole thing.** Audio context creation can fail in private browsing or before any user gesture. Silently no-op so the rest of the card keeps working.

## Gotchas

- **One context per session, not per card.** Multiple cards making sound share `_ctx`. That's normally what you want.
- **Long-running nodes leak.** For instruments held longer than a moment (a pad held for seconds, a polyphonic synth across many notes), keep an explicit handle and call `osc.disconnect()` + `osc.stop()` from a Glimmer-modifier teardown so the audio graph doesn't grow without bound.
- **`exponentialRampToValueAtTime` to 0 is invalid.** The target must be > 0 — use `0.0001` (effectively silent). To 0 silently throws.
- **iOS Safari mute-switch.** Audio plays through the silent switch by default but some iOS versions block it inside `<iframe>`. If your card runs embedded, test on real hardware.
- **Frequency ramps go through 0.** A sweep from 220Hz → 100Hz with `exponentialRampToValueAtTime` is fine. Sweeping to 0 is not — clamp to ≥ 1.

## Source

- `realms-staging.stack.cards/ctse/beet-ravine/avatar-creator-2111c4be-1889-4af6-af1d-9afc23a9d324/external/avataar-utils.gts` — `playClickSound()` at lines 475–510. Oscillator + gain envelope + ADSR, no library.

## See also

- `integrate-tone-js-via-cdn` — when you need polyphony, sequences, samplers, or effects.
- `integrate-three-js-via-cdn` — same module-scope-singleton + dispose lifecycle for a different resource type (GPU vs audio).
