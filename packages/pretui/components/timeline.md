## What it is

A chronological sequence rendered as an ordered list with a vertical rail: audit trails, order history, a record's lifecycle, a batch's journey. Use it when the *order* and the *when* are both load-bearing. If items arrive continuously and the reader pages through them, **Feed** is the right pattern (and has the ARIA for it). If the sequence is a process the user is completing, **StepList**. If it is just a list, a list.

## The contract

```
@events: TimelineEvent[]   { id, title, at?, status?, token?, person?, body?, icon? }
@label?, @density? ('expanded' | 'compact'), @now?
<:default>   — replaces the body
Element: an <ol>
```

**The order you pass is the order rendered and numbered.** No sorting, no reversing. Newest-first and oldest-first are both legitimate and the component refuses to guess.

**The event fields map onto kit components rather than to strings:** `status` → **StatusChip** (hue derived from the value, Law 2), `token` → **Token** (machine values as jewelry, Law 3), `at` → **RelativeTime** (timer-free, `@now` supplied by the caller), `person` → **Avatar** plus name. That is the interesting design decision: the data shape is declarative, and the visual vocabulary is the kit's, so every timeline in a product looks the same and none of them invent their own status colours.

`@density='compact'` collapses each event to one line with a smaller marker and no marker ring; `expanded` gives each a body block.

## Prior art

**MUI `Timeline`** and the shadcn-community timelines are the references, and the criticism the source makes of them is specific and correct: **their rail is real DOM content** — connector `<span>`s and dot `<span>`s that a screen reader dutifully reads out as noise between every pair of items.

Pretui's departures:

- **The rail is a CSS pseudo-element** and therefore invisible to assistive tech by construction; the marker span carries `aria-hidden`. A screen reader reads "1. Lot B-1181 cupped — 3 days ago" and no bullet noise. This is the single best thing about the component.
- **It is a real `<ol>`**, so items are numbered and counted by the reader.
- **No left/right alternating layout.** MUI's signature look is dropped deliberately: it doubles the CSS, halves the line length, and reads as two unrelated columns at narrow widths. The "opposite content" slot that exists only to feed that layout goes with it.
- **No per-event duration bars** — compose **Meter** or **ProgressBar** into the default block.

Where it is behind MUI: no alternating layout (if you want that look, you cannot have it), no horizontal orientation, and no built-in grouping by day.

The narrow-container behaviour uses an **unnamed container query** — named ones are forbidden in realm code, because the scoped-CSS transpiler silently drops every rule after one — so the timeline reflows against its pane rather than the viewport. Same constraint and same payoff as **FormLayout**.

## Accessibility

No APG pattern; a timeline is a list, governed by WCAG **1.3.1** and **1.3.2 Meaningful Sequence**.

What is right:

- **`<ol>` with `role="list"` set explicitly.** The explicit role is not redundant: `list-style: none` strips list semantics in Safari/VoiceOver, so an unstyled list silently stops being announced as a list. The source calls this out, and most kits ship the bug.
- **All chrome is `aria-hidden` or a pseudo-element** (above). The reading experience is the content and nothing else.
- **`aria-label` on the list** gives the sequence a name.
- **Composed components carry their own semantics**: `RelativeTime` supplies a machine-readable timestamp, `StatusChip` supplies text, `Avatar` supplies a name.

Gaps:

- **Timestamps are relative, and relative time is ambiguous.** "3 days ago" is what **RelativeTime** renders; it renders a `<time datetime>` carrying the exact timestamp, but screen readers announce the relative text, not the attribute. For an audit trail, where the exact timestamp is often what a user needs, put the absolute date in the item's own text.
- **`@now` is caller-supplied** (realm components own no timers), so a stale `@now` produces stale relative times with no indication. On a long-lived page "3 days ago" can quietly become wrong.
- **Event `title` is not a heading.** A long timeline has no structure to navigate by; a screen-reader user reads it linearly or not at all.
- **The status is announced as a bare word** ("Cupped") with no indication that it is a status rather than part of the title. **StatusChip**'s own note applies: a chip has no accessible relationship to the property it is the value of.
- **No `aria-current`** for a "you are here" event, if the timeline shows one.
- **Icons come from the icon registry via `@icon`** and are inside the `aria-hidden` marker, so a meaningful icon (error, warning) conveys nothing to assistive tech. Put the meaning in `status` or `title`.

## Theming

Rail and markers: `--border` (rail), `--card` (marker fill), `--pretui-shadow-hairline` (the marker ring, removed at compact density), plus the marker glyph's ink. Content: `--foreground`, `--muted-foreground`, `--text-ui-md`, `--text-ui-sm`. Composed components bring their own — **StatusChip**'s `--chart-*` palette, **Token**'s `--pretui-token-hue`, **Avatar**'s hash palette.

The 11px compact glyph, the marker sizes and the rail width are fixed; density is an arg, not a token.

Because the rail is a pseudo-element behind opaque markers, a season must keep `--card` (the marker fill) opaque and distinct from `--border` — a transparent or near-border marker fill lets the rail show through and the sequence stops reading as discrete moments.

The styles sit in `@layer PretComposite`, above RelativeTime's `PretComponent` layer, so what this component sets on RelativeTime wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
