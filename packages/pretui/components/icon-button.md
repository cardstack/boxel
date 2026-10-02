## What it is

A square **Button** carrying an icon instead of text, with a mandatory label. Use it in dense chrome where a word will not fit — toolbar affordances, row actions, panel headers, close buttons. If there is room for a word, use **Button**: an icon plus a label is comprehended faster than an icon alone by every measure, and the icon-only form is a space decision, not a clarity one. For a copy-to-clipboard affordance specifically, use **CopyButton**, which adds the confirm-state feedback.

## The contract

```
@label: string   (required)
@icon?: ComponentLike<{ Element: SVGSVGElement }>   (rendered before any block content)
@width?, @height?: string | number   (the @icon's size; default follows @size: 10 / 12 / 14 / 16 / 18 px)
@variant?: ButtonVariant   (default 'secondary'; the same spellings Button accepts)
@tone?, @appearance?   (forwarded to Button; they override @variant's axes)
@size?: 'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm', forwarded to Button)
@shape?: 'rounded' | 'pill' | 'square'   (forwarded to Button; 'pill' is a circle, since the button is square)
@href?: string   (renders an <a>; @busy and @pressed do not apply)
@pressed?: boolean   (toggle state as aria-pressed; leave undefined for a plain action)
@busy?, @loading?   (forwarded to Button)
@busyLabel?: string   (added after @label in the accessible name while busy)
@disabled?, @isDisabled?
<:default>   — the icon, when it is not passed as @icon
Element: HTMLButtonElement | HTMLAnchorElement
```

**`@label` is required, and it is the whole point of the component existing.** An icon-only `<Button>` has no accessible name and nothing warns you; `IconButton` makes the name non-optional at the type level and applies it as both `aria-label` and `title`. That is the single reason this is a separate export rather than a `size='icon'` variant.

**`@icon` takes an icon component, as boxel-ui's IconButton does**, and sizes it with `width`/`height` attributes so it has an intrinsic size before any stylesheet applies. `@width`/`@height` override that size, with the same meaning as on boxel-ui. Block content still works and renders after `@icon`, so a text glyph or an inline SVG needs no wrapper component.

The default variant is `secondary`, not `primary` — icon buttons are almost always secondary chrome, and defaulting the other way would fill toolbars with accent fills.

Sizing is one rule: `padding: 0; width: var(--pretui-button-h, 2.24em)`, the same em-scaled metric Button uses for its height, so the result is a square at every `@size`; at `xs` the width takes the same 24px floor as Button's height. The rules sit in `@layer PretComposite`, above Button's `PretComponent` layer, so they win by layer order rather than by stylesheet order. The rule targets `.pretui-iconbtn` directly: the class and this template's scope attribute both ride `...attributes` onto the composed Button's root element, so a plain compound selector is what matches it.

## Prior art

**Web Awesome** has no separate icon button: `wa-button` takes an icon child and **console-warns when an icon-only button has an unlabelled `wa-icon`** — a runtime nudge instead of a type-level requirement. **React Spectrum `ActionButton`** with `isQuiet` is the analogue, and Spectrum's convention is a `<Text>` child wrapped in a visually-hidden slot so the label is a real child rather than an attribute. **shadcn** uses `<Button size="icon">` and provides no label enforcement whatsoever — an `sr-only` span is left to the developer.

Pretui's improvement over both is small and real: **the label cannot be forgotten.** Web Awesome catches it at runtime in the console, shadcn does not catch it at all, and here it is a required arg. Making the mistake unrepresentable beats warning about it.

**`@tone` and `@appearance` are forwarded to Button**, so IconButton reaches the same seven tones and six appearances as Button, with `@variant` as the shorthand.

### Differences from boxel-ui IconButton

- **`@round` is `@shape='pill'`.** The button is square, so a pill is a circle.
- **`@variant` takes Pret UI Button's spellings**, not boxel-ui's `@kind` values. `primary-dark` and `text-only` have no direct equivalent; use `@tone`/`@appearance`.
- **`@size` is Pret UI's scale** (`xs`…`xl`, em-scaled), not boxel-ui's fixed `extra-small` / `small` / `base` / `tall` / `touch` heights.
- **No `--boxel-icon-button-*` knobs.** Size follows `--pretui-button-h`, and color follows Button's tone and appearance tokens.
- **`title` is set**, so a sighted mouse user gets a native tooltip that boxel-ui's IconButton does not show.

## Accessibility

Native `<button>`; no APG pattern needed. Space and Enter both activate.

What is right:

- `aria-label={{@label}}` gives the accessible name, and it is required.
- **The face is `aria-hidden`.** `aria-label` already names the button, so an icon that emits its own `<title>`, or a text glyph such as `✕`, is not read a second time.
- **`@pressed` sets `aria-pressed`** for a toggle (pin, favorite, bold). Per APG, a toggle's label must not change with its state, so `@label` stays fixed and `aria-pressed` carries the state. A pressed button takes a tint one step stronger than the `filled` appearance's, so the state shows on `outlined`, `plain` and `filled` alike, plus a forced-colors `Highlight` edge. An `accent` appearance has no stronger step to show it, so a toggle should use another appearance.
- **`@busy` keeps focus** (Button's `aria-disabled` treatment), and `@busyLabel` joins the accessible name, because `aria-label` hides Button's own busy text from it.

Gaps and cautions:

- **`title` is set to the same string as `aria-label`.** This is deliberate — it gives sighted mouse users a native tooltip — but it is a known double-announcement risk: some screen reader and browser combinations read the accessible name and then the `title` as a description. It is also a UA-controlled tooltip, which means no styling and, per WCAG 1.4.13's exception, no dismissible/hoverable obligation. If you want a styled hint, wrap in **Tooltip** and be aware you will then have three sources for one string.
- **Target size**: 28×28 CSS px at the default size clears WCAG 2.5.8's 24×24 minimum, but only just, and adjacent icon buttons in a toolbar with no gap will have touching targets.
- **Focus-visible ring inherited from Button**: `outline: 2px solid var(--ring)` with a 2px offset, which matters more here because there is no text to underline or shift.

## Theming

Everything comes from **Button**: `--pretui-tone`/`--pretui-tone-on` per variant, `--radius`, `--hover`, `--border`, `--pretui-edge-highlight`, `--shadow-ink-mid` — plus `--pretui-button-h` (default `2.24em`) for the square width.

A season retuning `--pretui-button-h` moves IconButton's width and Button's height together, so icon buttons stay square.
