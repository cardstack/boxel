## What it is

Choose one value from a known list. Use it when the options are enumerable and the user should not type — status, category, assignee from a short roster. If the user may need to enter a value that is not in the list, use **Combobox** (`allowsCustomValue` is exactly why it exists). If they need to pick several, use **MultiSelect**. If the list is a searchable set of records rather than static options, use **Lookup**. If there are two or three options and horizontal space, **SegmentedControl** or **RadioGroup** shows them all without a click.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @placeholder? (default 'Select…'), @disabled?, @controlId?
@onValueChange?(value: string)
```

**The public API speaks in values, not option objects.** `@value` is a string; `@onValueChange` yields a string. Internally power-select selects the option _object_, so `Select` looks it up by value on the way in and unwraps it on the way out. Call sites never hold an object identity, which means an options array rebuilt on every render still shows the right selection — the class of bug that plagues object-identity selects.

**Hybrid controlled/uncontrolled.** `@value ?? @internal`, and `@internal` is only written when `@value === undefined`. Pass `@value` and you own it; pass `@defaultValue` and the component does. This exact idiom is repeated across Switch, Checkbox, RadioGroup, SegmentedControl, Tabs, Slider and Pagination — learn it once.

**Search appears automatically past seven options.** Not an arg. Seven is the point where scanning stops being faster than typing, and making it a prop guarantees inconsistency across a product.

## Prior art

**Radix `Select`** composes `Root/Trigger/Value/Portal/Content/Item/ItemText/ItemIndicator` and is famously strict about `value`/`onValueChange` being strings. **Web Awesome `wa-select`** takes `<wa-option>` children, supports `multiple`, `clearable`, `with-label`/`hint`, and participates in native form validation. **React Spectrum `Picker`** uses a collection API (`items` + render function) and `selectedKey`/`onSelectionChange`.

Pretui's most consequential departure is under the hood: **it rides boxel-ui's `BoxelSelect` (ember-power-select) rather than reimplementing listbox behaviour**, which buys real keyboard navigation, scroll-into-view, trigger typeahead and the search box — behaviour a hand-rolled select in this kit would have got wrong.

And then it makes a decision the underlying library does not default to: **`@renderInPlace={{true}}`**. BoxelSelect's normal path portals the dropdown into `#ember-basic-dropdown-wormhole` and syncs a _fixed list_ of boxel variables (`--background`, `--foreground`, `--border`, …) onto the portal via a MutationObserver. Pretui tokens — `--popover`, `--hover`, `--field`, everything `--pretui-*` — are not on that list, so a portalled dropdown could not be re-dressed and a season recompile would leave it stale. Rendering in place means the dropdown inherits every token naturally and scoped `:deep()` reaches it, with no `:global` cached-HTML classes. The accepted cost is stated plainly in the source: **an `overflow: hidden` ancestor can clip the dropdown**, which the old fixed-position `Popup` path did not. That is the trade — correct theming over guaranteed escape.

Two smaller improvements: the selected row is bold `--pretui-primary-ink` rather than a checkmark-only affordance, and power-select opens with the highlight already on it, echoing the traveling-highlight language used by SegmentedControl and Tabs. The trigger's hairline rides `box-shadow`, not `border`, so its box metrics are byte-identical to `Input` — put a Select and an Input side by side and they align exactly.

## Accessibility

Governing pattern: APG **Combobox with listbox popup** (which is what ember-power-select implements) rather than the older Select-Only Combobox. Roles, `aria-expanded`, `aria-controls`, active-option tracking, Escape, arrow navigation, Home/End and typeahead all come from power-select, and they are genuinely good — this is the strongest argument for the retrofit.

Gaps and cautions:

- **No accessible name of its own.** `@controlId` lands on the trigger so `Field`/`FormField` can wire `<label for>`. Outside those wrappers, pass `aria-label` yourself. Note this id deliberately overrides BoxelSelect's own guid; the source records that this is safe _only because_ `renderInPlace` skips the wormhole theme observer that consumed it.
- **No invalid state.** There is no `@invalid`, no `aria-invalid`, no error row — unlike `Input`. Inside `Field` the invalid dress arrives through the `--border`/`--background` token channel, so it _looks_ invalid, but nothing is announced. For validated selects, use **FormField**, which supplies the ARIA.
- `@disabled` renders as `aria-disabled="true"` on the trigger (power-select's model), so the control stays focusable — arguably better than `Input`'s native `disabled`, but inconsistent with it.
- **The clipping caveat is an accessibility issue too**, not only a visual one: a dropdown clipped by an ancestor may be unreachable by pointer even though it is reachable by keyboard.
- No `multiple` and no clear affordance — deliberate; those are MultiSelect's job.

## Theming

Pretui tokens: `--field`, `--input`, `--primary`, `--pretui-primary-ink`, `--popover`, `--hover`, `--foreground`, `--ink-3`, `--border`, `--control-h`, `--radius`, `--text-ui-md`, `--track-ui`, `--pretui-shadow-overlay`, `--pretui-shadow-inset`.

Forwarded through the boxel-ui knob channel: `--boxel-form-control-border-radius`, `--boxel-select-trigger-padding`, `--boxel-select-trigger-gap`, `--boxel-select-trigger-content-wrap`, `--boxel-select-background-color`, `--boxel-select-text-color`, `--boxel-dropdown-background-color`, `--boxel-dropdown-text-color`, `--boxel-dropdown-hover-color`, `--boxel-dropdown-highlight-color`, `--boxel-dropdown-selected-text-color`.

A season must define `--popover` distinctly from `--card`, and `--pretui-primary-ink` as a _readable-on-popover_ variant of `--primary` — a saturated brand colour used directly as selected-row ink often fails contrast on a white dropdown.

## React ecosystem

| React                     | Pretui                          |
| ------------------------- | ------------------------------- |
| Select / Dropdown         | this tile                       |
| Native `<select>`         | **NativeSelect** stub           |
| Combobox / free text      | **Combobox** / **Autocomplete** |
| multi                     | **MultiSelect**                 |
| tags mode                 | **TagsInput**                   |
| tree / cascader           | **TreeSelect** / **Cascader**   |
| `onValueChange`           | @onChange — accept alias        |
| `placeholder`             | same                            |
| `disabled` / `isDisabled` | @disabled                       |

- [ ] Accept `onValueChange` and `isDisabled`.
