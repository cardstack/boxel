# formulajs — Upstream Diff Audit

**Upstream:** `formulajs/formulajs` @ `v4.6.0` (commit `82eccb0`, MIT).
**Audited:** 2026-04-22.

Summarizes what was imported, what was adapted, and what was omitted.

## Selection policy

Formula.js ships **397** uppercase Excel-function exports. BXL ships a curated
subset targeting **scalar and analytic** use:

- Functions that take scalar or flat-array inputs and return a scalar, array,
  or structured value — **imported**.
- Functions that duplicate jq's data-reshaping operators (`FILTER`, `SORT`,
  `UNIQUE`, `MAP`, `VSTACK`, `HSTACK`, `CHOOSECOLS`, `CHOOSEROWS`, etc.) —
  **omitted**; use jq operators.
- Functions that assume spreadsheet coordinates (`OFFSET`, `INDIRECT`,
  `ADDRESS`, `ROW`, `COLUMN`, `ROWS`, `COLUMNS`) — **omitted**; BXL paths
  replace the use case.
- Lookup functions (`VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH`, `XLOOKUP`) —
  **omitted**; BXL predicate paths (`[SKU = "X"]`, `[Quantity > 5]`) cover
  lookups more idiomatically.

## File-by-file mapping

BXL's modules are organized by role, not by Excel category. The table maps
each BXL file to its upstream sources.

| BXL file              | Upstream source modules                    | Purpose |
| --- | --- | --- |
| `bessel.ts`           | `engineering.js`                           | Bessel special functions that require upstream's external `bessel` dependency. This module is only imported through BXL's async lazy formula path. |
| `common.ts`           | `utils/*`, `information.js`, `statistical.js` | Input coercion (`parseExcel*`), type guards, aggregate helpers (`sumExcelRange`, `maxExcelRange`). |
| `criteria.ts`         | `statistical.js` (criteria matching), `text.js` (wildcards) | `SUMIF` / `COUNTIF` / `AVERAGEIF` predicate matching. |
| `dateSerial.ts`       | `date-time.js`, `utils/date.js`            | Excel serial-day arithmetic, `DATE`, `YEAR`, `MONTH`, `DAY`, `NOW`, `NETWORKDAYS`, `WORKDAY`, `DATEDIF`, `WEEKNUM`. |
| `engineering.ts`      | `engineering.js`                           | `BIN2DEC`, `HEX2DEC`, `BITAND`, `BITXOR`, `ROMAN`, `ARABIC`, complex-number ops (`IMSINH`, `IMCOSH`, etc.). |
| `errors.ts`           | `information.js` (error type checks) + ours | `EXCEL_ERROR` enum, `throwExcelError`, `ExcelError` class. Our adaptation of upstream's return-value sentinels (`#N/A`, `#VALUE!`) to throwable errors. |
| `financial.ts`        | `financial.js`                             | `PMT`, `FV`, `PV`, `NPV`, `IRR`, `RATE`, `NPER`, `IPMT`, `PPMT`, etc. |
| `statistical.ts`      | `statistical.js`                           | Distribution/test helpers that require upstream's external `jstat` dependency. This module is only imported through BXL's async lazy formula path. |

## Our adaptations

### 1. Error-handling translation

Upstream returns error strings (`"#N/A"`, `"#VALUE!"`) for invalid inputs.
BXL adapts to throwing a typed `ExcelError` via `throwExcelError(kind)` —
lets errors propagate through the jq evaluator and be caught at bridge
points by upstream jq's `try/catch` semantics.

Each imported function was edited to call `throwExcelError(EXCEL_ERROR.num)`
in places where upstream returns `'#NUM!'`, etc.

### 2. Input coercion layer

Upstream assumes callers pass already-coerced numbers/strings. BXL helpers
accept `unknown` and coerce via `parseExcelNumber`, `parseExcelBool`,
`parseExcelString`, `flattenExcelArgs` (handles jq arrays-of-arrays).

Consequence: function bodies are mostly upstream logic with a coercion
preamble.

### 3. TypeScript signatures

- All files renamed `.js` → `.ts`.
- Parameters typed `unknown` + coerced; return types explicit (`number`,
  `string`, `boolean`, `number[]`, etc.).
- No `any` leakage in the public function surface.

### 4. Curated function set

Count: BXL's native formula-filter registry exposes **280** Excel functions
(plus 7 jq-defined helpers like `IF`, `IFERROR`, `IFNA`), drawn from upstream's
397. See `jqxl-syntax-reference` §Formula matrix for the authoritative list.

## Bringing in new upstream functions

When upstream adds a function we want:

1. Locate the module in upstream `formulajs/src/` (e.g. `statistical.js`).
2. Decide which BXL file it belongs in by **role**, not upstream category.
3. Port the implementation: add types, replace sentinels with
   `throwExcelError`, add coercion if needed.
4. Register regular formulas in `src/bxl/bridge/formula-contrib-native.ts`.
   Register `jstat`-backed statistical formulas in
   `src/bxl/bridge/formula-statistical-native.ts` and add their names to
   `src/bxl/bridge/formula-statistical-manifest.ts` so async runtimes can
   lazy-load them only when referenced. Register `bessel`-backed engineering
   formulas the same way via `src/bxl/bridge/formula-bessel-native.ts` and
   `src/bxl/bridge/formula-bessel-manifest.ts`.
5. Add an example to `examples/formula.ts` and a test case.
6. Update this file with the upstream source + BXL destination.

## Version pinning

`v4.6.0` is the audit basis. Upstream activity (VSTACK, CHOOSECOLS, HSTACK,
EXPAND in recent commits) is explicitly **not** imported because those
functions fall outside our selection policy.
