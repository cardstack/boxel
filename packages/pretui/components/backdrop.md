## What it is

The scrim behind a layered surface — a dialog, drawer, sheet, popover or media lightbox — with a dismiss target. Use it when you are building a layered surface that does **not** ride the native top layer. **Dialog** and **Drawer** already get a `::backdrop` from `showModal()` and do not need this; **Popover** and **Menu** already own a transparent close target. Reach for Backdrop when composing something new.

## The contract

```
@open? (default true), @tone? ('scrim'), @label? ('Close')
@blur?, @focusable?, @z?
Blocks: {}   — none
Element: HTMLElement
```

**It yields nothing, deliberately.** A backdrop that rendered children would either nest interactive content inside a `<button>` — an accessibility violation — or force a second wrapper. **The layered surface is a *sibling* of the backdrop, above it in the stacking order.** Documented rather than hidden (Law 7), and it is the first thing to know before reaching for this.

**`@blur={{0}}` does not paint a filter.** Only a positive blur opts in, because a no-op `backdrop-filter: blur(0px)` still promotes the scrim to its own compositing layer *and* makes it a containing block for fixed-position descendants — which would break every overlay positioned above it. That is a real, non-obvious bug avoided by a guard.

`@z` is also settable as `--pretui-backdrop-z`.

## Prior art

The honest comparison set is **the ad-hoc `<div className="fixed inset-0 bg-black/50" onClick={close} />` that every React overlay tutorial ships**, plus motion-primitives' `GlowEffect`/`ProgressiveBlur` and cult-ui's `distorted-glass` for the visual treatments.

Three concrete improvements over that ubiquitous div:

- **The dismiss target is a real `<button>`.** The tutorial pattern's clickable div has **no keyboard path and no accessible name**. Here Enter and Space work, Escape works, and `@label` is required in spirit and defaulted in practice.
- **The tint is one token** — `--pretui-overlay-scrim`, the same one **Dialog** and **Drawer** already paint on `::backdrop` — rather than an opacity literal. So every scrim in the product is the same scrim, whether it comes from the platform or from this component.
- **The entry fade is `@starting-style`**, so there is no JS mount transition and reduced motion simply gets the end state.

Where it is thinner than the motion-primitives treatments: no gradient, no progressive blur, no glow. `@tone` and `@blur` are the whole visual surface.

## Accessibility

No pattern of its own; it is a dismiss affordance under a surface that has its own pattern.

What is right:

- **A real `<button>` with an accessible name**, so the dismiss is keyboard-operable — which is the whole reason this exists rather than a styled div.
- **Escape works**, not only click.
- `@focusable` lets a caller decide whether the backdrop joins the tab order at all. Note that **Popover** and **Menu** in this kit both use `tabindex="-1"` on their equivalents, on the reasoning that the panel's own close control is the keyboard route and a full-viewport button in the tab sequence is noise. Both positions are defensible; know which you are choosing.

Gaps and cautions:

- **A backdrop alone does not make a surface modal.** The layered surface above it is a sibling, so nothing is `inert`, nothing is `aria-hidden`, focus is not trapped, and background scroll is not locked. If you are building a modal, **use `Dialog`** — it gets all four from `showModal()` for free. If you are building something the platform cannot express, you must add the inertness yourself; this component will not tell you that you forgot.
- **`@label` defaults to `'Close'`**, so two backdrops on a page announce identically — and a backdrop is exactly the control a screen-reader user encounters without context.
- **The backdrop is announced as a button in reading order**, before or after the surface depending on DOM order. Put it before.
- **Blur is a visual effect with no semantic counterpart**, and a heavy blur over live content can reduce the contrast of anything showing through — which matters if the backdrop is decorative rather than opaque.
- No `prefers-reduced-transparency` handling for the blur.

## Theming

`--pretui-overlay-scrim` (the tint — shared with **Dialog**'s and **Drawer**'s `::backdrop`, so a season defines it once), `--pretui-backdrop-z` (stacking level), plus the `@blur` radius as an arg.

`--pretui-overlay-scrim` is the token seasons most often get wrong: it must read as a scrim in **both** light and dark, not simply invert. A dark-mode scrim that is pure black at the same alpha as the light one produces an overlay you cannot see through and a surface with no apparent elevation.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
