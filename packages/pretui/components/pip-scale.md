## What it is

A labelled value scale: pips sitting at the values they name, pickable by pointer and by keyboard.

It is what turns a bare slider into a readable one, and it can also stand alone as a scale under any value display.

## The contract

```
@min?, @max?, @step?
@pipStep?     — steps per pip; derived towards @targetPips when omitted
@targetPips?  — roughly how many pips to derive. Default 20
@maxPips?     — hard ceiling on pips drawn. Default 120
@maxLabels?   — hard ceiling on pips that carry a LABEL. Default 8
@pips?        — base mode for every pip
@first?, @rest?, @last? — override the base mode per position
@values?      — the selected value, or the [lower, upper] pair of a range
@span?        — paint the pips between the values, or below/above a single value
@limits?      — the selectable window; pips outside it draw quiet and take no clicks
@formatValue?, @prefix?, @suffix?
@disabled?
@label?       — accessible name for the group of pip buttons
@onPick?      — fires with a pip's value when one is picked
```

**Omitting the pick handler makes the scale decorative** — no buttons are rendered at all and the whole element becomes `aria-hidden`. That is the design's central decision: a scale that moved something without telling its owner would be the ship-blocking case, and a scale that is purely a ruler should not be a pile of buttons in the accessibility tree.

**Pip density is derived, with two separate ceilings.** `@maxPips` caps what is drawn; `@maxLabels` caps what is *named*, because a scale with forty labels is unreadable long before it has forty ticks.

**`@limits` narrows the selectable window without changing the scale.** Pips outside draw quiet and refuse clicks, so the reader can see the full range and the part of it that is available.

## Prior art

**svelte-range-slider-pips.**

Where Pretui is better: the decorative/interactive split. The upstream always renders pips as markup regardless of whether they do anything, which means a purely visual scale contributes noise to a screen reader. Separating the two on the presence of a handler makes the common case silent.

Where it is thinner: no logarithmic or non-linear scales, no per-pip styling or custom pip content, and no vertical orientation.

## Accessibility

- **Decorative by default is the headline.** With no pick handler the element is `aria-hidden` in full — a ruler is not a control.
- **Interactive pips are real buttons in a named group**, so they are reachable, activatable and countable.
- **`@maxLabels` is an accessibility lever, not only a visual one.** Every labelled pip is text a reader passes; capping labels caps the noise.
- **Pips outside `@limits` take no clicks and draw quiet**, so an unavailable value is perceivable rather than being a button that silently does nothing.
- **`@formatValue`, `@prefix` and `@suffix` shape what a pip is called**, which is what lets "50" become "50%" or "$50" in the announcement as well as on screen.
- **`@disabled` inerts the whole group.**

## Theming

The scale takes the kit's shared control and muted tokens rather than defining its own surface: pip colour follows the season's border and muted-foreground, the selected span follows the accent.

That is deliberate for a component that sits under **Slider** and under bare value displays alike — a scale that themed independently would look attached to one and pasted onto the other.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
