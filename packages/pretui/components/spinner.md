## What it is

The smallest possible "something is happening": a ring that spins, sized in pixels, inheriting the current text colour. Use it inline — inside a **Button**'s busy state, beside a label, in a table cell — where the duration is unknown and there is no room for anything larger. If the operation has a known extent, use **ProgressBar**. If the whole region is loading and you want a shape hint, use **Skeleton**. If you want a labelled loader with an elapsed clock, use **LoadingState**.

## The contract

```
@size? (13)
Element: HTMLSpanElement
```

One arg, and it sets `width` and `height` inline. Everything else is inherited.

**The ring is `currentColor`.** The border is `color-mix(in srgb, currentColor 25%, transparent)` with `border-top-color: currentColor`, so a Spinner takes the colour of whatever text it sits in — white inside an accent Button, `--muted-foreground` in a table cell — with no tone arg and no variant. That is the reason the component has one argument.

`flex: none` means it never shrinks in a flex row, which is the failure mode of hand-rolled spinners next to a long label.

`display: inline-block` (not `inline-flex`) keeps it on the text baseline rather than centring it, which matters when it sits mid-sentence.

## Prior art

**Web Awesome `wa-spinner`** has **zero properties and zero slots** — an SVG with `role="progressbar"` and a localized `aria-label` of "loading", themed entirely through `--track-width`, `--track-color`, `--indicator-color` and `--speed`. That is the closest philosophical match, and its four custom properties are the thing Pretui lacks. **React Spectrum** has no separate spinner; `ProgressCircle isIndeterminate` covers it. **shadcn** has no spinner component at all — the convention is a Lucide `Loader2` icon with `animate-spin`.

Pretui's `currentColor` inheritance is a real improvement on Web Awesome's `--indicator-color`: it needs no configuration at every call site to look right, and it _cannot_ be wrong inside a Button that changes tone.

Where it is behind: **no speed, thickness or colour tokens.** The 1.5px border and 0.7s duration are hard-coded, so a season cannot make spinners slower or heavier. Web Awesome's `--speed` in particular is the knob a calm season wants.

Note that **Button embeds its own copy of this ring** rather than composing `Spinner` — the same CSS, duplicated. Worth consolidating.

## Accessibility

No APG pattern. The two legitimate treatments are `role="progressbar"` with no `aria-valuenow` (the indeterminate contract) or `role="status"` for an announced "Loading…".

Pretui uses `role="status"` with `aria-label="Loading"`, and that combination has a specific problem:

- **`role="status"` is a live region, and this one is created with its content already in place.** A live region must exist in the DOM _before_ its content changes to be announced. A spinner that mounts when a fetch begins will frequently announce nothing at all — the region and its accessible name arrive together, which is exactly the case screen readers skip. `role="progressbar"` with no `aria-valuenow` would be the more honest choice here: it describes the element rather than trying to announce it.
- **Every spinner on a page announces the same literal "Loading"**, with no way to say what is loading. There is no `@label` arg; you can pass `aria-label` through `...attributes`, and you should.
- **Nothing announces when loading _finishes_.** The spinner unmounts silently. This is the other half of the pattern and it belongs to the caller — write "Loaded 24 results" into a persistent live region.
- **Inside a `<Button @busy>`, the button is `disabled`**, so focus is lost from it and the spinner is inside an element removed from the tab order. The busy state is silent to assistive tech in that path.
- **Reduced motion slows the animation to 2.8s rather than stopping it.** This is a defensible reading — a spinner that does not spin conveys nothing — and is gentler than the common approach of hiding it entirely. It is not a full `prefers-reduced-motion` stop, so a user who cannot tolerate any looping motion is not fully served; a static ring plus text would be.
- The element is empty, so nothing else is announced.

## Theming

`currentColor` for both the track (at 25% alpha) and the indicator. That is the entire palette — there are no spinner-specific tokens at all, which is either the cleanest thing about it or the most limiting, depending on what you need.

The 1.5px border width, 0.7s duration (2.8s under reduced motion), and the 13px default size are hard-coded. A season wanting a heavier or slower spinner must fork the component. Since it inherits ink, a season only needs to ensure `--foreground`, `--muted-foreground` and each Button tone's on-colour all read acceptably at 25% alpha — the track is the part that disappears first on low-contrast surfaces.
