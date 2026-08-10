# Shadcn Token Mapping in Boxel UI

Boxel uses shadcn-compatible semantic variables, but the values are consumed by Boxel UI components and the card container runtime. Treat the token names as contracts, not as raw brand swatches.

Official shadcn convention: semantic tokens come in background/foreground pairs. The base token controls a surface; the `-foreground` token controls text and icons on that surface.

Boxel runtime convention: `CardContainer` maps the theme's semantic tokens into Boxel component variables, including spacing, typography, radius, borders, and foreground color.

Sources to re-check when this model changes:

- Official shadcn theming docs: `https://ui.shadcn.com/docs/theming`
- Boxel card container mapping: `packages/boxel-ui/addon/src/components/card-container/index.gts`
- Boxel button, input, dropdown, tooltip, pill, icon-button, and progress components under `packages/boxel-ui/addon/src/components/`
- Structured theme variable descriptions: `packages/base/structured-theme-variables.gts`

## Hard Rules

- `--foreground` is the ordinary text color on `--background`.
- `--card-foreground`, `--popover-foreground`, and `--sidebar-foreground` are ordinary text colors only on their matching surfaces.
- `--primary`, `--secondary`, `--accent`, `--destructive`, `--sidebar-primary`, and `--sidebar-accent` are surface, action, hover, state, or indicator tokens. Do not use them as body copy or general foreground colors.
- Always set the paired foreground when setting a semantic surface: `--primary-foreground`, `--secondary-foreground`, `--accent-foreground`, `--destructive-foreground`, `--sidebar-primary-foreground`, and `--sidebar-accent-foreground`.
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
| `--border`, `--input`, `--ring` | Card boundaries, input borders, focus outlines, checkboxes, dropdown/tooltip frames. | `--border` cannot be invisible on `--background`; `--ring` must stand out on controls. |
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
- Link-like text: use `--foreground` or another readable foreground treatment, then add identity through underline, border, icon, or nearby `--primary` indicator.
- Icons, strokes, progress, and selection accents may use `--primary`, but check contrast against the actual surface.

If a BrandGuide maps `--primary` from `--brand-primary`, generate or explicitly set `--primary-foreground` for contrast. Do not assume the brand primary can carry text by itself.

## Audit Checklist

- [ ] Every semantic surface has its matching foreground value.
- [ ] `--primary`, `--secondary`, `--accent`, and `--destructive` are not assigned as ordinary text colors in template guidance.
- [ ] Bright brand colors are used as fills, indicators, or identity accents, not long-form text.
- [ ] `--foreground`, `--card-foreground`, `--popover-foreground`, and `--sidebar-foreground` are readable on their surfaces.
- [ ] `--muted-foreground` is readable for descriptions, placeholders, and metadata.
- [ ] `--border` is visible enough for Boxel's 1px frames and input outlines.
- [ ] `--ring` is visible on inputs, buttons, checkboxes, and menu rows.
- [ ] `rootVariables.spacing` is normalized through the Boxel `* 4` rule.
- [ ] `--radius` has been checked on buttons, inputs, dropdowns, card containers, and fitted card chrome.
- [ ] Dropdowns and tooltips remain themed when rendered through overlays.
