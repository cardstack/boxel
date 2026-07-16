# `prefersWideFormat` — when isolated needs the full viewport

A static class property on a `CardDef` that tells the host to render the `isolated` view at full viewport width, without operator-mode chrome on the sides.

```ts
export class MyCard extends CardDef {
  static displayName = 'My Card';
  static prefersWideFormat = true;   // 👈 single line
  // …
}
```

**Default is `false`.** Without it, isolated views are rendered into a narrow center column (~640–780px) with operator UI on either side. That's right for *most* cards — but wrong for layouts that depend on width.

This is **one of the most-forgotten static properties.** The symptom is always the same: the card looks cramped, the user posts "why is my card so narrow?", and the fix is a one-line addition. Front-load the decision when you create the CardDef.

---

## Decision rule

> **Set `prefersWideFormat = true` if the card's `isolated` view would look broken or cramped at ~720px.** Otherwise leave it `false`.

Concretely, set to `true` when the isolated view is:

| Kind of card | Why it needs wide |
|---|---|
| **App-card home** (`prefersWideFormat = true` is the canonical step-0 with `@context.searchResultsComponent` sections) | The home is the launcher / brand surface; grids and tables of children need horizontal room. |
| **Long-record card** with sectioned left nav (`layout-sectioned-record-with-nav`) | 220px nav rail + main content needs ≥800px total. |
| **Dashboard / multi-card layout** (`layout-design-board`, KPI surfaces, moodboards) | Tile grids of child cards crowd at narrow widths. |
| **Document / article card** (`pretext` multi-column layouts, magazine spreads) | Multi-column flow doesn't make sense in a single column. |
| **Spatial / 3D layouts** (`layout-3d-card-carousel`, scene-runtime canvases) | Camera perspective needs viewport breadth to feel like a scene, not a card. |
| **Routed page cards** (`link-host-mode-paths`) | Public URLs like `/about` /``/blog` /``/pricing` are full-page; they shouldn't render in a column. |
| **Spreadsheet / table-driven cards** (surfaces `Grid`, bxl computation surfaces) | Columns + scrolling need horizontal real estate. |
| **Form cards with multi-column form layout** | Two-column edit grids fall back to single-column at narrow widths — defeating the layout choice. |
| **Slide-deck / presentation cards** | The slide is the viewport; rendering it in a column loses aspect ratio. |

Leave `prefersWideFormat = false` (the default) when the isolated view is:

| Kind of card | Why narrow is fine |
|---|---|
| **Detail / record card** (one record per page, single-column natural-reading layout) | Reading flows are easier in a column. |
| **Form card** with a single column of editor rows | Standard `Form > Cell` layouts already fit ~600px. |
| **Note / memo / single-entity card** | The card *is* the focus; chrome on the sides isn't visual noise, it's wayfinding. |
| **Atom / chip-like card with a small detail view** | Detail isn't dense enough to need width. |
| **Settings / profile card with a vertical field stack** | Vertical scanning, not horizontal scanning. |

## Symptoms when you forget it

You're missing `prefersWideFormat = true` if:

- The card's `isolated` view shows **side margins that crop the layout** (header band gets clipped, sidebar nav hides under operator chrome).
- A multi-column grid **collapses to one column** when you didn't expect it (you set `grid-template-columns: 220px 1fr`, but only 220px shows and `1fr` is offscreen).
- A 3D / canvas layout **looks like a postage stamp** instead of a hero.
- A user opens the routed URL `/about` and **the page looks like a card in a frame** instead of a marketing landing page.
- The host's `Format Preview` widget shows the card at "full" width but the published / interact view doesn't match.

If any of these — open the `.gts`, add `static prefersWideFormat = true;` near the top of the class body, save, refresh.

## Symptoms when you set it incorrectly

Less common but real:

- A simple detail card opens **edge-to-edge** with awkward expanses of whitespace.
- An atom or small-card surface **feels lost** because it can't anchor to a center column.

The fix is symmetric: drop the line, save, refresh.

## Where it interacts

- **`link-host-mode-paths`** — every routed `path: "/about"` card MUST set `prefersWideFormat = true`. Published-realm URLs are intended to be full-page; without the static property the host shows operator-mode chrome on a *public* URL.
- **`app-card-home-with-search`** — the home CardDef sets it. The result-list sections (`@context.searchResultsComponent`; older builds used `PrerenderedCardSearch`) need width to render their child grids.
- **`layout-sectioned-record-with-nav`** — pattern won't work without it. The 220px sticky nav + main content needs ≥800px.
- **`layout-3d-card-carousel`** — perspective + per-card translateZ requires viewport width to feel spatial.
- **`/boxel-create-card`** done-criteria — confirm whether the card you just created should be wide-format. Don't skip this; the default is wrong for app cards.

## Why isn't it the default?

The default isn't `true` because *most* CardDefs are records — a Person, a Task, a Note. Those look better in a center column with operator chrome flanking them; the chrome carries navigation + sharing + actions that the user wants at hand. Cards-as-hero-surfaces are the exception, not the rule. So Boxel makes the common case zero-config, and the wide-format case explicit.

## Source

- The host reads `static prefersWideFormat` off the CardDef class. When `true`, the `isolated` rendering path skips the operator-mode chrome wrapper and gives the card the full available width. (In published-realm host mode the operator chrome doesn't exist anyway; this primarily affects operator/interact mode views.)
- Search the boxel monorepo for `prefersWideFormat` to see the rendering decision points.

## See also

- [`app-card-home-with-search`](../../boxel-patterns/patterns/app-card-home-with-search/README.md) — the home-page pattern that requires this.
- [`layout-sectioned-record-with-nav`](../../boxel-patterns/patterns/layout-sectioned-record-with-nav/README.md) — sectioned long-record cards.
- [`layout-3d-card-carousel`](../../boxel-patterns/patterns/layout-3d-card-carousel/README.md) — spatial layouts.
- [`link-host-mode-paths`](../../boxel-patterns/patterns/link-host-mode-paths/README.md) — published-realm routed pages.
- [`fitted-formats.md`](fitted-formats.md) — the *opposite* end of the spectrum: how cards render when the parent controls the size (16 named sizes).
