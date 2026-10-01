## What it is

Ant's inline "are you sure?": a small confirm bubble anchored to the control it guards, with a question, an optional line of detail and two buttons. Use it when the object of the verb is the thing you just clicked and it is still on screen — deleting *this* row, revoking *this* key, unpublishing *this* draft. The bubble points at the object, so the question needs no noun, and the page never went away, so the whole exchange feels reversible.

Reach for **AlertDialog** instead when the consequence is not visible from where the click happened, needs more than a line to state, spans more than one object, or is genuinely irreversible; a modal earns its interruption by forcing the reader to stop. The tell that a Popconfirm should have been an AlertDialog is wanting a third paragraph, a checkbox, or a type-the-name-to-confirm field inside it. **Popover** is the free-form version with no buttons and no answer; **Tooltip** is a string and never asks anything.

## The contract

```
@open? @defaultOpen? @onOpenChange?          — the overlay contract
@title? @description?                        — the question and one line under it
@confirmLabel? @cancelLabel?                 — default 'Yes' / 'No'
@okText? @cancelText?                        — Ant's names, accepted as aliases
@tone? (default 'danger')                    — the confirm button's tone
@placement? (default 'top') @distance? (6)   — through the shared Popup
@showCancel? (default true)
@disabled? @busy?
@label?                                      — accessible name; falls back to @title, then 'Confirm'
@onConfirm? @onCancel?
<:trigger as |open toggle|>                  — the control that asks
<:default>                                   — replaces the title/description body
<:footer as |confirm cancel|>                — replaces both buttons
```

**The trigger block owns the control.** Whatever focusable element it contains is found and given the disclosure contract — `aria-haspopup='dialog'` and a live `aria-expanded` — and both are restored on teardown, so the caller's element is left exactly as it was found. The block yields `open` and `toggle`; wire `toggle` to a click and the rest is handled.

**Ant's names work.** `@okText` and `@cancelText` are what an agent trained on Ant will type, and they resolve to the same labels as `@confirmLabel` and `@cancelLabel`; the Pretui names win when both are given. The defaults are the bare "Yes" / "No", which is the one place a bare yes/no is right: the question is one line and the object is on screen.

**Busy holds the bubble open.** While `@busy` the confirm button is `aria-busy` and a further confirm is refused; the bubble closes itself after `@onConfirm` only if `@busy` is still off, so a caller that turns it on from `@onConfirm` keeps the bubble open until it closes it. `@disabled` makes `toggle` inert without removing the trigger.

**Outside clicks are not swallowed.** Dismissal is a document `pointerdown` listener rather than a covering backdrop, so closing the bubble to press a button behind it takes one press, not two.

## Prior art

**Ant Popconfirm** is the API this answers to: `title`, `description`, `onConfirm`, `onCancel`, `okText`, `cancelText`, `okType`, `showCancel`, `placement`, `disabled`, and `okButtonProps={{ loading }}`. Every one of those has a direct equivalent here, most under the same name. **Mantine** has no Popconfirm and documents a Popover with two Buttons; **Chakra** the same, as a Popover-plus-Dialog hybrid; **shadcn** has none and reaches for AlertDialog. Ant is right that this is a distinct instrument, and its sibling page in the usage gallery shows why: same verb, same object, two very different amounts of ceremony.

Where this is better than Ant: **the accessibility is real.** Ant's Popconfirm gives the trigger no ARIA at all and the bubble is not a dialog, so a screen-reader user is told nothing about the bubble that just appeared. Here the trigger carries the disclosure contract, the bubble is a `role='dialog'` named by its question, focus moves into it on open and back to the trigger on every dismissal path, and Escape is taken in the capture phase so a host listening for the same key cannot act on the same press. The positioning is also shared: `@placement` goes through the same `Popup` primitive Popover and Menu use, so the bubble flips and shifts near a viewport edge for free.

Where it is thinner: **click only.** Ant's `trigger='hover'` is not offered, deliberately — a confirm that opens on hover is a footgun. There is no `icon` arg; the warning mark is fixed. `@tone` is the kit's tone set rather than Ant's `okType` button-type enum, and there is no `okButtonProps` pass-through: the footer block is the escape hatch when the two buttons need to be something else.

## Accessibility

Governing pattern: APG **Dialog (Non-Modal)** for the bubble, with the **Disclosure** contract on the trigger.

What the component does, and the tests assert:

- **The trigger's control gets `aria-haspopup='dialog'` and `aria-expanded`**, applied to the focusable element inside the trigger block, and removed again on teardown. A pre-existing `aria-haspopup` is put back rather than dropped.
- **The bubble is `role='dialog'`** with `aria-label` from `@label`, else `@title`, else `'Confirm'`. Always give it a question; a bubble labelled "Confirm" in a page with three of them is not helpful.
- **Focus lands on Cancel when it opens.** Cancel is the safe choice, so it takes the opening focus; with `@showCancel={{false}}` the confirm button takes it instead, so there is never an opening state where focus is nowhere.
- **Every dismissal returns focus to the trigger**: confirm, cancel, and Escape all route through the same path. An outside click closes without moving focus, because the reader's pointer is already somewhere else.
- **Escape cancels**, taken in the capture phase on the document while the bubble is open, and it runs `@onCancel` — the two dismissals are not distinguished.
- **The warning mark is `aria-hidden`.** It is decoration; the question carries the meaning.

The caller's part: put a real control in the trigger block. The contract is applied to the first focusable element found there, and a bare `<span>` gets it applied to the wrapper, which is announced as nothing. Keep `@title` a question that stands alone, since it is also the dialog's name. And do not make the confirm depend on colour: `@tone` tints the button, the label says what it does.

## Theming

Read directly: `--popover` and `--popover-foreground` (the bubble), `--radius-surface`, `--space-2`, `--space-3`, `--space-4`, `--font-sans`, `--text-ui-md` and `--text-ui-sm`, `--muted-foreground` (the description line), `--warning` and `--pretui-on-warning` (the mark), `--pretui-shadow-overlay`, and the enter motion pair `--pretui-dur-enter` / `--pretui-ease-enter`.

One knob of its own: `--pretui-popconfirm-max-width` (default `min(280px, 100vw - 16px)`). The buttons are the kit's **Button** at size `s`, so they take the season's control tokens through it; the confirm's colour is whatever `@tone` resolves to in the season.

Entry motion is `@starting-style` (opacity plus a 0.97 scale, 180ms) with a `prefers-reduced-motion` opt-out. The 15px warning disc and its 9px glyph are fixed.

## React ecosystem

| Agent types | Give them |
| --- | --- |
| Ant `title` / `description` | `@title` / `@description` |
| Ant `onConfirm` / `onCancel` | same |
| Ant `okText` / `cancelText` | accepted as-is (aliases of `@confirmLabel` / `@cancelLabel`) |
| Ant `okType='danger'` | `@tone='danger'` — the default |
| Ant `showCancel` / `placement` / `disabled` | same |
| Ant `okButtonProps={{ loading }}` | `@busy` |
| Ant `trigger='hover'` | not offered; click only |
| shadcn / Chakra "Popover + two buttons" | this tile |
| anything needing a paragraph or a field | **AlertDialog** |
