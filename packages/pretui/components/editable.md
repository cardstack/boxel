## What it is

Text that reads as a value until it is a field. A name in a profile header, a title on a card, a caption under an image: the reader sees plain text, and the person who owns it clicks (or presses Enter on) that text and gets an **Input** in the same place. Enter commits, Escape puts the old value back, and leaving the field commits unless told otherwise.

It is one field. If a record has several of these and they should save together with an undo per field and a docked footer, that is **RecordDetail**, which is this pattern at form scale. If the value is always a field, use **Input** inside a **Field**. If it is a longer passage, there is no textarea mode here; **Textarea** in a Field is the honest choice.

## The contract

```
@value?             — controlled text; omit for the uncontrolled half
@defaultValue?      — uncontrolled seed
@label?             — what the value is ("Name"); spoken in the trigger's name
@placeholder?       — muted preview text while empty, and the field's placeholder
@disabled?          — the trigger is a disabled button; nothing opens
@editing?           — controlled edit state; omit and use @defaultEditing
@defaultEditing?    — start open (default false)
@onEditingChange?   — every open and close, with the requested state
@onSubmit?          — every commit, with the committed string
@onChange?          — only when the committed value differs (@onValueChange is the alias)
@onCancel?          — Escape, or blur with @submitOnBlur off
@submitOnBlur?      — leaving the field commits (default true); false restores
@selectOnFocus?     — select the whole value when the field opens (default true)
<:preview as |value|>  — replaces the plain text inside the trigger
```

Aliases: `@isDisabled` for `@disabled`, `@startWithEditView` for `@defaultEditing`.

**Two hybrid states, one component.** The value and the edit state are each controlled-or-uncontrolled independently, on the usual rule: with the arg undefined the component keeps its own state; with it set the component never moves itself and only reports through the callback. A parent that controls `@editing` can therefore hold the field closed (or open) regardless of what the user does, and `@onEditingChange` tells it what was asked for.

**Commit is not change.** `@onSubmit` fires on every commit, including one that left the text as it was; `@onChange` fires only when the committed value differs from the previous one. A consumer that autosaves listens to one, a consumer that counts edits listens to the other.

**The draft is private.** Typing changes nothing outside the component until Enter or blur. Escape discards the draft and fires `@onCancel`; the value the parent holds is never touched by a cancel.

**Focus returns on Enter and Escape.** When the field closes by either key, the trigger is rendered again and takes focus on that render. When it closes on blur, focus has already gone where the reader sent it and stays there. There is no timer anywhere in this component; the handoff rides the render.

**Every opening is a fresh session.** The trigger, a parent setting `@editing`, and `@defaultEditing` all start the field from the current value, so a controlled `@editing` can open and close any number of times. A field the parent holds open stays in its session: every Enter, Escape and blur is reported again.

**Enter during IME composition does not commit.** The Enter that confirms a candidate belongs to the input method.

## Prior art

**Chakra `Editable`** is the reference shape: `EditablePreview`, `EditableInput` (or `EditableTextarea`), optional `EditableControls` with edit / submit / cancel buttons, and the `value` / `defaultValue` / `onChange` / `onSubmit` / `onCancel` / `submitOnBlur` / `startWithEditView` / `selectAllOnFocus` props. This component takes the same names where it has the same thing, so a port from Chakra mostly renames the tag. **SLDS inline edit** renders the static value as a non-interactive element and hangs a separate pencil button beside it, so the value itself does nothing and a field costs two tab stops; it has no Escape path. **Ant `Typography` with `editable`** is the same idea attached to a text component, with an explicit pencil icon as the only entry.

Where this is better: **the value is the button.** Clicking anywhere on the text opens the field, the field is one tab stop, and the button's name says both what it is and what it currently holds, so a screen reader hears "Edit Name, currently Ada" rather than an unlabelled pencil. Escape exists and returns focus. The pencil is a hover and focus affordance, not the target.

Where it is thinner, plainly: **no inline confirm and cancel controls**, so a pointer user's only cancel path is not there; Escape is keyboard-only and blur commits by default. **No textarea mode**, so a multi-line value does not fit. **No `isPreviewFocusable={false}`**: the preview is always the focusable trigger, which is the accessible choice and also the only one offered. The field is **Input** and nothing else, so `@type`, helper text and validation are not reachable through this component.

## Accessibility

No APG pattern names this exactly; it is a **button** that discloses an **input** in the same place, and both halves are native.

- **The trigger is a `<button type="button">`** with `aria-label` built from `@label` and the value: "Edit Name, currently Ada", or "Edit Name, empty" when there is nothing yet. That name is what makes the component legible to a screen reader; the visible text alone would read as a stray word.
- **Omitting `@label` is the caller's failure.** The name degrades to "Edit, currently Ada", which says what the button does but not what the value is. Pass the label.
- **The field is named too**: `@label` lands as `aria-label` on the input, so the person who opened it is told what they are editing.
- **Focus is managed once, on close.** Opening focuses the input and selects its text (unless `@selectOnFocus` is off); closing renders the trigger and focuses it. Nothing else moves focus, and nothing is timed.
- **Enter and Escape are handled on the field**, with the default prevented so an enclosing form does not submit on Enter and a dialog does not close on Escape.
- **Disabled is the native attribute** on the trigger: it leaves the tab order and announces as dimmed. A disabled Editable is therefore not reachable at all, which is right for a value that cannot be changed; if it should still be readable by keyboard, render the text and not this component.
- **The pencil is decorative** (`aria-hidden`) and appears on hover and focus only; nothing depends on seeing it.
- Since the trigger is a button, the preview block must not contain another interactive element: a link inside the preview is a nested-interactive failure, and it is the caller's to avoid.

## Theming

Read from the host theme: `--hover` and `--border` (the trigger's hover surface and hairline), `--ring` (the focus outline), `--radius`, `--muted-foreground` (the empty-state placeholder and the pencil). Hoisted once on the root as internal variables: `--control-h` (the trigger's minimum height, so the text does not jump when the field opens), `--text-ui-md`, `--space-2`, `--track-ui`, and `--pretui-dur-snap` / `--pretui-ease-snap` for the hover transition.

The trigger paints nothing at rest, so it inherits the surface and ink it sits on; hover adds the `--hover` fill and a `--border` hairline so the text reads as editable. The open field is **Input**'s dress entirely, so a season that retunes Input retunes this. Fixed here: the 0.75rem pencil and its hover-only opacity.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types | Give them |
| --- | --- |
| Chakra `Editable` + `EditablePreview` + `EditableInput` | this component; the preview and input are built in |
| `EditableControls` (submit / cancel buttons) | not offered; Enter, Escape and blur are the paths |
| `EditableTextarea` | **Textarea** in a **Field** |
| `startWithEditView`, `selectAllOnFocus`, `submitOnBlur` | `@startWithEditView` (or `@defaultEditing`), `@selectOnFocus`, `@submitOnBlur` |
| `isPreviewFocusable`, `isDisabled` | always focusable; `@isDisabled` or `@disabled` |
| SLDS inline edit, Ant `Typography editable` | this component |
| a whole record of inline edits with save / undo | **RecordDetail** |
