# Score Profile SQL Compiler

The score profile is a spreadsheet formula over one record's fields, lowered to a SQL number so a database can rank every row by it. A Boxel search uses it for a sort entry's `expression` (the engine's `_expr` form), after the [`query` profile](./profiles.md#query) has checked what the expression may contain:

```json
{ "sort": [{ "expression": "rating / LN(priceMin + 1)" }] }
```

It is the part of Excel that Postgres can compute per row, and the only place a query expression runs: an expression outside it is refused (`expression-unsupported`). A query's comparison set reaches it as `peers.<field>` (a list) and `stats.<field>.<aggregate>` (docs/search.md, "Ranking by an expression").

## What a formula may use

| Kind      | Allowed                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Values    | numbers, `TRUE`, `FALSE`, `null`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Fields    | a bare name (`rating`), a dotted name (`brand.name`), a jq path (`.priceMin`)                                                                                                                                                                                                                                                                                                                                                                                         |
| Operators | `+ - * / %`, unary `-`, `^` (POWER); `= == != <> < <= > >=` and `and` / `or` inside conditions                                                                                                                                                                                                                                                                                                                                                                        |
| Functions | `IF`, `IFERROR`, `IFNA`, `ISBLANK`, `AND`, `OR`, `NOT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `SIGN`, `SQRT`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`, `MIN`, `MAX`, `AVERAGE`, `SUM`, `COUNT`, `MEDIAN`, `STANDARDIZE`, `PERCENTRANK_INC`, `COUNTIF` (a number criterion, `3`, `">4"`, `">" & x`; text, `"Chair"` or `"<>Chair"`, equal ignoring case, no wildcards; or a field, matched by its number or its text), `FLOOR`, `CEILING`, `DAYS`, `NOW`, `TODAY`, `NA` |

Anything else is refused with the reason: text values and text functions (`LEN`, `TEXT`), lookups, pipes, list positions and iterators, user-defined helpers. `NOW()` and `TODAY()` are dates, so they appear only inside `DAYS`, as in `DAYS(NOW(), publishedAt)`.

## Excel's semantics, in SQL

Blanks and errors follow Excel's rules, and stay apart: a blank (a missing field, or null) is SQL NULL, and an error is NaN.

- **A blank is 0** in arithmetic and in a comparison, so `rating * 2` is 0 and `rating = 0` is true for a record with no rating. `IF` on a blank takes the else branch, and `NOT` of a blank is true.
- **Blanks are skipped** by `MIN`, `MAX`, `AVERAGE`, `SUM`, `COUNT`, `MEDIAN` and the list arguments of `PERCENTRANK_INC` and `COUNTIF`, and a field they read directly gives only its numbers (each number of a list field), as Excel skips the rest of a range. `MAX(DAYS(NOW(), publishedAt), 7)` is 7 for a record with no date.
- **Errors propagate.** Division by zero, the log or square root of a number out of range, an overflowing `EXP` or `POWER`, and a field holding text, a list or an object in arithmetic are errors. An error passes through arithmetic, comparisons, `IF`'s condition and `AND`, `OR` and `NOT`.
- **`IFERROR` catches errors only.** A blank passes through it, so `IFERROR(rating, 5)` is blank for a record with no rating. `NA()` is an error; in SQL every error is one value, so `IFNA` does not tell it from another and passes errors through.
- **Text.** A field holding text that spells a number reads as that number in arithmetic. In a comparison, text ranks above every number and equals none.
- **Truthiness.** A number is true when it is non-zero, and a boolean field reads as 1 or 0, in a comparison too.
- **Rounding.** `ROUND` rounds half away from zero; `ROUNDUP` and `ROUNDDOWN` round away from and toward zero. The digits must be a literal whole number from -15 to 15.

A formula whose value is blank or an error has no score: it ranks last in an `_expr` sort and gains nothing from it as a `_blend` signal. A value past a double's range makes Postgres raise rather than return; a Boxel search then refuses the query (`limit-exceeded`).

`prepareSpreadsheetFormula` computes the same values in JavaScript, for the formulas a database cannot run: it knows the operators and the functions above (and `SUM`, `COUNT`, `IFS` and the `IS…` tests), and hands any other function to the caller after an error among its arguments has become the result. The realm-server suite `formula-parity-test.ts` runs every formula in a matrix of records both ways and requires the same value.

Each value is read once where Postgres allows it: a simple `CASE`'s operand, `NULLIF` and `COALESCE` evaluate once, and `GREATEST` ranks NaN above every number. So `MAX` is `GREATEST`, `MIN` is the negated `GREATEST` of the negatives, and a comparison is a `CASE` on the sign of the difference.

## API

```ts
import { compileBxlScoreToSql, BxlScoreSqlError } from '@cardstack/bxl';

const { sql, fields } = compileBxlScoreToSql(
  'IFERROR(rating / LN(priceMin + 1), 0)',
  {
    fieldToSql(parts, usage) {
      // usage is 'number', 'passthrough', 'compare', 'aggregate' or
      // 'timestamp': see BxlScoreSqlUsage
      return usage === 'number'
        ? `(data #>> '{${parts.join(',')}}')::double precision`
        : `(data #>> '{${parts.join(',')}}')::timestamptz`;
    },
  },
);
// fields → ['rating', 'priceMin']
```

The result needs no parameters: numbers are checked finite and inlined, and field names (letters, digits, `_` and `$`) reach the SQL only through `fieldToSql`. A formula is at most 2,000 characters and 200 parts.
