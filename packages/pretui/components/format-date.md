## What it is

Locale-aware date and time rendering on a real `<time>` element, with a correct `datetime` attribute and a long-form title.

**RelativeTime** is its sibling: this one says "14 March 2026", that one says "2 months ago".

## The contract

```
@date?      — a Date, an epoch number, or a string. A bare YYYY-MM-DD is read as a
              LOCAL calendar date, not UTC midnight
@locale?    — BCP-47 tag; an unknown tag falls back rather than throwing
@dateStyle?, @timeStyle? — whole-date and whole-time presets
@weekday?, @era?, @year?, @month?, @day?, @hour?, @minute?, @second?
@timeZone?, @calendar?, @numberingSystem?
@now?       — reference instant for @omitCurrentYear. Caller-supplied
@omitCurrentYear? — drop the year when the date is in the same year as @now
@options?   — any Intl option not named above; named knobs win
@hint?      — title attribute carrying the long form. Default true
@token?     — wear the Token dress, for machine contexts like a log line
@spoken?    — sr-only mirror: 'auto' (default) | 'always' | 'off'
@placeholder? — when the date is missing or unparseable. Default '—'
```

**A bare `YYYY-MM-DD` is a local calendar date, not UTC midnight.** Reading it as an instant is how a date shifts by a day for half the world.

**`datetime` is calendar-correct.** A date-only rendering emits a local calendar date rather than an ISO instant — which for a Berlin morning would otherwise stamp the previous day.

**Precedence is resolved before Intl sees it.** `Intl` _throws_ when `dateStyle`/`timeStyle` meet component options like `@month` or `@weekday`; here any component option present simply drops the styles. Same policy as **FormatNumber**: a formatter must not take down a card over a combination of args.

**`@omitCurrentYear` is inert without `@now`**, because deciding what "this year" means requires an instant and this component never reads the clock.

## Prior art

**`wa-format-date`.**

Where Pretui is better: the calendar-correct `datetime`, the resolved precedence instead of a throw, and the clock-free `@omitCurrentYear`.

Where it is thinner: no date ranges, no duration formatting, and no "smart" format that switches between absolute and relative — combining the two is the caller's call.

## Accessibility

- **It renders a real `<time>` with a machine-readable `datetime`**, so assistive technology and anything parsing the page get the unambiguous value.
- **`@spoken='auto'` mirrors when the visible form is numeric-heavy.** "3/14/26" read aloud is three numbers; the mirror says the date.
- **`@hint` puts the long form in a `title`**, which is a pointer affordance rather than an accessible one — a caller-supplied title in `...attributes` wins, so it can be overridden.
- **`@placeholder` announces as a dash** rather than leaving an empty element.
- **A date with no year is ambiguous out of context.** `@omitCurrentYear` is a density optimisation for a list where the year is obvious; in a single rendered date it removes information a reader may need.

## Theming

`@token` swaps to the kit's **Token** treatment; otherwise the element inherits everything from its context.

A date in prose should be prose and a date in a log line should be mono, and those are the only two cases — which is why there is one flag rather than a token surface.
