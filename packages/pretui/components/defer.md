## What it is

A render gate: hold a subtree until it is in view, until the browser is idle, until the reader asks for it, or until a flag says so — with a placeholder that reserves the final space in the meantime.

It is about *work*, not choreography. **InView** animates an arrival; Defer decides whether the content is built at all. They compose.

## The contract

```
@trigger?      — 'visible' (default, IntersectionObserver) | 'intent' | 'idle' | 'manual'
@when?         — explicit gate: true renders immediately regardless of @trigger;
                 false leaves the trigger in charge. A caller override, not a lock
@once?         — stay revealed once revealed. Default true
@threshold?    — IntersectionObserver threshold, 0–1. Default 0
@rootMargin?   — IntersectionObserver rootMargin. Default '200px'
@idleTimeout?  — upper bound in seconds on the idle wait. Default 2
@minHeight?    — reserved height while pending; kept afterwards as a floor
@aspect?       — reserved aspect ratio while pending; dropped once revealed
@intentLabel?  — accessible name of the intent button. Default 'Load content'
@intentText?   — visible caption on the intent affordance
@announceText? — announced politely once, after the swap. Silent by default
@onReveal?     — fires the first time the content is revealed

<:default>     — the deferred subtree; rendered only once the gate opens
<:placeholder> — replaces the Skeleton; must occupy the reserved box
```

**The placeholder reserves the final space**, which is the whole reason this is safe to use on a long page: content arriving does not push everything below it down. `@minHeight` survives as a floor afterwards; `@aspect` is dropped once revealed.

**`@when` is an override, not a lock.** True renders now; false does not prevent the trigger from firing. A caller cannot use it to hold content closed.

**`@rootMargin` defaults to 200px**, so visible-triggered content starts before it is on screen and is usually there by the time the reader arrives.

**`@trigger='intent'` puts a named button over the placeholder** — hover, focus, tap or Enter all open it. That is the trigger to use for anything expensive enough that a scroll-past should not pay for it.

**`@once={{false}}` re-hides on exit** with `@trigger='visible'`, for content too heavy to keep alive off-screen: the observer stays armed, and the content unmounts when it scrolls away and mounts again when it returns. `@onReveal` still fires only the first time.

## Prior art

**boxel-catalog's card-with-hydration** is the source.

Where Pretui is better: four triggers rather than one, a reserved box rather than a collapsing placeholder, and an intent affordance that is a real button with an accessible name — so the "load this" path is not hover-only.

Where it is thinner: no priority or concurrency control across several Defers on a page — they all open independently — no retry if the deferred subtree throws, and no way to pre-warm without revealing. The idle trigger is bounded by `@idleTimeout` rather than being truly opportunistic.

## Accessibility

- **It is silent by default, and that is the right default.** Content arriving because someone scrolled is not news, and a live region that announces every deferred block on a long page is unusable. `@announceText` is the opt-in for the cases where the arrival genuinely matters.
- **The announcement is polite and fires once**, after the swap — not on every re-reveal.
- **The intent affordance is a real button** with an accessible name defaulting to "Load content", operable by Enter and by tap as well as by hover. An intent gate that only responds to hover would be unreachable by keyboard.
- **`@intentLabel` is the accessible name and `@intentText` the visible caption** — separate args, so a bare surface can still be named.
- **The reserved box prevents layout shift**, which is a genuine accessibility property: content moving under a reader mid-sentence affects everyone, and most of all anyone using magnification.
- **Deferred content is not in the accessibility tree until it renders.** A screen-reader user moving by heading will not find a heading inside an unopened Defer — so do not defer navigation landmarks or anything a reader might jump to.

## Theming

`@minHeight` and `@aspect` are caller values rather than tokens, since a reserved box is a property of the content rather than of the season. The default placeholder is the kit's **Skeleton**, so it inherits that component's tokens and a season retunes every pending block at once.

`<:placeholder>` must occupy the reserved box — a placeholder smaller than the content reintroduces exactly the layout shift the component exists to prevent.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
