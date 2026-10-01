## What it is

A slot of phrases rotating through one line: a clipped one-line window over a vertical reel of words, advanced discretely on an interval.

Use it for a headline whose subject changes — "built for *designers* / *engineers* / *teams*". For revealing a single string, that is **Typewriter**; for text that arrives live, **StreamingText**.

## The contract

```
@words (required) — the phrases, in order
@interval?        — seconds each word holds the slot
```

**The reel ends where it began.** The carousel is a `steps()` keyframe sequence over a vertical stack whose last frame is the first word again, so the wrap is seamless rather than a snap back to the top.

**Words swap discretely, not by sliding through.** `steps()` means each word holds its full interval and then the next is there — no intermediate half-word state, which is what makes it readable rather than a blur.

**Empty words are ignored**, and **a single word degrades to plain text** with no animation at all. A one-item rotation is a label.

**Reduced motion pins the slot to the first word.**

## Prior art

**motion-primitives' TextLoop and TextRoll**, **react-bits' RotatingText**, and **fancy-components' TextRotate**.

Where Pretui is better: **no timer.** Every upstream drives the rotation from a JavaScript interval holding an index in state; here the whole cycle is one CSS animation computed at render, so it cannot desync, cannot leak, and costs nothing after the first paint. The seamless wrap is also handled by duplicating the first word at the end of the reel rather than by a modulo in a state update.

Where it is thinner: no per-word timing — every word holds for the same `@interval`, so a long phrase gets the same beat as a short one — no direction control, no enter/exit transition beyond the step, and no way to pause on hover or on focus. There is no completion event either, since nothing is watching.

## Accessibility

- **Every word is mirrored in a visually-hidden span**, so a screen reader is told the full set rather than whichever word happened to be in the window when it reached the line. That is the correct trade: a rotating slot has no single truthful moment to announce.
- **The animated reel is `aria-hidden`**, so the words are not announced twice and the clipped ones are not announced at all.
- **Reduced motion pins the first word**, which is the one to put first — it is what a reader who has asked for stillness will see, permanently.
- **Nothing is focusable**, and the rotation is not interactive.
- **A rotating word cannot carry meaning a reader must act on.** By the time someone reads it, it may have changed. Use it for tone, not for instruction.

## Theming

`--pretui-rotate-count` (the number of words, which sets the keyframe stepping) and `--pretui-rotate-line` (the slot's line height, which is what the window clips to).

Both are derived rather than seasonal — the rotation's geometry follows its content. Colour and typeface come entirely from context, so the slot matches the heading it sits in without a token of its own.
