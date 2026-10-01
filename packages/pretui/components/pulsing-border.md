## What it is

A ring around a surface that says "this is live": a pulsing hairline plus a soft halo, with a **required** text marker on the boundary. Use it on something actively receiving updates — a streaming panel, a running job, a connected session. If the state is a value rather than a liveness, use **Chip** or **StatusChip**. If it is progress toward a known end, **ProgressBar**. If it is a decorative accent, do not use this at all — the marker is not optional, and the component will not let you have the glow without it.

## The contract

```
@label? ('Live'), @active? (true)
@variant? 'pulse' | 'trail'   (default 'pulse')
@marker? (default true), @markerPlacement? (default 'top-start')
@hue?
```

**`@marker={{false}}` demotes the marker to visually-hidden text — it never removes it.** That is the component's central rule and the source states the reasoning: **a pulsing border on its own is information carried entirely by texture** — invisible to a screen reader, unindexable, and gone from a still frame. So the affordance is not optional. The marker is an ink **Chip**, reused rather than re-drawn, carrying `role="status"`.

**The ring is an inset `box-shadow`, not a `border`**, so turning it on never reflows the content (Law 1 — depth is one property). Every hand-rolled version of this adds a border and shifts everything inside by a pixel.

**The halo animates `transform` and `opacity` only**, so it stays on the compositor.

**The resting state is a visible hairline plus a soft glow**, which means the component survives the screenshot test (Law 8) and reduced motion identically — a still frame of a live panel still reads as live.

`@hue` overrides the Law-2 derivation.

## Prior art

Ported in behaviour from **react-bits' `ElectricBorder` / `StarBorder`** and **motion-primitives' `BorderTrail`**.

**Dropped:** their canvas/WebGL electric distortion (Law 9 — no vendored engines), and — the substantive one — **their assumption that a border can say "live" unaccompanied.** All three upstreams are decorative components that people then use to convey state, and none of them carries text.

**Improved**, and each is concrete:

- **Inset `box-shadow` instead of a `border`**, so activation causes no reflow.
- **`transform`/`opacity`-only animation**, so the halo does not trigger layout or paint.
- **A resting state that is visible without motion** — the upstreams are invisible when static, so a reduced-motion user or a screenshot sees nothing at all.
- **The mandatory marker** (above).

Where it is thinner: no colour cycling, no gradient sweep beyond the `trail` variant, and no multi-hue effects. Those all belong to the decorative category this component deliberately left.

## Accessibility

No APG pattern; the criteria are WCAG **1.4.1 Use of Colour**, **4.1.3 Status Messages**, **2.2.2 Pause, Stop, Hide** and **2.3.3**.

This is the best-behaved decorative component in the kit, and the reason is the marker:

- **`role="status"` on the marker** means the liveness is announced, and it is announced as text rather than implied by a glow.
- **`@marker={{false}}` keeps the text, visually hidden** — so a caller who wants a clean surface still ships the information. Making the accessible affordance un-removable is a design pattern worth copying elsewhere in the kit (**Meter**'s required `@label` is the other example).
- **Colour is never the only channel**: hue plus a hairline plus a word.
- **The resting state is visible without motion**, so reduced-motion users are not left with an unmarked surface.

Gaps:

- **`role="status"` is a live region created with its content already in it.** The same problem **Alert**, **Toast**, **Spinner** and **LoadingState** have: a region that mounts complete is frequently not announced. If the point is to announce *becoming* live, the marker should exist before `@active` flips — render the component with `@active={{false}}` rather than mounting it on activation.
- **`@label` defaults to `'Live'`**, so two live panels announce identically and neither says what is live.
- **`@active={{false}}` presumably stops the pulse**; whether the marker's text changes to say so is worth checking — a `role="status"` still reading "Live" on an inactive surface is worse than no marker.
- **The pulse runs indefinitely.** **WCAG 2.2.2** governs motion that starts automatically, lasts more than five seconds and runs alongside other content; a live panel qualifies, and there is no pause control. The reduced-motion path covers users who set the preference and no one else.
- Verify a `prefers-reduced-motion` rule exists — the source implies the resting state doubles as the reduced-motion state, which is the right design, but it must actually be wired.
- No `forced-colors` treatment; a glow drawn with `box-shadow` is commonly dropped in High Contrast mode, leaving only the marker — which is, at least, the important half.

## Theming

The Law-2 hue derivation (one hue in, ring, halo and marker tint all derived), `--card` and `--border` for the resting hairline, plus the **Chip** tokens the marker reuses (`--pretui-chip-mix`, `--pretui-ink-mix`) and the animation's duration and easing.

Because the ring is a `box-shadow` and the halo is a transform, a season retunes intensity by changing the hue and the mix ratios rather than by changing geometry. A season must keep the *resting* hairline visible — it is what carries the state in a screenshot and under reduced motion, and a season that tunes only the animated peak will produce a component that says nothing when still.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
