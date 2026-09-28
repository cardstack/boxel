## What it is

The title row above a region: identity on the left (eyebrow, title, meta), actions on the right. It paints nothing — no surface, no border — so it sits directly on a page or above a **Panel** without doubling its chrome. Use it as the header of a view. If the region needs its own surface, use **Panel** (whose header is a lighter version of the same idea). If you need a dense row of icon actions with keyboard traversal, that is **ActionBar** or a **ButtonGroup**; this is a page header, not an ARIA toolbar.

## The contract

```
@title?, @eyebrow?, @meta?
<:default>   — the actions
Element: HTMLDivElement
```

All three text args are optional and each renders only when present, so a Toolbar can be actions-only.

**The identity column is `min-width: 0` and the title truncates.** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on the `<h2>`, with `flex: none` on the actions. The consequence is the right one: when space is tight, the **title** loses characters and the buttons stay whole and clickable. Most hand-built header rows do the opposite and wrap the buttons onto a second line.

`min-height: 44px` sets the row's rhythm even when it holds only text — so a page of stacked sections has consistent header heights whether or not each has actions.

`@meta` is the third line of the identity stack (after eyebrow and title): a record count, a timestamp, a status phrase.

## Prior art

**SLDS `page-header`** is the closest full-featured analogue — a title row with breadcrumb, meta, detail rows, and an action region. **Web Awesome** has no page header; its `wa-page` component handles layout at a higher level. **shadcn** has no header component; the convention is hand-rolled flex markup per page. **React Spectrum** does not ship one either.

So the comparison is really against "everybody writes this by hand", and Pretui's improvement is that **the truncation and flex behaviour are decided once**. The two things every hand-built header gets wrong — actions wrapping instead of the title truncating, and inconsistent row heights — are both fixed by construction here.

Against SLDS: much smaller. No breadcrumb slot (compose **Breadcrumb** above it), no detail-row region, no icon slot, no variants. That is a defensible floor, but note there is no `<:leading>` block, so putting an avatar or an icon before the title means wrapping the whole thing yourself.

The shared eyebrow voice with **Panel**, **DataGrid** and **FormField** is the quiet win: one mono uppercase treatment across the kit means "category" always looks the same.

## Accessibility

No APG pattern applies, and it is worth being explicit about why: **this is not an ARIA toolbar.** The APG **Toolbar** pattern means `role="toolbar"`, a single tab stop, and arrow-key traversal between at least three controls. This component sets no role, so its actions are ordinary tab stops in document order — which is the correct behaviour for a page header with two or three buttons, and would be the wrong behaviour for a dense formatting toolbar. The name is the misleading part, not the implementation.

Gaps:

- **The title is a hard-coded `<h2>`.** Same problem as **Panel**: a card does not know its host's outline, so every Toolbar emits an `h2` whatever its depth. There is no `@headingLevel` knob, and **ErrorSummary** already demonstrates the fix. This is the clearest thing to change.
- **The truncated title has no `title` attribute and no full-text fallback.** When the `<h2>` ellipsizes there is no way — by pointer or by keyboard — to read the whole thing. Screen readers announce the full text (the string is in the DOM), so this is a sighted-user problem specifically, and a WCAG **1.4.4/1.4.10** concern at high zoom where truncation kicks in early.
- **The root is a `<div>`, not a `<header>`.** Given it carries the region's heading, `<header>` would give it `banner`-adjacent structure inside a `<section>` for free.
- **`@eyebrow` and `@meta` are loose text around the heading**, unwired to it — announced in reading order, which is acceptable but means the heading alone is often not self-describing ("Overview" where "REVENUE · Overview · 24 records" is meant).
- **`min-height: 44px`** is a good target-size floor for the row, but the actions inside are **Button**s at 28px, which clears WCAG 2.5.8's 24×24 minimum only narrowly; adjacent icon actions with no gap will have touching targets.
- If you _do_ have three or more related icon actions here, wrap them in something with `role="toolbar"` — the pattern's whole point is shortening the tab sequence, and this component does not do it.

## Theming

`--muted-foreground` (eyebrow and meta ink), `--foreground` (title, inherited), `--font-mono` + `--text-ui-xs` + `--track-eyebrow` (eyebrow voice), `--text-heading` + `--weight-heading` + `--track-heading` (title), `--text-ui-sm` (meta), `--space-3` (action gap), `--space-4` (column gap).

The component paints no background and casts no shadow — it inherits whatever it sits on. That is why it composes above a **Panel** without a seam, and it also means a season cannot give headers their own band without wrapping them. The 44px minimum height is fixed and is the one metric a dense season would want to retune.
