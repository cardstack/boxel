## What it is

A record search field: type, results arrive from wherever you fetch them, pick one or several, selected records show as removable **RecordPill**s. Use it for any relationship — an account, an owner, a linked card. If the options are a short static list, **Select** or **MultiSelect**. If the user may type a value that is not a record, **Combobox**. If the whole set is small enough to show at once and order matters, **DuelingPicklist**.

## The contract

```
@records: PickerRecord[]   — already filtered/sorted by YOU
@selected? / @defaultSelected?, @multiple?, @loading?, @disabled?, @invalid?
@label?, @placeholder?, @recordNoun?
@onSearch?(query), @onSelectionChange?(records), @onOpenChange?(open)
<:option as |record, { selected, term }|>
```

**`@onSearch` fires on every keystroke and you debounce and fetch, not the component.** That is the load-bearing decision: a realm component owns no timers, so a built-in debounce is impossible — and the honest consequence is that the async boundary is explicit rather than hidden. `@records` is whatever you last returned.

**`PickerRecord` is a plain value, not a `CardDef` or `FieldDef` instance** — `{ id, label, meta?, icon?, search?, locked? }`. The source records the reason: a picker must be usable before a schema exists. Salesforce shapes map straight on (`id` ← the 18-char record id, `label` ← Name, `meta` ← the "Account • San Francisco" second line).

**`search` is the field that stops a real bug.** The dropdown runs a *local* filter over `label meta id`; when the server matched on something the visible text does not contain — a synonym, an account number, a fuzzy hit — that local pass would hide the row the server just returned. Setting `search` on the record keeps it.

**Single-select is an array of length 0 or 1.** One shape for both modes.

## Prior art

**SLDS's lookup** is the direct ancestor — the entity option row, the pill for the selection, the "Account • location" meta line. **React Spectrum** has no lookup; `ComboBox` with async `items` is the nearest. **Web Awesome** has none. **Radix** has none; shadcn's recipe is Command inside a Popover.

The combobox behaviour is **ember-power-select's**, and the source is explicit about why: roles, `aria-autocomplete="list"`, `aria-activedescendant` tracking, `role="listbox"`/`option`, DOM focus staying in the input, arrow navigation and scroll-into-view are all supplied whole rather than reimplemented.

Where Pretui adds real value over both:

- **A `role="status" aria-live="polite"` region announcing selections, removals and "Searching…".** That is the thing async record pickers universally omit, and it is what makes this component genuinely usable without sight. `@recordNoun` exists to make the announcements read naturally.
- **`@loading` spins the trigger affix *and* announces**, so the async state is not colour-and-motion only.
- **`RecordFace` is exported as its own primitive**, so a listbox option, a selection pill and a dueling-list row render records identically.

One documented gap the source itself flags: **EntityDisplay was the natural composition and could not be used**, because its `@title` is a string with no title block, so the matched search term could not carry a `<mark>`. That is a real API limitation in EntityDisplay worth fixing.

## Accessibility

Governing pattern: APG **Combobox with listbox popup**. This is the best-served component in the kit on announcements.

Present: `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`; `role="listbox"` with `role="option"` rows; DOM focus staying in the input; `aria-invalid` from `@invalid`; individually-named remove buttons on the pills; and the polite live region.

**The live region is designed rather than sprinkled**, which is worth reading as a model: it announces only what power-select does not already speak, so results are not double-spoken, and it is in the DOM from first render rather than being mounted with its content — which is the failure mode **Alert**, **Toast**, **Spinner** and **LoadingState** all have in this kit.

Gaps:

- **`@label` is optional** and is the combobox's accessible name. Without it the field is unnamed; there is no `@controlId`, so **Field**/**FormField** cannot wire a `<label for>` either.
- **The result count is announced but the results themselves are not enumerated** — a user must arrow through to discover them, which is correct behaviour but means an empty result set needs its own clear announcement. That announcement comes from power-select's own `role="status"` region, which also says "No results found" for an empty set.
- **`@invalid` sets `aria-invalid` but carries no message.** Issues render in the field wrapper, so a bare Lookup outside a **FormField** shows an error dress that announces nothing.
- **The pills are inside the control**, so a selection of eight records adds eight tab stops before anything after the field.
- **Debouncing is yours, and so is the announcement cadence.** A caller who fires `@onSearch` per keystroke with no debounce will produce a live region that re-announces a changing count continuously.

## Theming

Trigger and input: `--field`, `--input`, `--primary` (via `--ring`), `--ink-3`, `--control-h`, `--radius`, `--text-ui-md`. Dropdown: `--popover`, `--hover`, `--pretui-shadow-overlay`. Rows: **RecordFace**'s tokens plus the `<mark>` highlight dress. Pills: **RecordPill**'s. Invalid: `--destructive` through the **Field** token channel.

The `<mark>` on the matched term is the one thing to check per season: it must be legible against both the resting and highlighted row backgrounds, and the default `background: inherit; color: inherit` treatment means a season that does not define it produces no visible highlight at all.

The rules for the lookup's own elements sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector. The `:deep()` rules that restyle BoxelMultiSelect's power-select markup stay unlayered, because its own rules are unlayered and would beat them from inside a layer.
