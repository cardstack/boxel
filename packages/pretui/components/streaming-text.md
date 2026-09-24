## What it is

Text that appears word by word, as if being typed or streamed from a model. Use it for agent output, a generated summary landing on a card, or any moment where the arrival of the text is part of the experience. If you want a character-by-character effect with a blinking caret, that is **Typewriter**; if you want letters to scramble into place, **TextScramble**; if the text is simply present, do not animate it at all — an entrance animation on static content is noise.

## The contract

```
@text: string   (required)
@rate? (default 18, words per second)
@startDelay? (default 0, seconds)
@cursor?
Element: HTMLSpanElement
```

**`@rate` is words per second, and the units matter.** Law 7 of the kit: rates are unitless numbers over seconds, never milliseconds-per-item, because a rate composes (two components at rate 18 agree) where a per-item delay does not. `@startDelay` is likewise seconds, so a sequence of streaming blocks can be choreographed by adding rates.

**There is no timer.** Each word carries `animation-delay: startDelay + i / rate` seconds, and the whole reveal is CSS. That is the realm law — the prerenderer blocks timers — and it has three consequences worth knowing: the animation is correct under prerender (it simply shows the end state), it cannot leak, and **the text is fully present in the DOM from the first frame**. Nothing is being appended; opacity is being animated.

That last point is what makes the accessibility work (below), and it is also the limitation: **this animates text you already have.** It is not a streaming transport. If tokens arrive incrementally from a model, each new `@text` re-runs the whole stagger from word zero. Streaming _into_ it needs a different approach.

The entrance is opacity plus a 4px blur clearing over 420ms — the blur is what makes it read as "resolving" rather than "fading in".

## Prior art

**motion-primitives `TextEffect`** and **cult-ui's typewriter** are the closest — both drive per-character or per-word reveals through Framer Motion's stagger, i.e. a JS animation controller. **react-bits** ships several variants (`SplitText`, `BlurText`) on the same engine. **Vercel's AI SDK** streams tokens into a plain element and animates nothing.

Where Pretui is better: **no runtime.** The reference implementations all instantiate an animation controller per instance, which on a page with twenty streamed blocks is twenty controllers driving RAF loops. Here it is `n` CSS animations the compositor owns, and the component's entire JS is one `map` producing delay strings. It also works where the others cannot — under prerender, and with `prefers-reduced-motion` handled by a single CSS rule rather than a conditional in the controller.

Where it is behind: **no per-character mode**, no exit animation, no scroll-triggered start (compose **InView**), and the streaming-transport limitation above. motion-primitives' `TextEffect` also supports staggering _out_, which has no analogue here.

## Accessibility

No pattern governs it. Relevant criteria: WCAG **2.2.2 Pause, Stop, Hide**, **1.3.1**, and the live-region rules.

This is one of the better-handled animations in the kit, and the technique is worth copying:

- **A visually-hidden mirror carries the full text.** The animated words are inside an `aria-hidden="true"` wrapper, and a second `<span class='pretui-sr'>` holds `@text` complete. So a screen reader reads the whole sentence immediately and never encounters partially-revealed content, while the visual layer staggers. That is exactly right, and it is what most streaming-text implementations get wrong — they animate the real text and screen readers narrate fragments.
- **The cursor is `aria-hidden`.** Correct — it is decoration.
- **`prefers-reduced-motion: reduce` sets `animation: none; opacity: 1`**, so the end state appears immediately. Not a slower animation, not a fade: no motion at all, which is the right treatment for a decorative entrance.

Gaps:

- **The text is duplicated in the DOM.** The mirror is a second copy of the string, so `Ctrl+F`, text selection and copy-paste can pick up both. `clip: rect(0 0 0 0)` is the legacy visually-hidden recipe and does not prevent selection — a user dragging across the block may copy the sentence twice. The modern `clip-path: inset(50%)` recipe plus `user-select: none` on the mirror would tighten it.
- **Nothing announces that streaming has finished.** The full text is available from the start, so there is nothing to wait for — which is the right design, but it means a live region wrapping this component would announce everything instantly and then again on the next update.
- **WCAG 2.2.2** governs motion lasting more than five seconds. At the default rate of 18 words/second a paragraph resolves in well under a second, but a long document at a slow `@rate` can exceed it, and there is no pause control. Keep rates high enough that the whole block resolves quickly.
- **The blur filter is a compositing cost** on long text; a 2,000-word block is 2,000 animated elements. Use it for short passages.
- **Word splitting is `text.split(' ')`**, so multiple spaces collapse into empty words and the visual spacing comes from a trailing space inside each span. Text with newlines or tabs will not break as authored.

## Theming

Almost nothing: `currentColor` for the cursor, and the surrounding type styles are inherited. The 420ms duration, the `cubic-bezier(0.22, 0.61, 0.25, 1)` easing, the 4px blur and the 2px × 0.9em cursor are all fixed.

`@rate` and `@startDelay` are args rather than tokens, so a season cannot set a house streaming speed — that is a per-call-site decision. If a season wants slower, calmer motion across the kit it can reach `--pretui-dur-*` elsewhere but not here, which is an inconsistency worth noting.
