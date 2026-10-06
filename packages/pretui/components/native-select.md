## What it is

A styled closed face over a real `<select>`. The platform draws the open list — a phone gets its own picker, a screen reader gets the native listbox, and the control posts a value in a `<form>` without a script. Use it for a short flat list where the choice is the whole job: a country, a unit, a grade. Use **Select** when the list needs typeahead, sections or rich items; it draws its own popup and pays for that with a script and its own keyboard model. Use **Combobox** when the user may type a value that is not in the list. Use **RadioGroup** when there are five options or fewer and they should all be visible.

## The contract

```
@options? / @items?       — { value, label, disabled? }[]; @items is the alias
@value?                   — controlled; leave undefined for the uncontrolled half
@defaultValue?            — uncontrolled seed
@onChange? / @onValueChange? — the chosen value, as a string
@placeholder?             — a disabled first option, selected while nothing is chosen
@disabled? @required? @invalid?
@isDisabled? @isRequired? @isInvalid? @isReadOnly? @readOnly? — React Aria spellings
@controlId?               — the id a <label for> points at
@label?                   — aria-label, when no label element points here
@size?                    — xs · s · m · l · xl (default m)
<:default>                — hand-written <option> / <optgroup>; replaces @options
Element: HTMLSelectElement
```

**`...attributes` reach the `<select>`, not the wrapper.** The visible box is a `<span>` that positions the caret; `name`, `form`, `autocomplete` and any `data-*` land on the control itself, so the component behaves as a `<select>` inside a form.

**Without a placeholder the first enabled option is the value.** That is what the platform selects, so the component agrees: `data-empty` is `'false'` and the face reads as a choice. `data-empty='true'` only ever means the placeholder is showing.

**The placeholder is a real option.** It renders as `<option value='' disabled>` and is the selected option while the value is `''`, which is what makes the closed face read the prompt. It cannot be re-chosen once a value is set; give the list an explicit "None" entry if clearing is a feature.

**Hybrid state, one string out.** With `@value` undefined the component keeps its own selection and `@defaultValue` seeds it. With `@value` set the component reports the change, puts the select back to the owner's value, and renders whatever the owner decides next. Both callbacks fire on every change, with the value string — never the option object.

**A default block replaces `@options` entirely.** Write `<optgroup>` and `<option>` by hand when the list has sections; keeping the chosen option's `selected` state is then the caller's job, since the component only marks options it generated.

## Prior art

**shadcn `NativeSelect`** is the same idea: a `<select>` with `appearance: none`, a chevron drawn beside it, `size` (`sm | default`) and `NativeSelectOption` / `NativeSelectOptGroup` children. **Mantine `NativeSelect`** takes `data` (strings or `{ value, label, disabled }`), `size`, `radius`, `leftSection` / `rightSection`, `error` and the full `Input.Wrapper` props (`label`, `description`, `withAsterisk`). **MUI `NativeSelect`** is the `Select` component with `native` on, children as `<option>`, `variant` and `IconComponent`. **Tremor `SelectNative`** is `<select>` with Tremor's field cloth and `hasError`.

Where this one is better: **the alias layer.** `@items`, `@isDisabled`, `@isRequired`, `@isInvalid` and `@onValueChange` mean markup written from React Aria or Mantine memory works without a rename. **Both state halves** are supported; Mantine's `NativeSelect` is controlled-or-`defaultValue` too, but shadcn's leaves state entirely to the caller.

Where it is thinner: **no label, description or error line of its own.** Mantine's wraps the control in `Input.Wrapper`; here the caption belongs to **Field**, which supplies `controlId` and the described-by id. **No leading section** — no icon or flag beside the value — and **no `radius` axis**; the corner comes from `--radius`. **The caret is fixed**; MUI's `IconComponent` has no equivalent. And the size scale moves height and type together with no independent padding knob.

## Accessibility

Governing pattern: none of APG's — this is the native `<select>`, and its listbox, keyboard model and announcements are the browser's. What the component does is keep from breaking that.

- **The control is the `<select>`.** `appearance: none` removes the platform's closed-face painting; it does not touch the open list, the focus model or the role. Arrow keys, type-to-jump, Space/Enter to open and Escape to close are all still the platform's.
- **The caret is `aria-hidden`** and `pointer-events: none`, so it is neither announced nor a hit target that misses the control.
- **Naming is the caller's.** `@controlId` gives a `<label for>` something to point at, which is the preferred route; `@label` sets `aria-label` for the case where no visible label exists. Without either, the select is unnamed — the component does not invent a name from the placeholder.
- **`@invalid` sets `aria-invalid='true'`** on the select and paints the destructive hairline; both are asserted. It does not render the message — pair it with **Field**'s error line.
- **`@required` is the native attribute**, so a form's own validity check refuses submission while the placeholder is selected. The placeholder option being `disabled` is what makes that check meaningful.
- **Disabled keeps the value visible** at 0.45 opacity rather than emptying the control.
- **The focus ring is drawn** with `outline: 2px solid var(--ring)` on `:focus-visible`, because `appearance: none` discards the platform's.

## Theming

From the host theme, bare: `--field` (the face), `--input` (the hairline), `--hover`, `--foreground`, `--muted-foreground` (placeholder ink and the caret), `--destructive` (the invalid hairline), `--ring`, `--radius`.

Kit tokens, each named once on the root and read through an internal variable: `--control-h` (the `m` height; `xs`, `s`, `l`, `xl` are offsets from it), `--text-ui-md`, `--text-ui-sm`, `--text-ui-lg`, `--space-3` (the inline padding), `--track-ui`, `--pretui-dur-snap`, `--pretui-ease-snap`.

Fixed: the caret's 0.75rem box and its 1.5 stroke, the 1px hairline, the 2px focus outline, the 0.45 disabled opacity.

A season retunes the field face through `--field` and `--input` alongside **Input**, so the two read as one family; the size scale follows `--control-h`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React | Pretui |
| --- | --- |
| value / onChange | `@value` / `@onChange` (a string, not an event) |
| defaultValue | `@defaultValue` |
| placeholder | `@placeholder` — a disabled empty option |
| size (shadcn `sm`, Mantine `xs`–`xl`) | `@size` |
| disabled / isDisabled | `@disabled` / `@isDisabled` |
| required / isRequired | `@required` / `@isRequired` |
| error (Mantine) / hasError (Tremor) / isInvalid | `@invalid` / `@isInvalid` |
| data (Mantine) | `@options` / `@items` |
| children `<option>` | the default block |
| label / description (Mantine) | **Field** |
