## What it is

The wrapper every control needs: a label bound to the control by id, and a **reserved message line** below it. Reach for it whenever you put an **Input**, **Textarea**, **Select** or **Switch** on a surface outside a **Form**. Inside a Form, use **FormField** instead — it does everything Field does _and_ subscribes to the form's issue store, so validation state arrives without being threaded through. Field is the standalone, uncontrolled-validation version; FormField is the form-aware one.

## The contract

```
@label?, @hint?, @error?
<:default as |controlId messageId|>
Element: HTMLDivElement
```

Two decisions carry the component.

**It mints the id and yields it.** `guidFor(this) + '-ctl'` goes on `<label for>` and is handed to the block, which passes it to the control's own id arg. Ownership of the association sits in exactly one place, and no control has to generate an id it might collide on. The cost is real and worth stating: **a control that takes no id arg cannot be labeled through this API at all** — which currently rules out `RadioGroup`, `Slider`, `Checkbox` and `Rating`.

**The message line is always there.** `.pretui-fieldmsg` is one line tall (1rem by default) whether or not there is anything to say. This is the kit's alignment law: two fields side by side never shift when an error appears on one of them. Every design system eventually learns this; most learn it after shipping the jump.

`@error` takes precedence over `@hint` — one line, error wins — rather than stacking both. That keeps the reserved height at exactly one line and forces the hint to be genuinely optional guidance rather than something the user needs while fixing an error.

## Prior art

**React Aria `useField`** is the reference: it generates label, description and error ids with `useSlotId` so they are `undefined` when the slot is empty (no dangling idrefs) and returns four prop bags. **Radix `Form`** goes further with `Field name` auto-associating label ↔ control ↔ message and `Message match` accepting native `ValidityState` matchers. **Web Awesome** has no field wrapper at all — each control owns `label` and `hint` as both props and slots, with `with-label`/`with-hint` booleans for SSR slot detection.

Pretui's yielded-id shape is closest to Radix's implicit association but explicit about it, which makes it obvious at the call site which control the label belongs to — useful when a "field" contains two controls.

Where Pretui is genuinely better than all three: **the invalid dress travels through the token channel.** `Field` sets `data-invalid` on itself, and its own stylesheet repoints `--border` and `--background` on any `.pretui-inputwrap` or `.pretui-boxelwrap` descendant. The default dress is a `--destructive-ink` edge with no tint, as on Input, Select and Autocomplete; a control can pick another by setting `--pretui-invalid-border` and `--pretui-invalid-background` on its wrapper. The inner boxel-ui control re-dresses itself; **no Pretui CSS reaches into boxel markup**, so a boxel-ui upgrade cannot break the error styling, and a theme can redefine what "invalid" looks like by changing one token. Compare the usual approach of threading an `isError` prop down through three components.

Where it is behind: no `aria-describedby` wiring (below), no required/optional marker of its own, and no support for grouped controls.

## Accessibility

No APG pattern — this is wiring, governed by WCAG **3.3.1 Error Identification**, **3.3.2 Labels or Instructions** and **4.1.2 Name, Role, Value**.

What works: `<label for={{controlId}}>` gives a real programmatic label, and clicking the label focuses the control.

Gaps, and they matter:

- **The hint and error are not wired to the control automatically.** The message line has an id, yielded as the block's second param, but Field sets no `aria-describedby`; the caller has to put it on the control. Without it, a screen-reader user hears the label and the control's value; the hint and the error text are floating content they may or may not encounter. React Aria's `useField` exists precisely to solve this, and it is the standard.
- **`@error` sets no `aria-invalid` on the control.** `data-invalid` drives the red dress and nothing else. Visually the field is clearly wrong; to assistive tech it is unremarkable. This is a direct 3.3.1 failure when Field is used standalone.
- Worth noting what the ecosystem has settled on: `aria-errormessage` is still poorly supported, and React Aria carries an explicit code comment that it uses `aria-describedby` for error text "because `aria-errormessage` is unsupported using VoiceOver or NVDA". If Field adds wiring, `aria-describedby` carrying both description and error ids is the shape to copy, with `aria-errormessage` added only additively.
- **Controls without a `@controlId` arg cannot be associated.** Wrapping a `RadioGroup` or `Slider` in a `Field` produces a visible label pointing at nothing — `for` references an id that no element has. That is worse than no label, because it looks correct in review.
- No `aria-required` and no required marker.

Use **FormField** for anything validated. Field is right for a labeled control on a settings panel, not for a form that reports errors.

## Theming

`--foreground` (label ink), `--muted-foreground` (hint ink, through Cue), `--destructive-ink` (error ink, through Cue, and an invalid control's edge), `--info-ink` / `--success-ink` / `--warning-ink` (`@status` ink by `@statusTone`, through Cue), `--field` (an invalid control's face), `--boxel-ui-label-*` (label), `--boxel-font-size-2xs` (messages, through Cue).

Repointed into descendants when invalid: on Input, Textarea and the other boxel-ui-wrapped controls, `--border` → `--destructive-ink` and `--background` → `--field`, matching Select and Autocomplete; and on the Field itself `--input` → `--destructive-ink`, which the select-type triggers draw their edge from. A Field whose control is disabled keeps the usual edges.

The row gap is `--boxel-sp-3xs`. The reserved message line's height is `--pretui-cue-line-height` (1rem by default): the flex row takes it as its `min-height` and the message Cue as its line-height, so setting it on an ancestor changes both. A `@status` or error shows its tone's glyph, so the tone isn't hue alone. A theme must keep `--muted-foreground` and `--destructive-ink` distinguishable at 11px — hint and error occupy the same slot, so the error's glyph, its weight (`--pretui-cue-emphasis-font-weight`, 500 by default) and its hue tell them apart.

The styles sit in `@layer PretComposite`, above Input's `PretComponent` layer, so what this component sets on Input wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.

## React ecosystem

shadcn `Field` / Aria Field. **FormField** is the form-kit wrapper.
Accept `errorMessage` / `description` string sugar.
