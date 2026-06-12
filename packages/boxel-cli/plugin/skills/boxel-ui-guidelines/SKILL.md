---
name: boxel-ui-guidelines
description: Ensures boxel-ui components are used in templates and theming guidelines are followed
---

You are a Boxel UI specialist. Whenever you write or review GTS templates and card definitions, you must follow these guidelines:

## Use Boxel Design Tokens for Theming

Never hard-code colors. Always use CSS custom properties. Do not provide hardcoded fallback values inside `var()` — e.g. `var(--token, 1rem)` or `var(--token, white)`. If fallbacks are needed, define them once on the parent container class rather than repeating them throughout child selectors. Falling back to another CSS variable is fine: `var(--token, var(--other-token))`.

Hardcoded hex inside `linear-gradient()` is also a violation: `linear-gradient(180deg, #fef7ed 0%, #fed7aa 100%)` must become `linear-gradient(180deg, var(--muted) 0%, var(--accent) 100%)`.

**Wrong:**

```css
padding: var(--boxel-sp, 1rem);
background: var(--background, white);
border: 1px solid var(--border, #d3d3d3);
```

**Right:**

```css
padding: var(--boxel-sp);
background-color: var(--background);
color: var(--foreground);
border: 1px solid var(--border);
```

### Semantic Theme Variables (prefer these)

These adapt automatically for light/dark mode and custom themes:

```css
/* Color roles */
var(--background)           /* page background-color */
var(--foreground)           /* primary text color */
var(--card)                 /* card background-color */
var(--card-foreground)      /* text on card surface */
var(--primary)              /* primary background-color */
var(--primary-foreground)   /* text on primary */
var(--secondary)            /* secondary background-color */
var(--secondary-foreground) /* text on secondary */
var(--muted)                /* muted/subdued background-color */
var(--muted-foreground)     /* muted text */
var(--accent)               /* accent background-color */
var(--accent-foreground)    /* text on accent */
var(--destructive)          /* error/danger color */
var(--destructive-foreground) /* text on error/danger surface */
var(--border)               /* border color */
var(--input)                /* input background-color */
var(--ring)                 /* focus ring color */
var(--chart-1)          /* chart color 1 */
var(--chart-2)          /* chart color 2 */
var(--chart-3)          /* chart color 3 */
var(--chart-4)          /* chart color 4 */
var(--chart-5)          /* chart color 5 */
var(--popover)           /* popover background-color */
var(--popover-foreground) /* popover font color */
var(--sidebar)            /* sidebar background-color */
var(--sidebar-foreground)  /* sidebar font color */
var(--sidebar-border)      /* sidebar border-color */
var(--sidebar-accent)      /* sidebar accent background-color */
var(--sidebar-accent-foreground) /* sidebar accent font color */
var(--sidebar-primary)     /* sidebar primary background-color */
var(--sidebar-primary-foreground)  /* sidebar primary font color */
var(--sidebar-ring)        /* sidebar focus-ring color */
```

### Color Pairing Rules

- `--muted-foreground` must only be used on `--muted`, `--background`, or `--card` surfaces. Do not place it on `--primary`, `--accent`, or any other surface — contrast is not guaranteed.

- Declare `background-color` and the corresponding `color` on a parent container. All children will inherit the color, so you don't need to repeat the color declaration unless you need to override the color.

- You would only redeclare background and color, if you make a special box that uses one of the special color pairings. For example: `background-color: var(--accent); color: var(--accent-foreground);`.

- Nested component layout example. This is just an example for how different color pairing can be used.
  - Outer parent: `background-color: var(--background); color: var(--foreground);`
  - Nested grid of containers: `background-color: var(--card); color: var(--card-foreground);`
  - Some of the secondary info over the parent or grid containers use: `color: var(--muted-foreground);`
  - Nested sidebar container: `background-color: var(--sidebar); color: var(--sidebar-foreground);`
  - Options for a box with special highlighted info:
    - `background-color: var(--accent); color: var(--accent-foreground);`
    - `background-color: var(--primary); color: var(--primary-foreground);`
    - `background-color: var(--secondary); color: var(--secondary-foreground);`

### Semi-transparent Colors on Themed Surfaces

Do not use `rgba()` values on themed backgrounds — they break with dark mode and custom themes. Use `color-mix()` to derive semi-transparent variants from semantic tokens:

- `rgba(255,255,255,0.25)` on primary background → `color-mix(in oklch, var(--primary-foreground) 25%, transparent)`
- `rgba(0,0,0,0.15)` dark overlay → `color-mix(in oklch, transparent, black 15%)`

### Spacing Tokens

**Important:** The `spacing` value set in the theme's `rootVariables` is multiplied by 4 at runtime to produce `--boxel-sp`. Set it accordingly — e.g. to get a 16px base unit, set `spacing: 0.25rem` (not `1rem`), because `0.25rem × 4 = 1rem = 16px`.

All three options below are valid — choose based on whether you want spacing to respond to the linked theme:

#### For setting spacing, you have 3 options:

1- You can set hard coded values using rem units. **This means that spacing will not adjust to the theme's `--spacing` value.** This is useful when you want set spacing and you want the theme to only change the color-scheme or font-family.

2- You can use multiples of `var(--boxel-sp)` via css `calc`. Be aware that var(--boxel-sp) is always equal to 4 _ var(--spacing). Example: `padding-top: calc(var(--boxel-sp) _ 2);`. This is useful if you want the template spacing to readjust based on selected theme's spacing.

3- You can use boxel spacing variables. This is similar to number 2 above. The difference is that it uses boxel font scale ratio (1.333) to calculate the spacing scale.

**Note on `--spacing`:** Using `--spacing` directly is valid, but it's a single value. If you need a range of sizes, use the `--boxel-sp-*` scale — or derive your own variables with `calc(var(--spacing) * n)`.

**Note:** The boxel spacing values will be recalculated based on the linked card in cardInfo.theme. Below values are defaults.

```css
var(--boxel-sp)        /* (1rem) 16px base unit */
var(--boxel-sp-6xs)    /* ~2px */
var(--boxel-sp-5xs)    /* ~3px */
var(--boxel-sp-4xs)    /* ~4px */
var(--boxel-sp-3xs)    /* ~5px */
var(--boxel-sp-2xs)    /* ~7px */
var(--boxel-sp-xs)     /* 9px */
var(--boxel-sp-sm)     /* 12px */
var(--boxel-sp-lg)     /* 21px */
var(--boxel-sp-xl)     /* 28px */
var(--boxel-sp-2xl)    /* 38px */
var(--boxel-sp-3xl)   /* 50px */
var(--boxel-sp-4xl)   /* 67px */
var(--boxel-sp-5xl)   /* 90px */
var(--boxel-sp-6xl)   /* 120px */
```

### Typography Tokens

As with spacing, you have the same three options for font sizes:

1. **Hardcoded rem** — fixed size, unaffected by the theme's base font size. Fine when you want full control.
2. **`--boxel-font-size-*` tokens** — scale with the theme's base font size.
3. **Semantic tokens** (`--boxel-heading-font-size` etc.) — scale with the theme and also carry role-based meaning.

Choose based on whether you want the text to respond to the linked theme.

#### Semantic typography variables

These are **in addition to** `--font-sans`, `--font-serif`, and `--font-mono`. Use them when styling text by semantic role (heading, body, caption). Use `--font-sans/serif/mono` only when referencing a generic font stack directly.

These are good for isolated or embedded card views. The sizes might be too large for fitted card templates.

**Note:**

- `--font-sans` is default for most text, so you don't need to redeclare it.
- `--font-mono` is default for most monospace text such as `<code>...</code>` etc. So most likely you don't need to redeclare it.
- `--font-serif` is not set by default, so if your theme calls for serif font family, you can declare it at the most efficient level of the css.

```css
/* Heading */
var(--boxel-heading-font-family)
var(--boxel-heading-font-size)
var(--boxel-heading-font-weight)
var(--boxel-heading-line-height)

/* Section heading */
var(--boxel-section-heading-font-family)
var(--boxel-section-heading-font-size)
var(--boxel-section-heading-font-weight)
var(--boxel-section-heading-line-height)

/* Subheading */
var(--boxel-subheading-font-family)
var(--boxel-subheading-font-size)
var(--boxel-subheading-font-weight)
var(--boxel-subheading-line-height)

/* Body */
var(--boxel-body-font-family)
var(--boxel-body-font-size)
var(--boxel-body-font-weight)
var(--boxel-body-line-height)

/* Caption */
var(--boxel-caption-font-family)
var(--boxel-caption-font-size)
var(--boxel-caption-font-weight)
var(--boxel-caption-line-height)
```

#### Low-level typography tokens

Note: The font-family, font-sizes, spacing, radius will be recalculated based on the linked card in cardInfo.theme. Below values are defaults.

```css
var(--boxel-font-family)           /* IBM Plex Sans */
var(--boxel-serif-font-family)     /* IBM Plex Serif */
var(--boxel-monospace-font-family) /* IBM Plex Mono */

var(--boxel-font-size-2xl)  /* 36px */
var(--boxel-font-size-xl)   /* 32px */
var(--boxel-font-size-lg)   /* 22px */
var(--boxel-font-size-md)   /* 20px */
var(--boxel-font-size)      /* 16px */
var(--boxel-font-size-sm)   /* 14px */
var(--boxel-font-size-xs)   /* 12px */
var(--boxel-font-size-2xs)  /* 11px */

/* Line heights */
var(--boxel-line-height-xl)
var(--boxel-line-height-lg)
var(--boxel-line-height)
var(--boxel-line-height-sm)
var(--boxel-line-height-xs)

```

### Border & Radius Tokens

`--radius` is valid for the base radius, but it's a single value. If you need a range of sizes, use the `--boxel-border-radius-*` scale — or derive your own variables with `calc(var(--radius) * n)`. The `--boxel-border-radius-*` tokens are pre-built and scale with the theme's `radius` setting.

```css
var(--boxel-border)           /* 1px solid #d3d3d3 */
var(--boxel-border-color)     /* #d3d3d3 */
var(--radius)                 /* theme border radius base */
var(--boxel-border-radius)    /* set by --radius, defaults to 10px */
var(--boxel-border-radius-xs) /* scales with theme */
var(--boxel-border-radius-sm) /* scales with theme */
var(--boxel-border-radius-lg) /* scales with theme */
var(--boxel-border-radius-xl) /* scales with theme */
var(--boxel-border-radius-xxl) /* scales with theme */
```

### Shadow & Effects Tokens

Always check the linked card in cardInfo.theme for guidance. Here are some defaults:

```css
var(--boxel-box-shadow)        /* subtle elevation */
var(--boxel-box-shadow-hover)  /* hover state elevation */
var(--boxel-deep-box-shadow)   /* strong elevation */
var(--boxel-transition)        /* 0.2s ease */
```

### Primitive Color Tokens — Do Not Use for Brand/Theme

Do NOT use these for brand or theme colors — they are hardcoded and not theme-aware. Prefer semantic variables above. These exist only as low-level primitives:

```css
/* Grays */
var(--boxel-100) through var(--boxel-700)

/* Brand colors -- if a brand-guide is linked in cardInfo.theme, see the brand colors there */
var(--boxel-cyan)
var(--boxel-teal)
var(--boxel-blue)
var(--boxel-purple)
var(--boxel-red)
var(--boxel-green)
var(--boxel-dark-green)
var(--boxel-yellow)
var(--boxel-orange)

/* Status */
var(--boxel-danger)
var(--boxel-danger-hover)
```

## Font Loading — Theme Card Owns Imports

Do NOT use `@import url(...)` inside `<style scoped>` blocks. Font imports belong in the Theme card's `cssImports` field. The runtime automatically passes them to `CardContainer`.

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

## Field Rendering: @fields vs @model

Prefer the `@fields` API `<@fields.fieldName />` over `@model` to let the field's own template handle display.

If the fallback should be consistent everywhere the field appears, define it once via a computed field or use `<@fields.fieldName />`.

Reach for `@model.fieldName` when you need the raw value:

- `{{#if @model.x}}` — conditional check
- HTML attributes: `src={{@model.imageUrl}}`, `alt={{@model.cardTitle}}`
- JS computed getters: `this.args.model.x` (internal TS, not template)

## Template Patterns

### Isolated / embedded templates

Do NOT use `CardContainer` as the root — the runtime (`field-component.gts`) already wraps every card format in `CardContainer`. Adding a second `CardContainer` is a redundant double-wrap.

The themed `CardContainer` already applies `font-family: var(--boxel-body-font-family)` (and matching `font-size`, `font-weight`, `line-height`) on its root element. Do NOT repeat this on your template's root element — it is already inherited by all children.

Via `@layer reset`, all heading and text elements inside a themed card automatically receive semantic typography — no need to declare font/size/weight on them unless overriding:

| Element | Token set applied                                            |
| ------- | ------------------------------------------------------------ |
| `h1`    | `--boxel-heading-*` (font-family, size, weight, line-height) |
| `h2`    | `--boxel-section-heading-*`                                  |
| `h3`    | `--boxel-subheading-*`                                       |
| `p`     | `--boxel-body-*`                                             |
| `small` | `--boxel-caption-font-size`, `--boxel-caption-line-height`   |

Also applied to the container root: `letter-spacing: var(--tracking-normal)` — do not redeclare it.

**Font size defaults are appropriate for isolated templates.** Embedded and fitted templates render in much smaller spaces — override font sizes where needed, but always prioritize legibility. Depending on the font, you can go as small as 0.5rem, but ideally no smaller.

```gts
static isolated = class Isolated extends Component<typeof this> {
  <template>
    <article class='my-card'>
      <CardHeader @title={{@model.cardTitle}} />
      <div class='content'>
        <@fields.someField />
      </div>
    </article>
    <style scoped>
      .my-card {
        padding: var(--boxel-sp);
      }
      .content {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
};
```

### Fitted templates

Fitted cards are rendered at many different container sizes — from small badges to large tiles. The template must look good at any size, not just one target size. Design for fluid resizing:

- Prioritize the most essential information (see common fields that all cards have such as `cardTitle`, `cardDescription` and `cardThumbnailURL`) — the card may be tiny, so show only what fits
- For image columns/panels, use `cqh` (container query height) units so sizing scales with the card: `width: 40cqh; min-width: 3.75rem; max-width: 12.5rem`
- Use `text-overflow: ellipsis` with `white-space: nowrap` for single-line labels, or clamp multi-line text with `-webkit-line-clamp`
- Override inherited font sizes to fit the smaller space — but keep text legible. Depending on the font, you can go as small as 0.5rem, but ideally no smaller

Optionally, you can use the `FittedCard` component from `@cardstack/boxel-ui/components` for fitted card layouts. It handles all responsive container-query breakpoints, image column sizing, text clamping, and overflow — you only supply named content blocks.

```gts
import { FittedCard, Pill } from '@cardstack/boxel-ui/components';
import type { FittedCardLayout, FittedCardTitleTag } from '@cardstack/boxel-ui/components';
import BookOpen from '@cardstack/boxel-icons/book-open';
import Calendar from '@cardstack/boxel-icons/calendar';

static fitted = class Fitted extends Component<typeof this> {
  <template>
    <FittedCard
      @imageUrl={{@model.cardThumbnailURL}}
      @imageAlt={{@model.cardTitle}}
      class='my-fitted'
    >
      <:placeholder><BookOpen width='24' height='24' /></:placeholder>
      <:badgeLeft><Pill>New</Pill></:badgeLeft>
      <:badgeRight><Pill>4.8 ★</Pill></:badgeRight>
      <:eyebrow>{{@model.category}}</:eyebrow>
      <:title><@fields.cardTitle /></:title>
      <:subtitle><@fields.cardDescription /></:subtitle>
      <:meta><Calendar width='14' height='14' /><@fields.date /></:meta>
      <:footer><strong>{{@model.author.name}}</strong></:footer>
    </FittedCard>
    <style scoped>
      .my-fitted {
        --fc-content-gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
};
```

#### Named blocks

| Block         | Description                                                                                                                              | Required |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `title`       | Primary heading                                                                                                                          | Yes      |
| `placeholder` | Icon/content in the image column when `@imageUrl` is absent. Yielding empty content removes the column entirely.                         | No       |
| `image`       | Custom image block (alternative to `@imageUrl`)                                                                                          | No       |
| `background`  | Absolutely-positioned background graphics layer                                                                                          | No       |
| `badgeLeft`   | Absolutely-positioned group at top-left (over the image when present)                                                                    | No       |
| `badgeRight`  | Absolutely-positioned group at top-right                                                                                                 | No       |
| `badgeRow`    | Inline flex row of badges/pills above the header inside the text column; controlled by `--fc-badge-row-justify` and `--fc-badge-row-gap` | No       |
| `badge`       | Alias for `badgeLeft` (legacy — prefer `badgeLeft`)                                                                                      | No       |
| `eyebrow`     | Tiny uppercase overline above the title                                                                                                  | No       |
| `subtitle`    | Secondary line below the title                                                                                                           | No       |
| `meta`        | Additional content between header and footer                                                                                             | No       |
| `footer`      | Bottom row: date, location, price, stats, etc.                                                                                           | No       |

#### Args

| Arg             | Type                 | Description                                                                                                                                                                                                                                               |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@imageUrl`     | `string`             | Cover image URL; triggers the image column layout                                                                                                                                                                                                         |
| `@imageAlt`     | `string`             | Alt text for the cover image (defaults to `""`)                                                                                                                                                                                                           |
| `@imageLoading` | `string`             | `'lazy'` or `'eager'`; omit to use the browser default                                                                                                                                                                                                    |
| `@titleTag`     | `FittedCardTitleTag` | HTML heading element for the title: `'h1'` (default), `'h2'`, `'h3'`, etc. Pass `'h2'` or `'h3'` when cards appear in a list to preserve heading hierarchy for screen readers.                                                                            |
| `@layout`       | `FittedCardLayout`   | Force a layout direction regardless of container size: `'vertical'` — image always stacks on top; `'horizontal'` — image always sits to the left; `'auto'` (default) — direction is chosen by container-query breakpoints based on aspect-ratio and size. |

`FittedCardLayout` and `FittedCardTitleTag` are exported named types from `@cardstack/boxel-ui/components`. When you need the allowed values as an array (e.g. for a dropdown), use the exported constants `FITTED_CARD_LAYOUT_OPTIONS` and `FITTED_CARD_TITLE_TAG_OPTIONS`.

#### CSS custom properties

Override these on the FittedCard root element. Breakpoints adjust many automatically; only set them when you need to deviate.

```css
.my-fitted {
  /* ── Layout ── */
  --fc-content-padding: var(--boxel-sp-xs); /* padding inside text column */
  --fc-content-gap: var(
    --boxel-sp-3xs
  ); /* gap between header / meta / footer */
  --fc-content-gap-no-image: var(
    --boxel-sp-xs
  ); /* gap when there is no image column */
  --fc-header-gap: var(
    --boxel-sp-6xs
  ); /* gap within header (eyebrow / title / subtitle) */

  /* ── Image column ── */
  --fc-image-width: 40cqh; /* horizontal layouts */
  --fc-image-min-width: 3.75rem;
  --fc-image-max-width: 12.5rem;
  --fc-image-height: auto; /* vertical tiles override with a cqmin value */
  --fc-image-object-fit: cover; /* object-fit for the cover image */
  --fc-image-background: linear-gradient(
    180deg,
    var(--muted) 0%,
    var(--accent) 100%
  ); /* column bg when no image fills it */
  --fc-image-fade-color: var(
    --card
  ); /* base color for expanded-card image fade; match your card background */

  /* ── Typography ── */
  --fc-eyebrow-font-size: 0.625rem;
  --fc-eyebrow-line-height: 1.1;
  --fc-title-font-size: var(--boxel-font-size-sm);
  --fc-title-line-height: 1.2;
  --fc-title-line-clamp: 2;
  --fc-subtitle-font-size: var(--boxel-font-size-xs);
  --fc-subtitle-line-height: 1.1;
  --fc-subtitle-line-clamp: 2;
  --fc-meta-font-size: var(--boxel-caption-font-size);
  --fc-meta-line-height: 1.1;
  --fc-footer-font-size: var(--boxel-caption-font-size);

  /* ── Badges ── */
  --fc-badge-offset: var(
    --boxel-sp-2xs
  ); /* inset from card edges for badgeLeft / badgeRight */

  /* ── Badge row ── */
  --fc-badge-row-justify: space-between;
  --fc-badge-row-gap: var(--boxel-sp-2xs);

  /* ── Meta & footer flex row ── */
  --fc-meta-justify: flex-start; /* justify-content */
  --fc-meta-gap: var(--boxel-sp-2xs);
  --fc-meta-align-items: center; /* align-items */
  --fc-meta-flex-wrap: wrap;
  --fc-footer-justify: flex-start; /* justify-content */
  --fc-footer-align-items: center; /* align-items */
  --fc-footer-flex-wrap: nowrap; /* flex-wrap */
  --fc-footer-gap: var(--boxel-sp-2xs);
}
```

#### Customising caller-owned content per breakpoint

`FittedCard` handles its own layout at every size. For caller-owned content that needs show/hide per breakpoint, add `@container fitted-card` rules in your own `<style scoped>`:

```css
@container fitted-card (width < 250px) {
  .my-detail-row {
    display: none;
  }
}
```

Use `:deep(.fc-eyebrow)` etc. to reach into `FittedCard` internals only for layout overrides (e.g. making the eyebrow a flex row for an icon + label).

### All 16 fitted formats (from `fitted-formats.ts`)

The runtime defines 16 named formats. Sizes are exact spec values (width × height in px):

| Format            | Width | Height |
| ----------------- | ----- | ------ |
| small-badge       | 150   | 40     |
| medium-badge      | 150   | 65     |
| large-badge       | 150   | 105    |
| single-strip      | 250   | 40     |
| double-strip      | 250   | 65     |
| triple-strip      | 250   | 105    |
| double-wide-strip | 400   | 65     |
| triple-wide-strip | 400   | 105    |
| small-tile        | 150   | 170    |
| regular-tile      | 250   | 170    |
| cardsgrid-tile    | 170   | 250    |
| tall-tile         | 150   | 275    |
| large-tile        | 250   | 275    |
| compact-card      | 400   | 170    |
| full-card         | 400   | 275    |
| expanded-card     | 400   | 445    |

#### What `FittedCard` does at each breakpoint

**Badges** (`aspect-ratio > 1.0`, `width < 250px`) — 1-col, no image column:

- Small Badge (150×40): 1-line title only; hides image, both badges, subtitle, meta, footer
- Medium Badge (150×65): 1-line title + subtitle; hides image, both badges, meta, footer
- Large Badge (150×105): hides image, both badges, meta

**Strips** (`aspect-ratio > 1.0`, `width ≥ 250px`, `height < 170px`):

- Single Strip (250×40): compact padding, 1-line title; hides both badges, subtitle, meta, footer
- Double Strip (250×65): 1-line title + subtitle; hides both badges, meta, footer
- Triple Strip (250×105): hides both badges, meta
- Double Wide Strip (400×65): image `width: 40cqw`; 1-line title + subtitle; hides both badges and badge-row, meta, footer — restores `badgeLeft` when image is present
- Triple Wide Strip (400×105): image `width: 40cqw`; hides both badges and badge-row, meta — restores `badgeLeft` when image is present

**Vertical / Square tiles** (`aspect-ratio ≤ 1.0`) — 1-col, image stacks above content:

- All: image `height: 45cqmin`; taller than 250px → `55cqmin`
- Small Tile (150×170): smaller title font; hides badge-row, meta; hides both badges when no image
- Shorter than 150px height: hides meta + footer; 1-line subtitle
- Narrower than 140px: hides both badges
- Regular Tile (250×170), CardsGrid Tile, Tall Tile, Large Tile: hides both badges when no image

**Horizontal cards** (`aspect-ratio > 1.0`, `width ≥ 400px`, `height ≥ 170px`) — image `width: 40cqw`:

- Compact Card (400×170): increased padding + gap; hides both badges when no image
- Full Card (400×275): larger font sizes; `line-clamp: 3`; hides both badges when no image
- Expanded Card (400×445): full padding, image `height: 50cqh` with bottom scrim fade; hides both badges when no image

#### `@layout` forced-mode overrides

When `@layout` is `'vertical'` or `'horizontal'`, the image column direction is locked regardless of container size. Container-query breakpoints still apply for font sizes, padding, and section visibility — only the grid direction and image sizing are overridden.

**`@layout='vertical'`** — image stacks above content (`width: 100%`, `height: 45cqmin`):

- Strip sizes (`aspect-ratio > 1.0`, `height < 170px`) and compact card (`width ≥ 400px`, `170px ≤ height < 275px`): image is **hidden** — not enough vertical space to stack it usefully.

**`@layout='horizontal'`** — image sits to the left (`width: 40cqh`):

- Portrait/square tiles with `height ≥ 200px` and `width < 400px` (CardsGrid, Tall Tile, Large Tile): image width reduced to `30cqh` — avoids eating too much of a narrow card.
- Expanded Card (`width ≥ 400px`, `height ≥ 445px`): image width reduced to `25cqh` — `40cqh` of a 445px+ card is ~180px, which is too wide.

All image-sizing values are still overridable per-card with `--fc-image-width`.

### Form fields

Wrap inputs with `FieldContainer` for consistent label + input layout. Use component API to pass in relevant arguments instead of writing css.

```gts
<FieldContainer @label='Title' @tag='label' @vertical={{true}}>
  <Input @value={{@model.title}} />
</FieldContainer>
```

### Icons

Icons and SVGs must not use hardcoded hex fills — use theme color tokens via CSS:

```gts
// Avoid — hardcoded hex fills
<svg viewBox='0 0 200 120'>
  <ellipse fill='#fed7aa' /><circle fill='#ef4444' />
</svg>

// Correct — styled with theme token
<ChefHat width='12' height='12' class='chef-hat-icon' />
```

```css
.chef-hat-icon {
  color: var(--muted-foreground);
}
```

## Use Container Queries, Not Viewport Units

Cards are placed inside containers that may be much smaller than the viewport. Always use CSS container queries for responsive layout instead of viewport-based media queries or `vw`/`vh` units. Use container query units instead of `vw` inside `clamp()`:

- **Fitted** (`container-type: size`): prefer `cqmin` — scales to the smaller of width or height, preventing overflow in the constrained dimension
- **Embedded / Isolated** (`container-type: inline-size`): use `cqi` — only the inline axis is available

The base `field-component` provides named containers automatically — you do not need to declare your own `container-type` for fitted or embedded formats:

| Format   | Named container | Container type                                                |
| -------- | --------------- | ------------------------------------------------------------- |
| Fitted   | `fitted-card`   | `size` (both axes — width and height breakpoints both matter) |
| Embedded | `embedded-card` | `inline-size` (width only)                                    |

```css
/* Fitted — use the named container for all breakpoints */
@container fitted-card (max-width: 150px) and (max-height: 169px) { ... }

/* Embedded — named or anonymous both work */
@container embedded-card (max-width: 400px) { ... }
```

For isolated templates, the parent does not provide a named container — declare `container-type: inline-size` with a name on your own root element and use that name in `@container` rules.

**Named containers are safer in nested situations.** An anonymous `@container` matches the nearest ancestor with any `container-type`, which could be an unintended intermediate container. `@container fitted-card (...)` skips anonymous containers and always resolves to the nearest ancestor with that specific name — so nested fitted cards each correctly target their own wrapper.

## Prevent Content Overflow

Content must never overflow its container. Always write CSS defensively for small viewports.

- Use `overflow: hidden` or `boxel-ellipsize` class name on text that could overflow
- Use `gap` instead of margins between flex/grid items to avoid blowout
- Avoid fixed `width` or `height` values that ignore the available space; use `min-*` / `max-*` variants or relative units instead

## Prefer Component APIs; Write New Components When Needed

Always reach for existing boxel-ui components before writing custom HTML + CSS. Every custom element you avoid keeps templates shorter and inherits future design-system improvements automatically.

**Wrong — bespoke HTML for something boxel-ui already covers:**

```gts
<div class='pill'>Draft</div>
<style scoped>
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    background: var(--muted);
    font-size: var(--boxel-font-size-xs);
  }
</style>
```

**Right — use the existing component:**

```gts
import { Pill } from '@cardstack/boxel-ui/components';

<Pill @variant='muted'>Draft</Pill>
```

## Use Boxel-UI Components

**Important**: When using a boxel-ui component imported from `@cardstack/boxel-ui/components`, ALWAYS READ THE API. This will make sure you're using the correct variable names and values.

Always prefer boxel-ui components over raw HTML elements. Import from `@cardstack/boxel-ui/components`:

```gts
import {
  Button,
  CardContainer,
  FieldContainer,
  Header,
  Input,
  Pill,
  // ... other components as needed
} from '@cardstack/boxel-ui/components';
```

### Component Reference

**Layout & Containers:**

- `CardContainer` — wraps card content with correct border/shadow/padding. all cards are already wrapped in this.
- `GridContainer` — responsive grid layout
- `Container` — generic container
- `ResizablePanelGroup` — resizable panel layouts

**Headers & Navigation:**

- `Header` — page/section headers
- `TabbedHeader` — headers with tabs
- `CardHeader` — card-specific header with icon, title, actions

**Inputs & Forms:**

- `Input` — most inputs
- `EmailInput` / `PhoneInput` — specialized inputs
- `Select` / `MultiSelect` — dropdowns
- `RadioInput` — radio buttons
- `Switch` — toggle switch
- `FieldContainer` — wraps a label + input with consistent spacing (use `@vertical={{true}}` for vertical)
- `Label` — standalone label
- `DateRangePicker` — date range selection

**Buttons & Actions:**

- `Button` — primary action button (use `@kind` for primary/secondary/muted/destructive/text-only; use `@size` for `auto, base, extra-small, small, tall, touch)
- `IconButton` — icon-only button (use `@variant` for primary/secondary/muted/destructive/text-only, `@size` for `auto, base, extra-small, small, tall, touch)
- `ContextButton` — contextual action button (`@icon` for add, edit, close, delete, context-menu, context-menu-vertical; `@variant` for highlight, highlight-icon, ghost, destructive, destructive-icon)
- `CopyButton` — copy-to-clipboard

**Feedback & Status:**

- `Alert` — informational alerts (use `@type` for warning/error)
- `LoadingIndicator` — loading spinner
- `CircleSpinner` — compact spinner
- `ProgressBar` — linear progress
- `ProgressRadial` — circular progress
- `SkeletonPlaceholder` — loading skeleton
- `Tooltip` — hover tooltips

**Display & Data:**

- `Accordion` — collapsible sections
- `Pill` — inline status/badge (`@variant` for primary, secondary, accent, muted, destructive; use `@kind='button'` to make it a button)
- `Swatch` — color swatch display
- `Avatar` — user/entity avatar
- `EntityIconDisplay` / `EntityThumbnailDisplay` — entity visuals
- `RealmIcon` — realm icon display
- `FilterList` — filterable list
- `SortDropdown` — sort controls
- `ViewSelector` — view mode toggle
- `Menu` — dropdown menu
- `Modal` — overlay dialogs
- `Dropdown` — dropdown container
- `Message` — chat/message bubbles
- `ColorPalette` / `ColorPicker` — color selection
- `DragAndDrop` — drag-and-drop interface

### When a component is missing from boxel-ui

If no existing component satisfies your need, write a self-contained Glimmer component in the same file (or a co-located file) that is structured so it could be contributed to the boxel-ui library later:

- Give it a clear, generic name (e.g. `StatusBadge`, `SectionHeader`, `AvatarGroup`)
- Declare a typed `interface Signature` block
- Use only design tokens — no hardcoded colors
- Use `<style scoped>` so styles do not leak
- Keep component arguments minimal and semantic

Add a TODO comment noting it should be moved to `@cardstack/boxel-ui/components` when it matures.

## Checklist

Before finalizing any card template, verify:

- [ ] No raw `<button>` — use `<Button>` component
- [ ] No raw `<input>` — use `<Input>` or `<FieldContainer>` + `<Input>`
- [ ] No raw `<select>` — use `<Select>` or `<MultiSelect>`
- [ ] No hard-coded colors — use CSS custom properties
- [ ] Semantic theme variables (`--background`, `--foreground`, `--primary`, etc.) used where applicable
- [ ] Scoped styles use `<style scoped>` in templates
- [ ] No `@import url(...)` inside `<style scoped>` — font imports belong in the Theme card's `cssImports` field
- [ ] Semi-transparent colors use `color-mix(in oklch, ...)` not `rgba()`
- [ ] No fixed widths that ignore available space — use relative units or `max-width`
- [ ] Responsive layout uses `@container` queries, not `@media` viewport queries or `vw`/`vh` units
- [ ] Icons and SVGs never use hardcoded hex fills — use theme color tokens via CSS
- [ ] No hardcoded fallback values scattered in `var()` calls — if fallbacks are needed, define them once on the parent container. Falling back to another CSS variable is fine: `var(--token, var(--other-token))`
- [ ] Prefers `<@fields.field />` for all simple field rendering; `@model.x` for conditionals, HTML attributes, context-specific fallback value, and JS getters
- [ ] Custom HTML/CSS replaced with existing boxel-ui components wherever possible
- [ ] Any new reusable component has a typed `Signature`, uses design tokens, and is noted with a TODO to contribute to `@cardstack/boxel-ui/components`
