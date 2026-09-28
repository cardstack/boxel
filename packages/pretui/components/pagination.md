## What it is

Page controls for a paged list: previous, a windowed run of page numbers with ellipses, next. Use it under a **DataGrid** or **Table** whose data arrives a page at a time. If the list loads more on scroll, you do not want this. If the user is stepping through a _process_ rather than a list, use **Stepper** or **StepList**.

## The contract

```
@pages: number   (required)
@page?, @defaultPage?, @onPageChange?(n: number)
Element: HTMLElement (a <nav>)
```

Hybrid controlled/uncontrolled, the kit-wide idiom: `@page ?? @internal`, with `@internal` written only when `@page === undefined`.

**The window rule is fixed and not configurable:** always show page 1, always show the last page, always show the current page ±1, and collapse everything else to a single `…`. So the strip is at most seven items wide and never changes width as you move through the middle of a long list — which is the property that stops the buttons from sliding under the pointer between clicks. Web Awesome makes the equivalent two knobs (`sibling-count`, `boundary-count`); Pretui hard-codes the pair that produces a stable strip.

`go()` clamps to `[1, @pages]`, so a caller cannot drive it out of range.

The gap is a `<span>`, not a button — clicking `…` does nothing.

## Prior art

**There is no APG pattern for pagination.** The composed convention is: a navigation landmark with a distinct `aria-label`, links or buttons in the natural tab sequence, `aria-current="page"` on the active one, and no arrow keys or roving tabindex.

**Web Awesome `wa-pagination`** is the most complete implementation in the field: `total`/`page-size`/`page`, `sibling-count`, `boundary-count`, `with-edges`, `with-summary`, `format` (`standard`|`compact`), `href-template`, `hide-single-page`, a cancelable `wa-before-page-change` event, `<nav aria-label>` → `<ul role="list">` → `<li>`, `aria-current="page"` on the active item, **`aria-disabled` rather than `disabled`** so edge controls stay focusable, a polite live region announcing changes, and clicking an ellipsis jumps ±5. **Ark UI** exposes an `api.pages` array of `{ type: 'page' | 'ellipsis' }` — item-as-data via render prop, structurally the same idea as Pretui's `list` getter. **shadcn** ships presentation only.

Pretui's improvements are narrow but real: the fixed window (above) gives a stable strip that Web Awesome's configurable one does not guarantee, and `font-variant-numeric: tabular-nums` on the page buttons keeps the digits from jittering as the numbers change width — a detail almost everyone misses.

Where it is behind Web Awesome, and it is a fair distance: no summary ("11–20 of 240"), no `href` mode (so pages are not linkable or bookmarkable), no page-size control, no first/last jumps, no ellipsis jump, no cancelable change event, and no announcement.

## Accessibility

No APG pattern; governed by WCAG **2.4.8 Location** (AAA — this is the criterion pagination exists to satisfy), **2.4.4 Link Purpose**, **4.1.2** and **2.5.8 Target Size**.

What is right: the root is a `<nav aria-label="Pagination">`, so it is discoverable by landmark navigation and distinguishable from other navs. The active page carries `aria-current="page"` (alongside the visual `data-state="active"`), which is the one required property of the pattern. Previous/Next carry `aria-label`. All controls are ordinary tab stops, which is correct — pagination is not a roving-tabindex widget.

Gaps, in order:

- **Page buttons have no accessible context.** "3" is announced bare; `aria-label="Page 3"` (or `aria-label="Go to page 3"`) is the convention. Previous/Next are labelled; the numbers are not.
- **Edge buttons use the native `disabled` attribute**, so at page 1 the Previous button leaves the tab order entirely and a keyboard user tabbing backward into the strip lands on a page number instead. Web Awesome deliberately uses `aria-disabled` here so the control stays discoverable — the better choice, and one line.
- **Page changes are not announced.** After clicking "3" the table content changes and nothing says so; focus stays on the button, which is right, but a polite live region ("Page 3 of 12") is what Web Awesome adds.
- **Target size**: the buttons are `min-width: 26px; height: 26px` with a 2px gap — **below WCAG 2.5.8's 24×24 minimum once you account for the fact that 26px is the outer box and the gap is only 2px**, so adjacent targets effectively touch. Technically 26 ≥ 24 so the criterion passes, but only just, and this is the most-tapped small control in the kit.
- The `‹` and `›` glyphs are the visible content of buttons that also carry `aria-label`, so the label wins — correct.
- The `…` gap is a `<span>` with no role, announced as "horizontal ellipsis" or skipped. Harmless.

## Theming

`--muted-foreground` (resting ink), `--foreground` (hover ink), `--hover` (hover fill), `--pretui-selected` (active fill), `--pretui-primary-ink` falling back to `--primary` (active ink), `--pretui-shadow-hairline` (active edge), `--ink-3` (the ellipsis), `--text-ui-md`.

`--pretui-selected` is the notable one: it is the kit's "this row is the chosen one" fill, shared with selection states elsewhere, and a season that leaves it at the default light blue while retuning `--primary` to a warm hue will produce an active page whose fill and ink disagree. Define the pair together, and check `--pretui-primary-ink` for contrast against `--pretui-selected` rather than against `--card`.

## React ecosystem

Compose onto **DataTable** / **List**. Accept `page` / `pageSize` /
`onPageChange` / `total`. Ant `showSizeChanger` is a Select of page
sizes — optional enhancement.
