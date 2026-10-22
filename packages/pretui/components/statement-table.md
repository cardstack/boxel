## What it is

Figures in sections, with subtotals and totals, set the way an accountant sets them: a profit and loss, a trial balance, an aging, a budget against actuals. Use it wherever rows of money close with a subtotal and a total. For a record listing with sorting, filtering and selection use **DataTable**; for a plain grid of text with no opinion about figures use **Table**. For one headline figure use **Stat**.

## The contract

```
@columns, @rows
@label? | @labelledBy? | @caption? (or <:caption>)
@currency? ('USD'), @locale?, @negative? ('parentheses' | 'minus'), @zero? ('blank' | 'dash' | 'show')
@density? ('regular' | 'compact'), @framed? (true)
@onRowSelect?, @selectColumn?
@expanded?, @defaultExpanded?, @onExpandedChange?, @expandLabel?
@emptyTitle?, @emptyMessage? (or <:empty>)
<:cell> for a column of kind 'custom'
```

A column has a `key`, a `label` and a `kind`: `text`, `code` (mono), `amount`, `number`, `percent`, `quantity` or `custom`. A row has a `key`, a `role` (`line`, `heading`, `subtotal`, `total`), an optional `depth`, its `cells` by column key, optional `data` hooks and optional `children`.

Four decisions worth understanding.

**The caller hands over numbers, never formatted strings.** An amount column holds minor units (cents by default; `scale` says otherwise, so a percent can be held in basis points and a quantity in thousandths). Every figure is set by **FormatNumber**, so the table can't print a value two ways, and a column stays a column of figures a test can read.

**A row says what it is, not how it looks.** Rules, weight and indentation follow from `role`: a rule over each subtotal, a rule over the total and a double rule under it. Every statement in an app reads the same, and a caller can't hand-style a total that disagrees with the others. Totals are marked by weight and rules, never by colour.

**Negatives are parentheses for the eye and "minus" for the ear.** `@negative='parentheses'` (the default) sets the accounting sign, and a visually hidden copy of the value is what a screen reader hears. A column with `sign: 'change'` always shows its sign (+$120.00, −$80.00), for variances and deltas.

**A row can open where it is read.** `children` (an account's months, its sub-accounts, its postings) sit behind a real disclosure button, controlled through `@expanded` or left to the table through `@defaultExpanded`. A child's key is `parentKey/childKey`.

`data` puts `data-*` attributes on a row (camelCase keys become kebab-case; `true` is a bare attribute; null, undefined and false are left off), so a statement can be checked figure by figure without scraping its formatted text. A column with `priority: 'secondary'` folds away when the table, not the viewport, is narrower than 40rem.

## Prior art

The model is the spreadsheet's accounting number format and the hand-set report tables every finance product writes for itself: QuickBooks' and Xero's reports, and the statement layouts of annual accounts. General-purpose data grids (AG Grid, MUI DataGrid, TanStack Table) handle expandable tree rows and aggregation well but leave the accountant's conventions to the caller: the double rule, the parentheses, blank zeros, cents.

Where this one earns its place:

- **Figures in, typography out.** Grids take strings or renderers; this takes cents and a column kind, and the format is the kit's.
- **Row roles instead of row styles.** A total is a total wherever it appears.
- **The meaning survives without the typography.** Parentheses are spoken as "minus", disclosure state is `aria-expanded`, and totals are named by their row header.

Where it is thin: no sorting, no column resizing, no virtualisation (a statement is short), and no multi-currency column (one `@currency` per table).

## Accessibility

A real `<table>`, governed by WCAG **1.3.1**.

- Column headers are `<th scope='col'>`. A heading row's cell is `<th scope='rowgroup'>` spanning the table; a subtotal or total leads with `<th scope='row'>`, so its figures are announced with their name.
- The table is named by `@caption` (a real `<caption>`), `@label` or `@labelledBy`. A named table's scroll region is a focusable `role='region'` with the same name, so a keyboard user can scroll a wide statement.
- A row with children carries a `Button` with `aria-expanded` and `aria-controls` naming its child rows; the glyph follows the state.
- With `@onRowSelect`, each line's select cell is a link-styled `Button`, reachable by Tab.
- With no rows, **EmptyState** replaces the table, rather than leaving an empty grid.

## Theming

`--pretui-statement-max-height` caps the scroll region's height (default none), and the header row stays in view as it scrolls. Otherwise the table reads the theme: `--card` and `--card-foreground` for the frame, `--border` for line rules, `--inset` and `--border-strong` for the header band, `--foreground` for subtotal and total rules, `--muted-foreground` for headings and captions, `--hover` for the line under the pointer, `--ring` for focus, and `--font-mono` for the header and code columns. Figures use tabular numerals in the body font.

The styles sit in `@layer PretComponent`, and the disclosure button's restyling in `@layer PretComposite`, so a caller's unlayered CSS overrides them without a more specific selector.
