## What it is

The grid a form's fields sit in: one or two (or three) columns, labels above or beside, collapsing to one column when the *pane* gets narrow. Use it inside a **Form** via `form.Layout`, or stand-alone around a set of **FormField**s. For grouping fields under a heading with its own issue count, use **FormSection** — a section is a grid item and spans every column by default.

## The contract

```
@direction? 'stacked' | 'horizontal'   (default 'stacked')
@columns?   1 | 2 (3 allowed, collapses in two steps)
@labelWidth? (default 9rem)  @gap? (default var(--space-5, 14px))
@form?, @section?
<:default as |layout|>   — { Field, Section, direction, columns }
```

**`@direction` is curried into the yielded `Field`.** You set label placement once on the layout and every field inside inherits it; a field can still override with its own layout arg. Same for the form and section args — a field laid out inside a section still counts toward that section's issue badge, because the layout passes the section registry through.

**FormField**'s own span arg is SLDS's `_2-col`: a field can claim more than one grid column.

## Prior art

This is **SLDS's `.slds-form`** (`_stacked` / `_horizontal`) plus `slds-form__row` / `slds-form__item`, collapsed into one grid. **React Spectrum's `Form`** takes a similar `labelPosition` (`top`/`side`) and `labelAlign`, and Spectrum's grid is `maxWidth`-driven. **Web Awesome** has no form layout at all — each control owns its own label placement.

The improvement is specific and, in a card kit, decisive: **SLDS breaks its columns on `@media (min-width: 48em)` — the viewport.** A two-column form in a 320px side panel of a 1600px window stays two columns and shreds. Pretui measures the **pane** with a container query, so the same form collapses correctly wherever it is embedded. In a system where a card can be rendered at any size in any host, viewport media queries are simply the wrong instrument, and this is the clearest example of why.

Two implementation details worth knowing, because they look like accidents and are not:

- **The queries are unnamed.** Named container queries are forbidden in realm code: the scoped-CSS transpiler silently drops every rule after one, so a single `@container name (...)` would delete the rest of the stylesheet with no error anywhere. This is a platform trap, not a style preference.
- **There are two nested elements** — `.pretui-formlayout` (the container) wrapping `.pretui-formlayout-grid` (what the queries restyle) — because an unnamed container query resolves against the nearest *ancestor* container, so a rule inside one can never match the container element itself. The extra div is load-bearing.

## Accessibility

No APG pattern; this is layout. Roles, labelling and messaging all belong to **FormField** and **FormSection**.

What matters here, and what does not:

- **Visual order and DOM order must agree.** The grid uses `grid-template-columns` and normal flow, with `@span` widening items rather than reordering them — so the tab sequence follows the reading order, and WCAG **1.3.2 Meaningful Sequence** and **2.4.3 Focus Order** are satisfied by construction. Any layout that achieved two columns by `grid-column` placement or `order` would break both; this one cannot.
- **Column collapse is a reflow win.** Because the breakpoint is the container, a form inside a narrow pane genuinely reflows to one column — WCAG **1.4.10 Reflow** is met at the pane level, not just at 320px viewport width, which is a stronger guarantee than the media-query version gives you.
- `@direction='horizontal'` puts the label beside the control at a fixed `@labelWidth`. At large text sizes (WCAG **1.4.4**, 200% zoom) a 9rem label column can clip long labels; nothing here enforces wrapping, so prefer `stacked` for long labels.

Gaps:

- **The layout is not a group.** There is no `role="group"`, no `aria-label`, and no `<fieldset>` — deliberately, because that is **FormSection**'s job. But it means a bare `FormLayout` outside a section gives assistive tech no grouping at all, and a two-column form is announced as one flat run of fields.
- **`@columns={{3}}` is allowed and collapses in two steps**, but three columns of form fields is very hard to scan and there is no warning. Prefer two.
- Nothing associates the columns with anything; a screen-reader user has no signal that fields are laid out side by side, which is correct (it is presentational) but worth stating.

## Theming

`--space-5` (the default gap, overridable via `@gap`), the label column width (`@labelWidth`, default `9rem`), and whatever **FormField** consumes. The layout itself paints nothing — no background, no border, no shadow.

`data-direction` and `data-columns` are reflected on the container, so a season can hook either without reaching into the grid. Because the breakpoints are container queries, a season cannot retune them through tokens; changing where columns collapse means editing the component.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
