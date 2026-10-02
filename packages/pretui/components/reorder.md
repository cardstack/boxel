## What it is

A list whose rows can be moved, by drag **and** by keyboard, with every move announced.

## The contract

```
@items (required) — the list, in its current order. Reorder never mutates it
@keyFor?     — a stable key per item. Defaults to the index
@labelFor?   — the row's name, used for the handle's name and every announcement
@onReorder?  — receives the reordered list plus where the row came from and went.
               Called once per completed move, never during one
@label?      — accessible name for the list
@disabled?   — dimmed; neither pointer nor keyboard can move a row
@handleVerb? — verb prefixed to each handle's accessible name. Default 'Reorder'
```

**`@keyFor` matters more than it looks.** Without a stable key, moving a row re-creates every row after it and **focus is lost mid-drag**. The index default is correct only for a list whose members never change identity — which is to say, rarely.

**`@onReorder` is called once per completed move, never during one.** A caller is never handed an intermediate order.

**The component never mutates `@items`.** The list is the caller's; the component reports where a row should go.

## Prior art

The drag-and-drop list every kit ships, and the reason this one exists: almost none of them have a keyboard path. A drag handle with no key contract is a feature that excludes anyone who does not use a pointer.

Where Pretui is better: keyboard reordering is not an add-on, and every move is announced — the two things that make a reorderable list usable without sight.

Where it is thinner: single list only — no dragging between lists — no nested or tree reordering, no drop-position preview beyond the moving row, and no multi-select drag.

## Accessibility

- **Each handle carries its own name**, built from `@handleVerb` and the row's `@labelFor` — "Reorder Invoices", not a row of identical "drag" buttons.
- **Keyboard reordering is a first-class path**, not a fallback.
- **Every move is announced**, which is the part a drag implementation cannot borrow: a sighted user sees the row land, and everyone else needs telling.
- **`@labelFor` is used for both the handle and the announcements**, so what a reader hears when they grab a row is what they hear when it lands.
- **`@keyFor` is an accessibility argument, not only a rendering one.** Losing focus mid-move is a complete failure of the keyboard path, and the default index key causes exactly that whenever list members have real identity.
- **`@disabled` blocks both paths**, so a list is never movable by pointer but not by keyboard.

## Theming

The rows and handles take the kit's shared control, border and shadow tokens; the lifted row uses the shared raised elevation rather than a component-specific one.

Using the shared elevation is what makes a dragged row read as the same "picked up" gesture as every other lifted surface in the season — a bespoke shadow here is how a reorderable list ends up feeling like a different application.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
