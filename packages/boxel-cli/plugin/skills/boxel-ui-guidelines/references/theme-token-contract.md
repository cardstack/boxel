## Theme Token Contract

The single inventory of the CSS custom properties a Boxel theme provides. Every skill that talks about theme variables points here rather than carrying its own list, so when the contract changes this is the only file to update.

Source of record: `packages/boxel-ui/src/styles/theme.css` (every token's default value, light and dark) and `packages/base/structured-theme-variables.gts` (the `ThemeVarField` field behind each token). `CardContainer` (`packages/boxel-ui/src/components/card-container/index.gts`) derives the `--boxel-*` scales below from the base tokens.

**How the contract behaves.** Each named token is a declared field on the theme's variables, has a default in `theme.css`, and is re-declared at every themed-card boundary. A theme only sets the tokens it changes; the rest fall back to the defaults instead of leaking in from the chrome or an outer theme card. Consequently a template never needs a literal fallback in `var()` for any token on this page — `var(--success)` is complete, `var(--success, green)` is dead weight.

Reference tokens directly. Never wrap them in `hsl(var(...))`; Boxel stores resolved colors, not channel triples.

**Which card holds the contract.** Never create a theme from the bare `Theme` card (`@cardstack/base/card-api`), and never subclass it directly. Its `cssVariables` is a free-form string: nothing checks it against the contract, nothing supplies defaults for what it omits, and the theme editors and previews cannot read it. Start from `StructuredTheme` at minimum; step up to `StyleReference` or `DetailedStyleReference` for a documented visual system, and to `BrandGuide` when brand assets are involved or when custom variables outside the contract are required.

### Colors

Surface tokens name a background. Each pairs with its own `-foreground`, which is the only color guaranteed to read on it.

```css
/* core surfaces */
--background          --foreground            /* page */
--card                --card-foreground       /* card surface */
--popover             --popover-foreground    /* floating overlays */
--muted               --muted-foreground      /* subdued surface; muted-foreground also reads on --background and --card */
--subtle-foreground                           /* third ink step, fainter than --muted-foreground: timestamps, tertiary counts */

/* action and emphasis */
--primary             --primary-foreground
--secondary           --secondary-foreground
--accent              --accent-foreground

/* status */
--destructive         --destructive-foreground
--success             --success-foreground
--warning             --warning-foreground
--info                --info-foreground
--attention           --attention-foreground  /* needs-your-attention; distinct from warning and destructive */
--overlay                                     /* translucent scrim behind modals and drawers */

/* sidebar */
--sidebar             --sidebar-foreground
--sidebar-primary     --sidebar-primary-foreground
--sidebar-accent      --sidebar-accent-foreground
--sidebar-border
--sidebar-ring
```

**Neutral surfaces.** These have no `-foreground` of their own by design: the theme guarantees `--foreground` reads on every one of them. `--tooltip` is the exception, the one inverted surface.

```css
--canvas              /* workspace ground behind the page background */
--inset               /* a well sunk into a card */
--field               /* an editable input at rest; its border is --input */
--hover               /* pointer-hover surface; translucent so it composes over any background */
--stripe              /* alternate (zebra) row background */
--selected            /* selected row/item; defaults to a tint of --primary over --card */
--tooltip             --tooltip-foreground
```

**Hue as ink.** A hue used *as* text or icon color on a neutral surface (a status label, a link, an icon), as opposed to `--x-foreground`, which is ink *on* the hue's own fill. Each defaults to the hue mixed 60% toward `--foreground`, so it darkens on light surfaces and lightens on dark ones, and a theme that sets only the fill still gets a readable ink. Ink tokens belong on `--background`, `--card`, and `--muted`.

```css
--primary-ink   --secondary-ink   --accent-ink   --destructive-ink
--success-ink   --warning-ink     --info-ink     --attention-ink
```

**Borders, focus, controls.**

```css
--border              /* default border color */
--border-strong       /* one visible step darker, for dividers that must hold their own */
--input               /* input border color and the track of an unfilled control; input backgrounds are --field */
--ring                /* focus ring */
--control-height      /* height of inputs, selects, buttons; default 2.5rem */
```

**Charts.**

```css
--chart-1  --chart-2  --chart-3  --chart-4  --chart-5  --chart-6  --chart-7
```

### Typography

Font stacks. All three have `theme.css` defaults (the IBM Plex families). `CardContainer` applies `--font-sans` as the card's default `font-family` and as the fallback family for every typography role, so it never needs redeclaring. `--font-serif` is applied to nothing by the container: a serif voice is opted into by declaring `font-family: var(--font-serif)` once at the highest element that needs it, or by a typography slot naming it. `--font-mono` is applied only inside rendered Markdown; a bare `<code>`, `<pre>`, `<kbd>`, or `<samp>` in a template gets the fixed Boxel mono (`--boxel-monospace-font-family`) from the global stylesheet, so a template that wants the theme's mono stack on those elements declares `font-family: var(--font-mono)` on them.

```css
--font-sans   --font-serif   --font-mono
--tracking-normal                          /* base letter-spacing */
```

**Roles.** The theme's `typography` field has one slot per role: `heading`, `sectionHeading`, `subheading`, `body`, `caption`, `label` (control text, table headers, badges), and `eyebrow` (the small tracked-out kicker above a title). Each slot carries family, size, weight, line-height, and letter-spacing. `CardContainer` publishes them to templates as `--boxel-<role>-*`; the label role publishes as `--boxel-ui-label-*` because `--boxel-label-*` is the Label component's own contract.

```css
--boxel-heading-font-family          --boxel-heading-font-size          --boxel-heading-font-weight          --boxel-heading-line-height          --boxel-heading-letter-spacing
--boxel-section-heading-font-family  --boxel-section-heading-font-size  --boxel-section-heading-font-weight  --boxel-section-heading-line-height  --boxel-section-heading-letter-spacing
--boxel-subheading-font-family       --boxel-subheading-font-size       --boxel-subheading-font-weight       --boxel-subheading-line-height       --boxel-subheading-letter-spacing
--boxel-body-font-family             --boxel-body-font-size             --boxel-body-font-weight             --boxel-body-line-height             --boxel-body-letter-spacing
--boxel-caption-font-family          --boxel-caption-font-size          --boxel-caption-font-weight          --boxel-caption-line-height          --boxel-caption-letter-spacing
--boxel-ui-label-font-family         --boxel-ui-label-font-size         --boxel-ui-label-font-weight         --boxel-ui-label-line-height         --boxel-ui-label-letter-spacing
--boxel-eyebrow-font-family          --boxel-eyebrow-font-size          --boxel-eyebrow-font-weight          --boxel-eyebrow-line-height          --boxel-eyebrow-letter-spacing
```

Body, caption, and label letter-spacing follow `--tracking-normal` unless the slot sets its own.

**Scale knobs.** Two theme fields drive every derived ladder on this page. `themeFontSize` (`--theme-font-size`, default 1rem) is the base size `--boxel-font-size` resolves to. `themeScale` (`--theme-scale`, default 1.333, Perfect Fourth) is the ratio between steps of the `--boxel-fs-*` and `--boxel-sp-*` ladders.

```css
--theme-font-size   --theme-scale
```

**Size ladders.** Two exist, and they differ in how they step. `--boxel-font-size-*` multiplies the base by fixed factors (defaults in parentheses) and always exists. `--boxel-fs-*` steps by `--theme-scale` (`--boxel-fs` is the body size, each step up or down multiplies or divides by the ratio). Both ladders are declared on every `CardContainer`, themed or not, in the same rule as `--boxel-sp-*`, so neither takes a fallback. Headings do not read either ladder directly: they take the typography role tokens, whose defaults fall back to `--boxel-font-size-lg/md/...`.

```css
--boxel-font-size-2xl (36px)  --boxel-font-size-xl (32px)  --boxel-font-size-lg (22px)  --boxel-font-size-md (20px)
--boxel-font-size (16px)      --boxel-font-size-sm (14px)  --boxel-font-size-xs (12px)  --boxel-font-size-2xs (11px)

--boxel-fs-2xl  --boxel-fs-xl  --boxel-fs-lg  --boxel-fs-md  --boxel-fs  --boxel-fs-sm  --boxel-fs-xs  --boxel-fs-2xs

--boxel-line-height-xl  --boxel-line-height-lg  --boxel-line-height  --boxel-line-height-sm  --boxel-line-height-xs
```

The `--boxel-lsp-*` letter-spacing steps are fixed Boxel values, not derived from the theme; themed text takes its role's letter-spacing token instead.

### Spacing

`--spacing` is the theme's base unit and is multiplied by 4 at runtime: `CardContainer` sets `--boxel-sp: calc(var(--spacing) * 4)`. A 16px rhythm is therefore stored as `spacing: 0.25rem`, never `1rem`. The `--boxel-sp-*` scale steps from `--boxel-sp` by `--theme-scale` (default 1.333). Default values in parentheses.

```css
--spacing
--boxel-sp (16px)
--boxel-sp-6xs (~2px)  --boxel-sp-5xs (~3px)  --boxel-sp-4xs (~4px)  --boxel-sp-3xs (~5px)  --boxel-sp-2xs (~7px)  --boxel-sp-xs (9px)  --boxel-sp-sm (12px)
--boxel-sp-lg (21px)   --boxel-sp-xl (28px)   --boxel-sp-2xl (38px)  --boxel-sp-3xl (50px)  --boxel-sp-4xl (67px)  --boxel-sp-5xl (90px)  --boxel-sp-6xl (120px)
```

### Radius

`--radius` is the theme's base. The `--boxel-border-radius-*` scale derives from it.

```css
--radius
--boxel-border-radius-2xs  --boxel-border-radius-xs  --boxel-border-radius-sm  --boxel-border-radius (base)
--boxel-border-radius-lg   --boxel-border-radius-xl  --boxel-border-radius-2xl
```

### Shadows

The composed elevation scale, lightest to heaviest. A theme sets these directly; the `--shadow-x/y/blur/spread/opacity/color` primitives are stored only so imported themes round-trip and do not drive rendered shadows.

```css
--shadow-2xs  --shadow-xs  --shadow-sm  --shadow  --shadow-md  --shadow-lg  --shadow-xl  --shadow-2xl
--shadow-inset                                                    /* sunken wells and inputs */
```

### What CardContainer already applies

The host wraps every card render in a themed `CardContainer`, so a template inherits these without declaring them. Repeating them on a template root or on bare elements is noise at best and a theme override at worst; declare a value only where the design deviates.

On the container root:

```css
background-color: var(--background);
color: var(--foreground);
font-family: var(--boxel-body-font-family);
font-size: var(--boxel-body-font-size);
font-weight: var(--boxel-body-font-weight);
line-height: var(--boxel-body-line-height);
letter-spacing: var(--boxel-body-letter-spacing);
```

On elements inside the card, via a low-priority `@layer reset` so any scoped rule of yours still wins:

| Element | What it gets |
|---|---|
| `h1`–`h6`, `p` | margins zeroed |
| `h1` | the `heading` role: family, size, weight, line-height, letter-spacing |
| `h2` | the `sectionHeading` role |
| `h3` | the `subheading` role |
| `h4`–`h6` | `font-size: inherit` (body size; weight is the browser default) |
| `small` | the `caption` role's size, line-height, letter-spacing |

Consequences for templates: an isolated root does not repeat the background/foreground pair; body text needs no font declarations; a heading element already carries its role, so only re-declare when using a different role on that element (an `h2` that should read as a `heading`) or when styling a non-heading element as a heading. `p` gets no role of its own because it inherits the body role from the root.

### Font loading

`StructuredTheme` computes `cssImports`: it derives the Google Fonts stylesheet links from every font stack the theme names (`--font-sans/serif/mono` in both schemes and each typography slot's family), so those never drift from the fields. Stylesheets that cannot be derived, such as Adobe Fonts or a self-hosted face, go in the theme's `customCssImports` list and are appended ahead of the derived ones. `CardContainer` links `cssImports` wherever the theme applies; templates never `@import` a font.

### Not part of the contract

- **Fixed Boxel primitives** — the `--boxel-*` palette (`--boxel-100`…`--boxel-700`, `--boxel-teal`, `--boxel-danger`, `--boxel-success`, `--boxel-warning`, …), `--boxel-box-shadow*`, `--boxel-deep-box-shadow`, `--boxel-transition`, `--boxel-border`, `--boxel-border-color`. They never change with the theme. Inside card content prefer the semantic token they sit behind (`--boxel-success` → `--success`); they are the correct choice only in host app chrome, which no theme styles.
- **Brand Guide variables** — `--brand-primary`, `--brand-secondary`, `--brand-accent`, `--brand-light`, `--brand-dark`, the `--brand-*-mark*` logo variables, and any `brandColorPalette` name. Present only when the linked theme is a `BrandGuide`.
- **Custom variables.** `StructuredTheme` has no slot for tokens beyond this page, on purpose. Motion durations, easing curves, or shape constants need a `BrandGuide` (its `customCssVariables` list, or `brandColorPalette` names) or a theme card definition extended with fields of its own. Both give up the contract's guarantees: no `theme.css` default and no reset at the themed-card boundary, so the variables leak into every nested card, and linking a different theme card silently drops them because they do not exist there. Map onto a named token wherever one is close enough, never duplicate a named token this way, and when a template that may render under other themes reads a custom variable, give it a fallback once in a local variable on the component root.
