## What it is

A square **Button** carrying an icon instead of text, with a mandatory label. Use it in dense chrome where a word will not fit — toolbar affordances, row actions, panel headers, close buttons. If there is room for a word, use **Button**: an icon plus a label is comprehended faster than an icon alone by every measure, and the icon-only form is a space decision, not a clarity one. For a copy-to-clipboard affordance specifically, use **CopyButton**, which adds the confirm-state feedback.

## The contract

```
@label: string   (required)
@variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'   (default 'secondary')
@size?: 'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm', forwarded to Button)
@disabled?, @isDisabled?
<:default>   — the icon
Element: HTMLButtonElement
```

**`@label` is required, and it is the whole point of the component existing.** An icon-only `<Button>` has no accessible name and nothing warns you; `IconButton` makes the name non-optional at the type level and applies it as both `aria-label` and `title`. That is the single reason this is a separate export rather than a `size='icon'` variant.

The default variant is `secondary`, not `primary` — icon buttons are almost always secondary chrome, and defaulting the other way would fill toolbars with accent fills.

Sizing is one rule: `padding: 0; width: var(--pretui-button-h, 2.24em)`, the same em-scaled metric Button uses for its height, so the result is a square at every `@size`. The rule targets `.pretui-iconbtn` directly: the class and this template's scope attribute both ride `...attributes` onto the composed Button's root element, so a plain compound selector is what matches it.

## Prior art

**Web Awesome** has no separate icon button: `wa-button` takes an icon child and **console-warns when an icon-only button has an unlabelled `wa-icon`** — a runtime nudge instead of a type-level requirement. **React Spectrum `ActionButton`** with `isQuiet` is the analogue, and Spectrum's convention is a `<Text>` child wrapped in a visually-hidden slot so the label is a real child rather than an attribute. **shadcn** uses `<Button size="icon">` and provides no label enforcement whatsoever — an `sr-only` span is left to the developer.

Pretui's improvement over both is small and real: **the label cannot be forgotten.** Web Awesome catches it at runtime in the console, shadcn does not catch it at all, and here it is a required arg. Making the mistake unrepresentable beats warning about it.

The deliberate limitation versus the field: **`@variant` and `@size`, no `@tone`/`@appearance` axes.** The parent Button has seven tones and five appearances; IconButton exposes the four legacy variants. So there is no `warning`-toned icon button without dropping to `Button` and doing the square sizing yourself. That is an inconsistency in the control family rather than a considered restriction, and it is the obvious next version.

## Accessibility

Native `<button>`; no APG pattern needed. Space and Enter both activate.

What is right: `aria-label={{@label}}` gives the accessible name, and it is required.

Gaps and cautions:

- **`title` is set to the same string as `aria-label`.** This is deliberate — it gives sighted mouse users a native tooltip — but it is a known double-announcement risk: some screen reader and browser combinations read the accessible name and then the `title` as a description. It is also a UA-controlled tooltip, which means no styling and, per WCAG 1.4.13's exception, no dismissible/hoverable obligation. If you want a styled hint, wrap in **Tooltip** and be aware you will then have three sources for one string.
- **No `aria-pressed` support.** An icon button used as a toggle (bold, pin, favourite) has no way to report state; you would have to pass `aria-pressed` through `...attributes`, which works but is undiscoverable. APG is explicit that a toggle button's _label must not change with state_ — so `@label` stays fixed and `aria-pressed` carries the state. Worth a first-class arg.
- **No `@busy`.** Button has one; IconButton does not forward it, so there is no loading state on the most common place to need one (a row action that saves).
- **Target size**: 28×28 CSS px clears WCAG 2.5.8's 24×24 minimum, but only just, and adjacent icon buttons in a toolbar with no gap will have touching targets.
- **Focus-visible ring inherited from Button**: `outline: 2px solid var(--ring)` with a 2px offset, which matters more here because there is no text to underline or shift.
- The icon child itself should be `aria-hidden` or a `<title>`-less SVG; nothing enforces that, so an icon component that emits its own `<title>` will produce a doubled name.

## Theming

Everything comes from **Button** — `--pretui-tone`/`--pretui-tone-on` per variant, `--radius`, `--hover`, `--border`, `--pretui-edge-highlight`, `--shadow-ink-mid` — plus `--pretui-button-h` (default `2.24em`) for the square width.

A season retuning `--pretui-button-h` moves IconButton's width and Button's height together, so icon buttons stay square.
