# src/formulajs/

**Origin:** derived from [formulajs/formulajs](https://github.com/formulajs/formulajs)
at `v4.6.0` (MIT, © 2014 Sutoiku Inc.). See [`/NOTICE.md`](../../NOTICE.md)
for full attribution.

This directory contains **Excel-style formula implementations** — math/trig,
logical, lookup, date-time, financial, engineering, statistical, and text
helpers — adapted to BXL's runtime and error conventions.

## Layering rules

`src/formulajs/` **must not** import from `src/bxl/` or `src/jqtools/`.
It stands alone as a formula implementation library. The glue that exposes
these functions as jq builtins lives in `src/bxl/bridge/`.

## What we took from upstream

- Scalar math/trig functions (`ROUND`, `ABS`, `POWER`, `SQRT`, `ACOS`, `SIN`,
  `TAN`, etc.).
- Date/time helpers (`NOW`, `DATE`, `YEAR`, `NETWORKDAYS`, `WORKDAY`, etc.).
- Financial helpers (`PMT`, `FV`, `PV`, `NPV`, `IRR`, `RATE`, etc.).
- Complex engineering helpers (`IMSINH`, `IMCOSH`, `BIN2DEC`, `ROMAN`, etc.).
- Criteria evaluation (`SUMIF`, `COUNTIF`, `AVERAGEIF` matching semantics).

## What we **did not** take

Functions that duplicate jq's own data-reshaping capabilities, assume
spreadsheet coordinates, or rely on a spreadsheet grid model are omitted.
Specifically:

- `VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH` — BXL paths + predicates cover these.
- `FILTER`, `SORT`, `UNIQUE`, `SORTBY`, `CHOOSECOLS`, `CHOOSEROWS` — jq has
  `map`, `select`, `unique_by`, `sort_by`, etc.
- `VSTACK`, `HSTACK`, `EXPAND`, `TOCOL`, `TOROW` — jq `+` and array
  comprehensions cover array composition.
- `OFFSET`, `INDIRECT`, `ADDRESS` — no spreadsheet grid.

See `jqxl-syntax-reference` Use Cases for idiomatic BXL replacements.

## Our adaptations vs. upstream

1. **TypeScript port.** Upstream is `.js` with JSDoc types; we use `.ts`
   with typed signatures. Most conversions are mechanical.
2. **Error convention.** Upstream returns error sentinels (`#N/A`, `#VALUE!`
   as strings). BXL throws a typed `ExcelError` via `throwExcelError()` from
   `errors.ts` so errors propagate cleanly through the jq evaluator. Catch
   points are in `src/bxl/bridge/formula-contrib-*.ts`.
3. **Input coercion.** Helpers accept `unknown` and coerce via
   `parseExcelNumber`, `parseExcelString`, `parseExcelBool`, `flattenExcelArgs`
   from `common.ts` — makes them robust to jq's loose JSON values.
4. **Organizational renaming.** Upstream groups by Excel category
   (`math-trig.js`, `text.js`, `logical.js`, etc.). We group by BXL role
   (`common.ts`, `criteria.ts`, `dateSerial.ts`, `engineering.ts`, `errors.ts`,
   `financial.ts`). Mapping lives in `UPSTREAM-DIFFS.md`.

## Version pinning

`v4.6.0` is the audit basis. Upstream tracking is documented in
[`UPSTREAM-DIFFS.md`](./UPSTREAM-DIFFS.md). When upstream adds functions we
want to support, we port them manually — there is no automated sync.
