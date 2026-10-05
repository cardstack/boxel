## What it is

A real `<fieldset>` with a real `<legend>`. The legend names the group, and disabling the fieldset disables every control inside through the platform, without each one being told. Use it wherever several controls answer one question — a set of radios, a checkbox cluster, an address block — and the question needs a name that assistive tech reads as the group's. Use **FormSection** when the group lives in a **Form**: it is this element plus an issue count in the legend, a disclosure, and registration with the form's validation. Use **Field** for one control and its caption; a fieldset is for the group, not the field.

## The contract

```
@legend?          — the group's name; sugar for <:legend>
@description?     — prose under the legend, wired with aria-describedby
@disabled?        — native fieldset disabling
@isDisabled?      — React Aria / Base UI spelling
@hideLegend?      — keep the legend for assistive tech, do not paint it
@orientation?     — vertical (default) · horizontal
<:legend>         — the legend when it needs markup; wins over @legend
<:default>        — the controls
Element: HTMLFieldSetElement
```

**Disabled is inheritance, not a broadcast.** `@disabled` puts the `disabled` attribute on the fieldset and nothing else; the browser then treats every form control inside as disabled, including ones the component never saw. A control inside does not have its own `disabled` set — it matches `:disabled` — so a caller that later re-enables the fieldset gets every control back at once.

**The legend is the first child** when there is one, which is where the platform reads the group's name from. Without `@legend` or a `<:legend>` block no `<legend>` is rendered at all, and the group is unnamed.

**The description is a `<p>` with an id** the fieldset points at with `aria-describedby`; the attribute is absent when there is no description.

## Prior art

**shadcn `Field`** ships `FieldSet` and `FieldLegend` as styled `<fieldset>` / `<legend>` with a `variant` (`legend | label`) on the legend, plus `FieldGroup` for the stacked body. **Base UI `Fieldset`** is `Fieldset.Root` (a `<fieldset>`) and `Fieldset.Legend`, and its `disabled` is likewise the native attribute. **Mantine `Fieldset`** adds `legend`, `variant` (`default | filled | unstyled`), `radius` and a bordered box. **Chakra `Fieldset`** is `Fieldset.Root` / `Legend` / `HelperText` / `ErrorText` / `Content` with `invalid` and `disabled`. **React Aria** has no fieldset component; its `RadioGroup` and `CheckboxGroup` render a `role='group'` `<div>` and take `isDisabled`.

Where this one is better: **it stays a fieldset.** There is no styled box competing with **Card**, so the group can sit inside a card, a **Panel** or a **FormLayout** without a second border. The `@description` is wired to the group, which shadcn and Mantine leave to the caller. `@hideLegend` gives a way to name a group without a heading in the layout, which none of the five offers.

Where it is thinner: **no invalid state and no error line** — Chakra's `ErrorText` and Mantine's field-level error have no counterpart here; validation presentation is **FormSection**'s job, which counts issues into the legend. **No filled or bordered variant.** **No `radius`.** And the `horizontal` orientation is a wrapping row with no column control; a grid of fields belongs in **FormLayout**.

## Accessibility

Governing pattern: the HTML `<fieldset>` / `<legend>` pairing, which is what APG's grouping guidance says to prefer over `role='group'` with `aria-labelledby`.

- **The legend is the accessible name of the group**, and every control inside is announced with it. The component renders it as the fieldset's first child, which the tests assert.
- **Native disabled inheritance** is the platform's: a control inside matches `:disabled`, is skipped by Tab and posts nothing. The tests assert the inheritance on a checkbox and a text input, and that neither carries `disabled` itself.
- **`@hideLegend` hides visually only.** The legend stays in the DOM and in the tree; the stylesheet clips it with `clip-path: inset(50%)` and a 1px box. It is the right tool when the layout already shows the group's name elsewhere.
- **`@description` is exposed through `aria-describedby`** on the fieldset. Support for a described-by fieldset varies by screen reader; the prose is also in reading order directly under the legend, so nothing depends on the attribute alone.
- **Nesting is legal** and the platform handles it: an inner fieldset's legend names the inner group.
- **What the caller still owns:** the legend must actually name the question ("Roast profile", not "Options"), and a group with one control does not need a fieldset — a **Field** label is enough.

## Theming

From the host theme, bare: `--foreground` (the legend), `--muted-foreground` (the description, and the legend while disabled).

Kit tokens, each named once on the root: `--space-3` (the gap between legend, description and body, and between the controls), `--text-ui-md`, `--text-ui-sm` (the description), `--weight-strong` (the legend).

Fixed: the legend is body-size at the strong weight — the **Panel** header voice — with no uppercase treatment, so a stack of fieldsets reads as sections rather than eyebrows. The fieldset itself has no border, padding or background; the surface it sits on supplies those.

A season retunes the legend voice through `--weight-strong` and `--text-ui-md`, and the rhythm through `--space-3`, in step with **FormSection**.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React | Pretui |
| --- | --- |
| legend (Mantine) / `FieldLegend` (shadcn) / `Fieldset.Legend` (Base UI, Chakra) | `@legend` / `<:legend>` |
| `Fieldset.HelperText` (Chakra) / description | `@description` |
| disabled / isDisabled | `@disabled` / `@isDisabled` — the native attribute |
| `FieldGroup` (shadcn) / `Fieldset.Content` (Chakra) | the default block |
| invalid / `ErrorText` (Chakra) | **FormSection** |
| variant / radius (Mantine) | none; put the fieldset in a **Card** |
