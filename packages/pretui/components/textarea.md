## What it is

Multi-line free text. Reach for it when the value is prose — a note, a description, a comment body. If the value is one line, use **Input**; if it is markdown or rich content the user should see rendered, use **Prose** for display and a Textarea for editing; if it is structured (a query, a rule), use **ExpressionBuilder** rather than asking someone to type syntax into a box.

## The contract

```
@value?, @placeholder?, @invalid?, @disabled?, @controlId?
@onInput?(value: string)
@helperText?, @errorMessage?, @required?, @optional?
```

Identical to **Input** minus its type arg, and that symmetry is deliberate: the two are interchangeable at a call site, so a **FormField** can swap one for the other without the surrounding code changing. `@onInput` receives the string, not the event; `@controlId` comes down from the labelling wrapper.

Like Input, it is a **retrofit on boxel-ui's `BoxelInput`** in its textarea mode, re-dressed through the token channel — the wrapper `<div>` redefines `--background`, `--border`, `--ring`, `--muted-foreground` and a set of `--boxel-*` knobs and the inner control restyles itself. No Pretui CSS reaches boxel markup.

The one thing worth knowing that Input does not have: **boxel-ui defines its `10rem` `--boxel-input-height` on the textarea element itself**, so the wrapper's custom-property channel cannot override it — an element-local definition beats an inherited one. The fix is a single inline `style` carrying the Pretui metrics: `--boxel-input-height: 64px`, `padding: 7px 9px`, `resize: vertical`. This is the concrete case that proves the channel's limit, and it is the reason the escape hatch exists at all.

`resize: vertical` is a decision, not a default. Horizontal resize breaks every grid layout it sits in; vertical does not.

## Prior art

**Web Awesome `wa-textarea`** carries `rows` (default 4), `resize` (`none|vertical|horizontal|both|auto`, where `auto` uses a width-only ResizeObserver), `with-count`, plus label/hint props _and_ slots. **React Spectrum `TextArea`** is `TextField` with a different element and inherits the whole `description`/`errorMessage`/`isInvalid` surface. **shadcn** is a styled `<textarea>`.

Pretui is smaller than Web Awesome on purpose — no `rows`, no auto-grow, no character counter — and the gap is honest rather than clever. Height is a fixed 64px minimum plus user resize.

The one detail worth stealing back: **`wa-textarea`'s character counter is `aria-hidden` and paired with a separate visually-hidden `aria-live="polite"` region debounced by a full second**, so the count is available to screen readers without narrating every keystroke. If Pretui adds `with-count`, that is the shape to copy.

Where Pretui is better than shadcn and comparable to Spectrum: the invalid dress travels through the token channel (`Field` sets `data-invalid`, which repoints `--border` and `--background` on the wrapper), so there is no `.error` class threaded through layers and a season can redefine what invalid looks like in one place.

## Accessibility

Native `<textarea>`; no APG pattern. `aria-invalid`, `aria-errormessage` and `aria-describedby` wiring comes from BoxelInput, as with Input.

Gaps, plainly:

- **`@invalid` and `@errorMessage` are independent args.** `@invalid` alone gives a red control that announces nothing; `@errorMessage` alone renders nothing, because the error row is gated on validation state. Pass both, or use **FormField**.
- **No accessible name of its own.** Outside `Field`/`FormField`, and without an explicit `aria-label`, the control is unnamed. A placeholder is not a label (and in a textarea it disappears the instant a character is typed, so it is worse here than on Input).
- No `rows` arg means the initial height cannot express expected length — a one-sentence field and a five-paragraph field look identical, which is a WCAG 3.3.2 _instructions_ smell even though it is not a failure.
- `@disabled` is the native attribute: out of the tab order, value not submitted. Use `readonly` via `...attributes` if you need focusable-but-fixed.
- `resize: vertical` is good for 1.4.4/1.4.10 reflow; verify the focus ring (`--ring`, default `--primary`) against 2.4.11 in dark seasons.

## Theming

`--field` (control face), `--input` (hairline), `--primary` (focus ring via `--ring`), `--ink-3` (placeholder ink, injected as a locally narrowed `--muted-foreground`), `--control-h`, `--radius`, `--text-ui-md`, `--text-ui-sm`, `--text-ui-xs`, `--track-ui`.

Forwarded into boxel-ui: `--boxel-form-control-height`, `--boxel-form-control-border-radius`, `--boxel-font-size-sm`, `--boxel-font-size-xs`, `--boxel-sp-xs`, `--boxel-sp-sm`, and — inline only — `--boxel-input-height`.

Note the asymmetry with Input: because the metrics ride an inline `style`, a season **cannot** retune textarea height or padding through tokens. That is the accepted cost of the boxel-ui retrofit and the one place a season will find itself blocked.
