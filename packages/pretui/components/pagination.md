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

`go()` clamps to `[1, @pages]`, so a caller cannot drive it out of range, and ignores a request for the page already showing, so `@onPageChange` fires only when the page would change. A press on the current page, or on an edge arrow at its end, reports nothing.

The gap is a `<span>`, not a button — clicking `…` does nothing.

## Prior art

**There is no APG pattern for pagination.** The composed convention is: a navigation landmark with a distinct `aria-label`, links or buttons in the natural tab sequence, `aria-current="page"` on the active one, and no arrow keys or roving tabindex.

**Web Awesome `wa-pagination`** is the most complete implementation in the field: `total`/`page-size`/`page`, `sibling-count`, `boundary-count`, `with-edges`, `with-summary`, `format` (`standard`|`compact`), `href-template`, `hide-single-page`, a cancelable `wa-before-page-change` event, `<nav aria-label>` → `<ul role="list">` → `<li>`, `aria-current="page"` on the active item, **`aria-disabled` rather than `disabled`** so edge controls stay focusable, a polite live region announcing changes, and clicking an ellipsis jumps ±5. **Ark UI** exposes an `api.pages` array of `{ type: 'page' | 'ellipsis' }` — item-as-data via render prop, structurally the same idea as Pretui's `list` getter. **shadcn** ships presentation only.

Pretui's improvements are narrow but real: the fixed window (above) gives a stable strip that Web Awesome's configurable one does not guarantee, and `font-variant-numeric: tabular-nums` on the page buttons keeps the digits from jittering as the numbers change width — a detail almost everyone misses.

Where it is behind Web Awesome, and it is a fair distance: no summary ("11–20 of 240"), no `href` mode (so pages are not linkable or bookmarkable), no page-size control, no first/last jumps, no ellipsis jump, no cancelable change event, and no announcement.

## Accessibility

No APG pattern; governed by WCAG **2.4.8 Location** (AAA — this is the criterion pagination exists to satisfy), **2.4.4 Link Purpose**, **4.1.2** and **2.5.8 Target Size**.

What is right: the root is a `<nav aria-label="Pagination">`, so it is discoverable by landmark navigation and distinguishable from other navs. The active page carries `aria-current="page"` (alongside the visual `data-state="active"`), which is the one required property of the pattern. Previous/Next carry `aria-label`, and each page number carries `aria-label="Page N"` so "3" is not announced bare. All controls are ordinary tab stops, which is correct — pagination is not a roving-tabindex widget. At either end the edge arrow is marked `aria-disabled="true"` rather than natively `disabled`, so it stays in the tab order — a keyboard user tabbing backward into the strip at page 1 still lands on Previous and hears that it is unavailable — and a press on it does nothing and reports nothing. This is the choice Web Awesome makes. The disabled arrow dims its glyph to `--subtle-foreground` rather than fading the whole button, so its `--ring` focus outline stays at full strength.

Gaps, in order:

- **Page changes are not announced.** After clicking "3" the table content changes and nothing says so; focus stays on the button, which is right, but a polite live region ("Page 3 of 12") is what Web Awesome adds.
- **Target size**: the buttons are `min-width: 1.625rem; height: 1.625rem` with a gap of about 2px — **below WCAG 2.5.8's 24×24 minimum once you account for the fact that 26px is the outer box and the gap is only 2px**, so adjacent targets effectively touch. Technically 26 ≥ 24 so the criterion passes, but only just, and this is the most-tapped small control in the kit.
- The arrows render `ChevronLeft` / `ChevronRight` icons with `aria-hidden`, inside buttons that carry `aria-label`; the icons mirror under a right-to-left writing direction.
- The `…` gap is a `<span>` with no role, announced as "horizontal ellipsis" or skipped. Harmless.

## Theming

`--muted-foreground` (resting ink), `--foreground` (hover ink), `--hover` (hover fill), `--selected` (active fill), `--primary-ink` (active ink), `--border` (the active page's edge), `--subtle-foreground` (a disabled edge arrow), `--ring` (focus outline), `--subtle-foreground` (the ellipsis, like a disabled arrow), `--boxel-font-size-xs`. Spacing and radius come from `--boxel-sp-*` and `--boxel-border-radius-sm`. A press scales a page button to 0.96 (suppressed under `prefers-reduced-motion`); the current page and aria-disabled arrows do not react to it, and hovering the current page keeps its selected look. The hover fill applies only on a device with a hovering pointer, so a tapped button on a touch screen does not keep it.

`--selected` is the notable one: it is the kit's "this row is the chosen one" fill, shared with selection states elsewhere, and a season that leaves it at the default light blue while retuning `--primary` to a warm hue will produce an active page whose fill and ink disagree. Define the pair together, and check `--primary-ink` for contrast against `--selected` rather than against `--card`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Compose onto **DataTable** / **List**. Accept `page` / `pageSize` /
`onPageChange` / `total`. Ant `showSizeChanger` is a Select of page
sizes — optional enhancement.
