## What it is

A star (or arbitrary symbol) rating, either as an interactive control or a read-only display. Reach for it when a bounded, small-integer score is a familiar shorthand — reviews, quality flags, priority. If the score is not conventionally a star scale, use **Meter** or **Delta**; if it is a display-only value in a table, plain text or a **Chip** reads faster and costs nothing. For a general bounded number picker use **Slider**.

## The contract

```
@value?, @defaultValue?, @max? (5), @precision? (1), @label?
@readonly?, @disabled?, @hue?
@onValueChange?(value: number), @onHover?(phase: 'start'|'move'|'end', value: number)
```

Hybrid controlled/uncontrolled, the kit-wide idiom.

**`@precision` produces fractional symbols by clip-path, not by extra elements.** A symbol whose fraction is between 0 and 1 gets `clip-path: inset(0 X% 0 0)` over a filled copy, so half stars are one CSS declaration rather than a second overlay layer per star.

**Hover is a separate display channel.** The hovered value and the hovering flag are tracked internally, independently of `@value`, and `displayValue` prefers the hover value only while interactive and hovering — so the preview never mutates state. `@onHover` reports `start`/`move`/`end` with the previewed value, which is what lets a call site show "3 — Good" beside the stars without owning the pointer maths.

**Clicking the current value clears the rating** (`v === value ? 0 : v`). That is Web Awesome's toggle semantic, adopted deliberately: without it a five-star scale has no way back to "unrated".

Value comes from pointer X against the element's `getBoundingClientRect`, rounded up to the nearest `precision` step and clamped — so the whole control is one hit target rather than `max` separate buttons.

## Prior art

APG ships **two** reference examples and they disagree by design: `radio-rating` (a radio group, recommended for seven or fewer discrete values, with free form semantics) and `slider-rating` (recommended for granular scales, and the example that exists specifically to demonstrate `aria-valuetext` — "3 of 5 stars").

**Web Awesome `wa-rating`** takes the slider route: `role = 'slider'` is a _reactive property_ so a caller can override it, the host carries `aria-valuenow`/`valuemin=0`/`valuemax`/`aria-disabled`/`aria-readonly`/`aria-label`, each symbol is `role="presentation"`, and it offers `precision` (fractional stars via clip-path layers), `max`, `readonly`, and a `getSymbol(value, isSelected) => string` HTML hook. **React Spectrum** ships no rating.

Pretui follows Web Awesome closely — `role="slider"`, clip-path fractions, the click-to-clear toggle — which is the right call for `@precision < 1`, where a radio group cannot express half values.

Where Pretui improves: `@onHover` with an explicit three-phase signal is a cleaner contract than reading pointer events at the call site, and the hue escape (`--pretui-rating-hue` set from `@hue`) lets a call site tint a rating per row — a status-coloured rating in a table — without a variant explosion.

Where it is behind: no `getSymbol` equivalent, so the symbol is fixed; and `tabindex` is `-1` when read-only, which removes display ratings from the tab order but leaves them as `role="slider"` — a read-only display would be better as plain text or `role="img"` with a label.

## Accessibility

Governing pattern: APG **Slider** (the `slider-rating` variant). This is one of the better-implemented controls in the kit:

- Present and correct: `role="slider"`, `aria-valuemin="0"`, `aria-valuemax`, `aria-valuenow`, `aria-disabled`, `aria-readonly`, `aria-label` (defaulting to `'Rating'`), `tabindex="0"` when interactive.
- Keyboard: ArrowLeft/ArrowDown decrement, ArrowRight/ArrowUp increment, Home → 0, End → max, all with `preventDefault`. **Shift+Arrow steps by a whole unit** rather than by `@precision`, which is a nice inversion of the usual Shift-means-bigger convention and exactly right for half stars.

Gaps:

- **No `aria-valuetext`.** This is the specific thing the APG `slider-rating` example exists to demonstrate: the control announces "3" where it should announce "3 of 5 stars", and with `@precision` of 0.5 it announces "2.5". Given that Pretui otherwise follows the slider-rating pattern closely, this omission is conspicuous and is the single highest-value fix.
- **No Page Up/Page Down.** Optional in APG, but Shift+Arrow covers the same need here.
- **`@label` defaults to `'Rating'`** — two ratings in a list are both announced identically.
- **A read-only rating is still `role="slider"` with `tabindex="-1"`.** It is announced as a slider that cannot be reached, which is worse than announcing it as text. Display ratings should drop the role.
- **The whole control is one pointer target**, so there are no per-star targets to fail WCAG 2.5.8 — but equally there is no way to select a value by pointer other than aiming within a `(1/max)` fraction of the width. On a small rating that is a narrow target.
- No `forced-colors` treatment for the clip-path fills.

## Theming

`--pretui-rating-hue` (set per instance from `@hue`), plus the kit's ink and control tokens for the empty symbol. Season authors should define a default rating hue that reads at small sizes against both `--card` and `--canvas` — a mid-yellow that works on white commonly disappears on a light panel.
