## What it is

One BXL guide rule, edited: the metadata — label, severity, target path, message — above an **ExpressionBuilder** that composes the rule's `expression`. Use it as the editor for a single validation or automation rule. For a list of composed conditions in read-only form, **FilterSet**. For just the predicate with no rule metadata, **ExpressionBuilder** alone.

## The contract

```
@rule: GuideRule   { ruleId, label, severity, targetPath, message, expression }
@model?            — the authoring state behind rule.expression
@resources?, @operators?, @allowFieldComparison?
@severities?, @targetPaths?
@status?, @statusDetail?, @readonly?
@onChange?(rule, model), @onRemove?
@and? ('and'), @or? ('or')
<:value as |ctx|>  <:actions>
```

**`@model` is optional, and omitting it makes the expression read-only** — because **BXL source is never parsed back into a model here.** A lossy round-trip would quietly rewrite a rule, and a rule that changes meaning when you open it is worse than one you cannot edit visually. So the visual builder edits a model it was given; a rule with no model shows its source and nothing more.

**`@status` is a canned verdict from an evaluation that happened somewhere else.** Nothing in this file computes it. That is the territory's rule stated once more at the component level, and it is why the status is an arg rather than a getter.

**It edits the BXL guide rule verbatim, with no second shape.** `{ ruleId, label, severity, targetPath, message, expression }` is the record, and `@onChange` returns it whole with the expression freshly composed. No adapter, no view model.

`@targetPaths` falls back to `@resources`, and when neither is supplied the path is a **free-text input so predicate paths stay typable** — a predicate path like `"Line Item"[SKU = "COPY-04"].Quantity` is not in any dropdown.

## Prior art

**There is no upstream for this component.** SLDS's expression component stops at the condition list and never names what the conditions are *for* — so the metadata half is new work, laid out on the SLDS stacked form-element grid. The builder half is **ExpressionBuilder**, which is the SLDS port.

The comparison worth drawing is against how rule editors usually work. Two common shapes:

- **A form over a rule record with a text field for the predicate.** Simple, honest, and unusable for anyone who does not know the syntax.
- **A visual builder with no record around it**, where the rule's message and severity live in a separate screen. This is Salesforce's actual product shape, and it means a rule author writes the condition in one place and the message it produces in another — which is how rule messages end up saying "Invalid" for everything.

RuleRow puts them in one place, and that is the design argument: **the message is authored beside the condition that triggers it.** The forms territory's **FieldError** prints rule messages verbatim precisely because a rule author wrote them; this is where they get written.

Where it is thin: no test/preview affordance (you cannot try the rule against a record here — `@status` is canned), no rule duplication, no version history, and no cross-rule view.

## Accessibility

No APG pattern; it is a form plus a builder.

It inherits **ExpressionBuilder**'s accessibility work wholesale — per-row accessible names carrying the row number, focus management across delete and reorder, `aria-disabled` at list boundaries, the row count in the list's name, and the live region. That is a strong foundation.

The metadata half's own gaps:

- **The severity control determines whether the rule blocks a save.** `error` blocks; `warning` and `info` do not; and — per the territory's fail-closed rule — anything unrecognised is treated as `error`. Whether that consequence is stated anywhere in the UI is the question worth asking: a severity select whose options are three words does not tell an author that choosing "error" will stop people saving records. That is a **WCAG 3.3.2** instruction gap on the most consequential control on the screen.
- **`@status` is a canned verdict with a chip and prose.** The chip's label is text, so the verdict reaches assistive tech as words, not as hue.
- **The composed BXL source is shown in the footer.** For a screen-reader user that is a string of operators and quoted paths read as prose, which is close to unusable; it is reference material rather than an affordance, and marking it as such (or pairing it with a **CopyButton**) would be kinder.
- **`@readonly` disables every control**, so a reviewer cannot keyboard-explore the rule the way `aria-disabled` would allow.
- **`@onRemove` shows a remove control** for a rule that may be referenced elsewhere; there is no confirmation (**WCAG 3.3.4**).
- The free-text `targetPath` field has no format hint, and BXL predicate paths are exactly the kind of syntax that needs one.

## Theming

**FormField**/**FormLayout** tokens for the stacked metadata grid, **Select** and **Input** for its controls, **StatusChip** for `@status`, **Token** for the composed source, **FieldError**'s severity tiers, plus everything **ExpressionBuilder** consumes.

The severity control should read at the weight of its consequence — a season that renders it as one more quiet select among four understates what it does. There is no token that does this for you; it is a layout decision at the call site.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
