## What it is

Two side-by-side lists — Available and Selected — with move buttons between them and an optional reorder column. Use it when the selection is a **set whose order matters** and the whole option list is small enough to show at once: report columns, workflow stages, a permission set. If order does not matter, **MultiSelect** or **Picker** is far less UI. If the list is long or fetched, **Lookup**. If it is a short single choice, **Select**.

## The contract

```
@options: PickerRecord[]   — every record in play; the two lists derive from this + @value
@value? / @defaultValue?   — an ORDERED list of ids
@label?, @availableLabel?, @selectedLabel?
@reorder? (default true), @disabled?, @required?, @rows? (default 7)
@onValueChange?(ids: string[])
<:option as |record, { selected, side }|>
```

**"Order is the payload."** `@value` is an ordered array of ids, and reordering fires `@onValueChange` exactly as moving does. That is the reason this component exists rather than being a **MultiSelect** — a set of ids in arbitrary order is what MultiSelect gives you; an ordered list is a different value type, and the UI is the honest expression of it.

**The two lists are derived, not stored.** There is one `@options` array and one `@value`; Available is `options - value` and Selected is `value` in order. So the component can never get into a state where a record is in both lists or in neither.

**`PickerRecord.locked` means a record cannot be transferred out of its list** — the field exists on the shared record type specifically for this component, and it is how you express "this column is mandatory" without removing it from view.

`@rows` (default 7) sets the visible height before each list scrolls.

## Prior art

**SLDS's `dueling-picklist`** is the direct ancestor and the canonical implementation — two listboxes, four move buttons, up/down reorder, and a documented ARIA contract. **React Spectrum**, **Radix**, **Web Awesome** and **shadcn** all ship nothing here; the pattern belongs to enterprise UI and modern kits have skipped it.

So the comparison is against SLDS, and the interesting question is whether the pattern earns its space. The honest answer: it earns it **only** when order matters. For an unordered set, a multi-select with chips is one control instead of two lists and four buttons, and every usability comparison favours it.

Where Pretui improves on SLDS:

- **Records are the shared `PickerRecord` value**, so a dueling list, a **Lookup** result and a **RecordPill** all render through the same **RecordFace** primitive and look identical.
- **`locked` as a record property** rather than a separate disabled-ids array — the constraint travels with the data.
- **The derived-lists model** (above); SLDS leaves both lists to the caller.

Where it is behind SLDS: no drag-and-drop between lists (SLDS supports it), no multi-select-then-move-many in some implementations, and no search/filter over the Available list — which for anything past thirty options is what you actually want, and is the point at which you should switch to **Lookup**.

## Accessibility

Governing pattern: **two multi-select listboxes** (`role="listbox"` with `aria-multiselectable`, `role="option"` with `aria-selected`) plus a labelled group, which is what the source documents.

The move buttons are the crux, and SLDS's contract is the one to hold this to:

- **Each list needs its own accessible name** (`@availableLabel`/`@selectedLabel`), and the whole control needs a group name (`@label`) — all three are exposed, which is right.
- **Each move button names its direction and target**: "Move selection to Selected", "Move all to Available", not "→".
- **Every move must be announced.** "Region added to Selected, position 3 of 5" — without it, a keyboard user presses a button and has no idea whether anything happened, because focus stays on the button while both lists change behind them. **Lookup** in this same file has a well-designed polite live region; this component should have the same, and whether it does is the first thing to check.
- **Focus after a move** should follow the moved item or stay predictably on the button; an unmanaged move leaves focus on a button whose enabled state may have just changed.
- **Reorder buttons need the same treatment** — "Move up" must announce the new position, or the reorder column is unusable without sight.
- **WCAG 2.5.7 Dragging Movements** does not apply (there is no drag), which is one place the button-based design is *more* accessible than SLDS's drag-enabled version.
- **`locked` records must announce as such** — a record that cannot be moved should carry `aria-disabled` and, ideally, a reason.
- **`@required` adds "(required)" to the legend's accessible name**; the asterisk beside it is `aria-hidden`, as in **FormField**.
- Two scrolling listboxes at `@rows={{7}}` need keyboard scrolling, which listbox arrow navigation provides.

## Theming

**RecordFace**'s row tokens throughout, plus `--card`/`--inset` for the two list surfaces, `--border` for their edges, `--pretui-selected` and `--hover` for option states, **Button** or **IconButton** tokens for the move and reorder controls, and **Label**'s legend voice.

The option rows carry a `prefers-reduced-motion` branch (their transition is disabled), which is a good sign for a control with this much state change.

A season must keep the two list surfaces visually equal — if Available and Selected read at different weights, the control implies a hierarchy that is not there. And `--pretui-selected` must be distinguishable from `--hover` within a list, since a user pointing at one row while another is selected is the normal state of this control.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Ant `Transfer`. **Transfer** is this component under that name. Accept `dataSource` /
`targetKeys` / `onChange` as aliases if it helps agents.
