## What it is

A reading-progress ribbon bound to scroll: a filled bar that tracks how far through a document, or a scrolling container, the reader has got.

## The contract

```
@source?    — 'page' (default) tracks the document; 'nearest' tracks the closest
              scrolling ancestor — the ribbon must live inside it
@thickness? — ribbon thickness in px
@track?     — show the unfilled remainder. Default true
@affix?     — 'none' (default) leaves placement to the caller; 'top' / 'bottom'
              stick the ribbon to that edge of its scroll container
@label?     — accessible name; required when @announce is true
@announce?  — expose the ribbon as a live progressbar to assistive tech. Off by default
```

**It prefers a scroll-driven CSS animation and falls back to a listener.** When the browser supports `animation-timeline: scroll()` and the ribbon is not announcing, the fill is computed by the compositor with no JavaScript on the scroll path at all. Otherwise a passive scroll listener writes a ratio into a custom property.

**`@announce` forces the listener path**, because `aria-valuenow` has to be written by script — there is no declarative way to keep an ARIA value in sync with a CSS scroll timeline.

**`@track` defaults to true, and it is what makes the component legible in a still frame.** A bare fill with no remainder reads as a coloured line rather than as progress.

**`@source='nearest'` requires the ribbon to live inside the container it tracks.**

## Prior art

**motion-primitives' ScrollProgress**, with fancy's parallax family as a cousin.

Where Pretui is better: **the CSS scroll-timeline path.** Upstream implementations attach a scroll listener unconditionally and update state on every scroll event; here that is the fallback, not the default, so on a modern browser the ribbon costs nothing on the scroll path. The track is also on by default rather than being an afterthought.

Where it is thinner: no horizontal-scroll source, no segment or chapter markers along the ribbon, no circular variant, and no reading-time estimate. The fill is linear with no easing.

## Accessibility

- **The ribbon is `aria-hidden` by default, and that is deliberate.** A progress bar that updates continuously as someone scrolls is a live region that never stops talking — for most readers it is noise, and the scroll position is already perceivable through the content itself.
- **`@announce` is the opt-in for the cases where it genuinely helps** — a long legal document, a form-like reading flow — and it requires `@label`, because an unnamed progressbar tells a listener nothing.
- **With `@announce` on, the value is rounded to whole percent.** A `aria-valuenow` updating on a fractional ratio would be unbearable.
- **The ribbon is never focusable and never interactive.** It reports; it does not seek.
- **Colour alone carries the fill.** With `@track={{false}}` there is no boundary between filled and unfilled, so the progress is conveyed by extent against nothing — keep the track.

## Theming

`--pretui-scroll-progress` (the 0–1 ratio, written by either path), `--pretui-scrollprogress-fill`, `--pretui-scrollprogress-track`, `--pretui-scrollprogress-thickness` (from `@thickness`), `--pretui-scrollprogress-radius`.

Splitting fill and track into two tokens is what lets a season set the contrast between them; a season that makes them too close produces a ribbon that is technically animating and practically invisible, which is the failure mode to check in a dark palette.
