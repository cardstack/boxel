## What it is

Choose one value from a known list. Use it when the options are enumerable and the user should not type — status, category, assignee from a short roster. If the user may need to enter a value that is not in the list, use **Combobox** (`allowsCustomValue` is exactly why it exists). If they need to pick several, use **MultiSelect**. If the list is a searchable set of records rather than static options, use **Lookup**. If there are two or three options and horizontal space, **SegmentedControl** or **RadioGroup** shows them all without a click.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @placeholder? (default 'Select…'), @disabled?, @controlId?
@label?, @labelledBy?   (the trigger's accessible name)
@onValueChange?(value: string)
```

**The public API speaks in values, not option objects.** `@value` is a string; `@onValueChange` yields a string. Internally power-select selects the option _object_, so `Select` looks it up by value on the way in and unwraps it on the way out. Call sites never hold an object identity, which means an options array rebuilt on every render still shows the right selection — the class of bug that plagues object-identity selects.

**Hybrid controlled/uncontrolled.** `@value ?? @internal`, and `@internal` is only written when `@value === undefined`. Pass `@value` and you own it; pass `@defaultValue` and the component does. This exact idiom is repeated across Switch, Checkbox, RadioGroup, SegmentedControl, Tabs, Slider and Pagination — learn it once.

**Search appears automatically past seven options.** Not an arg, so every Select in a product behaves the same way; see the gap under Prior art.

## Prior art

**Radix `Select`** composes `Root/Trigger/Value/Portal/Content/Item/ItemText/ItemIndicator` and is famously strict about `value`/`onValueChange` being strings. **Web Awesome `wa-select`** takes `<wa-option>` children, supports `multiple`, `clearable`, `with-label`/`hint`, and participates in native form validation. **React Spectrum `Picker`** uses a collection API (`items` + render function) and `selectedKey`/`onSelectionChange`.

Pretui's most consequential departure is under the hood: **it rides boxel-ui's `BoxelSelect` (ember-power-select) rather than reimplementing listbox behavior**, which buys real keyboard navigation, scroll-into-view, trigger typeahead and the search box — behavior a hand-rolled select in this kit would have got wrong.

**The dropdown renders in BoxelSelect's wormhole**, so no `overflow: hidden` ancestor clips it. BoxelSelect copies its `--boxel-dropdown-*` knobs from the trigger onto the wormhole each time it opens, and a custom property's computed value has its `var()` references resolved. Select sets those knobs to theme tokens (`--popover`, `--popover-foreground`, `--hover`, `--selected`, `--border`, `--primary-ink`, `--ring`), so the dropdown carries the trigger's theme, dark mode included, with no `:deep()` rule reaching into it.

The selected row's text is `--primary-ink`. The trigger's hairline rides `box-shadow`, not `border`, and its corners are the theme radius less 2px, the same as Button; Input's field style differs until it adopts the same one.

**Against boxel-ui and the field.** `BoxelSelect` speaks in option objects and leaves naming to the caller; Radix and React Aria both require an explicit label and Radix's trigger, like this one, is a `role="combobox"` element no `<label for>` can name. Pretui is ahead on three counts: the string value API, a trigger that takes its name from a plain `<label for>` or a wrapping `<label>` with the chosen value read after it, and a portaled dropdown that still carries the field's theme. Behind: no `@invalid`, `@required` or `@describedBy` pass-through (React Aria and Web Awesome have all three, and `BoxelSelect` accepts `@ariaInvalid`, `@required` and `@ariaDescribedBy`), no disabled options, no custom option block, and a search box forced past seven options where Radix and React Aria leave typeahead alone.

## Accessibility

Governing pattern: APG **Combobox with listbox popup** (which is what ember-power-select implements) rather than the older Select-Only Combobox. Roles, `aria-expanded`, `aria-controls`, active-option tracking, Escape, arrow navigation, Home/End and typeahead all come from power-select, and they are genuinely good — this is the strongest argument for the retrofit.

Gaps and cautions:

- **Name it.** A `<label for={{@controlId}}>` or a wrapping `<label>` names the trigger through `aria-labelledby`, label first and then the trigger, so the chosen value is still read. Without a label, pass `@label` (or `@labelledBy`). The trigger keeps BoxelSelect's own id, which BoxelSelect needs to theme the wormhole, so `@controlId` is never an element id: nothing can find the trigger by it, and FormField focuses a failing Select through its first focusable element instead.
- **No invalid state.** There is no `@invalid`, no `aria-invalid`, no error row — unlike `Input`. Inside `Field` the invalid dress arrives through the `--border`/`--background` token channel, so it _looks_ invalid, but nothing is announced. For validated selects, use **FormField**, which supplies the ARIA.
- `@disabled` renders as `aria-disabled="true"` on the trigger (power-select's model) and drops its `tabindex`, so the control leaves the tab order, the same as `Input`'s native `disabled`.
- No `multiple` and no clear affordance — deliberate; those are MultiSelect's job.

## Theming

Theme tokens: `--field`, `--input`, `--foreground`, `--muted-foreground`, `--ring`, `--radius`, `--popover`, `--popover-foreground`, `--hover`, `--selected`, `--border`, `--primary-ink`, `--shadow-inset`.

Forwarded through BoxelSelect's knobs: `--boxel-form-control-border-radius`, `--boxel-select-trigger-padding`, `--boxel-select-trigger-gap`, `--boxel-select-trigger-content-wrap`, `--boxel-select-background-color`, `--boxel-select-text-color`, and the `--boxel-dropdown-*` colors. The selected row sits on `--selected`.

Per-instance knob: `--pretui-select-h` (the trigger's height, 1.75rem by default), set on your class.

The dropdown's own geometry (padding, option height, search box) is BoxelSelect's. The trigger's height, hairline, placeholder color and caret color have no knob (BoxelSelect's `--boxel-select-placeholder-color` never reaches its placeholder), so the `:deep()` rules that set them stay unlayered: BoxelSelect's own rules are unlayered and would beat them from inside a layer.

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
