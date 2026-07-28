## Use Boxel Design Tokens for Theming

Never hard-code colors. Always use CSS custom properties.

**Fallback rule — scoped to theme/semantic tokens.** Do not provide hardcoded fallback values inside `var()` when referencing theme or semantic tokens — e.g. `var(--primary, #6366f1)`, `var(--boxel-sp, 1rem)`, `var(--background, white)`. Those tokens are always defined, so the fallback is dead weight that drifts out of sync with the theme. Falling back to another CSS variable is fine: `var(--token, var(--other-token))`.

Two exemptions — both resolved by declaring on a parent container, never inline per selector:

1. **Locally-defined component variables** (`--fit-*`, `--stagger-d`, …): declare them once, with their default values, on the component's parent/root element; descendants reference them bare (`var(--fit-headline-size)`), never with inline fallbacks scattered through child selectors.
2. **Conditionally-existing runtime tokens** — tokens that only exist on themed containers (the scale-driven `--boxel-fs-*` ladder) or have no default at all (`--font-serif`). These genuinely need a fallback; give it ONCE, in a local-variable declaration on the parent container (e.g. `--serif: var(--font-serif, Georgia, serif);` on the composition root), and reference the local variable bare below.

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

- `--primary`, `--secondary`, `--accent`, `--destructive`, `--sidebar-primary`, and `--sidebar-accent` are surface/action/state tokens, not ordinary text colors. Boxel's primary may be a bright brand teal, so `color: var(--primary)` can fail on light backgrounds. Use `--foreground` for body text, `--muted-foreground` for secondary text, or the paired `--*-foreground` when text sits on the matching surface.

- `--muted-foreground` must only be used on `--muted`, `--background`, or `--card` surfaces. Do not place it on `--primary`, `--accent`, or any other surface — contrast is not guaranteed.

- Declare `background-color` and the corresponding `color` on a parent container. All children will inherit the color, so you don't need to repeat the color declaration unless you need to override the color.

- You would only redeclare background and color, if you make a special box that uses one of the special color pairings. For example: `background-color: var(--accent); color: var(--accent-foreground);`.

- Nested component layout example. This is just an example for how different color pairing can be used.
  - Outer parent: `background-color: var(--background); color: var(--foreground);`
  - Nested grid of containers:  `background-color: var(--card); color: var(--card-foreground);`
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

Do not copy a shadcn, Tailwind, or DESIGN.md base spacing value directly into Boxel `--spacing` without normalization. If the source system says the base spacing rhythm is `1rem`, Boxel usually wants `spacing: 0.25rem`.

All three options below are valid — choose based on whether you want spacing to respond to the linked theme:

#### For setting spacing, you have 3 options:

1- You can set hard coded values using rem units. **This means that spacing will not adjust to the theme's `--spacing` value.** This is useful when you want set spacing and you want the theme to only change the color-scheme or font-family.

2- You can use multiples of `var(--boxel-sp)` via css `calc`. Be aware that var(--boxel-sp) is always equal to 4 * var(--spacing). Example: `padding-top: calc(var(--boxel-sp) * 2);`. This is useful if you want the template spacing to readjust based on selected theme's spacing.

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

### Brand Guide Tokens

When the linked `cardInfo.theme` is a `BrandGuide`, consume brand identity through the generated variables rather than hardcoding brand colors or logo URLs. Brand Guide variables sit alongside the semantic variables above; prefer semantic roles for normal UI, and use brand variables only when the design specifically needs brand identity.

Functional brand palette:

```css
var(--brand-primary)
var(--brand-secondary)
var(--brand-accent)
var(--brand-light)
var(--brand-dark)
```

Logo and mark variables:

```css
var(--brand-primary-mark)
var(--brand-secondary-mark)
var(--brand-primary-mark-greyscale)
var(--brand-secondary-mark-greyscale)
var(--brand-social-media-profile-icon)
var(--brand-primary-mark-min-height)
var(--brand-primary-mark-clearance-ratio)
var(--brand-secondary-mark-min-height)
var(--brand-secondary-mark-clearance-ratio)
```

Use `--primary`, `--secondary`, `--accent`, `--background`, and `--foreground` for ordinary UI. `BrandGuide` maps those semantic tokens from `--brand-*` values when explicit theme values are absent, and generates readable foreground colors for primary/secondary/accent surfaces.
