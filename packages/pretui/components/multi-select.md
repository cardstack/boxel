## What it is

Pick several values from a known list, with the chosen ones shown as removable chips in the trigger. Use it for tags, assignees, filter facets — anywhere the selection is a set and the user needs to see it without opening the list. For one value, **Select**. For a value that may not be in the list, **Combobox**. For a searchable set of records, **Lookup**. For a two-column available/chosen arrangement over a long list, **DuelingPicklist**. For a multi-select with a select-all row and a search box, **Picker**.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @placeholder?, @disabled?
@label?        — accessible name; falls back to @placeholder, then 'Select items'
@onValueChange?(values: string[])
```

Hybrid controlled/uncontrolled, the kit-wide idiom.

**The trigger is a `role="combobox"` `<div>`, not a `<button>`, and that is a deliberate legality fix.** The chips inside the trigger carry their own remove buttons, and a `<button>` cannot legally contain another `<button>`. Making the trigger a div with an explicit role keeps the markup valid while preserving the combobox semantics.

**Toggling an option keeps the list open.** That is the difference from **Select**, and it is what a multi-select is for — closing after each pick would make selecting five things five round trips.

## Prior art

**boxel-ui's `BoxelMultiSelect` rides the ember-power-select wormhole**, which is on this kit's wart list — the portal escapes the theme island, so season tokens cannot reach the dropdown. So this is a **fresh build on the kit's own `Popup` primitive** rather than a wrap, mirroring **Select**'s structure exactly: the same trigger dress, the same focus ring while open, the same listbox with the traveling highlight, the same viewport-covering backdrop button instead of a `document` click listener.

Against the field: **Web Awesome `wa-select multiple`** shows chips with `max-options-visible` (default 3) and a `getTag(option, index)` render hook. **React Spectrum** has no multi-select picker. **Radix** has none; the ecosystem uses Popover + Command, which is what shadcn's multi-select recipes are.

Where Pretui is ahead of the shadcn assembly: it is one component with real listbox semantics rather than three composed libraries. Where it is behind Web Awesome: **no overflow cap.** There is no `@maxSelectedDisplay`, so selecting twenty options grows the trigger unboundedly — **Picker**, which wraps boxel-ui, does have that arg. That is the clearest gap and it is the first thing a real list will hit.

Also missing versus both: no search/filter inside the dropdown (Select auto-enables one past seven options; this does not), no grouping, and no select-all.

## Accessibility

Governing pattern: APG **Combobox with listbox popup**, multi-select form.

Present and correct, and this is one of the more complete ARIA implementations in the kit: `role="combobox"` on the trigger with `aria-haspopup="listbox"`, `aria-controls` pointing at the listbox id, `aria-expanded`, `aria-disabled` and `aria-label`; `role="listbox"` with **`aria-multiselectable="true"`** on the panel; `role="option"` with `aria-selected` explicitly `'true'`/`'false'` on every row; `aria-label="Remove {label}"` on each chip's remove button; an `aria-label="Close"` backdrop at `tabindex="-1"`.

Keyboard: Enter, Space and ArrowDown open; ArrowUp/ArrowDown move the highlight, Home/End jump to the ends, and typing jumps to the next matching label; Enter/Space toggle; Escape closes. Focus stays on the trigger, and `aria-activedescendant` names the highlighted option, so a screen reader follows the highlight. A polite status announces the selection count.

Gaps:

- **No `@controlId`.** The trigger is a `role="combobox"` `<div>`, which a `<label for>` cannot name, so **Field**/**FormField** wiring needs `@label` instead.
- **The chip remove buttons are pointer-only** (`tabindex="-1"`), so they add no tab stops. Keyboard removal goes through the list, where Enter or Space toggles the option off.
- **`aria-disabled` rather than the native attribute** keeps a disabled control focusable — arguably better than **Input**'s native `disabled`, and inconsistent with it.
- The dropdown escapes clipping via `Popup`'s `position: fixed`, so unlike **Select** it is not clipped by `overflow: hidden` ancestors.

## Theming

Trigger: `--field`, `--input`, `--primary` (the open/focus ring), `--ink-3` (placeholder), `--control-h`, `--radius`, `--text-ui-md`, `--track-ui`. Chips: **FilterChips**' capsule dress. Listbox: `--popover`, `--hover`, `--foreground`, `--pretui-shadow-overlay`, and the 28px row height the index-positioned highlight depends on.

**That 28px is load-bearing**: the traveling highlight is positioned by index × row height rather than measured, so a season that changes option row height without changing the highlight's step will desynchronise them. It is the one metric here that cannot safely be retuned in CSS alone.

The component's own styles sit in `@layer PretComposite`, so a caller's unlayered CSS overrides them without a more specific selector. The rule it sets on Popup's anchor stays unlayered, because Popup styles its anchor unlayered and unlayered CSS beats any layer.

## React ecosystem

Value is a **known set** (records or enums). Free-string chips are
**TagsInput**. Record references with search are **Lookup**. Ant
`mode=multiple` is this; `mode=tags` is TagsInput.
