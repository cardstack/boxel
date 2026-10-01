## What it is

Letters resolving out of noise, left to right, until the message is there.

It is a CSS approximation of an effect that is normally frame-driven, and the approximation is the interesting part.

## The contract

```
@text (required) — the message to resolve into
@duration?       — total seconds from first noise to last resolved character;
                   a non-positive value is floored
```

**Each character stacks two seeded noise glyphs that hand off and blur out as the real character blurs in**, on staggered delays swept across the string. Instead of re-randomising every frame — which is what the upstream does and what a timer would cost — the noise is chosen once per character at render.

**The noise is deterministic.** The same text always scrambles the same way, because the glyphs are drawn from a seed derived from the text itself. That matters here beyond tidiness: a card that re-renders during indexing produces the same frames, so a screenshot is reproducible.

**Spaces are left alone**, so word boundaries stay visible through the scramble and the line does not reflow as it resolves.

## Prior art

**motion-primitives' TextScramble**, **fancy-components' ScrambleIn/ScrambleHover** and **react-bits' Scrambled/DecryptedText**.

Where Pretui is better: **no animation frame loop.** Every upstream re-randomises each character on a `requestAnimationFrame` or interval tick, holding the partially-resolved string in state. Here the whole resolve is a CSS schedule computed once, which cannot leak a loop, cannot desync from a re-render, and costs nothing once painted. Determinism is the second win — an effect that looks different on every render cannot be screenshotted or diffed.

Where it is thinner, and honestly so: **two noise glyphs per character is not the same as continuous noise.** The upstream effect churns; this one hands off twice and resolves. At a short duration the difference is invisible; at a long one, it reads as a blur rather than as scrambling. There is also no hover-to-scramble mode, no per-character speed, and no reverse.

## Accessibility

- **The scrambled copy is `aria-hidden`** and the real text is mirrored in a visually-hidden span, so a screen reader gets the message rather than a run of noise glyphs. Announcing the animated layer would be actively harmful here — it is deliberately meaningless characters.
- **Reduced motion collapses it to the resolved text.** The base styles are the end state, so the kill switch leaves the message rather than a frozen midpoint of noise.
- **The effect delays legibility for sighted readers only.** Anyone using the mirror has the text immediately; anyone reading the screen waits `@duration`. Keep it short, and keep it away from anything time-sensitive.
- **Noise glyphs are not in the accessible name**, so a scrambling heading is still a findable heading.

## Theming

`--pretui-scramble-window` (the per-character resolve window) and `--pretui-scr-delay` (each character's staggered start), both derived from `@duration` and the string's length.

There is no colour token: the noise and the message are the same ink, inherited from context. That is what makes the resolve read as one piece of text changing rather than as two layers crossfading — and it means a season needs to do nothing for this component to fit.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
