---
name: boxel-ui-guidelines
description: Reviews or authors Boxel card components (.gts files) for correctness against Boxel UI conventions — CSS variable usage, theming, font loading, fitted views, and component patterns.
---

# Boxel UI Guidelines

Review or author the card at `$ARGUMENTS` (or the currently open file if no argument given) against the rules below. Flag every violation and suggest the correct fix.

---

## 1. CSS Variable Tiers — Use the Right One

Cards operate in two tiers of CSS variables. **Always prefer the semantic tier.**

### Tier 1 — Semantic theme variables (USE THESE)

These are defined by the Theme card linked to a card via `cardInfo.theme`. Use them for all color, font, and geometry decisions:

| Variable                              | Purpose                          |
| ------------------------------------- | -------------------------------- |
| `--background`                        | Page / card outer background     |
| `--foreground`                        | Main text color                  |
| `--card`                              | Elevated card surface            |
| `--card-foreground`                   | Text on card surfaces            |
| `--primary`                           | Primary brand / CTA color        |
| `--primary-foreground`                | Text/icons on primary surfaces   |
| `--secondary`                         | Secondary brand color            |
| `--secondary-foreground`              | Text/icons on secondary surfaces |
| `--accent`                            | Accent color                     |
| `--accent-foreground`                 | Text/icons on accent surfaces    |
| `--muted`                             | Subdued background               |
| `--muted-foreground`                  | Subdued text                     |
| `--border`                            | Border color                     |
| `--destructive`                       | Error / danger color             |
| `--destructive-foreground`            | Text on destructive surfaces     |
| `--font-sans`                         | Sans-serif font stack            |
| `--font-serif`                        | Serif font stack                 |
| `--font-mono`                         | Monospace font stack             |
| `--radius`                            | Base border radius               |
| `--spacing`                           | Base spacing unit                |
| `--boxel-heading-font-family`         | Heading font family              |
| `--boxel-heading-font-size`           | Heading font size                |
| `--boxel-heading-font-weight`         | Heading font weight              |
| `--boxel-heading-line-height`         | Heading line height              |
| `--boxel-section-heading-font-family` | Section heading font family      |
| `--boxel-section-heading-font-size`   | Section heading font size        |
| `--boxel-section-heading-font-weight` | Section heading font weight      |
| `--boxel-section-heading-line-height` | Section heading line height      |
| `--boxel-subheading-font-family`      | Subheading font family           |
| `--boxel-subheading-font-size`        | Subheading font size             |
| `--boxel-subheading-font-weight`      | Subheading font weight           |
| `--boxel-subheading-line-height`      | Subheading line height           |
| `--boxel-body-font-family`            | Body text font family            |
| `--boxel-body-font-size`              | Body text font size              |
| `--boxel-body-font-weight`            | Body text font weight            |
| `--boxel-body-line-height`            | Body text line height            |
| `--boxel-caption-font-family`         | Caption font family              |
| `--boxel-caption-font-size`           | Caption font size                |
| `--boxel-caption-font-weight`         | Caption font weight              |
| `--boxel-caption-line-height`         | Caption line height              |

> The `--boxel-heading-*` / `--boxel-body-*` / `--boxel-caption-*` variables are **in addition to** `--font-sans`, `--font-serif`, and `--font-mono`. Use the role-specific variables when styling text by semantic purpose (headings, body copy, captions); use `--font-sans/serif/mono` when you need to reference a generic font stack directly.

### Tier 2 — Boxel design tokens (use sparingly)

`--boxel-sp-*`, `--boxel-font-size-*`, `--boxel-border-radius-*`, `--boxel-lsp-*`, `--boxel-icon-*`, `--boxel-monospace-font-family`, `--boxel-deep-box-shadow`, etc. Use these for **layout, sizing, and spacing** only — not for brand colors.

### Never use

- Raw Boxel color primitives for brand/theme purposes: `--boxel-orange`, `--boxel-purple`, `--boxel-cyan`, `--boxel-teal`, etc.
- Hardcoded hex or rgb values: `#ff6b35`, `rgb(...)`, `rgba(255,255,255,0.7)`
- `color: white` or `color: black`
- Hardcoded hex **inside `linear-gradient()`** is also a violation: `linear-gradient(180deg, #fef7ed 0%, #fed7aa 100%)` → `linear-gradient(180deg, var(--muted) 0%, var(--accent) 100%)`

### Replacing hardcoded rgba values

For semi-transparent colors on themed surfaces, use `color-mix()`:

- `rgba(255,255,255,0.25)` on a primary background → `color-mix(in oklch, var(--primary-foreground) 25%, transparent)`
- `rgba(0,0,0,0.15)` dark overlay → `color-mix(in oklch, transparent, black 15%)`

### Private resolved variables — safe theme fallbacks

When a card may render outside a themed context (e.g. in a fitted tile before a Theme is linked), define **private resolved variables** on the card's root class. Each `--_*` variable resolves the semantic variable with an `oklch()` fallback:

```css
.my-card-fitted {
  --_card:             var(--card,             oklch(1 0 0));
  --_foreground:       var(--foreground,       oklch(0.14 0 0));
  --_primary:          var(--primary,          oklch(0.55 0.22 264));
  --_primary-foreground: var(--primary-foreground, oklch(1 0 0));
  --_secondary:        var(--secondary,        oklch(0.5 0.22 300));
  --_muted-foreground: var(--muted-foreground, oklch(0.55 0.02 250));
  --_border:           var(--border,           oklch(0.92 0 0));
}
```

Then consume `var(--_card)`, `var(--_primary)`, etc. throughout the component instead of the bare `var(--card)` form. This way:

- The semantic theme variables are used when a Theme is linked (correct behavior).
- A legible default is shown when no Theme is present (no invisible/broken rendering).
- The fallback `oklch()` values stay in one place and are easy to update.

**Note:** Only define `--_*` variables for colors you actually use in the component. Do not define them for every possible semantic variable.

---

## 2. Font Loading — Theme Card Owns Imports

**Cards must NOT use `@import url(...)` in their `<style scoped>` blocks.**

Font imports belong in the Theme card's `cssImports` field. The runtime (`FieldComponent.getCssImports()`) automatically passes them to `CardContainer`.

**Wrong:**

```css
<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
  .title { font-family: 'Bebas Neue', sans-serif; }
</style>
```

**Correct:**

```css
<style scoped>
  /* Font is loaded by the Theme card's cssImports field */
  .title { font-family: var(--boxel-heading-font-family); }
</style>
```

If a card requires a specific font, that font URL must be added to the Theme card that is linked via `cardInfo.theme`.

---

## 3. Isolated View — Do NOT add CardContainer

The runtime (`field-component.gts`) **already wraps every card format** (isolated, fitted, embedded, edit) in `CardContainer`, passing `@isThemed`, `@cssImports`, and `@displayBoundaries`. Adding a second `CardContainer` inside an isolated view is a redundant double-wrap.

The semantic CSS variables (`--background`, `--foreground`, `--card`, etc.) are available inside the card's template because the runtime's outer `CardContainer` sets them. No extra wrapper needed.

---

## 4. Fitted View — Container Queries, Not Fixed Pixels

The runtime wraps fitted cards with a container named `fitted-card` (`container-type: size`). Cards should use `@container fitted-card` queries to adapt layout rather than hardcoding pixel dimensions.

For simple cards, extend `BasicFitted` from `@cardstack/boxel-ui/components`. It handles the responsive layout for all 16 fitted formats automatically via built-in container queries.

```gts
import { BasicFitted } from '@cardstack/boxel-ui/components';

static fitted = class Fitted extends Component<typeof this> {
  <template>
    <BasicFitted
      @primary={{@model.title}}
      @secondary={{@model.subtitle}}
      @iconComponent={{@cardTypeIcon}}
    />
  </template>
};
```

For custom fitted layouts, write `@container fitted-card` rules instead of hardcoded heights:

```css
/* Instead of: height: 80px; */
.event-image {
  height: 30cqh;
}

@container fitted-card (aspect-ratio <= 1.0) {
  /* vertical layout */
}
@container fitted-card (height < 65px) {
  .event-image {
    display: none;
  }
}
```

### Fitted image sizing with `cqh`

For image columns/panels in fitted cards, use container query height units (`cqh`) instead of fixed pixels so the image scales proportionally with the card:

```css
/* scales with card height rather than being a fixed width */
.image-col {
  width: 40cqh;
  min-width: 60px;
  max-width: 200px;
}
```

### Fitted format sizes and container query breakpoints

#### All 16 fitted formats (from `fitted-formats.ts`)

The runtime defines 16 named formats across 4 groups. Sizes are exact spec values:

| Format | Width | Height |
|---|---|---|
| small-badge | 150 | 40 |
| medium-badge | 150 | 65 |
| large-badge | 150 | 105 |
| single-strip | 250 | 40 |
| double-strip | 250 | 65 |
| triple-strip | 250 | 105 |
| double-wide-strip | 400 | 65 |
| triple-wide-strip | 400 | 105 |
| small-tile | 150 | 170 |
| regular-tile | 250 | 170 |
| cardsgrid-tile | 170 | 250 |
| tall-tile | 150 | 275 |
| large-tile | 250 | 275 |
| compact-card | 400 | 170 |
| full-card | 400 | 275 |
| expanded-card | 400 | 445 |

### Fitted format breakpoints

Thresholds are midpoints between adjacent actual heights/widths, so each threshold cleanly catches one tier without overlap.

**Height thresholds:**

| Range | Actual height | Formats |
|---|---|---|
| `height < 58px` | 40px | single-strip, small-badge |
| `58px ≤ height < 86px` | 65px | double-strip, medium-badge, double-wide-strip |
| `86px ≤ height < 137px` | 105px | triple-strip, large-badge, triple-wide-strip |
| `137px ≤ height < 210px` | 170px | small-tile, regular-tile, compact-card |
| `210px ≤ height < 262px` | 250px | cardsgrid-tile |
| `262px ≤ height < 360px` | 275px | tall-tile, large-tile, full-card |
| `height ≥ 360px` | 445px | expanded-card |

**Width thresholds:**

| Range | Actual width | Formats |
|---|---|---|
| `width ≤ 160px` | 150px | badges, narrow tiles |
| `160px < width ≤ 210px` | 170px | cardsgrid-tile |
| `210px < width ≤ 325px` | 250px | strips + medium tiles |
| `width > 325px` | 400px | wide strips + cards |

**Most useful single threshold:** `height < 137px` vs `height >= 137px` cleanly separates all strip/badge formats from all tile/card formats.

**Typical format-group targeting:**

```css
/* Strips + badges (all short formats) */
@container fitted-card (height < 137px) { }

/* Tiles + cards (all tall formats) */
@container fitted-card (height >= 137px) { }

/* Tiles only (tall + not wide) */
@container fitted-card (height >= 137px) and (width <= 325px) { }

/* Cards only (tall + wide) */
@container fitted-card (height >= 137px) and (width > 325px) { }

/* Exact format — e.g. full-card only */
@container fitted-card (262px <= height < 360px) and (width > 325px) { }

/* Single-strip and small-badge only */
@container fitted-card (height < 58px) { }

/* Badge family (narrow formats) */
@container fitted-card (width <= 160px) { }
```

---

## 5. Inline SVGs — Prefer the Icon Library

Use `@cardstack/boxel-icons` instead of inline `<svg>` path data. The icon library covers common icons (location pins, arrows, etc.) and keeps markup clean.

**Wrong:**

```gts
<svg viewBox='0 0 24 24' fill='currentColor'>
  <path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13...' />
</svg>
```

**Correct:**

```gts
import MapPin from '@cardstack/boxel-icons/map-pin';
<MapPin class='location-icon' />
```

This applies to **decorative placeholder SVGs** too — even multi-element illustrations used as image fallbacks. Replace them with the card's own static icon (e.g. `static icon = ChefHat`) styled via CSS:

```gts
// Instead of a custom <svg> food illustration with hardcoded hex fills:
<div class='hero-placeholder'>
  <ChefHat class='hero-placeholder-icon' />
</div>
```

```css
.hero-placeholder-icon {
  width: 4rem;
  height: 4rem;
  color: var(--muted-foreground);
  opacity: 0.4;
}
```

---

## 6. Component Naming

When importing from `@cardstack/boxel-ui/components`, prefer the `Boxel`-prefixed names where both exist:

- `BoxelButton` not `Button`
- `BoxelInput` not `Input` (use `BoxelInput`)
- `BoxelSelect` not `Select`

This avoids collisions with app-local components of the same name.

---

## 7. Template API — `@fields` vs `@model`

Prefer `@fields.x` over `@model.x` when rendering field values in templates.

| Use `@fields.x`                                 | Use `@model.x`                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Rendering field content in HTML                 | `{{#if @model.x}}` conditional checks                              |
| `<@fields.title />`, `<@fields.cuisine />` etc. | HTML attributes: `src={{@model.imageUrl}}`, `alt={{@model.title}}` |
|                                                 | JS computed getters: `this.args.model.x`                           |

**Wrong:**

```hbs
<p>{{@model.subtitle}}</p>
<span>{{@model.cuisine}}</span>
<div>{{@model.servings}} servings</div>
```

**Correct:**

```hbs
<p><@fields.subtitle /></p>
<span><@fields.cuisine /></span>
<div><@fields.servings /> servings</div>

{{! conditionals and attributes still use @model }}
{{#if @model.subtitle}} ... {{/if}}
<img src={{@model.imageUrl}} alt={{@model.title}} />
```

---

## 8. Units — Prefer `rem` over `px`

Use `rem` for font sizes, spacing, and fixed dimensions that should scale with the user's base font size. Reserve `px` only for hairline values (`1px` borders, sub-pixel offsets) and container query thresholds where pixel breakpoints are intentional.

| Use `rem`                        | Use `px`                                            |
| -------------------------------- | --------------------------------------------------- |
| Icon sizes: `width: 1.5rem`      | Borders: `border: 1px solid var(--border)`          |
| Fixed layout dimensions          | Container query breakpoints: `height < 65px`        |
| Fallback sizes inside `minmax()` | Sub-pixel alignment tweaks: `margin-top: -1px`      |

**Wrong:**

```css
.placeholder-icon { width: 40px; height: 40px; }
.barcode-icon { width: 48px; height: 48px; }
```

**Correct:**

```css
.placeholder-icon { width: 2.5rem; height: 2.5rem; }
.barcode-icon { width: 3rem; height: 3rem; }
```

Note: `--boxel-sp-*` tokens and `cqh`/`cqw` container query units are preferred over both `px` and `rem` when a Boxel token or relative container unit exists — `rem` is the fallback when no token fits.

---

## 9. Quick Checklist

When reviewing or writing a card, verify:

- [ ] No `@import url(...)` inside `<style scoped>`
- [ ] Fixed sizes use `rem` not `px` (except `1px` borders, container query thresholds, sub-pixel tweaks)
- [ ] No raw color primitives (`--boxel-orange`, `--boxel-purple`, etc.) used for brand/theme purposes
- [ ] No hardcoded hex, rgb, or rgba color values — including inside `linear-gradient()`
- [ ] Semi-transparent colors on themed surfaces use `color-mix(in oklch, var(--primary-foreground) X%, transparent)`
- [ ] Cards that render outside a themed context define `--_*` private resolved variables on the root class with `oklch()` fallbacks, and consume `var(--_*)` throughout
- [ ] Inline SVGs (including decorative placeholders) replaced with icon library components
- [ ] Font families referenced by css variable name only — loading is the Theme card's responsibility
- [ ] Typography uses `--boxel-heading-*`, `--boxel-body-*`, `--boxel-caption-*`, etc. instead of hardcoded font families/sizes/weights
- [ ] Field values rendered with `<@fields.x />`, not `{{@model.x}}` — reserve `@model.x` for conditionals and HTML attributes
