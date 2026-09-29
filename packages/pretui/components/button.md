## What it is

The kit's action primitive: a native `<button>` with a two-axis treatment system and a built-in busy state. Everything that performs an action is this, or wraps it: **IconButton** and **CopyButton** render a Button, and **ButtonGroup** arranges them. If the thing navigates rather than acts, pass `@href`: the Button renders a real `<a>` with the same treatment, because a `<button>` that only changes the URL lies to assistive tech. If you need a set of mutually exclusive choices styled as buttons, that is **SegmentedControl** (a selection, not an action).

## The contract

```
@tone?      'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'attention'
@appearance? 'accent' | 'filled' | 'outlined' | 'filled-outlined' | 'plain' | 'link'
@href?      renders an <a> instead of a <button>; @busy does not apply
@size?      'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm')
@busy?, @disabled?
@shape?     'rounded' | 'pill' | 'square'   (default 'rounded': the theme's --radius less 2px)
@variant?   single-axis alias resolved onto @tone × @appearance:
            primary|secondary|ghost|destructive|default|outline|outlined|subtle|filled|link
```

**Two axes, not a variant enum.** This is the kit's central control decision. `@tone` picks the hue and sets exactly two custom properties (`--pretui-tone`, `--pretui-tone-on`); `@appearance` picks the recipe and _reads_ those properties. Seven tones × five appearances is thirty-five looks from twelve CSS rules, and adding a tone is a two-line block. `@variant` is a lookup table into the same grid (`destructive` → `['danger','accent']`) — the single-axis spelling boxel-ui (`kind`) and shadcn callers pass.

**`@size` sets host `font-size` only.** Minimum height (`2.24em`, floored at 24px for `xs`), padding (`0.96em`), gap, spinner and radius are all `em`, so the whole control scales from one number and `m` stays pixel-identical to the pre-scale cut (2.24 × 12.5px = 28px). No per-size rule duplication, and a season can retune the scale by redefining `--pretui-size-*`.

**`@busy` blocks activation but keeps focus.** It sets `aria-disabled` rather than native `disabled`, swallows clicks (and so form submission) in a capture-phase listener, and never changes the button's width: the label fades out but keeps its space, and a busy layer on top shows the spinner with `@busyLabel` when both fit, otherwise the spinner beside the dimmed label when the button has room (a stretched or `min-width` button), otherwise the spinner alone. `@busyLabel` is always in the accessible name while busy, visible or not. One arg, not three.

## Prior art

**Web Awesome `wa-button`** has `variant` (neutral/brand/success/warning/danger) × `appearance` (accent/filled/outlined/plain) plus `size`, `pill`, `loading`, `caret`, `href` — Pretui's grid is directly descended from it, with `info`/`attention` added and a `filled-outlined` fifth recipe. **shadcn** ships a `cva` variant map (`default/destructive/outline/secondary/ghost/link` × `default/sm/lg/icon`) — a flat cross-product that grows multiplicatively. **React Spectrum** has `variant` × `style` (`fill`/`outline`) and `staticColor`, plus `isPending` with an announced loading state.

Where Pretui improves:

- **Tone is a token indirection, not a colour.** Because tones only write `--pretui-tone`/`--pretui-tone-on`, an appearance recipe is written once and works for every current _and future_ tone. shadcn's `cva` map has to enumerate each combination.
- **`color-mix` hover derivation.** Hover is `color-mix(in oklch, --foreground 10%, <bg>)` rather than a second hard-coded colour per variant, so a season that changes `--primary` gets a correct hover for free.
- **Uniform `em` sizing** (above) — Web Awesome and shadcn both restate padding/height per size.
- Per-instance escapes (`--pretui-button-h`, `--pretui-button-min-w`, `--pretui-button-px`, `--pretui-button-radius`, `--pretui-button-bg`, `--pretui-button-fg`) are custom properties, so a call site can deviate without `:deep()`.

Deliberately absent versus the field: no `caret`, no icon slots — icons are just children, and no `as`/`asChild` polymorphism (`@href` is the one alternate element). Links inside running text belong to a separate text-link component, not to `@appearance='link'`, which is for standalone actions.

## Accessibility

No APG pattern is required: this is a native `<button>`, or with `@href` a native `<a>`, which is the whole point. `type='button'` is set _before_ `...attributes`, so a call site can still pass `type="submit"` and win.

**Links.** `@href` renders `<a href>`, so middle-click, open-in-new-tab and the link role all work. `target`, `rel` and `download` pass through `...attributes`; pair `target='_blank'` with `rel='noopener noreferrer'`. A disabled link drops its `href`, takes `role="link"` with `aria-disabled="true"` so the state is still announced, and swallows clicks. Inside a card, a plain `href` is a full browser navigation: the host does not intercept it. To open a card in the stack, call `@context.actions.viewCard` (or the card's `viewCard`) from a click handler instead, or `preventDefault` in one if the element must stay a link.

**`@appearance='link'`** is underlined on hover and on keyboard focus only, which suits standalone actions. It is not a substitute for an underlined link inside a paragraph (WCAG 1.4.1 needs a cue besides color there).

Gaps worth knowing:

- **`@busy` keeps the button in the tab order**: `aria-disabled="true"`, never together with native `disabled`, the same choice as Spectrum's `isPending`. `@disabled` still uses native `disabled`; with both set, native wins.
- **The busy state reaches the accessible name only through the label.** Busy sets `aria-busy="true"`, which screen readers largely ignore on buttons, so a busy button should either say so visibly ("Saving…") or pass `@busyLabel`, which shows beside the spinner when it fits and is visually hidden otherwise. There is no default, because a label that already says it is busy would be announced twice ("Saving Loading"). The text node is always rendered and only filled while busy. Screen readers differ on whether they announce a name change on the focused control, so this still needs a pass with NVDA and VoiceOver.
- The spinner is `aria-hidden="true"` and slows down under `prefers-reduced-motion`, which also drops the press nudge.
- **Focus-visible paints its own ring**: `outline: 2px solid var(--ring)` with a 2px offset. How visible it is depends on the theme's `--ring` against the surface.
- **Forced colors**: every appearance keeps a 1px border (transparent until forced colors paints it), and disabled switches to `GrayText`.
- Disabled uses `opacity: 0.45`, which will fail contrast for label text in most seasons. That is conventional, and conventionally wrong.
- Icon-only usage must go through **IconButton**, which requires `@label` and applies it as `aria-label` _and_ `title`. A bare `<Button>` with only an icon child has no accessible name and nothing warns you.

## Theming

Tone tokens, all from the Boxel theme contract: `--primary`, `--destructive`, `--info`, `--success`, `--warning` and `--attention`, each with its `-foreground` pair, plus `--foreground`/`--background` for the neutral tone. Recipe tokens: `--background`, `--foreground`, `--border`, `--muted-foreground`, `--shadow-2xs`. Each appearance only sets `--pretui-btn-surface`, `--pretui-btn-text` and `--pretui-btn-edge` (plus `-hover` twins); one border carries the edge, so fill and edge move together on hover. Metrics: `--radius` (the `rounded` shape uses `calc(var(--radius) - 2px)`, so a button nests inside a card or dialog of the same radius; `pill` uses `--boxel-border-radius-pill`, `square` is 0, and `--pretui-button-radius` overrides any shape per instance), `--track-ui`, `--text-ui-xs|sm|md|lg|xl` under the `--pretui-size-xs|s|m|l|xl` override knobs, `--pretui-dur-snap`, `--pretui-ease-snap`.

The `accent` recipe paints the tone as the background and its `-foreground` as the text, so a theme that changes `--warning` should change `--warning-foreground` with it. `theme.css` defaults every pair, so a theme that sets neither still renders a readable button.

## React ecosystem

Button already accepts `@variant` as sugar. Agents will still emit the
shadcn CVA names and Aria pending flags.

| React agent                                                     | Pretui                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `variant=default\|destructive\|outline\|secondary\|ghost\|link` | @variant sugar → tone×appearance (have)                       |
| `size=sm\|default\|lg\|icon\|icon-sm`                           | `s`/`m`/`l` + **IconButton** for icon sizes                   |
| `isDisabled` / `disabled`                                       | @disabled — accept both                                       |
| `isPending` / `loading` / `isLoading`                           | @busy — prefer Aria pending (keep focus) over native disabled |
| `asChild` / `<a>` / `href`                                      | `@href` renders a real `<a>` — do not port Slot               |
| `variant=link`                                                  | `@variant='link'` → primary × `link`; add `@href` to navigate |
| `rounded-full` / `shape`                                        | `@shape='pill'` (`'rounded'` default, `'square'`)             |
| `type=submit`                                                   | ...attributes, already wins                                   |

- [x] Accept `sm`/`md`/`lg` as `@size` aliases.
- [x] Accept `isDisabled` / `isPending` / `loading`.
- [x] Move `@busy` from `disabled` to `aria-disabled` so focus is retained (`aria-busy` is already set).
