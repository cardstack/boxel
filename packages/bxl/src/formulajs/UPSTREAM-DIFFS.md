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

| BXL file         | Upstream source modules                                     | Purpose                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bessel.ts`      | `engineering.js`                                            | Bessel special functions that require upstream's external `bessel` dependency. This module is only imported through BXL's async lazy formula path.      |
| `common.ts`      | `utils/*`, `information.js`, `statistical.js`               | Input coercion (`parseExcel*`), type guards, aggregate helpers (`sumExcelRange`, `maxExcelRange`).                                                      |
| `criteria.ts`    | `statistical.js` (criteria matching), `text.js` (wildcards) | `SUMIF` / `COUNTIF` / `AVERAGEIF` predicate matching.                                                                                                   |
| `dateSerial.ts`  | `date-time.js`, `utils/date.js`                             | Excel serial-day arithmetic, `DATE`, `YEAR`, `MONTH`, `DAY`, `NOW`, `NETWORKDAYS`, `WORKDAY`, `DATEDIF`, `WEEKNUM`.                                     |
| `engineering.ts` | `engineering.js`                                            | `BIN2DEC`, `HEX2DEC`, `BITAND`, `BITXOR`, `ROMAN`, `ARABIC`, complex-number ops (`IMSINH`, `IMCOSH`, etc.).                                             |
| `errors.ts`      | `information.js` (error type checks) + ours                 | `EXCEL_ERROR` enum, `throwExcelError`, `ExcelError` class. Our adaptation of upstream's return-value sentinels (`#N/A`, `#VALUE!`) to throwable errors. |
| `financial.ts`   | `financial.js`                                              | `PMT`, `FV`, `PV`, `NPV`, `IRR`, `RATE`, `NPER`, `IPMT`, `PPMT`, etc.                                                                                   |
| `statistical.ts` | `statistical.js`                                            | Distribution/test helpers that require upstream's external `jstat` dependency. This module is only imported through BXL's async lazy formula path.      |

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
(plus 7 jq-defined helpers like `IF`, `IFERROR`, `IFNA`), drawn from upstream's 397. See [`docs/formulas.md`](../../docs/formulas.md) for the authoritative list.

### 5. Dates are anchored to UTC, not the host time zone

An Excel serial names a calendar day, not an instant, so the same expression
has to give the same answer wherever it runs. That is not a preference here:
BXL evaluates a card's computeds server-side during indexing, in UTC, and again
in the viewer's browser, in their own zone — a serial that shifted with the host
would make the indexed search doc and the prerendered HTML disagree with what
the viewer sees.

Upstream builds and reads dates in local time: `serialToDate` ends
`new Date(y, month, days, …)`, `EOMONTH` uses `new Date(getFullYear(),
getMonth() + months + 1, 0)`, `WEEKDAY` uses `.getDay()`, and the string branch
parses `date + 'T00:00:00.000'` with no zone. BXL constructs with `Date.UTC` and
reads with `getUTC*` throughout, and a date string that names no zone has its
civil fields re-anchored to UTC rather than resolved against the host. Strings
carrying an explicit offset still resolve as instants.

The local-time form is not merely zone-sensitive but self-inconsistent, because
the serial epoch materializes at a zone's 1899 offset while results are read at
its modern one — the two differ by 8 minutes in Kolkata and by nearly a day at
+14, which is how a month-end could land 30 days off.

Two other divergences ride along, both restoring upstream behavior BXL had lost:
`EDATE` clamps day-of-month to the target month's last day (upstream clamps;
BXL let the day overflow, so a January 31st plus one month gave March 3rd), and
`TODAY` reads the same UTC clock `NOW` reads, so `FLOOR(NOW()) = TODAY()` holds
in every zone.

### 6. Functions corrected against Excel's specification

Writing a coverage case for every exposed function turned up a batch that
answered something other than what Excel documents. Each now matches the
specification, so any of these that still reads like upstream's version is a
regression rather than a port detail.

| Function                              | What it does now                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROPER`                              | Capitalizes any letter following a non-letter, so `2-way` becomes `2-Way`. A word is a run of letters, not a run of non-spaces.                |
| `TRIM`                                | Collapses and strips the ASCII space only, leaving tabs, newlines and U+00A0 to `CLEAN` and `SUBSTITUTE`.                                      |
| `SEARCH`                              | Reads `find_text` as a wildcard pattern — `*`, `?`, and `~` escaping either — which is the other half of what separates it from `FIND`. Matched by `wildcard.ts` in one forward pass, not by a regex: `.*` per star makes a backtracking engine exponential, which turns a stray run of asterisks into a hung indexing worker. `COUNTIF`'s criteria go through the same matcher. |
| `SUBSTITUTE` (4-argument)             | Counts an occurrence at position 0, so instance 1 is the first match wherever it sits.                                                         |
| `TEXT`                                | Renders date and time format codes rather than returning the bare serial. `mm` reads as minutes only where the clock puts it — after an hour run, or before a seconds run — and as the month everywhere else, `mmmmm` as the month's initial. Bracketed runs are colour, condition and locale codes and print nothing, except `[h]`/`[m]`/`[s]`, which are elapsed totals. |
| `NUMBERVALUE`                         | Ignores spaces anywhere in the text and divides by 100 per trailing percent sign, so `9%%` is 0.0009.                                          |
| `CHAR`                                | Restricted to 1–255, the single-byte range. `UNICHAR` is the one that reaches past it.                                                         |
| `ISEVEN`, `ISODD`                     | Truncate toward zero before testing parity, so `ISEVEN(-2.5)` is true.                                                                        |
| `WEEKDAY`, `WEEKNUM`                  | Honour every return type, including the 11–17 ladder that walks the start of the week forward and `WEEKNUM`'s ISO 21. Others raise `#NUM!`.    |
| `ISOWEEKNUM`, `WEEKNUM(…, 21)`        | Number from the week holding the year's first Thursday, so an early-January date reports the previous ISO year's 52nd or 53rd week.            |
| `TIMEVALUE`                           | Reads a trailing meridiem, so an afternoon time is not twelve hours early.                                                                    |
| `BASE`, `BIN2HEX`, `DEC2HEX`, `OCT2HEX` | Emit upper-case digits above 9. The reading side already accepts either casing, so a round trip survives.                                    |
| `COMPLEX` and the `IM*` family        | Drop the coefficient for an imaginary part of -1 as well as +1, so `COMPLEX(0, -1)` is the `-i` the parser already reads.                      |
| `ERF`, `ERFC`                         | Computed from the regularized incomplete gamma function to full double precision. `ERFC` is the upper tail, not `1 - ERF`, so the far tail keeps its digits. Both ends of the argument range are answered directly, since x² is what overflows and underflows first: erf saturates at ±1 above ~1.3e154 and is 2x/√π below ~1.5e-162. |
| `WEIBULL_DIST`                        | Takes alpha as the shape and beta as the scale, as Excel does. jstat's signature is `(x, scale, shape)`, so they cross at the call.            |
| `T_TEST`                              | Pairs its Welch standard error with Welch–Satterthwaite degrees of freedom — Excel's two-tailed unequal-variance test, type 3.                 |
| `IRR`, `IRR_BY`, `XIRR`               | Raise `#NUM!` unless the rate the search settled on is really a root — its net present value is zero, or the value changes sign across it. The second test is what recognizes a root near -100% or on a long series, where discounting amplifies rounding past any fixed residual. |
| `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD` | Raise `#NUM!` for a maturity more than a year past settlement.                                                                                |
| `COUPDAYS`                            | Measures the real coupon period containing settlement under basis 1, actual/actual, with the schedule measured from maturity and sticky to month ends — a bond maturing on the last day of a month pays on the last day of every month. The other bases give every period the same nominal length, but all of them validate the dates. |

`DAYS360`'s US/NASD method implements the day-31 rule but not the
last-day-of-February rule Microsoft documents, which is left alone: Excel's own
shipped behavior is known to diverge from that doc text, so matching the text
would mean diverging from Excel.

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
