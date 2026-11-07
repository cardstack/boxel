# Score Profile SQL Compiler

The score profile is a spreadsheet formula over one record's fields, lowered to a SQL number so a database can rank every row by it. A Boxel search uses it as the `_expr` sort:

```json
{ "by": "_expr", "expr": "rating / LN(priceMin + 1)" }
```

It is the part of Excel that Postgres can compute per row. What runs on a bounded result instead, with every Excel function, is the [Query Then Process](./query-then-process.md) pattern.

## What a formula may use

| Kind      | Allowed                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Values    | numbers, `TRUE`, `FALSE`, `null`                                                                                                                                                                                          |
| Fields    | a bare name (`rating`), a dotted name (`brand.name`), a jq path (`.priceMin`)                                                                                                                                             |
| Operators | `+ - * / %`, unary `-`, `^` (POWER); `= == != <> < <= > >=` and `and` / `or` inside conditions                                                                                                                            |
| Functions | `IF`, `IFERROR`, `IFNA`, `ISBLANK`, `AND`, `OR`, `NOT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `SIGN`, `SQRT`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`, `MIN`, `MAX`, `AVERAGE`, `FLOOR`, `CEILING`, `DAYS`, `NOW`, `TODAY` |

Anything else is refused with the reason: text values and text functions (`LEN`, `TEXT`), lookups, pipes, list positions and iterators, user-defined helpers. `NOW()` and `TODAY()` are dates, so they appear only inside `DAYS`, as in `DAYS(NOW(), publishedAt)`.

## Excel's semantics, in SQL

- **Errors are NULL.** Division by zero, the log or square root of a number out of range, an overflowing `EXP` or `POWER`, and a missing or non-numeric field all yield NULL rather than a database error. `IFERROR` and `IFNA` catch it, so `IFERROR(reviews / views, 0)` behaves as in Excel.
- **Blanks are skipped.** `MIN`, `MAX` and `AVERAGE` ignore missing values, as Excel's do, so `MAX(DAYS(NOW(), publishedAt), 7)` is 7 for a record with no date.
- **Truthiness.** A number is true when it is non-zero, and a boolean field reads as 1 or 0.
- **Rounding.** `ROUND` rounds half away from zero; `ROUNDUP` and `ROUNDDOWN` round away from and toward zero. The digits must be a literal whole number from -15 to 15.

A row whose formula is NULL ranks last in an `_expr` sort, and gains nothing from it as a `_blend` signal.

## API

```ts
import { compileBxlScoreToSql, BxlScoreSqlError } from '@cardstack/bxl';

const { sql, fields } = compileBxlScoreToSql(
  'IFERROR(rating / LN(priceMin + 1), 0)',
  {
    fieldToSql(parts, usage) {
      // usage is 'number' (NULL unless the value is a number) or 'timestamp'
      return usage === 'number'
        ? `(data #>> '{${parts.join(',')}}')::double precision`
        : `(data #>> '{${parts.join(',')}}')::timestamptz`;
    },
  },
);
// fields → ['rating', 'priceMin']
```

The result needs no parameters: numbers are checked finite and inlined, and field names (letters, digits, `_` and `$`) reach the SQL only through `fieldToSql`. A formula is at most 2,000 characters and 200 parts.
