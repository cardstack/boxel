## What it is

An immediate on/off. The distinction from **Checkbox** is not shape, it is _when the change lands_: a Switch takes effect the moment it is flipped, a Checkbox is a value collected and submitted. If your Switch sits above a Save button, it should have been a Checkbox. For one-of-many use **RadioGroup**; for a pressed/unpressed _action_ use a **Button** with `aria-pressed`.

## The contract

```
@checked?, @defaultChecked?, @disabled?, @controlId?
@onCheckedChange?(checked: boolean)
Element: HTMLButtonElement
```

Hybrid controlled/uncontrolled — `@checked ?? @internal`, with `@internal` written only when `@checked === undefined` — the same idiom as Checkbox, RadioGroup, Select, Tabs and Slider.

`@controlId` lands on the element so **Field**/**FormField** can wire `<label for>`. There is no label arg; the label is the wrapper's job, which keeps one owner for the association but means a bare Switch has no name (see below).

The implementation is a `<button role="switch">` rather than `<input type="checkbox" role="switch">`. That is the one decision worth questioning: the checkbox route keeps native `checked` state, form participation and the platform's own toggle semantics, and it is what React Aria and Web Awesome both do. The button route is simpler to style and is what Radix does. Neither is wrong; the button route just means form submission is entirely on the caller.

The `disabled` guard is doubled — the native `disabled` attribute _and_ an early return in `toggle` — which is belt-and-braces rather than redundant, since `...attributes` could in principle re-enable the element.

## Prior art

**APG Switch** is the pattern, and all three respected implementations follow it. **React Aria `useSwitch`** builds on `useToggle` and puts `role="switch"` on a real checkbox input. **Web Awesome `wa-switch`** likewise uses `<input type="checkbox" role="switch">`, and adds ArrowLeft/ArrowRight (RTL-aware) as toggle keys plus a `hint` prop and slot, with `setValue` → `null` when unchecked so unchecked switches submit nothing. **Radix `Switch`** is `Root` + `Thumb` with `checked`/`defaultChecked`/`onCheckedChange`, rendering a visually hidden native input for form participation.

Pretui is deliberately the smallest of the four. Where it is better: the thumb travel is a single `transform: translateX(12px)` transition on a `data-state` attribute with a `prefers-reduced-motion` opt-out, so the animation is CSS state rather than a JS-driven value, and the whole component has no runtime beyond the toggle handler.

Where it is behind:

- **No arrow-key toggling.** Web Awesome adds Left/Right, which is a small, real usability gain on a settings page.
- **No form participation.** Radix and Web Awesome both submit a value; Pretui submits nothing. `name`/`value` cannot be threaded because there is no input.
- **No hint/label slot**, no size axis, no invalid state.

## Accessibility

Governing pattern: APG **Switch**. `role="switch"` and `aria-checked` `'true'`/`'false'` are both present and correct — and notably `aria-checked` is never `'mixed'`, which the Switch pattern forbids (unlike Checkbox, where `mixed` is legal).

Keyboard: it is a native `<button>`, so **Space and Enter both activate**. APG requires Space and permits Enter, so this passes.

Gaps:

- **No accessible name of its own.** There is no `@label`, and the only content is an empty thumb `<span>`. A Switch outside `Field`/`FormField` and without an explicit `aria-label` is announced as "switch, off" with no indication of what it controls. This is the most likely real-world failure, because a Switch is visually self-evident and developers do not notice the omission.
- **`@disabled` uses the native attribute**, so a disabled switch leaves the tab order entirely and cannot be discovered by a keyboard user scanning a settings panel. `aria-disabled` would keep it readable.
- **`opacity: 0.45`** for disabled will fail contrast in most seasons.
- **No focus-visible ring is defined.** The track uses `background` and the thumb uses `box-shadow`; nothing paints `:focus-visible`, so the control relies on the UA outline around a 30×18 pill. Likely WCAG 2.4.7 failure.
- **Target size is 30×18 CSS px**, below the 24×24 minimum of WCAG 2.5.8 on the short axis. Wrapping it in a larger label row (which `Field` does) resolves it in practice, but a bare Switch in a table row does not.
- The label, if a wrapper supplies one, must not change with state — "Notifications", not "Notifications on". That is an APG requirement and a caller obligation.

## Theming

Track: `--pretui-control-border` (falling back to `--line-strong`) when off, `--primary` when on. Thumb: `--card` with `--shadow-ink-mid`. Pressed: `--pretui-shadow-inset`. Motion: `--pretui-dur-snap`, `--pretui-ease-snap`.

The 30×18 track, 14px thumb and 12px travel are fixed — there is no size axis, so a season cannot scale it alongside Button's `xs`–`xl`. That inconsistency is visible when a Switch sits next to an `xs` Button.

A season that sets `--primary` close in luminance to `--line-strong` makes on and off indistinguishable for anyone not perceiving hue; the thumb position is the only other cue, and it is subtle at this size.

## React ecosystem

Immediate on/off setting. **Toggle** is a pressed _button_ (toolbar).
**Checkbox** is a form value. Accept `isSelected` / `onSelectedChange`
as aliases of `@checked` / `@onChange`.
