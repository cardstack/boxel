## What it is

**Sheet**'s chrome strip: a title, a quick-filter field, and a slot for actions, driven by the `SheetApi` the grid yields. Use it inside `<Sheet>`'s `<:toolbar>` block. It is not a general-purpose toolbar — for a page header use **Toolbar**, and for a row of related actions use **ButtonGroup** or **ActionBar**.

## The contract

```
@api: SheetApi   (required — the object yielded by <Sheet>'s <:toolbar> block)
@title?, @hideSearch?, @placeholder?
<:actions>
```

**`@api` is the whole coupling.** The toolbar does not own the filter query, the sort, or anything else; it reads and writes through the api object the grid hands it. That is why it is a separate component rather than args on `Sheet`: a caller who wants different chrome writes their own and drives the same api, and a caller who wants the default writes one line.

**The arg is `@hideSearch`, not its inverse** — the quick filter is on by default, because a grid without one is unusable past about thirty rows and defaulting it off means every call site remembers.

The search field is the kit's **SearchInput**, so it matches every other search in the product and inherits its clear affordance.

## Prior art

**boxel-grid ships its own `<Toolbar>`, and it is deliberately unused** — the source says so plainly, along with `<Spinner>`, `<Toast>` and `<GridOverlay>`: Pretui has its own and the names collide. That is the honest reason this component exists, and it is a reasonable one: a toolbar built from the kit's **SearchInput** and **Button** looks like the rest of the product, and the engine's does not.

Against the field: **AG Grid** ships a substantial toolbar with column chooser, export, grouping and filter panels. **TanStack Table** ships no UI at all. **React Spectrum's `TableView`** has no toolbar; sorting and filtering are the caller's chrome.

So this sits at the minimal end deliberately. What it is missing versus AG Grid, and what you will reach for first: **a column chooser** (there is no way to hide or reorder columns), **export**, and **a filter panel** (the quick filter is a single string across all columns — there are no per-column filters, because the engine builds the table with the core row model only and `Sheet` filters the array itself).

Where it is better than rolling your own strip beside a grid: the api coupling means the filter's state and the grid's are the same state, and there is no chance of the toolbar showing a query the grid is not applying.

## Accessibility

No APG pattern applies, and — as with **Toolbar** — it is worth being explicit that **this is not an ARIA toolbar**. The APG **Toolbar** pattern means `role="toolbar"`, a single tab stop and arrow-key traversal; a strip with a title, one text field and two buttons should not have it, and does not.

What matters here is its relationship to the grid, and that is where the notable behaviour lives:

- **The header chrome is deliberately excluded from Sheet's Tab interception.** Sheet's capture-phase handler always lets Tab through inside the header chrome, **so the sort buttons and this toolbar are reachable at all**. Without that carve-out the engine's unconditional Tab binding would swallow focus before it ever reached the strip. Worth knowing: this component is reachable because Sheet explicitly arranged for it.
- **The quick filter is a SearchInput**, and inherits its gaps: no Escape-to-clear, no `role="search"` landmark, and no accessible name unless one is passed.

Gaps:

- **Filter results are announced by Sheet's live status line, not by this component.** That is the right division — the count belongs to the grid — but it means a SheetToolbar used outside a Sheet announces nothing.
- **`@title` is a plain span**, not a heading and not the grid's name. The Sheet names its grid from its own `@label`, so give the two the same words.
- **The title is not wired to the grid.** A `<Sheet>` with a `SheetToolbar` titled "Line items" still has an unnamed `role="grid"`; `aria-labelledby` from the grid to this title would fix both problems at once and is the clearest improvement available here.
- **No search-results relationship.** The quick filter and the grid are connected only through the api; `aria-controls` from the input to the grid would state it.
- Target sizes in a dense strip should be checked against WCAG **2.5.8**'s 24×24 minimum.

## Theming

`--inset` or `--card` for the strip, `--border` and `--line-strong` for its rule against the grid, `--foreground` and `--muted-foreground` for the title, plus **SearchInput**'s and **Button**'s full token sets.

Because **Sheet** turns the engine's own chrome off (`@chrome='none'`) and paints the hairline and depth itself, this strip and the grid's header band must be seasoned together — they are two components forming one visual object, and a season that gives them different surfaces will produce a visible seam exactly where the engine's un-themable shadow used to be.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
