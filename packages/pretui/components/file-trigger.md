## What it is

A file-picker button with the `<input type='file'>` encapsulated inside it — so a caller gets a real button, styled like every other button in the kit, without ever touching a file input's unstyleable chrome.

For a drop target as well as a button, that is **Dropzone**. For a single slot that previews what landed, **AssetWell**.

## The contract

```
@accept?    — an <input accept> list; filters the picker AND, when this trigger
              sits inside a Dropzone, the drop path
@multiple?  — allow selecting more than one file
@directory? — pick a whole directory (webkitdirectory)
@capture?   — 'user' | 'environment'; ask a mobile camera rather than the library
@label?     — the button's text, and the encapsulated input's accessible name
@disabled?
@tone?, @appearance?, @size? — forwarded to the default Button
@onSelect?  — receives the chosen files. Never called with an empty list

<:default> — replaces the default button entirely; yields an api with open()
```

**`@accept` reaches the drop path too** when the trigger sits inside a **Dropzone**, so one declaration screens both.

**`@directory` degrades rather than failing.** Support is uneven; where it is unsupported the button still opens a normal picker.

**`@onSelect` is never called with an empty list** — a cancelled picker is silence, not an empty batch.

**Supplying `<:default>` is the only supported way to change the trigger.** The button is a slot, not a set of strings, so a caller who needs a different control renders it and wires `api.open` rather than hunting for a styling arg.

## Prior art

**React Spectrum's FileTrigger**, which established the encapsulated-input pattern.

Where Pretui is better: the default button is the kit's **Button**, with its tone, appearance and size axes forwarded — so a file trigger sits correctly beside the other buttons in a toolbar without any custom styling. And the block yields an API rather than expecting the caller to find the input, which means a custom trigger is a normal component with a click handler.

Where it is thinner: no drag support of its own — that is Dropzone — no file screening beyond `@accept`, so size and count limits are the caller's, and no progress or result state; this component's job ends when it hands you the files.

## Accessibility

- **The input is encapsulated and `tabindex='-1'`**, so it never becomes a second tab stop beside the button that operates it.
- **`@label` names both the button and the input**, so the two never disagree about what the control is for.
- **The button is a real button.** Activating a file picker is one of the few places where a native control's behaviour genuinely cannot be re-implemented — the picker only opens from a trusted activation — which is why the pattern encapsulates rather than replaces.
- **A custom `<:default>` inherits the responsibility for naming itself.** The yielded `open` gives it the behaviour; the accessible name is the caller's.
- **`@disabled` dims and inerts the trigger** rather than leaving a button that opens a picker whose result is ignored.

## Theming

`--pretui-dropzone-glyph-size`, `--pretui-dropzone-transition` and `--pretui-shadow-hairline` are shared with **Dropzone** in the same module; the button itself resolves through the kit's shared recipe system from `@tone`, `@appearance` and `@size`.

Sharing the dropzone tokens matters when the trigger sits inside a zone: the two are one control to the reader, and a trigger that transitioned on a different curve from the zone around it would read as a button pasted on top rather than as part of the surface.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
