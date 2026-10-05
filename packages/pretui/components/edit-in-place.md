## What it is

A displayed value that becomes an editable field, then commits or cancels.

Use it where a value is usually read and occasionally changed — a title, a note, a field on a record detail. For a value that is always being edited, use the field directly.

## The contract

```
@value?            — the committed value
@label (required)  — the field's name
@placeholder?      — shown, muted, when the value is empty. Default 'Empty'
@editing?, @defaultEditing?, @onEditingChange? — controlled / uncontrolled mode
@onCommit?         — fires with the draft; RETURN FALSE to refuse and stay in edit mode
@onCancel?         — fires on Escape or an explicit Cancel
@onDraftChange?    — live draft channel, for a caller mirroring the draft elsewhere
@invalid?, @error? — rejected state and the message under the editor
@canEdit?          — not editable: renders the display content bare, with no chrome
@activateOn?       — 'row' also activates on a click in the display. Never the only path
@commitOn?         — 'blur' (default) commits on leaving; 'action' renders Save / Cancel
                     and ignores blur
@multiline?        — Enter inserts a newline; ⌘/Ctrl-Enter commits
@announce?         — announce the mode change politely. Default true
@saveLabel?, @cancelLabel?

<:display> — the resting presentation; any content, never wrapped in a control
<:editor>  — the editor, receiving a draft api. Omit for a Pretui Input
```

**Returning `false` from `@onCommit` refuses the commit and stays in edit mode.** That is the honest way for a caller to reject a value without a validation framework — the draft is not lost and the reader is not ejected.

**`@label` is required** because an unnamed in-place editor is an unnamed editor: it supplies both the visually-hidden label and the trigger's name.

**`@activateOn='row'` is pointer convenience and never the only path.** There is always a real trigger; click-the-text is an addition to it.

**`@commitOn='action'` ignores blur entirely.** Commit-on-blur is right for a quick title edit and wrong for anything a reader might tab out of to check something.

**`<:display>` is never wrapped in a control**, which is what lets arbitrary content — a chip, a link, a formatted value — be the resting state without nesting interactives.

## Prior art

**boxel-catalog's blog-app editable-field.**

Where Pretui is better: the refusal path, the explicit commit mode, and the display block not being wrapped in a button — the source wrapped its display content, which made a link inside it unreachable.

Where it is thinner: no optimistic state, no undo after commit, and no draft persistence across unmount — cancel means the draft is gone.

## Accessibility

- **The mode change is announced politely by default.** Moving from reading to editing is a change a screen-reader user cannot see, and silence is the common failure.
- **There is always a real trigger**, so entering edit mode never depends on clicking text.
- **`@error` is announced and referenced by `aria-describedby`**, so a refusal is both heard and located.
- **Escape cancels**, and `@commitOn='action'` gives an explicit Cancel for readers who do not use it.
- **`@multiline` changes what Enter means**, and says so: Enter inserts a newline, ⌘/Ctrl-Enter commits. A multiline editor that commits on Enter is unusable.
- **`@canEdit={{false}}` renders the display bare, with no chrome at all** — not a disabled control, just the value, which is what a read-only row should be.

## Theming

`--pretui-destructive-ink` for the rejected state, `--pretui-radius-encroach` for the editor's fit against the display box, and the shared `--pretui-dur-snap` / `--pretui-ease-snap` for the mode transition.

`--pretui-radius-encroach` is the detail that makes the swap look deliberate: the editor has to sit inside the space the display occupied without the corners disagreeing, and a shared encroachment value is what keeps that consistent across every in-place editor in a season.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
