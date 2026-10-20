## What it is

Choose one value from a known list. Use it when the options are enumerable and the user should not type — status, category, assignee from a short roster. If the user may need to enter a value that is not in the list, use **Combobox** (`allowsCustomValue` is exactly why it exists). If they need to pick several, use **MultiSelect**. If the list is a searchable set of records rather than static options, use **Lookup**. If there are two or three options and horizontal space, **SegmentedControl** or **RadioGroup** shows them all without a click.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @placeholder? (default 'Select…'), @disabled?, @controlId?
@searchEnabled?   (a search box above the list, focused on open)
@label?, @labelledBy?   (the trigger's accessible name)
@onValueChange?(value: string)
```

**The public API speaks in values, not option objects.** `@value` is a string; `@onValueChange` yields a string. Internally power-select selects the option _object_, so `Select` looks it up by value on the way in and unwraps it on the way out. Call sites never hold an object identity, which means an options array rebuilt on every render still shows the right selection — the class of bug that plagues object-identity selects.

**Hybrid controlled/uncontrolled.** `@value ?? @internal`, and `@internal` is only written when `@value === undefined`. Pass `@value` and you own it; pass `@defaultValue` and the component does. This exact idiom is repeated across Switch, Checkbox, RadioGroup, SegmentedControl, Tabs, Slider and Pagination — learn it once.

**Search is opt-in.** `@searchEnabled` adds a search box above the list, with a search icon, that takes focus when the list opens and filters by label. Off by default: typeahead on the trigger covers most lists, as in Radix and React Aria. BoxelSelect's own search box never takes focus, so from the trigger it is reachable by pointer only; Select supplies its own. A list the user types into to find a value that may not exist is a **Combobox**.

## Prior art

**Radix `Select`** composes `Root/Trigger/Value/Portal/Content/Item/ItemText/ItemIndicator` and is famously strict about `value`/`onValueChange` being strings. **Web Awesome `wa-select`** takes `<wa-option>` children, supports `multiple`, `clearable`, `with-label`/`hint`, and participates in native form validation. **React Spectrum `Picker`** uses a collection API (`items` + render function) and `selectedKey`/`onSelectionChange`.

Pretui's most consequential departure is under the hood: **it rides boxel-ui's `BoxelSelect` (ember-power-select) rather than reimplementing listbox behavior**, which buys real keyboard navigation, scroll-into-view, and trigger typeahead — behavior a hand-rolled select in this kit would have got wrong.

**The dropdown renders in BoxelSelect's wormhole**, so no `overflow: hidden` ancestor clips it. BoxelSelect copies its `--boxel-dropdown-*` knobs from the trigger onto the wormhole each time it opens, and a custom property's computed value has its `var()` references resolved. Select sets those knobs to theme tokens (`--popover`, `--popover-foreground`, `--hover`, `--border`, `--primary`, `--primary-foreground`, `--ring`), so the dropdown carries the trigger's theme, dark mode included, with no `:deep()` rule reaching into it.

**Inside a Dialog, Drawer, CommandPalette or EditInPlace editor the list renders in place.** A modal `<dialog>` makes everything outside it inert, the wormhole included, and an editor that commits on blur reads focus moving into the wormhole as leaving. Each of those provides the `pretui-popups-in-place` context, and Select reads it when it is created and passes `@renderInPlace`: ember-basic-dropdown reads that argument only once, at creation, so it cannot come from where the Select later finds itself in the DOM. In place the list takes the theme through the cascade and scrolls with its trigger; a long list scrolls its container instead of floating over its edge. Pressing inside the list keeps focus where it was, and choosing leaves focus on the trigger, so an editor around the Select never reads a pick as leaving.

The selected row is a `--primary` fill; its text and checkmark are `--primary-foreground`. The trigger's hairline rides `box-shadow`, not `border`; on hover it pulls toward `--foreground`, strengthening in both schemes like a Button's edge. Its corners are the theme radius less 2px, the same as Button; Input's field style differs until it adopts the same one.

**Against boxel-ui and the field.** `BoxelSelect` speaks in option objects and leaves naming to the caller; Radix and React Aria both require an explicit label and Radix's trigger, like this one, is a `role="combobox"` element no `<label for>` can name. Pretui is ahead on three counts: the string value API, a trigger that takes its name from a plain `<label for>` or a wrapping `<label>` with the chosen value read after it, and a portaled dropdown that still carries the field's theme. Behind: no `@invalid`, `@required` or `@describedBy` pass-through (React Aria and Web Awesome have all three, and `BoxelSelect` accepts `@ariaInvalid`, `@required` and `@ariaDescribedBy`), no disabled options, and no custom option block.

## Accessibility

Governing pattern: APG **Combobox with listbox popup** (which is what ember-power-select implements) rather than the older Select-Only Combobox. Roles, `aria-expanded`, `aria-controls`, active-option tracking, Escape, arrow navigation, Home/End and typeahead all come from power-select, and they are genuinely good — this is the strongest argument for the retrofit.

Gaps and cautions:

- **Name it.** A `<label for={{@controlId}}>` or a wrapping `<label>` names the trigger through `aria-labelledby`, label first and then the trigger, so the chosen value is still read. Without a label, pass `@label` (or `@labelledBy`). The trigger keeps BoxelSelect's own id, which BoxelSelect needs to theme the wormhole, so `@controlId` is never an element id: nothing can find the trigger by it, and FormField focuses a failing Select through its first focusable element instead.
- With `@searchEnabled`, the search input is the combobox: it carries `aria-activedescendant` and `aria-controls`, and the trigger gives them up while the list is open.
- **No invalid state.** There is no `@invalid`, no `aria-invalid`, no error row — unlike `Input`. Inside `Field` the invalid dress arrives through the `--border`/`--background` token channel, so it _looks_ invalid, but nothing is announced. For validated selects, use **FormField**, which supplies the ARIA.
- `@disabled` renders as `aria-disabled="true"` on the trigger (power-select's model) and drops its `tabindex`, so the control leaves the tab order, the same as `Input`'s native `disabled`.
- No `multiple` and no clear affordance — deliberate; those are MultiSelect's job.

## Theming

Theme tokens: `--field`, `--input`, `--foreground`, `--muted-foreground`, `--ring`, `--radius`, `--popover`, `--popover-foreground`, `--hover`, `--border`, `--primary`, `--primary-foreground`.

Forwarded through BoxelSelect's knobs: `--boxel-form-control-border-radius`, `--boxel-select-trigger-padding`, `--boxel-select-trigger-gap`, `--boxel-select-trigger-content-display`, `--boxel-select-background-color`, `--boxel-select-text-color`, and the `--boxel-dropdown-*` colors. Hovered or keyboard-highlighted, the selected row darkens a shade in both schemes, the same as an accent Button's hover.

Per-instance knob: `--pretui-select-h` (the trigger's height, `--boxel-form-control-height-sm` (1.875rem) by default), set on your class.

On touch screens (`pointer: coarse`) the trigger, its placeholder, the options and the search box are at least 16px (`--boxel-form-control-touch-font-size`), matching **Input** and **Autocomplete**, so iOS doesn't zoom into the search box on focus; the trigger keeps its height.

The dropdown's own geometry (padding, option height, search box) is BoxelSelect's. Select adds two rules there: the search box's icon inset, and the options and search box at the trigger's font size, through an unscoped rule on its dropdown class, since the wormhole is outside Select's subtree and BoxelSelect has no font-size knob. The trigger's height, hairline, placeholder color and caret color have no knob (BoxelSelect's `--boxel-select-placeholder-color` never reaches its placeholder), so `:deep()` rules set them. All of these sit in `@layer PretComponent`, which outranks BoxelSelect's layers.

## React ecosystem

| React                     | Pretui                           |
| ------------------------- | -------------------------------- |
| Select / Dropdown         | this tile                        |
| Native `<select>`         | **NativeSelect** stub            |
| Combobox / free text      | **Combobox** / **Autocomplete**  |
| multi                     | **MultiSelect**                  |
| tags mode                 | **TagsInput**                    |
| tree / cascader           | **TreeSelect** / **Cascader**    |
| `onValueChange`           | same; `@onChange` is an alias    |
| `placeholder`             | same                             |
| `disabled` / `isDisabled` | `@disabled`; `@isDisabled` alias |
