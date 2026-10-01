## What it is

Character-by-character reveal of a string you already have, on a pure-CSS stagger, with an optional caret that rides the insertion point.

It is the static-choreography sibling of **StreamingText**: StreamingText paces live agent output arriving word by word, Typewriter choreographs a string it already holds. If the text is still arriving, you want the other one.

## The contract

```
@text (required) — the string to reveal
@speed?          — reveal rate in characters per second
@caret?          — blinking insertion-point caret
@startDelay?     — seconds before the first character lands
```

**`@speed` is a rate, not a duration.** Characters per second, so the same value reads the same across strings of different lengths. A non-positive speed falls back rather than dividing by zero.

**There are no timers.** Each character span carries its index as a custom property and the container carries one step duration; the reveal is an `animation-delay` of `index × step` with a `steps(1)` snap. The schedule is computed once per render.

**Unrevealed characters animate from zero font-size**, so the line *grows* as it types and the caret rides the insertion point — rather than parking at the end of an invisible full-width line, which is what a simple opacity reveal gives you.

**There is no loop or delete-and-retype cycle, and that is a real limitation.** A coherent CSS loop of a staggered per-character reveal needs per-index keyframe percentages — every character has to share one period — which static scoped CSS cannot express. The upstream `waitTime`/`deleteSpeed`/`loop` surface is deliberately out of scope. Re-render the component to replay.

## Prior art

**cult-ui's typewriter**, **fancy-components' Typewriter** and **react-bits** — transcribed in behaviour, never in code.

Where Pretui is better: **no timer state machine.** fancy-components drives a `setTimeout` loop that holds the revealed prefix in component state; here the whole reveal is one CSS schedule, which means it cannot desync, cannot leak a timer, and costs nothing after the first paint. The growing line and the riding caret are also more faithful to a real typewriter than the usual full-width reveal.

Where it is thinner: no loop, no delete-and-retype, no per-word or per-line mode, no pause/resume, and no completion callback — there is no JavaScript watching the animation, so nothing to fire one from.

## Accessibility

- **The animated copy is chopped into per-character spans and hidden**, with the whole string mirrored in a visually-hidden span beside it. Without that, a screen reader would announce the text one character at a time, which is the standard failure of every per-character effect.
- **Reduced motion collapses it to the finished line.** The base styles *are* the end state and the keyframes only supply the choreography, so `animation: none` is a complete kill switch rather than a freeze at an arbitrary frame.
- **The caret is decoration** and carries no meaning; it is not an insertion point anyone can type at.
- **Text that is still animating is already fully available** to assistive technology, so a reader is never waiting on the animation to learn what it says.

## Theming

`--pretui-type-step` (seconds per character, derived from `@speed`), `--pretui-type-i` (each character's index), `--pretui-type-delay` (from `@startDelay`).

The effect inherits its colour and typeface entirely from context — there is no ink token — which is what lets it be dropped into a heading, a label or a paragraph without looking like a different component. A season changes how this looks by changing the text around it.
