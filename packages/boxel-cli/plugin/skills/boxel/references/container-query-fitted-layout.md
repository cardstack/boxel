# Container Query Fitted Layout — Implementation Guide

## Fitted means the parent owns the cell size

A `fitted` child card must **not** impose its own intrinsic minimum height or rely on its content to size the surface. The parent (a grid, a filmstrip, a CardsGrid) decides the cell envelope; the child fills it.

Safer fitted-card defaults to set on the outermost element:

```css
.cq {
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  container-type: size;
  container-name: card;
}
```

Plus: stable grid/flex tracks (no `auto` rows for body content — use `minmax(0, 1fr)`), explicit `overflow: hidden` on every region, and text clamps (`-webkit-line-clamp: N`, `display: -webkit-box`, `-webkit-box-orient: vertical`).

**Container-query units (`cqw`, `cqh`, `cqmin`, `cqmax`) only resolve relative to an actual container.** If you reach for them on a surface that _isn't_ a container (e.g. an `isolated` template not yet wrapped), they silently fall back to the viewport — which is fine on a full-page card but catastrophic in split panes or narrow canvases. Establish a container on the owning surface with `container-type: inline-size` (or `size`) before using cq units inside.

**Parent already drawing the framing?** Direct child embeds often need `@displayContainer={{false}}` on the `<@fields.X />` invocation, OR explicit parent-side chrome styling that kills the host's default `CardContainer` background / padding / boundaries. Otherwise you'll see double framing or cramped rows. See `boxel-ui-guidelines/references/delegated-render-control.md`.

## Overview

This guide teaches how to build Boxel card fitted views using **only CSS container queries** — no JavaScript modifiers, no ResizeObserver, no post-layout DOM manipulation. It replaces the three-modifier engine (FitGridModifier + LineBudgetModifier + PretextModifier) documented in older FITTED-LAYOUT-GUIDE.md material.

**Reference implementations:**

- `news-card-cq.gts` — Standard stacked + thumbnail sidebar layouts
- `stock-ticker-card-cq.gts` — No-image domain card (dark terminal theme)
- `recipe-card-cq.gts` — Complex 7-region card with line budget replacement
- `hotel-room-card-cq.gts` — Magazine spread layouts at wide sizes

## The Two-Element Pattern

**CRITICAL RULE:** CSS container queries cannot style the container element itself — only its descendants. You MUST use a two-element pattern:

```gts
<template>
  <div class='cq'>
    {{! ← Container: sets size context }}
    <article class='fit'>
      {{! ← Grid: styled BY container queries }}
      ...regions...
    </article>
  </div>
</template>
```

```css
.cq {
  container-type: size; /* enables both width AND height queries */
  container-name: card;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.fit {
  width: 100%;
  height: 100%;
  display: grid;
  overflow: hidden;
  box-sizing: border-box;
}
```

**Why `container-type: size`?** Fitted cards have fixed width AND height set by the parent. We need both `@container (width ...)` and `@container (height ...)` queries. `container-type: size` enables both. This is safe because the parent guarantees both dimensions.

**If you use a single element** (the grid IS the container), none of your `@container` rules for grid-template, padding, gap, or CSS custom properties on that element will work. The layout will be completely broken. This was the #1 mistake in the initial implementation.

## Size Classification

### Height Quanta

| Quantum | Range     | Visible Regions                               | Purpose                 |
| ------- | --------- | --------------------------------------------- | ----------------------- |
| h40     | ≤50px     | head only                                     | Badges, inline mentions |
| h65     | 50-80px   | head + meta                                   | Chooser dropdowns       |
| h105    | 80-130px  | head + body + meta                            | Strips, search results  |
| h170    | 130-200px | head + body + [tags] + meta                   | Tiles                   |
| h275    | 200-320px | hero + head + body + [tags] + meta            | Large tiles, cards      |
| h445    | >320px    | hero + head + body + [tags] + meta (spacious) | Expanded cards          |

### Width Classes

| Class  | Range     | Behavior                                                       |
| ------ | --------- | -------------------------------------------------------------- |
| narrow | ≤170px    | Hide tags, clamp meta to 1 line, hide subhead at small heights |
| medium | 170-260px | Hide tags, clamp meta to 1 line                                |
| wide   | >260px    | Show tags, horizontal thumbnails at h40/h65/h105               |

### Container Query Syntax

```css
/* Height quantum */
@container card (height <= 50px) {
  /* h40 */
}
@container card (50px < height <= 80px) {
  /* h65 */
}
@container card (80px < height <= 130px) {
  /* h105 */
}

/* Compound: width + height */
@container card (width > 260px) and (200px < height <= 320px) {
  /* wide h275 */
}
```

## Grid Template Patterns

### The Body-as-1fr Rule

**CRITICAL:** The body region (secondary text) MUST use `minmax(0, 1fr)` — never `auto`. This is the key to preventing overflow:

```css
/* ❌ WRONG — body auto rows overflow when content exceeds space */
grid-template-rows: minmax(0, 35%) auto auto auto auto;

/* ✅ CORRECT — body (1fr) absorbs remaining space, clips internally */
grid-template-rows: minmax(0, 35%) auto minmax(0, 1fr) auto auto;
/*                   hero            head body            tags meta */
```

**Why:** With `auto`, the body row takes its full content height regardless of available space, pushing tags and meta off the bottom. With `minmax(0, 1fr)`, the body gets whatever space remains after hero (percentage), head (auto = line-clamped content), tags (auto), and meta (auto). If that's 0px, the body collapses gracefully — its `overflow: hidden` clips any content.

### Grid Templates Per Height Quantum

```css
/* h40: head only */
@container card (height <= 50px) {
  .fit {
    grid-template-rows: 1fr;
    grid-template-areas: 'head';
    gap: 0;
  }
  .r-hero,
  .r-body,
  .r-tags,
  .r-meta {
    display: none;
  }
  .r-head {
    display: flex;
    align-items: center;
  } /* vertical center */
}

/* h65: head + meta */
@container card (50px < height <= 80px) {
  .fit {
    grid-template-rows: 1fr auto;
    grid-template-areas: 'head' 'meta';
  }
  .r-hero,
  .r-body,
  .r-tags {
    display: none;
  }
}

/* h105: head + body + meta */
@container card (80px < height <= 130px) {
  .fit {
    grid-template-rows: auto auto 1fr;
    grid-template-areas: 'head' 'body' 'meta';
  }
  .r-hero,
  .r-tags {
    display: none;
  }
}

/* h170: head + body + meta (no hero) */
@container card (width <= 260px) and (130px < height <= 200px) {
  .fit {
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: 'head' 'body' 'meta';
  }
  .r-hero {
    display: none;
  }
  .r-tags {
    display: none;
  }
}
@container card (width > 260px) and (130px < height <= 200px) {
  .fit {
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'head' 'body' 'tags' 'meta';
  }
  .r-hero {
    display: none;
  }
}

/* h275: hero + all content */
@container card (width > 260px) and (200px < height <= 320px) {
  .fit {
    grid-template-rows: minmax(0, 30%) auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'hero' 'head' 'body' 'tags' 'meta';
  }
}

/* h445: hero (larger) + all content */
@container card (width > 260px) and (height > 320px) {
  .fit {
    grid-template-rows: minmax(0, 38%) auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'hero' 'head' 'body' 'tags' 'meta';
  }
}
```

### Handling Missing Images with `:not(:has())`

When the hero image is optional, provide alternative templates:

```css
.fit:not(:has(.r-hero)) {
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas: 'head' 'body' 'tags' 'meta';
}
```

### Horizontal Thumbnail Layouts (Wide + Short)

For wide containers at h40/h65/h105, switch to 2-column layout with thumbnail:

```css
@container card (width > 260px) and (50px < height <= 80px) {
  .fit:has(.r-hero) {
    grid-template-columns: 50px 1fr;
    grid-template-rows: 1fr auto;
    grid-template-areas: 'hero head' 'hero meta';
    gap: 2px 10px;
  }
  .fit:has(.r-hero) .r-hero {
    display: block;
    width: 50px;
    align-self: stretch;
  }
}
```

## Layout Mode Heuristics

### Layout Mode Progression

Cards progress through layout modes as width increases. Each mode has a minimum width threshold based on how much horizontal space the content column needs:

| Mode              | Width Threshold | Description                                                              |
| ----------------- | --------------- | ------------------------------------------------------------------------ |
| Badge             | any             | Single line, h40                                                         |
| Strip             | any             | 1-2 rows, h65                                                            |
| Thumbnail sidebar | >260px          | Small fixed-width image column (50-80px) alongside content, h40/h65/h105 |
| Stacked card      | any             | Vertical: image top → content below, h170+                               |
| Magazine spread   | >370px          | Image fills ~45% left column, content stacks on right, h170+             |

**Key insight:** Thumbnail sidebars and magazine spreads both use 2-column grids, but they have very different width requirements because the image column is sized differently.

### Thumbnail Sidebar vs Magazine Spread

**Thumbnail sidebar** — image column is a fixed pixel width (50-80px):

- Content column = container width - image width - gap
- At 265px wide: 265 - 55 - 10 = 200px content → comfortable
- Safe at `width > 260px`

**Magazine spread** — image column is a percentage (40-50%):

- Content column = (container width × content%) - gap
- At 335px with 45% image: 335 × 0.55 - 12 ≈ 172px → too tight, text wraps badly
- At 370px with 45% image: 370 × 0.55 - 12 ≈ 192px → minimum viable
- Safe at `width > 370px`

```css
/* ✅ Thumbnail sidebar at >260px — fixed image column */
@container card (width > 260px) and (50px < height <= 80px) {
  .fit:has(.r-hero) {
    grid-template-columns: 55px 1fr;
  }
}

/* ✅ Magazine spread at >370px — percentage image column */
@container card (width > 370px) and (130px < height <= 200px) {
  .fit:has(.r-hero) {
    grid-template-columns: 45% 1fr;
  }
}

/* ❌ WRONG — magazine spread at >260px, content column too narrow */
@container card (width > 260px) and (130px < height <= 200px) {
  .fit:has(.r-hero) {
    grid-template-columns: 45% 1fr; /* at 265px: content = 134px! */
  }
}
```

### The 200px Content Column Rule

For any 2-column layout, the content column must be at least **200px** for comfortable text display. Work backwards from your image column sizing:

| Image Column | Formula                  | Min Container Width |
| ------------ | ------------------------ | ------------------- |
| 50px fixed   | 50 + gap + 200           | ~260px              |
| 80px fixed   | 80 + gap + 200           | ~290px              |
| 40%          | width × 0.60 - gap ≥ 200 | ~350px              |
| 45%          | width × 0.55 - gap ≥ 200 | ~370px              |
| 50%          | width × 0.50 - gap ≥ 200 | ~410px              |

### Aspect Ratio Awareness

Portrait-oriented cards (height > width) should generally use **stacked layouts** even if the width exceeds a threshold. A 335×450 card is technically "wide" (>260px) but:

- The card's shape implies vertical flow — users expect top-to-bottom
- A side-by-side layout in a portrait frame creates large empty vertical gaps
- Content elements (dates, specs, amenities) spread too thin across the height

**Practical rule:** For magazine spreads, the width threshold already handles this. At `>370px`, a card narrow enough to be portrait typically doesn't qualify. For thumbnail sidebars at `>260px`, portrait shapes are fine because the fixed-width image column leaves ample content space.

### Content Density Matching

Match layout complexity to content volume:

- **Few fields** (title + 1-2 attributes): stacked layout works at all sizes. Magazine spread wastes space.
- **Many fields** (title + image + 5+ attributes): magazine spread at wide sizes lets you show more without vertical scrolling.
- **Mixed priority** (hero image + critical text): magazine spread puts them side-by-side for simultaneous visibility.

### No-Image Fallback

When the image is optional, always provide a fallback grid that uses stacked layout:

```css
/* Magazine spread only when image exists AND width is sufficient */
@container card (width > 370px) and (200px < height <= 320px) {
  .fit:has(.r-hero) {
    grid-template-columns: 45% 1fr;
    /* ... 2-column areas ... */
  }
}

/* No image: always stacked, regardless of width */
.fit:not(:has(.r-hero)) {
  grid-template-columns: 1fr;
  /* ... single-column areas ... */
}
```

### Reference Implementations

| Card                       | Layout Modes Used                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `news-card-cq.gts`         | Badge, strip, stacked, thumbnail sidebar (wide h40/h65/h105)                          |
| `stock-ticker-card-cq.gts` | Badge, strip, stacked (no image, so no 2-column modes)                                |
| `recipe-card-cq.gts`       | Badge, strip, stacked, thumbnail sidebar (wide h40/h65/h105)                          |
| `hotel-room-card-cq.gts`   | Badge, strip, thumbnail sidebar, stacked, **magazine spread** (>370px h170/h275/h445) |

## Region Styles

Every region MUST have:

```css
.r-head,
.r-body,
.r-tags,
.r-meta,
.r-hero {
  overflow: hidden;
  min-height: 0; /* allows grid rows to shrink below content size */
}
```

**`min-height: 0`** is critical — without it, grid items won't shrink below their content minimum, defeating the `minmax(0, 1fr)` pattern.

The body region should use flex column layout for internal spacing:

```css
.r-body {
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px; /* breathing room between subhead and excerpt */
}
```

## Line Clamping

### Boilerplate

Every text element that needs clamping requires this base:

```css
.headline,
.subhead,
.excerpt {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}
```

### Pre-Declared Clamp Values

Instead of the JS modifier computing line allocation at runtime, you declare the clamp value at each size breakpoint:

```css
@container card (height <= 50px) {
  .headline {
    -webkit-line-clamp: 1;
  }
}
@container card (50px < height <= 80px) {
  .headline {
    -webkit-line-clamp: 2;
  }
}
@container card (80px < height <= 130px) {
  .headline {
    -webkit-line-clamp: 2;
  }
  .subhead {
    -webkit-line-clamp: 1;
  }
  .excerpt {
    display: none;
  }
}
@container card (130px < height <= 200px) {
  .headline {
    -webkit-line-clamp: 3;
  }
  .subhead {
    -webkit-line-clamp: 1;
  }
  .excerpt {
    -webkit-line-clamp: 2;
  }
}
```

### Content Priority in CSS

The JS system's "priority-1 gets 3x more lines" is encoded directly: at every breakpoint, give the headline more lines than other text:

| Height | Headline | Subhead | Excerpt |
| ------ | -------- | ------- | ------- |
| h40    | 1        | hidden  | hidden  |
| h65    | 2        | hidden  | hidden  |
| h105   | 2        | 1       | hidden  |
| h170   | 3        | 1       | 2       |
| h275   | 2-3      | 1-2     | 2-3     |
| h445   | 3-4      | 2-3     | 4-6     |

**Width affects clamps too:** At narrow widths, words wrap more frequently, so the headline may need MORE lines (or you hide secondary text to give it room):

```css
/* Narrow h170: headline needs more lines, hide subhead */
@container card (width <= 170px) and (130px < height <= 200px) {
  .headline {
    -webkit-line-clamp: 4;
  }
  .subhead {
    display: none;
  }
  .excerpt {
    -webkit-line-clamp: 2;
  }
}
```

### The Line Budget Math

To compute how many lines fit, calculate:

1. **Available height** = container height - (padding × 2)
2. **Subtract fixed regions**: hero (% of container), meta (~16px), tags (~28px), gaps
3. **Remaining** = available for head + body
4. **Lines per element** = floor(region_height / (font_size × line_height))

Example for 250×275 (medium, h275) with hero:

- Available: 275 - 14px padding = 261px
- Hero at 30%: 83px
- Meta: ~16px
- Gaps (4 × 4px): 16px
- Remaining for head + body: 261 - 83 - 16 - 16 = 146px
- Headline at 18px × 1.22 = 22px/line → 2 lines = 44px + tag 12px = 56px
- Body remaining: 146 - 56 = 90px
- Subhead at 12px × 1.35 = 16px/line → 1 line = 16px
- Excerpt at 12px × 1.35 = 16px/line → 2 lines = 32px
- Total body: 48px ← fits in 90px with breathing room

**If the math doesn't work at the smallest size in a range, reduce the clamp or font size.** The h275 range (200-320px) is wide — values must work at 200px tall, not just 275px.

## Comfort-Scored Typography — `pow()`-based hierarchical scale

### Approach: One Base, One Ratio, `pow()` Hierarchy

**All fitted cards MUST use continuous container-query unit scaling, driven by a single hierarchical scale.** Anchor the whole type system on ONE base size that grows with the container, then derive each role (headline, body, meta, etc.) by raising/lowering it via `pow()` with a typographic ratio. Each derived size gets a `max()` floor so it stays readable at the smallest container sizes.

This replaces both (a) the original 18-block stepped `@container` font-size grid, and (b) the additive `4cqi + 1.5cqb` formula per role. One base, one ratio, hierarchical exponents, explicit minimums — fewer variables to tune, and the _relative_ hierarchy is preserved automatically as the base scales.

```css
.fit {
  /* Aspect ratio penalty — 0 for square, grows with stretch */
  --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));

  /* Typographic ratio — 1.25 = "major third", a classic readable scale.
     Use 1.2 for tighter scales, 1.333 for more dramatic display hierarchy. */
  --type-ratio: 1.25;

  /* Base: the anchor for the whole hierarchy. Scales continuously with the
     container (width weighted higher than height because width affects
     wrapping more), dampened at extreme aspect ratios. */
  --type-base: clamp(10px, calc(3px + 2.2cqi + 1cqb - 0.6 * var(--ar)), 18px);

  /* Roles derived from the base via pow() — hierarchical and proportional.
     Each role floors at its minimum so tiny containers stay readable. */
  --fit-pill-size: max(
    7px,
    calc(var(--type-base) / pow(var(--type-ratio), 2))
  ); /* 2 steps down */
  --fit-tag-size: max(
    7px,
    calc(var(--type-base) / pow(var(--type-ratio), 1.5))
  ); /* 1.5 steps down */
  --fit-meta-size: max(
    8px,
    calc(var(--type-base) / var(--type-ratio))
  ); /* 1 step down */
  --fit-body-size: max(9px, var(--type-base)); /* base */
  --fit-subhead-size: max(9px, var(--type-base)); /* base */
  --fit-keyinfo-size: max(
    10px,
    calc(var(--type-base) * pow(var(--type-ratio), 1.5))
  ); /* 1.5 steps up */
  --fit-headline-size: max(
    11px,
    calc(var(--type-base) * pow(var(--type-ratio), 2))
  ); /* 2 steps up */

  --fit-headline-lh: 1.18;
  --fit-body-lh: 1.4;

  /* Spacing scales with width only (no height component) */
  --fit-pad: clamp(5px, calc(2px + 1.8cqi), 14px);
  --fit-gap: clamp(2px, calc(0.5px + 1.2cqi), 8px);
}
```

**How it works:**

- `cqi` = 1% of container inline size (width). `cqb` = 1% of container block size (height).
- The base scales continuously: `clamp(10px, calc(3px + 2.2cqi + 1cqb − 0.6·AR), 18px)`. Width is weighted higher than height because width affects wrapping more directly.
- Every role is `base × pow(ratio, steps)` — positive steps grow the size (headline, keyinfo), negative steps shrink it (meta, tag, pill). The hierarchy stays harmonic across all container sizes.
- `max(<floor>, …)` per role guarantees a per-role minimum — even if the base shrinks to 10px, meta won't fall below 8px or pills below 7px.
- The aspect-ratio penalty `--ar` is subtracted from the base, so extreme-aspect containers (a 400×65 strip, a 170×445 column) get a more conservative base, and the whole hierarchy follows.
- Padding and gap use only `cqi` (no `cqb`) — they don't benefit from height scaling.

**Why `pow()` instead of independent additive formulas:**

- **Single source of truth.** Want a denser scale? Change `--type-ratio` to 1.2. Want all text bigger? Bump the base's clamp. Every role moves together, preserving the visual hierarchy.
- **Floors per role, not globally.** The body and headline shouldn't have the same minimum — the headline can drop to 11px in a tight strip, but its derived base might want to clamp at a different floor than meta. `max()` per role handles that without re-deriving from a different base.
- **Cleaner mental model.** "Headline is 2 ratio-steps above body" is a single sentence. The previous additive formula encoded the same hierarchy through 6 separate hand-tuned coefficients, harder to keep consistent.
- **CSS `pow()` is real.** Supported in Chrome 117+, Safari 17+, Firefox 118+ (late 2023). Boxel runs in modern browsers; this is safe.

**Tuning knobs:**

| Knob                                | Effect                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--type-ratio`                      | Steepness of the hierarchy. 1.2 = subtle, 1.25 = balanced (default), 1.333 = punchy, 1.414 = display-heavy. |
| `--type-base` clamp min             | Floor for the whole system at tiny containers (default 10px).                                               |
| `--type-base` clamp max             | Ceiling at large containers (default 18px).                                                                 |
| Base coefficients (`2.2cqi + 1cqb`) | How fast the base grows. Bigger = more dramatic scaling.                                                    |
| AR coefficient (`0.6 * var(--ar)`)  | How much to shrink in stretched containers. Bigger = more conservative on strips/columns.                   |
| Per-role `max()` floor              | Per-role minimum, independent of base.                                                                      |
| Per-role `pow()` exponent           | Hierarchical step from base.                                                                                |

### Verification Against Comfort Table

The `pow()`-based formulas approximate the original hand-tuned table at standard sizes, scale smoothly between them, and stay sane at extremes. Spot checks at `--type-ratio: 1.25`:

| Container | --ar | --type-base    | Headline (formula)    | Headline (table)  | Body                     | Body (table) |
| --------- | ---- | -------------- | --------------------- | ----------------- | ------------------------ | ------------ |
| 100×40    | 0.6  | 10.0px (floor) | 15.6px → 11px (floor) | 11px              | 10px (floor → 9px floor) | 9px          |
| 200×65    | 1.35 | 10.5px         | 16.4px → 12.3px       | 13px              | 10.5px → 9px (floor)     | 9px          |
| 400×65    | 3.35 | 13.8px         | 21.5px                | 15px (capped low) | 13.8px → 11.0px (cap)    | 11px         |
| 250×105   | 1.45 | 11.6px         | 18.1px → 14.5px       | 14px              | 11.6px → 10px            | 10-11px      |
| 300×300   | 0    | 16.6px         | 25.9px → 18px (cap)   | 18-24px           | 16.6px → 14px (cap)      | 12px (cap)   |
| 170×445   | 2.75 | 11.7px         | 18.3px → 15.5px       | 14px              | 11.7px → 10.5px          | 11px         |

Match the table for "good enough" cases at small/medium sizes; the formulas give slightly larger values at very wide containers (where the table caps), which is generally desirable — large cards can afford bigger type.

### Full Comfort Table (Reference Only — Don't Implement Stepped)

The table below documents the original stepped values. Preserved for reference and validation, but **do not implement stepped `@container` blocks for font sizes** — use the `pow()`-based continuous formulas above instead.

| Width   | Height  | Headline | Body | Subhead | Meta | Tag  | Pad  | Gap |
| ------- | ------- | -------- | ---- | ------- | ---- | ---- | ---- | --- |
| ≤170    | ≤50     | 11px     | 9px  | 9px     | 8px  | 7px  | 5px  | 2px |
| ≤170    | 50-80   | 12px     | 9px  | 9px     | 8px  | 8px  | 5px  | 2px |
| ≤170    | 80-130  | 13px     | 10px | 10px    | 8px  | 8px  | 5px  | 2px |
| ≤170    | 130-200 | 14px     | 10px | 10px    | 9px  | 8px  | 5px  | 2px |
| ≤170    | 200-320 | 14px     | 11px | 11px    | 9px  | 8px  | 5px  | 2px |
| ≤170    | >320    | 14px     | 11px | 11px    | 9px  | 8px  | 5px  | 2px |
| 170-260 | ≤50     | 12px     | 9px  | 9px     | 8px  | 8px  | 7px  | 4px |
| 170-260 | 50-80   | 13px     | 10px | 10px    | 9px  | 9px  | 7px  | 4px |
| 170-260 | 80-130  | 14px     | 11px | 11px    | 9px  | 9px  | 7px  | 4px |
| 170-260 | 130-200 | 16px     | 11px | 11px    | 9px  | 9px  | 7px  | 4px |
| 170-260 | 200-320 | 18px     | 12px | 12px    | 10px | 10px | 7px  | 4px |
| 170-260 | >320    | 18px     | 12px | 12px    | 10px | 10px | 7px  | 4px |
| >260    | ≤50     | 15px     | 11px | 11px    | 9px  | 9px  | 10px | 6px |
| >260    | 50-80   | 15px     | 11px | 11px    | 9px  | 9px  | 10px | 6px |
| >260    | 80-130  | 16px     | 12px | 12px    | 10px | 10px | 10px | 6px |
| >260    | 130-200 | 18px     | 12px | 12px    | 10px | 10px | 10px | 6px |
| >260    | 200-320 | 18px     | 12px | 12px    | 10px | 10px | 10px | 6px |
| >260    | >320    | 24px     | 14px | 14px    | 11px | 11px | 10px | 7px |

### Behavioral Overrides (Stepped Rules That Remain)

While font sizes and spacing scale continuously, some **behavioral rules** still use stepped `@container` queries. These control element visibility, line-clamp changes, and layout switches that can't meaningfully interpolate:

```css
/* Hide elements at small sizes — binary decision, not gradual */
@container card (width <= 170px) and (height <= 50px) {
  .chg {
    display: none;
  }
}

/* Adjust line clamps at specific thresholds */
@container card (width <= 170px) and (130px < height <= 200px) {
  .headline {
    -webkit-line-clamp: 4;
  }
  .subhead {
    display: none;
  }
}
```

**Rule of thumb:** If the property is a number that benefits from smooth scaling (font-size, padding, gap, border-radius), use continuous `cqi`/`cqb` via the `pow()` hierarchy. If it's a binary switch (display: none, grid-template change, line-clamp step), keep it as a stepped `@container` rule.

### Using the Variables

Content styles reference the variables with fallbacks:

```css
.headline {
  font-size: var(--fit-headline-size, 14px);
  line-height: var(--fit-headline-lh, 1.18);
}
.subhead {
  font-size: var(--fit-subhead-size, 12px);
  line-height: var(--fit-body-lh, 1.35);
}
.excerpt {
  font-size: var(--fit-body-size, 11px);
  line-height: var(--fit-body-lh, 1.4);
}
```

### Key Info vs Tertiary Meta

Some "metadata" is actually **key info** — price, status, availability — that users scan for first. Key info:

- Uses `--fit-keyinfo-size` (1.5 ratio-steps above base — bigger than body, smaller than headline)
- Gets `font-weight: 800` and accent color
- Docks at the bottom of the card (typically in a stub or footer region)
- Has a visual separator (dashed border, rule) from the rest of the content

```css
/* Key info: bigger, bolder, colored — not buried in meta */
.price {
  font-size: var(--fit-keyinfo-size, 14px);
  font-weight: 800;
  color: var(--primary, #6366f1);
}

/* Regular meta: small, muted, subordinate */
.author,
.date,
.source {
  font-size: var(--fit-meta-size, 9px);
  color: var(--muted-foreground, #9b8bb0);
}
```

**Priority hierarchy:** Headline > Key Info > Subhead ≈ Body > Meta > Tag > Pill

(Subhead and body share the base size; visual differentiation comes from weight and color, not size.)

## Lessons Learned (Pitfalls to Avoid)

### 1. Container Cannot Style Itself

`@container card (...) { .fit { ... } }` only works if `.fit` is a DESCENDANT of the element with `container-name: card`. If `.fit` IS the container, nothing happens. Always use the two-element pattern.

### 2. `auto` Grid Rows Overflow

Grid rows with `auto` sizing take their full content height. If multiple `auto` rows exceed the container height, they overflow (even with `overflow: hidden` on the grid — each row still gets its content size). Use `minmax(0, 1fr)` for any row that should absorb remaining space and clip.

### 3. Font Sizes Must Work at the Smallest Size in the Range

The h275 range covers 200-320px height. If you set font sizes for the 275px sweet spot, they'll overflow at 200px. Always calculate line budgets for the WORST case (smallest height in the range). The `pow()`-based scale + per-role `max()` floors handle this automatically — but the line-clamp values you pick per quantum still need to be conservative for the smallest size in the band.

### 4. `min-height: 0` on Grid Children

Grid items have `min-height: auto` by default, which prevents them from shrinking below their content minimum. Add `min-height: 0` to every region so `minmax(0, ...)` rows actually work.

### 5. Hero Percentage Must Be Conservative

At h275, `35%` hero = 96px at 275px tall but only 70px at 200px tall. Use 30% for h275 and 35-38% for h445 to ensure enough text space at the short end.

### 6. Line Clamp Boilerplate is Required

`-webkit-line-clamp` only works with the full boilerplate: `display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;`. Missing any of these and clamp silently does nothing.

### 7. Tags Wrap Unpredictably

Tag pills with `flex-wrap: wrap` consume unpredictable height. Hide them at narrow/medium widths to avoid layout instability:

```css
@container card (width <= 260px) {
  .r-tags {
    display: none;
  }
}
```

### 8. Meta Should Be `auto`, Not `1fr`

The meta row at the bottom should be `auto` (takes its content size). Using `1fr` wastes space or creates a gap between body text and meta. Use `align-self: end` on the meta region.

### 9. Don't Set `--fit-*` Variables Inside `@container` Blocks

The `pow()`-based hierarchy is computed once on `.fit`. Each per-quantum `@container` block should only override **structure** (`grid-template-*`, `display`), **line-clamp values**, and **visibility** — never the size variables. If you find yourself overriding `--fit-headline-size` inside a `@container` rule, adjust the base clamp range or the type ratio instead.

### 10. `pow()` Browser Support

`pow()` lands in Chrome 117 (Sept 2023), Safari 17 (Sept 2023), Firefox 118 (Sept 2023). Boxel runs in modern browsers. If you must support older browsers, replace `pow(var(--type-ratio), 2)` with the literal multiplication `var(--type-ratio) * var(--type-ratio)` — uglier, same result.

## Building a New Fitted Card

### Step 1: Define Your Regions

Every fitted card has regions. Common patterns:

| Card Type    | Regions                                           |
| ------------ | ------------------------------------------------- |
| News         | hero, head, body, tags, meta                      |
| Recipe       | photo, title, subtitle, stars, grid, desc, footer |
| Stock Ticker | header, price, spark, metrics, range              |
| Product      | image, name, price, rating, badge                 |
| Profile      | avatar, name, role, stats, bio                    |

### Step 2: Write the Template

```gts
<template>
  <div class='cq'>
    <article class='fit'>
      {{#if @model.imageUrl}}
        <div class='r-hero'><img
            class='hero-img'
            src={{@model.imageUrl}}
            alt=''
          /></div>
      {{/if}}
      <div class='r-head'>
        <h3 class='headline'>{{@model.title}}</h3>
      </div>
      <div class='r-body'>
        <p class='excerpt'>{{@model.description}}</p>
      </div>
      <div class='r-meta'>
        <span>{{@model.author}}</span>
      </div>
    </article>
  </div>
</template>
```

No modifiers. No `data-line-*` attributes. No `{{this.fitGrid}}`.

### Step 3: Write the Base CSS

```css
.cq {
  container-type: size;
  container-name: card;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.fit {
  width: 100%;
  height: 100%;
  display: grid;
  overflow: hidden;
  box-sizing: border-box;
}
.r-hero,
.r-head,
.r-body,
.r-tags,
.r-meta {
  overflow: hidden;
  min-height: 0;
}
.headline,
.excerpt {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}
```

### Step 4: Add the `pow()` Comfort Hierarchy

Add the `pow()`-based block on `.fit` (copy from "Comfort-Scored Typography" above). Adjust:

- `--type-ratio` if you want a tighter (1.2) or punchier (1.333) hierarchy
- The base `clamp(min, …, max)` if your card's typography differs from the standard set
- Per-role `max()` floors if a particular role needs a higher minimum (e.g. a price card might want `--fit-keyinfo-size: max(14px, …)`)

### Step 5: Add Container Queries for Structure

Start from the smallest height quantum and work up. For each quantum:

1. Set the grid template (which regions are visible, how rows are sized)
2. Set the line clamp values
3. Add behavioral overrides (element hiding, line-clamp adjustments at specific width×height combos)

**Do NOT set `--fit-*` font/spacing variables inside `@container` blocks** — the `pow()` hierarchy handles this automatically.

### Step 6: Test in Format Preview

Open the Format Preview card, link your card instance, and check all 16 sizes. Use the resizable playground to test arbitrary dimensions. Pay special attention to:

- The smallest size in each height range (200px for h275, 130px for h170)
- Narrow widths where words wrap aggressively
- Extreme aspect ratios (400×65 strips, 170×445 columns) where AR dampening kicks in
- Cards with and without optional content (images, tags)

## Template Structure Comparison

### Before (JS Modifiers)

```gts
<article class="fit" {{this.fitGrid}}>
  <div class="r-head" {{this.lineBudget}}>
    <h3 data-line-priority="1" data-line-height="20" data-line-font-size="16"
        data-line-min="1" data-line-max="4" data-line-must-display>
      {{@model.headline}}
    </h3>
  </div>
</article>
```

### After (Container Queries)

```gts
<div class="cq">
  <article class="fit">
    <div class="r-head">
      <h3 class="headline">{{@model.headline}}</h3>
    </div>
  </article>
</div>
```

No modifiers, no data attributes. All layout logic lives in CSS.

## File Inventory

| File                               | Purpose                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `news-card-cq.gts`                 | Reference: standard stacked + thumbnail sidebar       |
| `stock-ticker-card-cq.gts`         | Reference: no-image domain card (dark terminal theme) |
| `recipe-card-cq.gts`               | Reference: complex multi-region with line budgets     |
| `hotel-room-card-cq.gts`           | Reference: magazine spread layouts                    |
| `event-ticket-card-cq.gts`         | Reference: dark venue theme, CSS barcode stub         |
| `restaurant-menu-item-cq.gts`      | Reference: serif typography, fine dining theme        |
| `trip-itinerary-card-cq.gts`       | Reference: aviation boarding pass, SVG flight path    |
| `container-query-fitted-layout.md` | This guide                                            |
| `format-preview.gts`               | Testing tool for all 16 sizes                         |

## Quick Checklist for New CQ Fitted Views

- [ ] Two-element pattern: `.cq` (container) wraps `.fit` (grid)
- [ ] `container-type: size` on the outer element
- [ ] All regions have `overflow: hidden; min-height: 0`
- [ ] Body region uses `minmax(0, 1fr)` grid row, not `auto`
- [ ] Line clamp boilerplate on all clamped text elements
- [ ] **`pow()`-based hierarchy** on `.fit` with `--type-base` + `--type-ratio` + per-role `max()` floors (NOT stepped font-size blocks, NOT independent per-role additive formulas)
- [ ] 6 height quanta defined for **structure only** (grid-template, display:none, line-clamp)
- [ ] Behavioral overrides extracted as separate stepped `@container` rules
- [ ] No `--fit-*` variable assignments inside `@container` blocks
- [ ] Line clamp values work at the SMALLEST size in each range
- [ ] Tags hidden at narrow/medium widths
- [ ] Meta clamped to single line at narrow/medium
- [ ] `:not(:has(.r-hero))` variants for missing image
- [ ] Horizontal thumbnail layouts for wide + short (h40/h65/h105)
- [ ] Magazine spread (if used) requires `width > 370px`, not `>260px`
- [ ] Content column ≥200px in any 2-column layout
- [ ] No-image fallback uses stacked layout via `:not(:has(.r-hero))`
- [ ] Tested all 16 sizes in Format Preview
- [ ] Tested with resizable playground at edge cases including extreme aspect ratios

---

## Design Pass — Above-the-Fold Isolated, Art-Directed

The container-query rules above guarantee a card that **doesn't break**. They do not guarantee a card that **looks designed**. This section is the second pass: how to take a working `isolated` view from plumbing-quality to editorial-quality.

The Design Pass applies primarily to the `isolated` format, framed as an **above-the-fold composition** — the masthead the user sees on first paint, before scrolling to ingredients/method/body. Apply it whenever a card is intended to read like a magazine spread, not a database row.

### The Recipe (verbatim brief)

When a card needs a Design Pass, run it exactly like this:

> Do a design exploration and generate only the above-the-fold view in isolated, framed as such. Write sample content for this use case and fit the elements in there as a design challenge executed by a brand-focused art director of Pentagram, judged by the preeminent taste maker in that field.

The brief is doing real work — read it twice:

- **"design exploration"** — not just styling. Question what fields belong, what hierarchy they form, what the eye reads first.
- **"only the above-the-fold view in isolated"** — do not touch `fitted`/`embedded`/`edit`/`atom`. The Design Pass is a _masthead_, not a redesign of all formats.
- **"framed as such"** — the composition must read as a self-contained screen. End the view with a fold cue (rule + "Continue below" label, or equivalent) that signals there is more content beneath it.
- **"Write sample content"** — schema thinness is half the bug. Enrich the instance with editorial copy.
- **"design challenge executed by a brand-focused art director of Pentagram"** — Pentagram's house voice: confident type, restrained color, editorial micro-objects, every choice tracked.
- **"judged by the preeminent taste maker in that field"** — the agent must hold a specific person in mind during the pass. Naming forces specificity. Do **not** include the name in your final summary — it is a thinking aid, not a deliverable.

### Canonical examples

Two existing recipe-card-cq implementations pass the Design Pass. Ask the user for URLs to those references when you need a concrete bar to match — they exist in the user's realms but file paths vary per workspace.

If your output does not visually rhyme with editorial-grade reference cards on first paint, the Design Pass is not done.

### The six moves that make a card feel art-directed

A card looks art-directed when these six moves are all present. Missing any one and it slumps into plumbing.

#### 1. Font pairing — serif body + sans micro-labels

One serif (the body voice: headline, dek, lede, stat values) and one sans-serif (the micro-labels: eyebrows, stat labels, byline meta, review counts). Never mix three families. Never set the eyebrow in the serif. Never set a stat value in the sans.

```css
.headline {
  font-family: var(--font-serif, 'Playfair Display', Georgia, serif);
}
.dek {
  font-family: var(--font-serif, 'Lora', Georgia, serif);
  font-style: italic;
}
.stat-val {
  font-family: var(--font-serif, ...);
}
.eyebrow,
.stat-lbl,
.review-count {
  font-family: var(--font-sans, 'Inter', sans-serif);
}
```

The theme card supplies `--font-serif` and `--font-sans`. Always reference them. Always provide a safe fallback (`Georgia, serif` / `system-ui, sans-serif`).

#### 2. Weight rhythm — pair a large, light serif with tiny, bold sans

Plumbing-quality cards set everything at weight 600 because that's what reads in Figma. Art-directed cards play a chord:

- **Headline:** 1.8rem-3.5rem at weight **400** (large, low — confident, not shouty).
- **Stat values:** 1.25rem-1.5rem at weight **400** (still light, still serif — they're part of the body voice).
- **Micro-labels (eyebrow, stat labels):** 0.55rem-0.65rem at weight **700** (tiny, bold — they're punctuation, not prose).

This is the single move that most reliably separates designed from default. If every text element is weight 600, the card is uniform — uniform reads as untouched.

#### 3. Letter-spaced eyebrows — the editorial tell

Every micro-label gets `text-transform: uppercase` and `letter-spacing: 0.05em` to `0.22em`. The exact spacing depends on size:

| Size     | Letter-spacing | Use                        |
| -------- | -------------- | -------------------------- |
| 0.55rem  | 0.18em-0.22em  | Stat labels, fold text     |
| 0.625rem | 0.18em-0.22em  | Eyebrow above the headline |
| 0.7rem   | 0.04em-0.08em  | Review counts              |

Under-spaced micro-labels are a tell: it means the agent used a default. Letter-spacing forces an explicit choice and immediately reads as designed.

#### 4. One accent color, used in ≤2 places

The theme card supplies `--primary` and `--accent`. Use **one** of them. Use it in **no more than two** places per composition. Typical disciplined pairings:

- Cuisine eyebrow + author avatar background.
- Drop cap initial + stat-key label.
- Section heading rule + price.

Stars are an exception: they always render in amber (`#f5a524` or similar). Amber stars are a typographic convention, not a brand choice — they don't count against the accent budget. **But:** use a literal hex _only_ for the star. Everything else routes through theme tokens. The taste-maker will check.

If you find yourself wanting a second accent — a green for "vegetarian", a red for "spicy" — resist. Pick one and let the rest of the page be ink and rule.

#### 5. Editorial micro-objects

The masthead earns its rent by containing small, tracked objects that fashion-magazine readers recognize:

- **Author avatar with initial** — circle, primary background, primary-foreground text, weight 700, 1.2-1.5rem.
- **Star rating with fill states** — five glyphs, filled ones in amber, unfilled in border-muted.
- **Review count** — sans, small, muted, set after the stars with non-breaking space.
- **"Issue No." / date / volume mark** — a sans micro-label that gives the card a publication identity even if it isn't a real publication.
- **Rule lines bracketing the stats slab** — `border-top` + `border-bottom` on the stats grid, never a box, never a card-within-a-card.
- **Drop cap on the lede** — `::first-letter` styling, the initial in serif at 2-3× line-height, floated left, primary color or foreground.
- **Fold cue** — at the bottom of the above-the-fold composition: a flex row with `<rule> "Continue below — ingredients & method" <rule>`. Signals the framing.

Each micro-object is small but specific. Together they read as a magazine masthead. A card without any of them reads as form output.

#### 6. Schema richness — content earns design

Design moves cost. A weight-rhythmed headline with no compelling text reads worse than a 600-weight headline with great copy. Before designing, add the fields the design demands:

| Field                               | Why                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `cuisine` / category                | Drives the eyebrow. Without it, you have no above-headline punctuation. |
| `subtitle` / dek                    | One italic sentence below the headline. The lede pull.                  |
| `description` / lede                | The drop cap paragraph. Editorial voice, ~3-4 sentences.                |
| `author`                            | Drives the byline + avatar. "By Sofia Lombardi" earns its space.        |
| `rating` + `reviews`                | Drives the star row. Numbers make the design feel published.            |
| `keyIngredient` / hero element      | A named secondary stat — gives the stat slab a non-numeric column.      |
| `difficulty` / level                | Single-word italic stat. Breaks the numeric monotony.                   |
| `caloriesPerServing` (or analogous) | Fourth numeric stat — fills the auto-fit grid handsomely.               |
| `imageUrl`                          | The hero. Without it, the masthead has no anchor.                       |

Pick the subset the card actually needs — recipes use most of these; a music card might want `genre`, `runtime`, `producer`, `releaseLabel`. The rule: if a slot in the design is empty because the field doesn't exist, add the field, don't omit the slot.

### Editorial voice in the instance

The schema is a stage; the JSON instance is the performance. Voice cues that pass the Design Pass:

- **Subtitle is a sentence, not a tagline.** "Four ingredients, no cream, and a saucepan you do not put back on the heat." — not "Easy weeknight pasta!".
- **Description sets a scene before stating the fact.** "There is a moment, late in the cooking, when the egg yolks slip into the still-warm pan..." — Bon Appétit, not Allrecipes.
- **Author has a believable name and provenance.** Sofia Lombardi reads more designed than "Chef Mike". You're sample-styling a fictional publication; respect the fiction.
- **Rating numbers are plausible.** 4.8 with 1,247 reviews reads published. 5.0 with 3 reviews reads seeded.
- **Cuisine names a region, not a continent.** "Roman, Lazio" over "Italian".
- **Image is a real food photo.** Unsplash food URLs are fine. Generic stock-art directives are not — "photo of pasta" is plumbing. The instance should reference a specific URL the design can render.

### Self-critique checklist — run BEFORE declaring done

Apply this list to your output. If any answer is "no" or "maybe", revise.

- [ ] Is there exactly one serif family and one sans family — no third?
- [ ] Does the headline sit at weight 400 (or lighter), not 600+?
- [ ] Is at least one micro-label set in sans, uppercase, weight 700, letter-spacing ≥0.15em?
- [ ] Does the eyebrow appear _above_ the headline (not below, not beside)?
- [ ] Is there a dek (italic subtitle) under the headline?
- [ ] Is `--primary` (or `--accent`) used in ≤2 places, with amber-only for stars?
- [ ] Are stat values in the serif voice (not sans)?
- [ ] Are stat labels in the sans voice with `text-transform: uppercase` + tracked letter-spacing?
- [ ] Is the stats slab bracketed by `border-top` + `border-bottom` (rule above + rule below), not boxed?
- [ ] Is there an author avatar (initial in a colored circle), and does it sit in the byline?
- [ ] Is there a star row with fill states (not just a number)?
- [ ] Is there a drop cap on the lede paragraph, set via `::first-letter`?
- [ ] Does the composition end with a fold cue (rules + "Continue below" or equivalent)?
- [ ] Are there at least 8 schema fields driving the masthead (title, subtitle, cuisine, author, rating, reviews, description, image, plus optional difficulty/keyIngredient/calories)?
- [ ] Does the JSON instance read like editorial writing (sentence-shaped subtitle, scene-setting description, real-feeling author name)?
- [ ] Does the image URL point to a real, specific photo — not a placeholder?
- [ ] Are all colors except amber-for-stars routed through theme tokens (`var(--primary)`, `var(--border)`, `var(--muted-foreground)`, etc.)?
- [ ] If you held a specific taste-maker in mind during the pass, would they specifically respect _something_ in the output? If not, identify the weakest move and strengthen it.

### Anti-patterns — the things a taste-maker calls out

These are the failure modes the Design Pass exists to prevent. If you find any in your output, the pass isn't done.

- **Default-token reliance.** Pulling `--card-foreground` for every text color, never differentiating headline / dek / body / meta. The theme gives you `--foreground`, `--muted-foreground`, `--primary`, `--border` — use the full palette.
- **Weight uniformity.** Everything at weight 600. No weight contrast = no rhythm = no design.
- **Missing weight rhythm.** Headline at weight 700 + labels at weight 700 = shouting match. The headline must sit _under_ the labels in weight (large + light vs tiny + bold).
- **Untracked micro-labels.** Eyebrows set in mixed case with no letter-spacing. Reads like a button label, not a publication.
- **Schema thinness.** Two visible fields (title + servings) trying to carry the design. The fix is more fields, not bigger typography.
- **Weak content fit.** Sample copy that reads "Lorem ipsum" or "Tasty recipe!". Editorial design demands editorial voice.
- **Generic photography directives.** No image, or a stock-photo-of-X placeholder. Use a real URL.
- **Two accents.** Cuisine in primary + author in accent + price in destructive. Three colors = no accent.
- **Boxed-up stats.** A bordered card-within-the-card for the stats slab instead of two rules. Boxes read as form fields; rules read as editorial.
- **No fold framing.** Composition runs to the bottom of the viewport without a "Continue below" signal. The brief specifically says "framed as such" — frame it.

### When to apply the Design Pass

The Design Pass is **not** appropriate for every card. Apply it when:

- The card is intended as a **content artifact** users read (recipes, articles, profiles, releases, products, dossiers).
- The user explicitly asks for design exploration, editorial styling, or art direction.
- The `isolated` view is the primary surface — not a leaf in a larger app shell.

Skip the Design Pass for:

- Form-shaped cards (label/value field stacks where the layout is determined by the schema, not by an editorial layout).
- Pure data cards (status panels, log readers).
- Cards used only as embedded children inside another card's composition.
- Catalog scaffolds where the user wants to remix and theme themselves.

### Reference implementations after Design Pass

| Reference type                               | What to study                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Canonical recipe-card-cq isolated            | The weight rhythm, the stats grid, the star row, the cuisine tag color discipline.    |
| Alternate recipe-card-cq copy                | Same approach, slightly different copy. Confirms the pattern, not the implementation. |
| Editorial recipe with above-the-fold framing | Drop-cap lede, eyebrow with issue marker, hero veil, hero ingredient as named stat.   |

(Ask the user for current URLs when you need to study any of these — file paths vary per workspace.)
