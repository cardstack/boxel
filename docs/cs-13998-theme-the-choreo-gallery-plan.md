# CS-13998: Theme the Choreo gallery through the theme contract

## Goal

The gallery's palette lives in its theme card (`realm/theme.json`) instead of `ChoreoRoot`'s private custom properties. The gallery's rules read contract names wherever the contract has a slot. A theme card's tokens then reach the gallery's text, surfaces, accents and focus ring, and a Pret UI control rendered inside the gallery takes the gallery's colors with no per-component overrides.

## How the scheme switch keeps working

- `CardContainer` writes a linked theme's light and dark sets inside an `@scope` rule. That rule reapplies the light set at (0,2,0) to any `[data-theme]` element inside the card, and the dark set to any `[data-theme='dark']` element.
- `theme.css`'s `[data-theme='dark']` / `[data-theme='light']` blocks reach only (0,1,0). So on `ChoreoRoot`'s `.choreo-site[data-theme]`, the theme card's values win in both schemes.
- `lib/theme.ts` and the theme picker stay as they are.

## The theme card

`theme.json` becomes a `BrandGuide` (a `StructuredTheme` subclass). Its `rootVariables` hold the light set and its `darkModeVariables` the dark set.

| Gallery name                       | Contract slot                             |
| ---------------------------------- | ----------------------------------------- |
| `--bg-page`                        | `--background`                            |
| `--bg-elev`                        | `--card`                                  |
| `--bg`                             | `--canvas`                                |
| `--bg-well`                        | `--inset`                                 |
| `--ink`                            | `--foreground` (also `--card-foreground`) |
| `--ink-dim`                        | `--muted-foreground`                      |
| `--ink-faint`                      | `--subtle-foreground`                     |
| `--ember`                          | `--primary`                               |
| `--ember-ink`                      | `--primary-ink`                           |
| `--line` / `--line-strong`         | `--border` / `--border-strong`            |
| `--ring` (already a contract name) | `--ring`                                  |
| `--font` / `--font-mono`           | `--font-sans` / `--font-mono`             |

The names with no slot keep their gallery names, but the theme declares them now:

- **`brandColorPalette`** (one value in both schemes): `ember-hot`, `copper`, `iris`, `steel`, `teal`, `azure`, `mark-tail-dark`, `mark-orbit-dark`, `glow`.
- **`customCssVariables`** (a light and a dark value):
  - the other inks: `ink-soft`, `copper-ink`, `iris-ink`, `steel-ink`, `hot-ink`, `syn-string`;
  - surfaces: `bg-spot`, the playhead surfaces `ph-*`;
  - shadows and tints: `shadow-ink`, `shadow-a`, `surface-tint`;
  - the mark and gradient: `mark-tail`, `mark-orbit`, `gradient-tail`, `lightbox-ring`;
  - the display faces `font-display` and `font-display-alt`.
- **What stays on `ChoreoRoot`:** layout and motion constants (`--ease`, `--page`) and `--wash`, which is composed from the palette.
- **What goes away:**
  - The `rgba(var(--ink-rgb), a)` / `rgba(var(--bg-rgb), a)` triplets become `color-mix(in srgb, var(--foreground) a%, transparent)` and the matching `--canvas` mix. That way a theme's foreground reaches every hairline and tint as well.
  - `--eyebrow` goes: kickers read `--primary-ink` directly.

## Eyebrow role

- The theme's `typography.eyebrow` carries the hero kicker's type: Plex Mono, 11px, weight 400, 0.18em.
- Every kicker reads `--boxel-eyebrow-font-family`, `-font-weight`, `-font-size` and `-letter-spacing`.
- The smaller kickers keep their measured size and tracking as a ratio of the role, for example `calc(var(--boxel-eyebrow-font-size) * 10 / 11)`. A theme that changes the eyebrow scales every kicker with it, and today's render is unchanged.

## Steps

1. Rewrite `theme.json` as a `BrandGuide` with the values above, copied from `ChoreoRoot`'s current light and dark sets. These are the measured values that hold 4.5:1 for text in both schemes.
2. Strip the palette from `ChoreoRoot`. Rewrite references across `realm/` mechanically, matching only `var(--name)` with a `,` or `)` after the name, plus the string token names in `stages/inline-edit.gts`.
3. Read the eyebrow role at the ten kicker sites.
4. Update the docs that describe where the palette lives: the README's `theme.json` row, the `lib/theme.ts` comment and the `ChoreoRoot` doc comment.
5. Test, in `gallery.test.gts`:
   - Render the gallery with the theme card linked, in each scheme. The contract tokens a Pret UI control reads (`--foreground`, `--background`, `--card`, `--primary`, `--primary-ink`, `--ring`, …) resolve to the gallery's values on a control inside it. Pret UI itself can't render here: `boxel test`'s local mode doesn't mount the `@cardstack/pretui/` realm.
   - A second theme with a different `--foreground` and `--primary` repaints the gallery.
   - The theme's eyebrow role reaches the gallery.
6. `check-realm` fails on any card instance that doesn't link `theme.json`.

## Testing notes

- `boxel test realm` runs against a built host `dist/`, with no realm-server or Matrix stack.
- Lint with `pnpm lint` in `packages/choreo-gallery`; that includes `check-realm`.
- Check value parity by resolving every token of the old `ChoreoRoot` and of the new theme card in each scheme, and comparing them.
