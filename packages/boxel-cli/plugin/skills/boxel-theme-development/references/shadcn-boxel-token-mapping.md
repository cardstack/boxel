# Shadcn Token Mapping in Boxel UI

Boxel uses shadcn-compatible semantic variables, but the values are consumed by Boxel UI components and the card container runtime. Treat the token names as contracts, not as raw brand swatches.

Official shadcn convention: semantic tokens come in background/foreground pairs. The base token controls a surface; the `-foreground` token controls text and icons on that surface.

Boxel runtime convention: `CardContainer` maps the theme's semantic tokens into Boxel component variables, including spacing, typography, radius, borders, and foreground color.

The token inventory itself lives in `skills/boxel-ui-guidelines/references/theme-token-contract.md`; this file covers how Boxel UI components consume each token and what that means for the values a theme author picks.

Sources to re-check when this model changes:

- Official shadcn theming docs: `https://ui.shadcn.com/docs/theming`
- The token contract and its defaults: `packages/boxel-ui/src/styles/theme.css`
- Boxel card container mapping: `packages/boxel-ui/src/components/card-container/index.gts`
- Boxel button, input, dropdown, tooltip, pill, icon-button, and progress components under `packages/boxel-ui/src/components/`
- Structured theme variable descriptions: `packages/base/structured-theme-variables.gts`

## Hard Rules

- `--foreground` is the ordinary text color on `--background`.
- `--card-foreground`, `--popover-foreground`, and `--sidebar-foreground` are ordinary text colors only on their matching surfaces.
- `--primary`, `--secondary`, `--accent`, `--destructive`, `--success`, `--warning`, `--info`, `--attention`, `--sidebar-primary`, and `--sidebar-accent` are surface, action, hover, state, or indicator tokens. Do not use them as body copy or general foreground colors.
- Always set the paired foreground when setting a semantic surface: `--primary-foreground`, `--secondary-foreground`, `--accent-foreground`, `--destructive-foreground`, `--success-foreground`, `--warning-foreground`, `--info-foreground`, `--attention-foreground`, `--sidebar-primary-foreground`, and `--sidebar-accent-foreground`.
- A hue used *as* ink on a neutral surface is a separate token: `--primary-ink`, `--success-ink`, etc. Each defaults to the hue mixed 60% toward `--foreground`, so setting only the fill yields a readable ink; set the ink explicitly only when the brand wants a specific text shade.
- The neutral surfaces `--canvas`, `--inset`, `--field`, `--hover`, `--stripe`, and `--selected` carry no `-foreground`: `--foreground` must read on all of them, so keep them close in lightness to `--background`. `--hover` should be translucent so it composes over any surface.
- Every token above has a `theme.css` default and is reset at each themed-card boundary; a theme only has to set what it changes. Tokens the contract does not name (motion, shape) need a `BrandGuide` (`customCssVariables`, `brandColorPalette`) or an extended theme card definition, and lose both guarantees: they leak into nested cards and vanish when a different theme card is linked.
- Boxel Teal and other bright brand colors may be valid `--primary` values, but they are often poor text colors on light surfaces. Put them behind text or use them for strokes/progress/selection only after checking contrast.
- `--spacing` is not the desired base gap directly. Boxel computes `--boxel-sp` from `calc(var(--spacing) * 4)`.

## Component Consumption

| Token group | Boxel UI usage | Theme authoring implication |
|---|---|---|
| `--background` / `--foreground` | Card container fallback surface and default component text. Inputs use these for normal input background and text. | Pick the readable app/card default pair first. Do not make `--foreground` a brand accent. |
| `--card` / `--card-foreground` | Card-like nested surfaces and content when templates choose a card surface. | Keep this close enough to `--background` for dense UI, with visible contrast against `--border`. |
| `--popover` / `--popover-foreground` | Floating overlays when templates/components choose popover semantics. | Define both so wormholed overlays remain themed outside the original card root. |
| `--primary` / `--primary-foreground` | Primary buttons, primary pills, selected states, checkbox checked fill, progress/highlight indicators, tooltip/dropdown primary variants. | `--primary` is an action fill/indicator. `--primary-foreground` must read on it. |
| `--secondary` / `--secondary-foreground` | Secondary buttons, secondary pills, tooltip/dropdown secondary variants. | Use a lower-emphasis fill with readable foreground. |
| `--accent` / `--accent-foreground` | Hover/highlight surfaces for default buttons, menu rows, ghost interactions, and accent panels. | It can be subtle, but `--accent-foreground` still needs readable contrast. |
| `--muted` / `--muted-foreground` | Muted surfaces, descriptions, placeholders, helper text, empty states. | `--muted-foreground` should be readable on `--background`, `--card`, and `--muted`; do not make it too pale. |
| `--destructive` / `--destructive-foreground` | Invalid states, destructive action surfaces, destructive tooltip/dropdown variants. | Keep destructive visible without overpowering normal error text. |
| `--success`, `--warning`, `--info`, `--attention` + `-foreground` | Status fills: badges, banners, pills, progress states. `--attention` is the "needs you" hue, distinct from warning and destructive. | Fills with readable paired foregrounds. Defaults come from the fixed Boxel status palette when unset. |
| `--*-ink` | Status words, links, and icons on neutral surfaces. | Usually leave at default (hue mixed toward `--foreground`); set only for a deliberate brand text shade, and check it on `--background`, `--card`, and `--muted`. |
| `--canvas`, `--inset`, `--field`, `--hover`, `--stripe`, `--selected`, `--tooltip` / `--tooltip-foreground` | Workspace ground, sunken wells, input backgrounds (Input, Select, Switch track pairs with `--input`), hover rows, zebra rows, selected rows, tooltip surface. | `--foreground` must read on every one but `--tooltip`, which is the inverted surface and needs its own foreground. |
| `--subtle-foreground` | Third ink step: timestamps, tertiary counts. | Fainter than `--muted-foreground` but still readable on `--background` and `--card`. |
| `--border`, `--border-strong`, `--input`, `--ring` | Card boundaries, emphasized dividers, input borders and unfilled control tracks, focus outlines, checkboxes, dropdown/tooltip frames. | `--border` cannot be invisible on `--background`; `--border-strong` is one visible step darker; `--ring` must stand out on controls. |
| `--control-height` | Height of inputs, selects, and buttons. | Default 2.5rem; change it with the type scale, not independently. |
| `--shadow-2xs` … `--shadow-2xl`, `--shadow-inset` | Elevation scale on cards, popovers, and sunken wells. | Set the composed scale; the `--shadow-x/y/blur/spread/opacity/color` primitives are stored for round-tripping and do not drive rendered shadows. |
| `--radius` | Card/container radius, form control radius, button radius through Boxel component variables. | Use one base radius that works for buttons and framed card chrome. |
| `--spacing` | Multiplied by 4 to produce `--boxel-sp`; Boxel spacing scale derives from that base. | Normalize incoming spacing scales before assigning the value. |
| `--font-sans`, `--theme-font-size`, typography slots | Card container sets Boxel font families, role sizes, line heights, weights, and tracking. | Use role tokens for display/body/caption behavior instead of ad hoc component text sizes. |

## Spacing Normalization

Boxel's themed container does this:

```css
--theme-spacing: calc(var(--spacing) * 4);
--boxel-spacing: var(--theme-spacing);
--boxel-sp: var(--boxel-spacing);
```

That means:

| Desired `--boxel-sp` base | Set Theme `rootVariables.spacing` to |
|---|---|
| 12px compact base | `0.1875rem` |
| 16px default base | `0.25rem` |
| 20px spacious base | `0.3125rem` |
| 24px editorial base | `0.375rem` |

Do not map a shadcn, Tailwind, or DESIGN.md `spacing.base: 1rem` directly to Boxel `--spacing`. In Boxel that produces `--boxel-sp: 4rem`, which makes controls and card layouts balloon.

Use `0.25rem` unless the source system has a strong reason to be more compact or more spacious. Then preview buttons, inputs, dropdowns, and at least one dense card layout.

## Primary Is Not Text

The historical failure mode is mapping a bright brand primary, such as light teal, into `--primary` and then using `color: var(--primary)` for labels, links, or body copy. That can be unreadable on `--background`.

Use these instead:

- Body/default text: `color: var(--foreground)`.
- Secondary text: `color: var(--muted-foreground)`.
- Text on primary buttons or selected states: `color: var(--primary-foreground)` with `background-color: var(--primary)`.
- Link-like text and status words on a neutral surface: `color: var(--primary-ink)` (or the matching `--*-ink`). The ink tokens default to the hue mixed 60% toward `--foreground`, so they read on `--background`, `--card`, and `--muted` in both schemes.
- Icons, strokes, and other marks follow the same pairing rule as text: on a neutral surface use `--primary-ink`, and on a `--primary` fill use `--primary-foreground`. `--primary` itself is a fill, not a foreground color; use it as a `background-color` or a filled indicator paired with `--primary-foreground`, never as `color`, `stroke`, or `fill` on its own.

If a BrandGuide maps `--primary` from `--brand-primary`, generate or explicitly set `--primary-foreground` for contrast. Do not assume the brand primary can carry text by itself.

## Audit Checklist

- [ ] Every semantic surface has its matching foreground value.
- [ ] `--primary`, `--secondary`, `--accent`, and `--destructive` are not assigned as ordinary text colors in template guidance.
- [ ] Bright brand colors are used as fills, indicators, or identity accents, not long-form text.
- [ ] `--foreground`, `--card-foreground`, `--popover-foreground`, and `--sidebar-foreground` are readable on their surfaces.
- [ ] `--muted-foreground` is readable for descriptions, placeholders, and metadata.
- [ ] `--border` is visible enough for Boxel's 1px frames and input outlines.
- [ ] `--ring` is visible on inputs, buttons, checkboxes, and menu rows.
- [ ] `--success`, `--warning`, `--info`, and `--attention` each have a readable `-foreground`, and their `-ink` defaults read on `--background` and `--card` in both schemes.
- [ ] `--foreground` reads on `--canvas`, `--inset`, `--field`, `--stripe`, and `--selected`; `--tooltip-foreground` reads on `--tooltip`.
- [ ] No custom variable (Brand Guide `customCssVariables`, palette names, or fields on an extended theme def) duplicates a named token, and every template reading one either only renders under that theme or carries a local fallback.
- [ ] `rootVariables.spacing` is normalized through the Boxel `* 4` rule.
- [ ] `--radius` has been checked on buttons, inputs, dropdowns, card containers, and fitted card chrome.
- [ ] Dropdowns and tooltips remain themed when rendered through overlays.
