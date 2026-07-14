## Fitted Format Essentials

> 🔴 **REQUIRED for every fitted view.** All fitted templates MUST be built using the approach documented in [`container-query-fitted-layout.md`](./container-query-fitted-layout.md). The two-element `.cq` → `.fit` pattern, six height quanta with `minmax(0, 1fr)` body rows, `pow()`-based hierarchical typography with per-role minimums, line-budget math, and the magazine-spread / thumbnail-sidebar width thresholds are **not optional advice** — they're the standard. Hand-rolling per-format CSS without container queries, using `auto` rows for body content, or skipping `min-height: 0` on grid children will produce fitted views that overflow at edge sizes.
>
> This file (fitted-formats.md) is a **quick reference for size classification + the 16 named sizes you must verify against**. For the actual implementation, read the long guide.

## Four sub-formats strategy

- **Badge** (≤150px width, <170px height) — exportable graphics
- **Strip** (>150px width, <170px height) — dropdown / chooser panels
- **Tile** (<400px width, ≥170px height) — grid viewing
- **Card** (≥400px width, ≥170px height) — full layout

## The 16 named sizes — verify against ALL of them

The host previews fitted cards at 16 specific size boxes when validating a CardDef. A fitted layout that looks great at one size and breaks at another isn't done. Walk through every cell below and confirm content fits, type is hierarchically legible, and nothing overflows.

### Badges (≤150 × ≤105)

| Name         | Width × Height | Use                                       |
| ------------ | -------------- | ----------------------------------------- |
| Small Badge  | 150 × 40       | One-line label / chip                     |
| Medium Badge | 150 × 65       | Title + one-line meta                     |
| Large Badge  | 150 × 105      | Title + 2 meta lines or a small media bug |

### Strips (250+ wide, ≤105 tall)

| Name              | Width × Height | Use                                      |
| ----------------- | -------------- | ---------------------------------------- |
| Single Strip      | 250 × 40       | One-line row — a chooser entry           |
| Double Strip      | 250 × 65       | Title + one-line meta — list-row default |
| Triple Strip      | 250 × 105      | Title + 2 meta lines + status            |
| Double Wide Strip | 400 × 65       | Magazine-spread two-line row             |
| Triple Wide Strip | 400 × 105      | Magazine-spread three-line row           |

### Tiles (≤250 wide, ≥170 tall)

| Name           | Width × Height | Use                                           |
| -------------- | -------------- | --------------------------------------------- |
| Small Tile     | 150 × 170      | Grid thumbnail — square-ish                   |
| Regular Tile   | 250 × 170      | Wider thumbnail                               |
| CardsGrid Tile | 170 × 250      | Portrait thumbnail — the default in CardsGrid |
| Tall Tile      | 150 × 275      | Tall thumbnail                                |
| Large Tile     | 250 × 275      | Full tile                                     |

### Cards (400 wide, ≥170 tall)

| Name          | Width × Height | Use                                        |
| ------------- | -------------- | ------------------------------------------ |
| Compact Card  | 400 × 170      | Wide list row with thumbnail               |
| Full Card     | 400 × 275      | Standard fitted card                       |
| Expanded Card | 400 × 445      | Tallest fitted size — supports rich layout |

## Container query skeleton

The base `field-component` already provides `container-name: fitted-card; container-type: size` on the fitted card wrapper — you do not need to redeclare these on your template root. Use the named container in `@container` queries.

This is also safer in nested situations: `@container fitted-card (...)` skips any anonymous intermediate containers and always targets the nearest `fitted-card` boundary, so nested fitted cards each correctly respond to their own wrapper.

```css
/* Hide all by default */
.badge,
.strip,
.tile,
.card {
  display: none;
  padding: clamp(0.25rem, 2cqmin, 0.5rem);
}

/* Activate by size using the named fitted-card container */
@container fitted-card (max-width: 150px) and (max-height: 169px) {
  .badge {
    display: flex;
  }
}
```

## Content priority (re-evaluate at every size)

1. Title / name
2. Image
3. Short ID
4. Key info
5. Status badges

What survives depends on the cell. At Small Badge (150×40), one line of title is all that fits — drop everything else. At Expanded Card (400×445), all five priorities can live alongside hero media.

## Verification checklist (run BEFORE declaring a fitted view done)

The fitted view must render correctly in all 16 sizes above. For each row in the tables:

- [ ] Content fits without horizontal overflow.
- [ ] Content fits without vertical overflow / clipped text.
- [ ] Type hierarchy is legible — title visibly larger than meta, no two adjacent fonts at the same weight + size.
- [ ] The card's media (hero image, illustration, brand mark) is featured if the size has the room (any tile or card; double/triple-wide strips when the image is wider than tall).
- [ ] The 4-sub-format strategy (badge / strip / tile / card) routes the right sub-template at each cell.
- [ ] No `auto` rows for body content (use `minmax(0, 1fr)` per the container-query guide).
- [ ] No overflowing scrollbars or missing visual rhythm at any cell.

Server-side validation: hit `/_search-prerendered` with `format=fitted` for the card; the response includes pre-rendered HTML for each of the 16 named sizes. Open the live app's format preview to walk through them visually. `npx boxel check` does not do this — it's sync-state only.
