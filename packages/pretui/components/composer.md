## What it is

The agent input: a growing text field with a mode switch, context chips, a send/stop control and a queue-aware placeholder.

## The contract

```
@value?, @defaultValue?, @onInput? — the draft
@onSend?       — fires on submit with the draft and the active mode
@modes?        — the modes offered; defaults to Ask / Act
@mode?, @defaultMode?, @onModeChange?
@attachments?  — context chips shown above the field
@onPin?        — promote an auto-attached chip to a pinned one
@onRemove?     — drop an attachment
@placeholder?  — overrides every derived placeholder
@queueCount?   — how many messages are already queued
@busy?         — a run is in flight: the send button becomes Stop
@onStop?
@sendLabel?, @stopLabel?
@label?        — accessible name for the field. Default 'Message the agent'
@rows?         — minimum visible rows before the field grows. Default 2
@submitOnEnter? — Enter submits, Shift+Enter inserts a newline. Default true
@disabled?     — the field, every action and the mode switch; yielded to <:tools>

<:tools as |disabled|> — extra controls in the action bar, left of the send button
```

**`@queueCount` rewrites the placeholder to say so, and that is the whole point of the arg.** A queue the reader cannot see is a message they think was sent.

**`@busy` turns Send into Stop** rather than disabling it — an in-flight run is something to interrupt, not a reason to take the control away.

**Every piece of state is controllable from outside.** Draft, mode and disclosure are held internally only until you pass the arg.

**Enter submits by default, Shift+Enter inserts a newline** — and `@submitOnEnter={{false}}` inverts it for a composer where multi-line is the norm.

## Prior art

The design-mirror JSX these descend from, and the Claude and Copilot composer surfaces behind it.

Where Pretui is better: **the mode note is a `role='status'`.** Upstream renders it as inert prose, so switching Ask→Act announces nothing — a change of what the agent will *do* with your message, conveyed only visually. Making it a live region is a small change that fixes a real silence.

Where it is thinner: no slash-command menu, no inline mention autocomplete, no draft persistence across unmount, and no file drop — attachments arrive as `@attachments`, they are not acquired here.

## Accessibility

- **The field is named**, defaulting to "Message the agent" rather than relying on a placeholder — a placeholder-named field loses its name on the first keystroke.
- **The mode note is announced.** Switching mode changes what will happen to the draft, and that is worth saying out loud.
- **Attachments are a named list** — "Attached context" — so the chips above the field are reachable and countable rather than being loose decoration.
- **The keyboard hint is `aria-hidden`.** It restates the Enter behaviour visually; announcing it on every focus would be noise.
- **`@queueCount` is an accessibility affordance as much as a visual one**, because the queue is otherwise invisible in every modality.
- **Stop replacing Send keeps one control in one place**, so a keyboard user interrupting a run does not have to go looking for a different button.

## Theming

The composer is built from the kit's **Button** and **SegmentedControl** and takes their shared recipe tokens rather than defining its own surface.

That is deliberate for a surface this prominent: a composer that themed independently would be the one part of an agent UI that did not follow a season, and it is the part people look at most.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
