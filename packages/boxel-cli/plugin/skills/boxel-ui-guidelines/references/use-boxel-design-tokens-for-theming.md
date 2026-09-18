## Use Boxel Design Tokens for Theming

Never hard-code colors. Always use CSS custom properties.

**Fallback rule — scoped to theme/semantic tokens.** Do not provide hardcoded fallback values inside `var()` when referencing theme or semantic tokens — e.g. `var(--primary, #6366f1)`, `var(--boxel-sp, 1rem)`, `var(--background, white)`. Those tokens are always defined, so the fallback is dead weight that drifts out of sync with the theme. That includes the status tokens: `--success`, `--warning`, `--info`, and `--attention` are declared in `theme.css` with defaults, so plain `var(--success)` is correct and `var(--success, green)` is the same dead weight. Falling back to another CSS variable is fine: `var(--token, var(--other-token))`.

Two exemptions — both resolved by declaring on a parent container, never inline per selector:

1. **Locally-defined component variables** (`--fit-*`, `--stagger-d`, …): declare them once, with their default values, on the component's parent/root element; descendants reference them bare (`var(--fit-headline-size)`), never with inline fallbacks scattered through child selectors.
2. **Brand Guide custom variables** — tokens outside the contract that only exist when a particular Brand Guide is active. These genuinely need a fallback; give it ONCE, in a local-variable declaration on the parent container (e.g. `--display-size: var(--brand-display-size, 2.4rem);` on the composition root), and reference the local variable bare below. The `--boxel-fs-*` ladder is not one of these: `CardContainer` declares it on every container alongside `--boxel-sp-*`, so it is referenced bare.

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
background-color: var(--card);
color: var(--card-foreground);
border: 1px solid var(--border);
```

### Semantic Theme Variables (prefer these)

The full inventory — surfaces and their paired foregrounds, status fills, neutral surfaces, hue-as-ink tokens, borders, charts, sidebar, typography, spacing, radius, shadows — lives in one place: `skills/boxel-ui-guidelines/references/theme-token-contract.md`. Read it before styling; this reference only covers how to *use* those tokens. In short: every surface token names a background and pairs with its own `--*-foreground`; the neutral surfaces (`--canvas`, `--inset`, `--field`, `--hover`, `--stripe`, `--selected`) pair with `--foreground`; a hue used as text or icon color on a neutral surface takes its `--*-ink` token.

### Color Pairing Rules

- `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--sidebar-primary`, and `--sidebar-accent` are surface/action/state tokens, not foreground colors. They fail in both directions: Boxel's primary may be a bright brand teal, so `color: var(--primary)` washes out on light backgrounds, while `--muted` is a near-white surface that all but vanishes as `color` on `--background` or `--card`. Each names a background and only pairs with its own `--*-foreground`. This covers **every** foreground role, not just body text — icon `color`/`stroke`/`fill`, borders, rules, and underlines all inherit the same problem. Use `--foreground` for body text, `--muted-foreground` for secondary text and de-emphasized marks, or the paired `--*-foreground` when the element sits on the matching surface.

- The status tokens follow the same contract: `--success`, `--warning`, `--info`, `--attention`, and `--destructive` are fills, each paired with its own `--*-foreground`. A status *word* or *icon* on a neutral surface takes the hue's `--*-ink` token instead (see below), never the fill.

- The neutral surfaces (`--canvas`, `--inset`, `--field`, `--hover`, `--stripe`, `--selected`) have no `-foreground` of their own by design: the theme guarantees `--foreground` reads on every one of them, so a rule that sets one of them as `background-color` pairs it with `color: var(--foreground)` (or inherits it). `--tooltip` is the exception — it is the inverted surface and pairs with `--tooltip-foreground`.

- `--muted-foreground` must only be used on `--muted`, `--background`, or `--card` surfaces. Do not place it on `--primary`, `--accent`, or any other surface — contrast is not guaranteed.

- A rule that sets a semantic `background-color` also sets the paired `--*-foreground` as `color` **in the same rule**, once, at that surface's root. All children inherit the color — never re-declare on descendants what they already inherit.

- You would only redeclare background and color, if you make a nested surface that diverges from its parent — that is the sanctioned case for declaring both: `background-color: var(--card); color: var(--card-foreground);`, `--sidebar`/`--sidebar-foreground`, `--accent`/`--accent-foreground`, `--primary`/`--primary-foreground`, etc.

- Isolated-format roots do not repeat `background-color: var(--background); color: var(--foreground);` — `CardContainer` already provides that pairing.

- Nested component layout example. This is just an example for how different color pairing can be used.
  - Outer parent: `background-color: var(--background); color: var(--foreground);`
  - Nested grid of containers:  `background-color: var(--card); color: var(--card-foreground);`
  - Some of the secondary info over the parent or grid containers use: `color: var(--muted-foreground);`
  - Nested sidebar container: `background-color: var(--sidebar); color: var(--sidebar-foreground);`
  - Options for a box with special highlighted info:
    - `background-color: var(--accent); color: var(--accent-foreground);`
    - `background-color: var(--primary); color: var(--primary-foreground);`
    - `background-color: var(--secondary); color: var(--secondary-foreground);`

**Hue as ink.** When a word or mark must read *as* a hue on a neutral surface — a status label, a link, a colored icon — use the hue's ink token (`color: var(--success-ink)`, `color: var(--primary-ink)`) rather than the fill. Every fill has one (`--primary-ink`, `--secondary-ink`, `--accent-ink`, `--destructive-ink`, `--success-ink`, `--warning-ink`, `--info-ink`, `--attention-ink`). The default is the hue mixed 60% toward `--foreground`, so it darkens on light surfaces and lightens on dark ones, and a theme that sets only `--success` still gets a readable `--success-ink`. Ink tokens belong on `--background`, `--card`, and `--muted`; on a hue's own fill use its `--*-foreground`.

### Guaranteed Contrast Pairings

The theme owes you these pairings and nothing else. Stay inside them and no contrast check is needed:

- Every surface token with its own `--*-foreground`: `--background`/`--foreground`, `--card`/`--card-foreground`, `--popover`, `--primary`, `--secondary`, `--accent`, `--muted`, `--destructive`, `--success`, `--warning`, `--info`, `--attention`, `--tooltip`, and the `--sidebar-*` family.
- `--foreground` on any neutral surface: `--canvas`, `--inset`, `--field`, `--hover`, `--stripe`, `--selected`.
- `--foreground` on `--muted`. `--muted` does have its own `--muted-foreground`, but that pair reads as a disabled surface, so ordinary text on a muted well uses `--foreground` and the theme guarantees it.
- `--muted-foreground` on `--background`, `--card`, or `--muted`.
- Each `--*-ink` token on `--background`, `--card`, or `--muted`.

A pair outside this list — an accent token used as ink, a hand-picked combination, a `color-mix()` result, a foreground placed on a surface it was not paired with — has no guarantee behind it, and the theme is free to break it. Prefer restructuring onto a guaranteed pair over keeping the combination.

### `background-color`, Not `background`, for a Plain Color

When a rule sets only a color, write `background-color: var(--card)`, never `background: var(--card)`.

`background` is a shorthand for eight properties. Writing a bare color through it resets the other seven (`background-image`, `-size`, `-position`, `-repeat`, `-origin`, `-clip`, `-attachment`) to their initial values in the same declaration. That is rarely what a color change means, and the damage is silent: a hover rule that says `background: var(--hover)` wipes a gradient or a wallpaper image the resting state set; a parent's `:deep()` override that says `background: var(--card)` erases a child's `background-image`; a theme that later adds a texture to `--canvas` never shows through. It also blurs the pairing rule — the rule for a surface is "set the background color and its `-foreground` together", and `background-color` says exactly that.

Exceptions, where the shorthand is the right tool because you mean more than the color:

- You are setting an image or gradient: `background: linear-gradient(180deg, var(--muted), var(--accent));`, `background: url(...) center / cover no-repeat;`. Tokens still apply inside the gradient stops.
- You are setting several sub-properties at once and want them read as one declaration.
- You intend the reset: `background: none;` or `background: transparent;` to clear an inherited image *and* color together. Say so in a comment, because the next reader will assume it was a plain color.
- Inline `style=` attributes and JS style objects follow the same rule (`backgroundColor` in `Object.assign(el.style, …)`).

### Semi-transparent Colors on Themed Surfaces

Do not use `rgba()` values on themed backgrounds — they break with dark mode and custom themes. Use `color-mix()` to derive semi-transparent variants from semantic tokens:

- `rgba(255,255,255,0.25)` on primary background → `color-mix(in oklch, var(--primary-foreground) 25%, transparent)`
- `rgba(0,0,0,0.15)` dark overlay → `color-mix(in oklch, transparent, black 15%)`

The literal `black` there is deliberate, not an exception to the no-hardcoded-colors rule. A scrim's job is to darken whatever is behind it in *both* schemes; a token would flip with the theme (`--foreground` goes light in dark mode and would brighten the scrim). Pure black and pure white are the two colors with no theme meaning, so they are the right base for a darkening or lightening veil. Prefer the contract's ready-made tokens first — `--overlay` for a modal/drawer scrim and `--hover` for a pointer-hover veil — and reach for `color-mix(… black/white …)` only when neither fits.

### Spacing Tokens

**Important:** The `spacing` value set in the theme's `rootVariables` is multiplied by 4 at runtime to produce `--boxel-sp`. Set it accordingly — e.g. to get a 16px base unit, set `spacing: 0.25rem` (not `1rem`), because `0.25rem × 4 = 1rem = 16px`.

Do not copy a shadcn, Tailwind, or DESIGN.md base spacing value directly into Boxel `--spacing` without normalization. If the source system says the base spacing rhythm is `1rem`, Boxel usually wants `spacing: 0.25rem`.

All three options below are valid — choose based on whether you want spacing to respond to the linked theme:

#### For setting spacing, you have 3 options:

1- You can set hard coded values using rem units. **This means that spacing will not adjust to the theme's `--spacing` value.** This is useful when you want set spacing and you want the theme to only change the color-scheme or font-family.

2- You can use multiples of `var(--boxel-sp)` via css `calc`. Be aware that var(--boxel-sp) is always equal to 4 * var(--spacing). Example: `padding-top: calc(var(--boxel-sp) * 2);`. This is useful if you want the template spacing to readjust based on selected theme's spacing.

3- You can use boxel spacing variables. This is similar to number 2 above. The difference is that it uses boxel font scale ratio (1.333) to calculate the spacing scale.

**Note on `--spacing`:** Using `--spacing` directly is valid, but it's a single value. If you need a range of sizes, use the `--boxel-sp-*` scale — or derive your own variables with `calc(var(--spacing) * n)`.

The `--boxel-sp-*` ladder and its default values are listed in `skills/boxel-ui-guidelines/references/theme-token-contract.md`.

### Typography Tokens

As with spacing, you have the same three options for font sizes:

1. **Hardcoded rem** — fixed size, unaffected by the theme's base font size. Fine when you want full control.
2. **`--boxel-font-size-*` tokens** — scale with the theme's base font size.
3. **Semantic tokens** (`--boxel-heading-font-size` etc.) — scale with the theme and also carry role-based meaning.

Choose based on whether you want the text to respond to the linked theme.

**`font:` shorthand pitfall.** The composite `--boxel-font-*` tokens (`font: var(--boxel-font-sm);` etc.) bundle size/line-height *and* `--boxel-font-family` — the fixed IBM Plex stack. Using the shorthand therefore pins the Boxel family and stomps the theme's `--font-sans`. On themeable content, set the individual `font-size` / `font-weight` / `line-height` properties instead so the theme's family inherits. The shorthand stays valid where Boxel chrome styling is the intent — it's a deliberate theme opt-out, so judge each occurrence by intent, not mechanically.

**`--boxel-font-*` is not a size.** `font-size: var(--boxel-font-sm);` is invalid CSS and the declaration is dropped: `--boxel-font-sm` expands to `<size> / <line-height> <family>`, a value only the `font` shorthand accepts. The two correct forms are `font-size: var(--boxel-font-size-sm);` for themeable content, where the theme's family and line-height inherit, or `font: var(--boxel-font-sm);` where Boxel chrome styling is the intent. Never mix the two names.

#### Semantic typography variables

These are **in addition to** `--font-sans`, `--font-serif`, and `--font-mono`. Use them when styling text by semantic role (heading, section heading, subheading, body, caption, UI label, eyebrow). Use `--font-sans/serif/mono` only when referencing a generic font stack directly. The role tokens and the low-level size ladder are listed in `skills/boxel-ui-guidelines/references/theme-token-contract.md`.

These are good for isolated or embedded card views. The sizes might be too large for fitted card templates. Before declaring any of them, check what `CardContainer` already applies (body role on the root, heading roles on `h1`–`h3`, caption on `small`; see the contract reference) — most templates need no typography declarations at all.

**Note:**
- `--font-sans` is applied by `CardContainer` as the card's default family and every role's fallback, so there is no need to redeclare it.
- `--font-serif` has a default but the container applies it to nothing. For a serif voice, declare `font-family: var(--font-serif)` once at the highest element that needs it.
- `--font-mono` follows the theme only inside rendered Markdown. A bare `<code>` / `<pre>` in a template gets the fixed Boxel mono from the global stylesheet, so declare `font-family: var(--font-mono)` on those elements when they should match the theme.

Each role, including `label` and `eyebrow`, is a slot on the theme's `typography` field, so a theme can retune it; the `--boxel-*` names are what `CardContainer` publishes from those slots. Use the role's letter-spacing token rather than a hand-picked `--boxel-lsp-*` value when the text is in a themed template — an eyebrow's tracking is part of the theme's voice.

**Take the whole role group, don't assemble one.** When text needs a size *and* a matching line-height, use the tokens of its semantic role rather than reaching into the primitive ladder and hand-writing the pair — `font-size: var(--boxel-font-size-xs); line-height: calc(15 / 11);` should be `var(--boxel-caption-font-size)` + `var(--boxel-caption-line-height)`. The role group stays internally consistent and re-scales with the theme; a hand-computed `calc()` line-height silently stops matching the moment the theme's type scale changes.

### Border & Radius Tokens

`--radius` is valid for the base radius, but it's a single value. If you need a range of sizes, use the `--boxel-border-radius-*` scale (listed in `skills/boxel-ui-guidelines/references/theme-token-contract.md`) — or derive your own variables with `calc(var(--radius) * n)`. The scale is pre-built and re-scales with the theme's `radius` setting. `--boxel-border` / `--boxel-border-color` are fixed Boxel chrome values; themed content uses `1px solid var(--border)`.

### Shadow & Effects Tokens

Prefer the theme's shadow scale (`--shadow-2xs` … `--shadow-2xl`, plus `--shadow-inset` for sunken wells; see `skills/boxel-ui-guidelines/references/theme-token-contract.md`): it is part of the contract, so a theme can retune elevation and the template follows. `--boxel-box-shadow`, `--boxel-box-shadow-hover`, `--boxel-deep-box-shadow`, and `--boxel-transition` are fixed Boxel chrome values that do not respond to the theme.

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

/* Status — the fixed palette behind the themed status tokens. In a card, use
   --destructive / --success / --warning / --info / --attention (and their
   -foreground / -ink pairs) instead, so the theme can restyle them. */
var(--boxel-danger)
var(--boxel-danger-hover)
var(--boxel-success)
var(--boxel-warning)
```

### Tokens Outside the Contract

`StructuredTheme` has no slot for tokens the contract does not name, and the escape hatches (a `BrandGuide`'s `customCssVariables`, or an extended theme card definition) give up the boundary reset and the ability to switch theme cards. `skills/boxel-ui-guidelines/references/theme-token-contract.md` spells out the trade-off. In a template: map onto a named token wherever one is close enough, and when you must read a custom variable under a theme that may be swapped, give it a fallback once in a local variable on the component root (exemption 2 at the top of this reference).

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
