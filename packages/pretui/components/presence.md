## What it is

Mount and unmount transitions: content that fades, rises, falls, scales or slides both **in and out**. Use it wherever something appears or disappears and the disappearance should be visible — a panel, a row, a toast, an inline detail. If the entrance should be triggered by scroll position, **InView**. If the thing is an overlay, **Dialog**, **Drawer** and **Popover** already have their own `@starting-style` motion.

## The contract

```
@show? (default true)
@enter? / @exit?: 'fade' | 'rise' | 'fall' | 'scale' | 'slide'
@duration? / @exitDuration? (seconds)
@delay? (seconds), @distance? (px), @scale? (0–1)
<:default>
```

**`Presence` owns `display` — do not also wrap it in `{{#if}}`.** That is the one thing to get right: an `{{#if}}` removes the element before the exit transition can run, so the content vanishes instead of leaving. This is the single most common misuse and the source calls it out in the arg's own doc comment.

**`@exit` is separately settable and defaults to `@enter`; `@exitDuration` defaults to two-thirds of `@duration`.** Leaving reads differently from arriving, and leaving should not linger — that ratio is Law 7 expressed as a default rather than a rule you have to remember.

**`@delay` is the timer-free way to stagger several Presences.** Seconds, unitless rate vocabulary, same as **StreamingText**'s rate arg.

The preset table is **shared with InView**, so "rise" means the same travel in both, and every preset resolves through `--pretui-motion-distance` / `--pretui-motion-scale` — a caller can retune the travel without leaving the preset vocabulary.

## Prior art

**`AnimatePresence`** from framer-motion / motion-primitives is the direct upstream, and the comparison is the whole point of this file: `AnimatePresence` pays a **JS animation engine and a per-frame RAF loop** for behaviour the modern CSS platform now expresses declaratively.

Pretui uses **`@starting-style` plus `transition-behavior: allow-discrete`**, which gives real enter _and_ exit transitions on a `display` change with no engine at all. The source is explicit that "dropping the engine is not a compromise here; it is the upgrade" — and the concrete payoff is that **it keeps working when the main thread is busy**, which the RAF originals do not. A page mid-hydration or mid-parse animates correctly here and janks in framer-motion.

Dependency-free (Law 9) and timer-free (realm law): every effect is CSS.

**Deliberately dropped** from the upstream surface: **layout animation** (morphing children through a shared layout needs FLIP measurement and a JS engine — render two Presences and stagger them with `@delay`), and **variant/keyframe objects** (a preset knob plus two custom properties covers the honest cases).

## Accessibility

No pattern governs it; the criteria are WCAG **2.3.3 Animation from Interactions** and **2.2.2**.

The notable thing this does that the upstream does not:

- **`inert` during the exit window.** `display: none` removes focusability once the transition ends, but there is a window in between where the content is still in the DOM, still focusable, and on its way out — a keyboard user can tab into content that is disappearing. Presence sets `inert` for exactly that window. **Upstream leaves that gap open.** This is a small, genuinely-better detail and worth knowing about.

Gaps and cautions:

- **There is no `prefers-reduced-motion` branch in this component.** Every other animated component in the kit has one; here the reduced-motion answer is presumably that the caller sets `@duration={{0}}`, or that a season zeroes `--pretui-motion-distance`. Verify — an unguarded entrance and exit on every mounted element is exactly what **2.3.3** is about, and a component whose entire purpose is motion is the one that most needs the guard.
- **Content appearing is not announced.** Presence is a visual transition, not a live region; if the content mattering is the point (an error, a result), pair it with a `role="status"` region that already exists in the DOM.
- **Focus is not moved into entering content**, correctly — that is the caller's decision, and moving it automatically would be wrong for most uses.
- **`@delay` staggering means later items appear after a measurable gap**; a screen-reader user encountering the DOM does not experience the stagger at all, which is fine, but do not use stagger to convey order.
- Content that is `inert` on the way out is correctly unreachable; content on the way _in_ is reachable immediately, before the transition finishes.

## Theming

`--pretui-motion-distance` (default 8px, used by rise/fall/slide) and `--pretui-motion-scale` (default 0.96, used by scale) — two tokens that a season sets once to give every Presence and **InView** in the product the same travel. Duration, exit duration and delay are args in seconds rather than tokens, so a season cannot set a house pace; that is an inconsistency with the kit's `--pretui-dur-*` tokens elsewhere.

Because the presets resolve _through_ those custom properties rather than baking in pixel values, a caller can override `--pretui-motion-distance` on an ancestor and every preset inside adapts — including a season that wants near-zero travel for a calm theme, which is also the poor-man's reduced-motion switch.
