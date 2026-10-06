## What it is

A signature capture surface with a typed-name alternative beside it.

The alternative is not a convenience — it is the only path for anyone who cannot draw with a pointer, and it is the reason this component is usable at all.

## The contract

```
@label?         — the visible label. Defaults to 'Signature'
@description?   — helper text under the surface, wired via aria-describedby
@signerName?    — who is signing; used in the image alt text and as the typed default
@defaultStrokes?, @defaultTypedName? — rehydration from a previous @onChange payload
@defaultMode?   — which method is offered first. 'draw' by default
@hideTypedAlternative? — strongly discouraged; see below
@penColor?      — opaque hex or rgb(); defaults to the resolved token ink
@minWidth?      — thinnest stroke in px, clamped to [0.1, 10]
@maxWidth?      — thickest stroke in px, clamped to [0.5, 30]
@dotSize?       — radius of a single tap dot in px, clamped to [0, 20]
@height?        — surface height in px, clamped to [80, 600]. Default 180
@required?      — marks the control required and says so in the label
@onChange?      — fires on every stroke, clear, typed keystroke and mode change

<:default> — receives an api: clear, toSVG, toPNG, isEmpty, value
```

**`@hideTypedAlternative` is documented as discouraged in the signature itself.** It exists so a caller with a genuinely different fallback can say so out loud, rather than being unable to express that. Using it without one leaves a control that a large group of people simply cannot complete.

**Every numeric arg is clamped**, so a caller cannot produce an unusable pen or a surface too small to sign on.

**`@onChange` fires on everything** — strokes, clears, typed keystrokes, mode changes — so a form always holds the current state rather than needing to poll.

**The block yields an imperative api** because export is inherently imperative: `toSVG` and `toPNG` are called when a form submits, not rendered.

## Prior art

The signature-pad libraries that wrap a canvas. The comparison worth making is not with their drawing quality but with their scope: a canvas with strokes on it is not a signature control, because it has exactly one input method.

Where Pretui is better: the typed alternative is part of the component, with the mode change reported like any other change, rather than being something each product bolts on beside it.

Where it is thinner: no pressure or tilt input, no stroke smoothing options beyond the width range, no timestamp or audit metadata in the payload, and no verification of any kind — this captures a mark, it does not attest to anything.

## Accessibility

- **The typed alternative is the accessibility story.** Drawing is a fine-motor pointer gesture with no keyboard equivalent that means anything; the typed name is the equal path, and it is why hiding it is called out in the contract.
- **The rendered signature carries `role='img'` with alt text built from `@signerName`**, so an exported mark is described rather than being an unlabelled graphic.
- **`@description` is wired through `aria-describedby`**, giving a place for "sign with your mouse or type your name" that is not a placeholder.
- **`@required` says so in the label** rather than only setting an attribute — the asterisk is `aria-hidden` and the word is in the name.
- **Mode changes are reported through `@onChange`**, so a form knows which method produced the value.

## Theming

`--pretui-sigpad-paper` (the surface), `--pretui-sigpad-ink` (the default pen), `--pretui-sigpad-radius`, `--pretui-sigpad-script` (the typeface the typed name renders in), over `--pretui-shadow-control`.

`--pretui-sigpad-script` is the one that matters for the typed path: a typed signature set in the interface font reads as a text field, and set in a script face it reads as a signature. A season that leaves it unset makes the alternative feel like a lesser option, which is exactly what it must not be.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
