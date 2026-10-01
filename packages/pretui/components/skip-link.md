## What it is

**The first focusable control in a pane**: a link past the header and navigation to the main content. It satisfies WCAG 2.4.1 Bypass Blocks. It is off screen until it receives focus, then appears in the top start corner, so a keyboard user sees where the first Tab took them.

Put exactly one SkipLink first in the pane, before any header or navigation. For other screen-reader-only text, use **VisuallyHidden**.

## The contract

```
@href? (default '#main')
@label? (default 'Skip to content')
Element: HTMLAnchorElement
```

**A plain in-page anchor.** It needs no router and no script: following it moves the document to the element with the matching id. Give the target `tabindex='-1'`, for example `<main id='main' tabindex='-1'>`, so focus moves there too, not only the scroll position. Without it, the next Tab starts from the top again in some browsers.

**Hidden with the clip pattern until focused.** Unfocused, it is 1px and clipped, but it stays in the tab order and the accessibility tree. Focused, it is a solid primary-toned pill, absolutely positioned in the top start corner of the nearest positioned ancestor.

## Prior art

**Chakra `SkipNavLink` / `SkipNavContent`** pairs the link with a target component that carries the id. **Gov.uk and USWDS** ship a skip link as a class on an anchor. Most other React kits (Radix, MUI, Ant, Mantine) have none, and agents hand-roll an `sr-only focus:not-sr-only` anchor.

Where Pretui is better: the hidden state keeps the link reachable. Hand-rolled versions often use `display: none` until focus, which never receives focus at all. Where it is thinner: **no target component**. Chakra's `SkipNavContent` sets the id and `tabindex` for you; here you put them on your `<main>`.

## Accessibility

No APG pattern. WCAG 2.4.1 and the conventions around it.

- **It is a real link.** `<a href>`, in the natural tab order with no `tabindex` and no `aria-hidden`. The tests assert the tag, the default `href` and label, and that it can take focus.
- **It must come first.** A skip link after the navigation skips nothing. Render it before the header.
- **The target must accept focus.** Put `tabindex='-1'` on it so focus moves with the scroll.
- **The label says where it goes.** "Skip to content" is the convention. Use "Skip to results" or similar when the main region has a more specific job.
- **The focus ring is always shown** on `:focus-visible`.

## Theming

`--primary` and `--primary-foreground` (the revealed pill), `--radius-control`, `--pretui-shadow-raised`, `--ring` (focus ring), `--font-sans`, `--text-ui-md`, `--space-2`, `--space-3` and `--space-4`, and `--pretui-z-toast`, so it sits above page chrome while it is visible.

The corner position and the clip-until-focus behaviour are fixed.

## React ecosystem

| Agent types                                 | Give them                                  |
| ------------------------------------------- | ------------------------------------------ |
| Chakra `<SkipNavLink>`                      | `<SkipLink />`                             |
| Chakra `<SkipNavContent>`                   | `id='main' tabindex='-1'` on your `<main>` |
| `<a className="sr-only focus:not-sr-only">` | `<SkipLink @href @label />`                |
