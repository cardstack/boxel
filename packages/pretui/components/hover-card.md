## What it is

A rich preview that opens on hover or focus: a person behind a mention, the card behind a reference, the definition behind a term. It sits between two neighbours. **Tooltip** is a short string and is never interactive. **Popover** opens on click and can hold a form. HoverCard opens without a click, holds real content with its own links, and must itself be hoverable so the pointer can travel into it — which is what makes it the hardest of the three to get right.

Use it for a preview the reader might want and can live without. If the content is something they must see, it is not a preview: put it on the page, or behind a **Popover** they open on purpose.

## The contract

```
@open? @defaultOpen? @onOpenChange?        — the overlay contract
@placement? (default 'bottom-start') @distance? (8)
@openDelay? (seconds, default 0.5)
@closeDelay? (seconds, default 0.3)
@label? (default 'Preview')                — the card's accessible name
@tapToOpen? (default true)                 — a tap opens it on a coarse pointer
<:trigger>                                 — the link or control being previewed
<:default as |close|>                      — the card
```

**Delays are in seconds.** Radix passes `700`; a bare number in a prop is a unit no caller can check, so here `@openDelay={{0.7}}` says what it means. The pair matters more than either value: the open delay stops the card firing as the pointer crosses the link, and the close delay is the bridge across the gap between trigger and card. Set the close delay to zero and the card becomes unreachable by pointer no matter how good the open delay is.

**Focus ignores the open delay.** A reader who deliberately tabbed to the trigger has already expressed the intent, so the card opens at once. Focus leaving the whole surface — trigger and card together — closes it at once too.

**The trigger block owns the control.** The focusable element inside it is given `aria-expanded` and an `aria-controls` pointing at the card, both removed on teardown. Wrap a link, a button, or a **RecordPill**; the trigger's own activation is untouched, so a link stays a link.

**Touch has a path.** On a coarse pointer a tap opens the card without swallowing the trigger; a tap outside closes it. `@tapToOpen={{false}}` turns that off, leaving the card reachable only by keyboard on touch devices — usually the wrong trade.

**The default block yields `close`** for a card that wants its own dismiss. It closes and returns focus to the trigger, the same path Escape takes.

## Prior art

**shadcn HoverCard** is **Radix HoverCard**: `openDelay` / `closeDelay` in milliseconds, `side` / `align` for placement, `open` / `onOpenChange` / `defaultOpen`. **Mantine HoverCard** adds a `shadow` prop and a group-open. **Base UI PreviewCard** and **React Aria PreviewTrigger** are the same idea under the accessibility-conscious names. All share the two delays, because without them the card flickers.

Where this is better, and the difference is the whole component: **the card is reachable by the people the pattern usually excludes.** Radix sets `tabindex='-1'` on every tabbable node inside the card. That prevents a keyboard trap, at the price of making the card's own links unreachable by exactly the users who most needed them reachable. Here the card renders in DOM order immediately after the trigger and keeps its tab stops, so Tab walks *into* it, Tab out of the last one leaves and closes it, and Escape closes it and returns focus to the trigger. Radix also excludes touch outright, so on a phone the card does not exist; `@tapToOpen` gives it one. And the trigger carries `aria-expanded` and `aria-controls`, a relationship neither Radix nor shadcn establishes, so a screen-reader user is told the preview exists.

Where it is thinner: no `side` / `align` pair — one logical `@placement` resolved through the kit's own `anchorTo`; no arrow; no portal arg, because the shared `Popup` decides that; and no Mantine-style group hover. The card has no built-in layout: it is a padded surface, and what goes in it is yours.

## Accessibility

Governing pattern: there is no APG pattern for a hover card, and that absence is the point — content that only appears on hover is content a keyboard user, a screen-reader user and every touch device cannot reach, so the component's job is to give each of them a path. WCAG **1.4.13** (content on hover or focus) is the requirement: dismissible, hoverable, persistent.

What it does, and the tests assert:

- **Focus opens it with no delay**, and the trigger's control gets `aria-expanded='true'` plus an `aria-controls` that points at the card's `id`.
- **The card keeps its own tab stops.** A link inside it is reached by Tab from the trigger, and Tab past the last one leaves the surface and closes the card.
- **Escape closes it and returns focus to the trigger**, taken in the capture phase on the document while open.
- **Focus leaving the whole surface closes it**; focus moving between trigger and card does not.
- **The card is `role='dialog'`** with `aria-label` from `@label`. The default `'Preview'` is generic; name the thing being previewed.
- **Hoverable and persistent** by construction: the close delay bridges the gap, and pointer travel into the card cancels the close.

The caller's part: put a real focusable control in the trigger block, or none of the keyboard path exists. Keep the card's content meaningful without the trigger's context, because a reader who tabs into it arrives with no pointer position. And do not put anything essential in it — 1.4.13 makes hover content dismissible, and a dismissed card is gone.

## Theming

Read directly: `--popover` and `--popover-foreground`, `--radius-surface`, `--space-4`, `--font-sans`, `--text-ui-md`, `--pretui-shadow-overlay`, and the enter motion pair `--pretui-dur-enter` / `--pretui-ease-enter`.

One knob of its own: `--pretui-hovercard-width` (default 260px), capped at the viewport minus 16px. Entry motion is `@starting-style` (opacity plus a 4px rise and 0.98 scale, 180ms) with a `prefers-reduced-motion` opt-out. Position and flip come from the shared `Popup`, so a season that retunes overlay placement retunes this with it.

## React ecosystem

| Agent types | Give them |
| --- | --- |
| Radix `openDelay={700}` / `closeDelay={300}` | `@openDelay={{0.7}}` / `@closeDelay={{0.3}}` — seconds |
| `open` / `onOpenChange` / `defaultOpen` | same |
| `side` / `align` | one `@placement` |
| `HoverCardTrigger` / `HoverCardContent` | `<:trigger>` / `<:default>` |
| Mantine `shadow` | `--pretui-shadow-overlay` |
| a preview that must be tappable on mobile | `@tapToOpen` (on by default) — Radix has no equivalent |
| a card with a form in it | **Popover** |
| a one-line label | **Tooltip** |
