## What it is

The kit's field-label voice, as a component: small-caps mono in `--muted-foreground`, the same treatment as **Panel**'s eyebrow, **DataGrid**'s column headers and **FormField**'s labels. Use it when you need that voice with the _right element_ — a `<label>` bound to a control, a `<legend>` for a fieldset, or a `<span>` for a caption with nothing to point at. If you are labelling a control inside a form, you almost certainly want **FormField**, which uses this internally and also owns the id wiring; reach for `Label` directly only when composing something the form territory does not cover.

## The contract

```
@tag? 'label' | 'span' | 'legend'   (default 'label')
@for?   — id of the control (label tag only)
<:default>
Element: HTMLElement
```

**Tag polymorphism is the whole component.** The three tags are the three a form label actually takes: `<label for>` for a real control, `<legend>` for a fieldset's group name, and `<span>` for a static display where there is nothing to bind to — which is exactly the `@static` case in **FormField**. Choosing the element rather than always emitting a `<label>` matters: a `<label>` with no `for` and no wrapped control is a lie that passes review, and a group name inside a `<div>` is not announced when you enter the group.

The implementation is deliberately three `if` branches rather than a dynamic-element helper. boxel-ui uses `(element @tag)`; Pretui enumerates, because there are exactly three valid tags and a closed set catches a typo at the type level rather than emitting `<lable>`.

## Prior art

**Radix `Label`** wraps `@radix-ui/react-label` and does one thing beyond a native label: it **prevents text selection on double-click**, since double-clicking a label to select its text is almost never what a user wanted next to a checkbox. **Web Awesome** has no label component at all — every control owns a `label` prop _and_ a `label` slot, with a `with-label` boolean for SSR slot detection. **React Aria `useField`** returns `labelProps` rather than a component, leaving the element to you. **shadcn** wraps Radix.

Pretui's tag polymorphism is the differentiator, and it comes from a real need: **FormField** renders the same visual label as a `<label for>` when editable and a `<span>` when static, and without a tag arg that would be two copies of the styling.

Where Pretui is behind Radix: **no double-click selection guard.** That is a genuinely good detail and it is one line.

Where it is behind Web Awesome's approach: nothing structural — Web Awesome's per-control labels are a different architecture (each control owns its label) with its own costs, and Pretui's separation of label from control is the more composable choice. But note the consequence: **a Label does not know whether its target exists.** `@for` pointing at a nonexistent id is silently broken, which is exactly the hole **Field** has with `RadioGroup` and `Slider`.

## Accessibility

No APG pattern; this is the wiring layer, governed by WCAG **1.3.1**, **3.3.2 Labels or Instructions** and **4.1.2**.

What is right: the three tags are the three correct elements, and `<legend>` in particular is available — most kits force you to reconstruct a group name with `aria-label`, which is less reliably announced than a real legend.

Gaps:

- **`@for` is not validated and not required.** A `<label>` with no `for` and no wrapped control has no association at all, and nothing warns. This is the most common way labels silently fail, and the component makes it easy — `@tag` defaults to `'label'`, so the _default_ usage is the one that needs `@for`.
- **`text-transform: uppercase` is a styling transform, not a content change**, so screen readers announce the underlying text — "Approver email", not "A P P R O V E R". That is correct. But note some readers spell out short all-caps _source_ strings, so keep the authored text in normal case and let CSS do the uppercasing, which this component's styling assumes.
- **11px at `--muted-foreground` with 0.08em tracking** is the kit's quietest label voice. Uppercase text at that size is measurably slower to read and harder for users with low vision — the tracking mitigates it, and it is a deliberate typographic choice, but it is at the edge of **WCAG 1.4.3** for `--muted-foreground` on `--card` and should be checked per season.
- **No required-indicator support.** **FormField** adds a visually-hidden "(required)" inside the label; a bare `Label` has no equivalent, so composing your own required field means reimplementing that.
- **No `aria-hidden` or decorative mode**, so a Label used purely as a visual caption still announces.
- Nothing is focusable; clicking a correctly-wired `<label>` focuses its control, which is the platform's behaviour and is preserved.

## Theming

`--font-mono`, `--text-ui-xs` (11px), `--track-eyebrow` (0.08em), `--muted-foreground`. Weight 500 and `line-height: 16px` are fixed.

Four tokens, and they are the same four that define the eyebrow voice in **Panel**, **Toolbar**, **DataGrid** and **FormField** — so a season retuning `--track-eyebrow` or `--text-ui-xs` moves all of them together, which is the intent. That coupling is the reason this exists as a component rather than as a utility class: there is one definition of what a label sounds like.

The `line-height: 16px` is a fixed pixel value rather than a ratio, so a season that scales `--text-ui-xs` up will get labels that clip or crowd. Worth changing to a unitless ratio.

## React ecosystem

shadcn/Radix/Aria `Label`. Keep the small-caps Pretui voice. Must
point at a control (`for` / `aria-labelledby`) — never a lone `<div>`.
