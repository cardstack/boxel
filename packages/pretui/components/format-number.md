## What it is

Locale-aware number rendering: decimals, currency, percentages, units, compact notation — the whole of `Intl.NumberFormat` exposed as args, with a screen-reader mirror where the visible text is abbreviated.

## The contract

```
@value?       — the number; strings are coerced, anything non-finite renders @placeholder
@locale?      — BCP-47 tag; an unknown tag falls back rather than throwing
@style?       — 'decimal' (default) | 'currency' | 'percent' | 'unit'
@currency?    — ISO 4217, required by style='currency'
@currencyDisplay?, @currencySign?
@unit?, @unitDisplay?   — CLDR unit identifier and wording
@notation?    — 'standard' (default) | 'compact' | 'scientific' | 'engineering'
@compactDisplay?, @signDisplay?, @useGrouping?
@minimumIntegerDigits?, @minimumFractionDigits?, @maximumFractionDigits?
@minimumSignificantDigits?, @maximumSignificantDigits?
@numberingSystem?
@options?     — any Intl option not named above; named knobs win over it
@token?       — wear the Token dress, for machine contexts like a parameter row
@spoken?      — sr-only mirror: 'auto' (default) | 'always' | 'off'
@placeholder? — when the value is missing or not finite. Default '—'
```

**Nothing throws.** An unknown locale falls back; `style='currency'` without a `@currency` degrades to decimal. A formatter that throws takes a whole card's render down over a data problem, which is never the right trade in a realm.

**Named knobs win over `@options`.** The bag is an escape hatch for options this contract does not name, not a second way to set the ones it does.

**`@spoken='auto'` mirrors whenever the visible text is abbreviated** — compact, scientific or engineering notation. "1.2M" read aloud is not a number; the mirror says the whole one.

## Prior art

**`wa-format-number`.**

Where Pretui is better: the spoken mirror, and the refusal to throw. The upstream passes options straight to Intl, so a bad locale or a currency style with no code is a runtime exception in the middle of a page.

Where it is thinner: no range formatting (`formatRange`), no per-part styling — you cannot make the currency symbol smaller than the digits — and no plural-aware wording beyond what `@unitDisplay` gives.

## Accessibility

- **The mirror is the point.** Abbreviated numbers read badly aloud, and `'auto'` decides that for you rather than leaving every call site to think about it.
- **`@spoken='always'` is worth it in a dense table** where the visible form is terse for space reasons rather than notation reasons.
- **`@spoken='off'` is for when the number is already announced elsewhere** — inside a label that repeats it, say.
- **`@placeholder` defaults to an em dash**, which is announced as a dash rather than as silence, so a missing value is perceivable as missing.
- **Grouping separators differ by locale**, which is why `@locale` matters to comprehension and not only to appearance.

## Theming

`@token` swaps the component into the kit's **Token** treatment — mono face, tabular figures — rather than defining a surface of its own.

That is the whole theming story on purpose: a formatted number should look like the text around it unless it is a machine value, and the Token dress is the kit's one answer for machine values.
