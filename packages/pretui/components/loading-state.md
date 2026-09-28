## What it is

A labelled loader with personality: a 3×3 pixel grid animating in one of three patterns, a shimmering label, and an optional elapsed-time readout. Use it where a wait is long enough that a bare **Spinner** feels like a hang — an agent turn, a query, an upload — and where naming the work ("Indexing", "Thinking") is more reassuring than a generic spinner. For a short inline wait, use **Spinner**. For a known extent, **ProgressBar**. For a region whose shape you can hint at, **Skeleton**.

## The contract

```
@label? (default 'Working')
@variant? 'drive' | 'dots' | 'orbit'   (default 'drive')
@elapsed?   — caller-supplied text, e.g. '4.2s'
```

**`@elapsed` is a string the caller computes, and that is a realm law, not a preference.** Realm components own no timers — the prerenderer blocks them — so the component cannot tick a clock. The caller passes `'4.2s'` and re-passes it as it changes. This is the same constraint that shaped **StreamingText** (CSS `animation-delay` stagger instead of a timer) and **Stat**'s odometer.

The three variants are three delay tables over the same nine pixels: `drive` is a chevron sweep computed from row/column distance; `orbit` walks the eight perimeter cells in order and **leaves the centre cell dark** (its delay is `null` → `opacity: .07; animation: none`); `dots` is `drive`'s timing with round pixels. All three are pure `animation-delay` — no JS drives a frame.

## Prior art

Adopted from **Beautiful UI**'s pixel-grid loader plus shimmer label. The wider field: **Web Awesome `wa-spinner`** is deliberately minimal (zero props, four CSS knobs); **React Spectrum** offers `ProgressCircle isIndeterminate`; **shadcn** has no loader at all. None of them ship a _named_ loader, and none ship an elapsed readout.

Where Pretui is ahead: **the label and the elapsed time are first-class.** The single most useful thing during a long wait is knowing what is being waited on and how long it has taken, and every kit above leaves both to the caller. Making them args means a system's loaders are consistently informative rather than consistently anonymous.

The shimmer label is a nice touch executed correctly — a `linear-gradient` background clipped to the text (`background-clip: text`) and scrolled, so the motion is in the ink rather than an overlay. Compare the common approach of a translucent bar sliding over the words, which fights the text.

Where it is behind: no size axis, no colour axis, and the elapsed clock's correctness is entirely the caller's problem — a caller who forgets to update `@elapsed` shows a frozen number, which is worse than showing none.

## Accessibility

No APG pattern; the relevant rules are the live-region rules and WCAG **2.2.2 Pause, Stop, Hide**, **4.1.3 Status Messages** and **2.3.3**.

What is right: the pixel grid is `aria-hidden`, so nine decorative spans do not reach the accessibility tree — only the label and elapsed text do.

Gaps, and the last one is serious:

- **`role="status"` on an element created with its content already in it.** Same problem as **Spinner** and **Alert**: a live region must exist in the DOM before its content changes, or nothing is announced. A LoadingState that mounts when work begins will usually be silent. The fix is a persistent hidden region at the host level.
- **`@elapsed` inside the live region means every tick re-announces the whole thing.** `role="status"` carries an implicit `aria-atomic="true"`, so a clock updating once a second produces "Working 4.2 seconds… Working 4.3 seconds…" indefinitely. That is worse than silence. `@elapsed` should be `aria-hidden`, or the live region should wrap only the label.
- **There is no `prefers-reduced-motion` rule at all.** Nine pixels pulse continuously and the label's gradient scrolls at 1.4s, forever, with no reduction. Every other animated component in this kit (Skeleton, Switch, Dialog, Drawer, Popover, StreamingText, Spinner) has a reduced-motion branch; this one does not. Given that the animation is infinite and the component is used precisely when a user is stuck waiting, this is the clearest accessibility defect in the feedback territory and the easiest to fix.
- **WCAG 2.2.2** applies to any motion that starts automatically, lasts more than five seconds and runs in parallel with other content — a loader during a long agent turn is exactly that, and there is no pause control.
- The label text is painted with `color: transparent` + `background-clip: text`. In **forced-colors mode** the background is commonly dropped, which can render the label invisible; a `@media (forced-colors: active)` fallback to a solid colour is needed.
- Nothing announces completion; the component unmounts silently.

## Theming

`--foreground` (pixels, and the shimmer's bright stop), `--ink-3` (the shimmer's dim stops and the elapsed readout), `--font-mono` (elapsed), `--text-ui-md` (label).

The 4px pixels, 1.5px grid gap, 650/950ms cycles, 1.4s shimmer and 10px inter-element gap are all fixed. The pixel grid uses `--foreground` directly rather than `currentColor`, so unlike **Spinner** it does _not_ adapt to the ink of a coloured container — a LoadingState inside an accent surface will show dark pixels. Worth knowing before placing one on a tinted panel.
