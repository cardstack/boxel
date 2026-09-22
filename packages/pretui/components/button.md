## What it is

The kit's action primitive: a native `<button>` with a two-axis treatment system and a built-in busy state. Everything that performs an action is this, or wraps it — **IconButton**, **CopyButton**, **ButtonGroup**, **FormFooter** and **ApprovalFooter** all render Buttons. If the thing navigates rather than acts, use an anchor; a Button that only changes the URL lies to assistive tech. If you need a set of mutually exclusive choices styled as buttons, that is **SegmentedControl** (a selection, not an action).

## The contract

```
@tone?      'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'attention'
@appearance? 'accent' | 'filled' | 'outlined' | 'filled-outlined' | 'plain'
@size?      'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm')
@busy?, @disabled?
@variant?   single-axis alias resolved onto @tone × @appearance:
            primary|secondary|ghost|destructive|default|outline|outlined|subtle|filled|link
```

**Two axes, not a variant enum.** This is the kit's central control decision. `@tone` picks the hue and sets exactly two custom properties (`--pretui-tone`, `--pretui-tone-on`); `@appearance` picks the recipe and _reads_ those properties. Seven tones × five appearances is thirty-five looks from twelve CSS rules, and adding a tone is a two-line block. `@variant` is a lookup table into the same grid (`destructive` → `['danger','accent']`) — the single-axis spelling boxel-ui (`kind`) and shadcn callers pass.

**`@size` sets host `font-size` only.** Height (`2.24em`), padding (`0.96em`), gap, spinner and radius are all `em`, so the whole control scales from one number and `m` stays pixel-identical to the pre-scale cut (2.24 × 12.5px = 28px). No per-size rule duplication, and a season can retune the scale by redefining `--pretui-size-*`.

**`@busy` implies disabled** and swaps in an inline spinner while dimming the label to 0.6. One arg, not three.

## Prior art

**Web Awesome `wa-button`** has `variant` (neutral/brand/success/warning/danger) × `appearance` (accent/filled/outlined/plain) plus `size`, `pill`, `loading`, `caret`, `href` — Pretui's grid is directly descended from it, with `info`/`attention` added and a `filled-outlined` fifth recipe. **shadcn** ships a `cva` variant map (`default/destructive/outline/secondary/ghost/link` × `default/sm/lg/icon`) — a flat cross-product that grows multiplicatively. **React Spectrum** has `variant` × `style` (`fill`/`outline`) and `staticColor`, plus `isPending` with an announced loading state.

Where Pretui improves:

- **Tone is a token indirection, not a colour.** Because tones only write `--pretui-tone`/`--pretui-tone-on`, an appearance recipe is written once and works for every current _and future_ tone. shadcn's `cva` map has to enumerate each combination.
- **`color-mix` hover derivation.** Hover is `color-mix(in oklch, --foreground 10%, <bg>)` rather than a second hard-coded colour per variant, so a season that changes `--primary` gets a correct hover for free.
- **Uniform `em` sizing** (above) — Web Awesome and shadcn both restate padding/height per size.
- Per-instance escapes (`--pretui-button-h`, `--pretui-button-px`, `--pretui-button-radius`, `--pretui-button-bg`, `--pretui-button-fg`) are custom properties, so a call site can deviate without `:deep()`.

Deliberately absent versus the field: no `href`/link rendering (use an anchor), no `pill`, no `caret`, no icon slots — icons are just children.

## Accessibility

No APG pattern is required: this is a native `<button>`, which is the whole point. `type='button'` is set _before_ `...attributes`, so a call site can still pass `type="submit"` and win.

Gaps worth knowing:

- **`@busy` sets the native `disabled` attribute**, which removes the button from the tab order. A user who tabbed to a button and pressed it loses focus to `<body>` for the duration. Spectrum's `isPending` deliberately uses `aria-disabled` instead so focus is retained. This is a real regression against best practice.
- **`@busy` sets `aria-busy="true"` but announces nothing.** A screen-reader user gets the state on the control and no live-region message; a visually-hidden live region would close that half.
- The spinner `<span>` is decorative and empty, so it contributes nothing to the accessible name — correct, though an explicit `aria-hidden="true"` would be more obviously intentional.
- **Focus-visible paints its own ring**: `outline: 2px solid var(--ring)` with a 2px offset, because the appearances' own `box-shadow` would otherwise hide the UA outline.
- Disabled uses `opacity: 0.45`, which will fail contrast for label text in most seasons. That is conventional, and conventionally wrong.
- Icon-only usage must go through **IconButton**, which requires `@label` and applies it as `aria-label` _and_ `title`. A bare `<Button>` with only an icon child has no accessible name and nothing warns you.

## Theming

Tone tokens: `--primary`/`--primary-foreground`, `--destructive`/`--destructive-foreground`, `--success`, `--warning`, `--pretui-info`, `--pretui-attention`, `--foreground`, plus the `--pretui-on-*` counterparts. Recipe tokens: `--card`, `--background`, `--border`, `--hover`, `--muted-foreground`, `--pretui-edge-highlight`, `--shadow-ink-mid`, `--pretui-shadow-control`. Metrics: `--radius`, `--track-ui`, `--text-ui-xs|sm|md|lg|xl` under the `--pretui-size-xs|s|m|l|xl` override knobs, `--pretui-dur-snap`, `--pretui-ease-snap`.

A season **must** define an on-colour for every tone it uses. The `accent` recipe paints `--pretui-tone` as the background and `--pretui-tone-on` as the ink; a season that sets `--warning` to a light amber without setting `--pretui-on-warning` gets white text on amber and fails contrast. That is the single most common season bug on this component.

## React ecosystem

Button already accepts `@variant` as sugar. Agents will still emit the
shadcn CVA names and Aria pending flags.

| React agent                                                     | Pretui                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `variant=default\|destructive\|outline\|secondary\|ghost\|link` | @variant sugar → tone×appearance (have)                       |
| `size=sm\|default\|lg\|icon\|icon-sm`                           | `s`/`m`/`l` + **IconButton** for icon sizes                   |
| `isDisabled` / `disabled`                                       | @disabled — accept both                                       |
| `isPending` / `loading` / `isLoading`                           | @busy — prefer Aria pending (keep focus) over native disabled |
| `asChild`                                                       | yield or an anchor — do not port Slot                         |
| `type=submit`                                                   | ...attributes, already wins                                   |

- [x] Accept `sm`/`md`/`lg` as `@size` aliases.
- [x] Accept `isDisabled` / `isPending` / `loading`.
- [ ] Move `@busy` from `disabled` to `aria-disabled` so focus is retained (`aria-busy` is already set).
