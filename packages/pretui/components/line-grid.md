## What it is

An editable grid of line items, with totals and a balance check: journal lines (account, debit, credit, memo), invoice lines (product, quantity, price), allocations. Use it where a document is written as rows that add up. For reading figures back use **StatementTable**; for a single amount use **AmountInput**; for a list of records use **DataTable**.

## The contract

```
@columns, @rows, @label, @onChange(index, key, value)
@onAdd?, @onRemove?(index), @minRows? (0), @addLabel? ('Add line')
@balance? ([debitKey, creditKey]), @currency? ('USD'), @locale?
@disabled?
<:footer> receives { totals, balanced, difference }
```

A column has a `key`, a `label` and a `kind`: `text`, `code` (mono), `amount`, `number` or `choice` (a **Combobox** over its `options`). Amount and number columns take `scale` (amounts default to 2, cents), `pairsWith` and `total`. Any column can be `required`, and can set `width` and `placeholder`.

Four decisions worth understanding.

**The grid is controlled and reports one cell at a time.** `@onChange(index, key, value)` hands the caller the row, the column and the value in stored units; the grid never changes `@rows` itself. A caller binds it straight to stored fields, with no draft copy to reconcile, and totals and the balance are derived from the rows on every render, so they can't drift from them.

**Amounts are stored in minor units and typed in major units.** Each amount cell is an **AmountInput**, with its locale-aware separators and parse on every keystroke. A cell shows no currency symbol (the totals carry it), so a line stays one control high.

**A column can pair with another.** `pairsWith: 'cr'` on the debit column means typing a non-zero debit clears that line's credit: the bookkeeper's one-sided-line rule, enforced where it is typed rather than reported afterwards.

**Enter walks the column.** Enter moves to the same column on the next line, and on the last line adds a line (when `@onAdd` is given) and moves into it; Shift+Enter moves up. An open Combobox listbox keeps Enter for itself, and an IME composition is left alone.

A `required` cell that is empty in a line that has been started is marked invalid; an untouched blank line is not. `@minRows` protects the leading lines from removal.

## Prior art

The journal-entry grids in QuickBooks and Xero, and spreadsheet rows, are the reference. Spreadsheet-style grids (Handsontable, AG Grid's editing) give free-form cells and leave the rules to the caller; accounting apps each hand-build this grid, and the same mistakes recur: amounts typed as cents or parsed from strings, a debit and a credit both filled on one line, totals held separately from the rows, and a keyboard that must leave the grid to add a line.

Where this one earns its place:

- **One source of truth.** Rows in, cell changes out; totals and balance are derived.
- **The accountant's rules in the cells.** Minor units, paired columns, and a balance check in words.
- **Keyboard entry stays in the grid.** Enter adds and moves, as a bookkeeper expects.

Where it is thin: no row reordering, no copy and paste of ranges, no column hiding, and no per-line currency.

## Accessibility

A real `<table>` inside a named `role='region'`, both labelled by `@label`.

- Column headers are `<th scope='col'>`. Every control's accessible name is its line and column ("Line 2, Debit"), so a screen-reader user knows where they are without the visual grid.
- Each line's remove button is named for its line ("Remove line 2").
- The footer's balance status is a `role='status'` polite live region, and says the state in words ("Balanced", "Out of balance by $12.00"), not by colour alone.
- Focus follows the grid: after Enter, or after a line is added, the target cell's control takes focus.
- Rows are keyed by position, so typing updates a line in place and focus stays in the cell.

## Theming

The grid reads the theme: `--card` and `--card-foreground` for the frame, `--border` for line rules, `--inset` and `--border-strong` for the header band, `--foreground` for the totals rule, and `--font-mono` for the header and code and choice cells. Amount and number cells end-align with tabular numerals.

The styles sit in `@layer PretComponent`. The rules that seat each cell's control flush in its cell (width, alignment, mono) restyle **AmountInput**, **Input** and **Combobox** and sit in `@layer PretComposite`, so a caller's unlayered CSS overrides either without a more specific selector.
