## What it is

The rule and condition **authoring** surface: a list of `(resource, operator, value)` rows, an any/all joiner, and an optional custom-logic string like `1 AND (2 OR 3)` that references row numbers. Use it wherever a user composes a predicate — validation rules, filters, automation triggers. If you only need to *show* a composed predicate, **FilterSet** is the read-only face. If the predicate belongs to a named rule with a message and a severity, **RuleRow** wraps this with that metadata.

## The contract

```
@conditions? / @defaultConditions?, @logic? / @defaultLogic?, @customLogic? / @defaultCustomLogic?
@resources?, @operators?, @title?, @logicLabel?, @conditionNoun?, @addLabel?
@maxConditions?, @allowFieldComparison?, @readonly?, @issues?
@onChange?(model), @onIssues?(issues)
<:value as |ctx|>  <:header>  <:footer>
```

**The hard architectural rule of the forms territory: it never evaluates anything.** There is no BXL import, no `prepareBxlSafe`, no `evaluate`. It edits rule *data* and composes a BXL *string* for the caller to persist. Evaluation happens elsewhere and fails closed. Anything that looks like a result in a demo was passed in canned.

**`<:value>` is a slot, not a string.** The right-hand control varies by operator and field type — a date needs a date picker, an enum needs a select, `is empty` needs nothing at all — so it is yielded with a context (Law 7). It falls back to a plain **Input**.

`@allowFieldComparison` adds a Value/Field switch so a condition can compare two fields ("Total must not exceed the approved budget"); in Field mode the right side is a resource picker the builder owns and the slot is not asked for.

## Prior art

Ported from **Salesforce Lightning Design System's `ui/components/expression/`** (`base/`, `custom-logic/`, `filters/`). SLDS supplies the layout and interaction vocabulary. Seven things it got wrong, and what changed:

1. **SLDS has no reorder** — rows can only be appended and deleted, yet the custom-logic string references row *positions*, so position is meaningful and un-editable. Pretui adds keyboard-first Move up / Move down.
2. **SLDS renumbers nothing**, and the real Lightning builder is notorious for leaving dangling references after a delete. Pretui remaps the custom-logic string **from stable row ids on every structural change — never by arithmetic on the numbers** — removes the operator orphaned by a dropped reference, collapses the resulting empty groups, then **validates and shows what is still wrong rather than silently repairing it**. That last clause is the important one: a builder that quietly fixes your logic has changed your rule.
3. **SLDS's row identity lives entirely in a `<legend>`** most screen readers announce once, on entry; every control inside is then labelled "Resource"/"Operator"/"Value", identical in every row. Pretui keeps the fieldset and legend **and** gives every control its own accessible name carrying the row number ("Condition 3 resource").
4. **SLDS never moves focus.** Deleting a row destroys the focused button and drops focus to `<body>`. Pretui moves focus to the row that took the deleted row's place (or the previous row, or the Add button) and announces it.
5. **SLDS `disabled`s the delete button on the only remaining row** — the classic focus-loss trap. Pretui's end-of-list Move buttons use `aria-disabled` and stay focusable, so repeated Up presses never eject the user.
6. **SLDS hardcodes Sass dimensions** and cannot respond to its own pane. Every dimension here is a token, and the row collapses to a stacked layout on an unnamed container query.
7. **The row count is nowhere in SLDS's accessibility tree.** Pretui's is in the list's accessible name and in the live region.

**Dropped deliberately:** the `formula/` rich-text editor (it needs a rich-text engine, and Law 9 forbids vendoring one — a caller wanting free-form BXL edits `rule.expression` directly, which **RuleRow** exposes), and nested condition **groups**: custom logic already expresses grouping with parentheses over one flat row list, and a flat list is what keeps stable-id remapping provable.

## Accessibility

No APG pattern; this is a form of forms, governed by WCAG **1.3.1**, **2.4.3 Focus Order**, **3.3.1**, **3.3.3** and **4.1.3**.

This is the most deliberately-accessible component in the kit, and the four fixes above (3, 4, 5, 7) are all accessibility work. What it does that almost nothing else does:

- **Every control's accessible name carries its row number**, so a control reached by Tab, by virtual cursor, or by a forms-mode jump always identifies its row.
- **Focus is managed across deletion and reordering**, and the change is announced in a live region.
- **`aria-disabled` rather than `disabled`** at list boundaries, keeping controls discoverable.
- **The row count is in the list's accessible name.**
- **Issues are surfaced, not repaired** — which is the accessible behaviour as well as the correct one, since a silent repair is a change the user was never told about.

Remaining gaps:

- **The custom-logic string is a free-text field expressing a grammar**, and there is no expressed format hint beyond the placeholder — a **WCAG 3.3.2** gap for a genuinely non-obvious syntax. Its validation errors are shown, which covers 3.3.1.
- **The relationship between a row's number and its position** is conveyed by the accessible name and by the live region, but a user editing custom logic must hold the mapping in their head; there is no "jump to condition 3" affordance.
- **`@readonly` disables every control**, so a review state is not keyboard-explorable in the way `aria-disabled` would allow.
- The `<:value>` slot's accessibility is the caller's — a custom control yielded there gets the row context but must apply it.

## Theming

**FormField**/**FormLayout** tokens for the row grid, **Select** and **Input** tokens for the three columns, **IconButton** for the row controls, **Button** for Add, **FieldError**'s severity tiers for issues, and `--border`/`--inset` for the rows' structure. Every dimension is a token with a light literal fallback.

The stacked-collapse breakpoint is an **unnamed container query** — named ones are forbidden in realm code, since the scoped-CSS transpiler silently drops every rule after one. So the builder reflows against its pane, which is what makes it usable in a side panel.

The styles sit in `@layer PretComposite`, above Select's `PretComponent` layer, so what this component sets on Select wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
