## What it is

"3 days ago", "in 2 hours" — a timestamp rendered as a phrase relative to a reference instant. Use it in **Timeline**, **Feed**, comment lists, activity rows: anywhere the _recency_ matters more than the exact instant. If the exact instant matters — an audit record, a scheduled time, a legal timestamp — render the absolute date instead, or render both. For a formatted absolute date, **FormatDate**; for a fixed known date, **KnownDate**.

## The contract

```
@date: string | Date   (required)
@now?: string | Date
@format? 'long' | 'short' | 'narrow'   (default 'long')
@numeric? 'always' | 'auto'            (default 'auto')
Element: HTMLTimeElement
```

**It does not tick.** The realm forbids timers, so the phrase is computed once from `@date` versus `@now` and recomputes only when the args change. `@now` is caller-supplied — the same precedent as **LoadingState**'s elapsed arg — and when omitted it captures the _construction_ instant. So "2 minutes ago" stays "2 minutes ago" until the caller refreshes `@now`. On a long-lived page that is a correctness issue you must handle, not a limitation you can ignore.

**`@numeric='auto'` is the right default** and is what turns "1 day ago" into "yesterday" and "0 days ago" into "today". `'always'` keeps the numbers, which is what you want in a dense table where every row should read the same shape.

The unit is chosen by walking a descending table (year, month, week, day, hour, minute) and taking the first whose magnitude the difference exceeds, falling back to seconds. Note **`week` is in the table**, so a 10-day-old item reads "last week" rather than "10 days ago" — worth knowing, because several implementations skip weeks.

## Prior art

**Web Awesome `wa-relative-time`** is the direct semantic source: `date`, `format`, `numeric`, `sync` and a locale, wrapping `Intl.RelativeTimeFormat` over a `<time>` element. **React Spectrum** has no relative-time component. **`<relative-time>`** (GitHub's element) is the widely-deployed reference and it _does_ tick.

The differences, stated honestly:

- **Web Awesome has `sync`, which auto-updates the phrase.** Pretui cannot — no timers — so `@now` is the caller's job. That is a real capability gap, imposed by the platform rather than chosen, and it is why the arg exists at all.
- **Pretui has no locale arg.** `Intl.RelativeTimeFormat` is constructed with a hard-coded `'en-US'`. Web Awesome takes the element's `lang`. For an internationalised product this is disqualifying, and it is the same gap **Calendar** has.
- **Pretui recomputes the formatter on every access.** `new Intl.RelativeTimeFormat(...)` inside the `phrase` getter means a table of 200 timestamps constructs 200 formatters per render. `Intl` constructors are not cheap; hoisting them into module-level constants (as this same file already does for `DISPLAY_FMT`, `LABEL_FMT`, `MONTH_FMT` and `ABS_FMT`) is a one-line fix and an inconsistency with the file's own practice.

Where it is better than the naive version everyone writes: it uses `Intl.RelativeTimeFormat` rather than a hand-written pluralisation ladder, so "1 minute ago" versus "2 minutes ago" is the platform's problem, and it renders a real `<time>` element.

## Accessibility

No pattern governs it. The relevant criteria are WCAG **1.3.1** and, for the ticking question, **4.1.3**.

What is right, and it is the important part:

- **It renders `<time datetime="…">` with a full ISO 8601 timestamp.** So the machine-readable instant is always present even though the visible text is a phrase — which is exactly what `<time>` is for, and what a `<span>` version loses. Assistive tech, browsers and scrapers all get the real value.
- **`title` carries the absolute formatted date** (`ABS_FMT`, medium date plus short time), so a pointer user can hover for the exact instant.
- **Nothing ticks, so nothing announces repeatedly.** A live-updating relative time inside a live region is a notorious screen-reader nuisance; the no-timer constraint accidentally produces the polite behaviour.

Gaps:

- **`title` is the only route to the absolute time for most users.** It is not shown on touch, not reachable by keyboard, and announced inconsistently by screen readers. So for a keyboard or touch user, "3 days ago" is _all_ the information available. Where the exact instant matters, render it visibly rather than relying on `title`.
- **Screen readers do not announce `datetime`.** The `<time>` element's machine value is not spoken; a screen-reader user hears the phrase, same as everyone else. The `datetime` attribute is for machines, not for assistive tech — a common misconception worth stating.
- **A stale `@now` produces silently wrong output.** "2 minutes ago" on a page open for an hour is a factual error with no visual indication. This is the component's most consequential failure mode and it is the caller's to prevent.
- **An invalid `@date` renders an empty string** — `phrase` returns `''` and `datetime` is `undefined`, so the element is empty. Nothing is announced, and nothing distinguishes it from a missing value.
- **No locale support** (above) means non-English users see English phrases regardless of their settings.
- `white-space: nowrap` prevents a phrase wrapping mid-way, which is right.

## Theming

Effectively none: `white-space: nowrap` and `font-variant-numeric: tabular-nums`. Ink, size and family are inherited from context — which is correct for something that appears inside **Timeline** rows, **Feed** articles and table cells, and should look like the text around it in each.

The tabular figures are the one deliberate typographic choice: in a column of timestamps, "11 days ago" and "3 days ago" align on the same grid rather than jittering. A season needs a font whose tabular figures actually differ from its proportional ones for that to have any effect.
