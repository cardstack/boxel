# BXL Syntax Reference

The canonical BXL syntax reference. Readable labels, one-based rows, predicates, and positional selectors on top of jq pipes and 300+ Excel formula helpers. Compiles to canonical jq; same evaluator, same AST, one language.

> This is the Markdown mirror of [`docs/syntax-reference.html`](./syntax-reference.html). The HTML version has syntax highlighting and a rendered layout — open it in a browser for the best reading experience.

---

## Mental Model

If you know spreadsheets, you know the core idea. The difference: instead of cell references like `A1:B10`, you work with JSON -- fields, arrays, and objects.

| Spreadsheet | BXL (readable, with sugar) |
| --- | --- |
| Cell value | JSON scalar (number, string, boolean) |
| Range `A1:A10` | Array field — navigate it as `"Line Item"` or materialize with `"Line Item"[all]` |
| Table with headers | Array of objects — each object's keys are the columns (`Quantity`, `"Unit Price"`, …) |
| Current row | `.` (the dot — current JSON value inside `map`/`select`) |
| `=A1 + B1` | `Price + Tax` |
| `=SUM(A1:A10)` | `SUM("Line Item".Amount)`  — implicit iteration, no `map` needed |
| `=IFERROR(A1, 0)` | `IFERROR(Value, 0)` |
| `=SUMIF(C:C, "Service", B:B)` | `SUM("Line Item"[* ."Category" = "Service"].Amount)` |
| `=VLOOKUP(E2, A:B, 2, FALSE)` | `"Line Item"[SKU = Target SKU]."Unit Price"`  — first-match predicate |
| `=A1` (first row) | `"Line Item"[#first].Amount` |
| `=INDEX(A:A, ROWS(A:A))` (last) | `"Line Item"[#last].Amount` |
| `=ROUND(B1*C1, 2)` | `ROUND(Quantity * "Unit Price", 2)` |

> **Notice what changes between Excel and BXL:** no cell letters (`A1`), no absolute columns (`A:A`), no separate `ROWS()` to get the last position. Every row shows a different piece of sugar in action — labels replace cell references, implicit iteration replaces `map`, `[* .pred]` replaces `SUMIF`, first-match `[pred]` replaces `VLOOKUP`, and positional selectors replace `INDEX`/`ROWS` arithmetic.

> **Commas for Excel, semicolons for `def`.** Built-in Excel formulas take commas to match spreadsheet paste: `ROUND("Unit Price", 2)`, `SUM(a, b, c)`. BXL rewrites the comma-separated argument list to jq's `;` form during compile so the runtime sees valid jq — that rewrite happens under the hood; `ROUND("Unit Price"; 2)` is not paste-compatible with Excel and is not a form authors write. The rewrite applies **only** to built-in Excel formulas: user-defined `def` helpers must use `;` at both the definition (`def clamp(lo; hi; x): …`) and the call (`clamp(0; 100; .score)`). Array literals also use **commas**: `[1, 2, 3]`.

### Naming convention: UPPERCASE is Excel, lowercase is BXL-native

Every helper name in BXL follows one of two conventions. The compiler is case-insensitive (`ROUND`, `round`, and `Round` all resolve to the same function), but the convention communicates _intent_ to the reader.

| Reader sees | Interpretation | Examples |
| --- | --- | --- |
| `UPPERCASE` | Real Microsoft Excel function — paste-compatible, matching semantics. **We never invent new UPPERCASE names.** | `ROUND`, `SUM`, `IFERROR`, `VLOOKUP`, `ISBLANK` |
| `lowercase` | BXL-native contribution — jq ecosystem primitive or a BXL-specific shortcut. Not portable to Excel. | `present`, `when` / `implies`, `words`, `nonempty`, `map`, `select`, `add` |

> **If a helper name is UPPERCASE, you can paste it into an Excel cell and expect the same answer.** If it's lowercase, it's BXL's own vocabulary. The convention is enforced socially in review, not by the compiler — but keep it honest in authored expressions so reviewers can trust the promise.

### How `MATCH` and `match` dispatch

BXL keeps lookup case-insensitive: `ROUND`, `round`, `Round`, and `rOUNd` are the same spelling for lookup. Casing is style, not semantics. When Excel and jq share a case-folded name, BXL decides the meaning from syntax that survives copy/paste:

1. **Arity and call shape first.** Explicit arguments decide most cases: `LOG(x)` is Excel `LOG/1`, while `x | log` is jq `log/0`. Piped input does not count as an explicit argument. For `NOW`, parenthesized `NOW()` / `now()` is Excel; bare `now` / `NOW` is jq.
2. **Separator second.** If the same explicit arity exists on both sides, comma means Excel/readable BXL and semicolon means jq. `MATCH(value, array)` is Excel lookup; `match(re; flags)` is jq regex matching. `ATAN2(x, y)` is Excel order; `atan2(y; x)` is jq/POSIX order.
3. **Casing last.** After dispatch, the formatter prefers UPPERCASE for Excel and lowercase for jq. The linter nudges mismatches, but the compiler does not make `NOW` or any other function case-sensitive.

Commas are for Excel formulas and readable BXL helpers: `MATCH(value, array)`, `when(condition, result)`. Semicolons are for jq calls and jq `def` syntax: `match(re; flags)`, `def helper(x): ...;`.

#### Non-colliding pairs

Most jq/Excel pairs use different names, or the same name with different arity:

| jq form | Excel form | How they coexist |
| --- | --- | --- |
| `x \| pow(y)` / `pow(b; e)` | `POWER(b, e)` | Different names, same parameter order. |
| `fmod(a; b)` | `MOD(a, b)` | Different names, different sign semantics: `fmod(-7; 3) = -1`; `MOD(-7, 3) = 2`. |
| `fmax(a; b)` / `fmin(a; b)` | `MAX(arr)` / `MIN(arr)` | Different names, different NaN/error handling. |
| `jn(n; x)` / `yn(n; x)` | `BESSELJ(x, n)` / `BESSELY(x, n)` | Different names and different argument order. |
| `x \| sin`, `x \| sqrt`, `x \| exp` | `SIN(x)`, `SQRT(x)`, `EXP(x)` | Same case-folded idea, different explicit arity. |

#### Practical collision table

| Name | Excel/readable BXL | jq | Dispatch note |
| --- | --- | --- | --- |
| `MATCH` / `match` | `MATCH(value, array)` / `MATCH(value, array, type)` | `text \| match(re)` / `text \| match(re; flags)` | Arity separates `match/1` and `MATCH/3`; separator separates `match/2` from `MATCH/2`. |
| `INDEX` / `index` | `INDEX(array, row)` / `INDEX(array, row, col)` | `array \| index(value)` / `text \| index(substr)` | Arity separates jq `index/1` from Excel `INDEX/2` and `INDEX/3`. |
| `TYPE` / `type` | `TYPE(value)` returns Excel numeric type code | `value \| type` returns jq type string | Arity separates jq `type/0` from Excel `TYPE/1`. |
| `LOG` / `log` | `LOG(value)` is base-10 by default | `value \| log` is natural log | Arity separates jq `log/0` from Excel `LOG/1` and `LOG/2`. |
| `NOW` / `now` | `NOW()` returns Excel date serial | `now` returns Unix epoch seconds | Call shape separates this: parenthesized call is Excel; bare filter is jq. |
| `TRIM` / `trim` | `TRIM(text)` trims and collapses internal whitespace | `text \| trim` trims outer whitespace | Arity separates jq `trim/0` from Excel `TRIM/1`. |
| `ATAN2` / `atan2` | `ATAN2(x, y)` uses Excel order | `atan2(y; x)` uses jq/POSIX order | Arity separates jq `atan2/1`; separator separates Excel `ATAN2/2` from jq `atan2/2`. |

```text
MATCH("b", ["a", "b"], 0)   -- Excel lookup, returns 2
"abc123" | match("\\d+")     -- jq regex match object
"abc123" | match("\\d+"; "i") -- jq regex match with flags

LOG(100)                    -- Excel base-10 log, returns 2
100 | log                   -- jq natural log

NOW()                       -- Excel date serial
now                         -- jq Unix epoch seconds

ATAN2(1, 2)                 -- Excel order: Math.atan2(y=2, x=1)
atan2(1; 2)                 -- jq/POSIX order: Math.atan2(y=1, x=2)
```

Edge case: **jq `atan2(0; 0)` returns `0` in BXL** for POSIX compatibility. Excel `ATAN2(0, 0)` follows Excel and returns `#DIV/0!`.

#### `GAMMA` — different definitions, resolved to true Γ

`GAMMA` is a known minefield across libraries:

- **C / POSIX `gamma()`**: deprecated; historically log-Γ on Linux, true Γ on BSD. Implementation-defined. Vanilla jq inherits whatever libm it was linked against — there is no portable "jq-correct" answer.
- **Excel `GAMMA(x)`**: true Γ, unambiguously.

BXL canonicalizes both `GAMMA/1` (Excel) and `gamma/0` (jq) to **true Γ**. Use `GAMMA(x)` for Excel-style explicit calls; use `x | gamma` for jq pipe form.

If you need log-Γ, use the unambiguous spellings — they compute the same thing in either dialect:

| Want | jq spelling | Excel spelling |
| --- | --- | --- |
| true Γ(x) | `x \| gamma` (== `tgamma`) | `GAMMA(x)` |
| log Γ(x) | `x \| lgamma` | `GAMMALN(x)` |

#### Quick reference: collisions and resolutions

> Spelling reminder: prefer the **UPPERCASE** form for any name that ends up at an Excel function. Lowercase still resolves but the linter emits an info-level `excel-name-uppercase-preferred` nudge — see [Linter style nudges](#linter-style-nudges).

| Function | BXL behaviour | Notes |
| --- | --- | --- |
| `MATCH(value, array)` / `match(re; flags)` | Excel lookup with comma; jq regex with semicolon | `match(re)` is jq by arity; `MATCH(value, array, 0)` is Excel by arity. |
| `INDEX(array, row)` / `index(value)` | Excel lookup with 2-3 args; jq index-of with 1 arg | Excel rows are one-based; jq index result is zero-based. |
| `TYPE(value)` / `type` | Excel numeric type code vs jq type string | Parenthesized one-arg call is Excel; bare pipe filter is jq. |
| `LOG(x)` / `log` | Excel base-10 log vs jq natural log | Arity decides. `LOG(x, base)` is Excel. |
| `NOW()` / `now` | Excel date serial vs jq epoch seconds | Call shape decides. `now()` is Excel and formats to `NOW()`. Bare `NOW` is jq and formats to `now`. |
| `TRIM(text)` / `trim` | Excel collapse whitespace vs jq outer trim | Arity decides. |
| `ATAN2(x, y)` / `atan2(y; x)` | Excel order with comma; jq/POSIX order with semicolon | Separator decides the two-arg collision. |
| `GAMMA(x)` / `gamma` | true Γ | Same math; use `lgamma` or `GAMMALN` for log-Γ. |
| `fmod` vs `MOD` | independent functions | `fmod` dividend-signed (C); `MOD` divisor-signed (Excel) |
| `fmax`/`fmin` vs `MAX`/`MIN` | independent functions | `fmax`/`fmin` skip NaN; `MAX`/`MIN` propagate errors |
| `jn`/`yn` vs `BESSELJ`/`BESSELY` | independent functions | `jn(n; x)` (C order); `BESSELJ(x, n)` (Excel order) |
| `pow` vs `POWER` | independent functions | Same param order in both, no impedance |

> **Why no runtime dialect flag?** Earlier drafts considered an `expression(jq\`…\`)` mode. BXL does not need it: arity/call shape and separators preserve the intent that users paste from Excel or jq, while casing stays a formatter/linter convention.

#### Linter style nudges

The runtime is case-insensitive: `atan2`, `Atan2`, `ATAN2` all participate in the same dispatch rules. When an expression is being **edited or saved through the BXL parser** (the realm UI, the `bxl --lint` CLI, or any caller of `lintBxlExpression`), the linter checks the resolved dialect:

```
✕  atan2(.x, .y)          info  excel-name-uppercase-preferred
                                ATAN2 is an Excel formula — spell it UPPERCASE.
                                The lookup is case-insensitive, but UPPERCASE makes
                                the paste-from-spreadsheet contract obvious to readers.
                                Suggestion: ATAN2(.x, .y)

✕  MATCH("\\d+"; "i")      info  jq-name-lowercase-preferred
                                match is a jq filter in this call shape — spell it lowercase.
```

The rule applies only after dispatch. `atan2(x, y)` lints to uppercase because comma means Excel; `ATAN2(y; x)` lints to lowercase because semicolon means jq. `now()` lints/formats to `NOW()`, while bare `NOW` lints/formats to `now`. It does not fire on lowercase names that are jq-only (`map`, `select`, `add`, `pow`, `fmod`, `hypot`, `jn`, etc.).

Severity is `info`, never `error` — your code still compiles and runs.

## Top 10 things to remember

If you only remember ten things about BXL, remember these. Every other section expands on one of them.

| # | Rule | In practice |
| --- | --- | --- |
| **1** | **Labels replace paths in schema-aware contexts.** `"Line Item".Quantity`, not `.lineItems[].quantity`. | Write what the UI shows. The compiler resolves display names via the active schema. |
| **2** | **Implicit iteration on array fields.** Navigating `.field` on an array auto-materializes. | `SUM("Line Item".Amount)` — no `map`, no `[all]`. Sugar beats boilerplate. |
| **3** | **One-based rows use `[#N]`; raw `[N]` is 0-based jq.** They mean different elements. | `[#4]` = 4th row. `[3]` = 4th row but zero-based (escape hatch). Pick one style per expression. |
| **4** | **Predicates come in two shapes.** `[pred]` returns the first match; `[* .pred]` returns every match. | Scalar vs array result. `[SKU="X"]` finds one; `[* ."Taxable"]` filters all. |
| **5** | **Excel-style equality works:** `=` and `<>` compile to `==` and `!=`. | Paste `IF(Status="paid", …)` from Excel, no edits needed. |
| **6** | **UPPERCASE is a promise.** `ROUND`, `SUM`, `ISBLANK` match Microsoft Excel exactly. lowercase (`present`, `when`, `words`) is BXL-native. | UPPERCASE paste-compatible with Excel cells. lowercase is BXL's own vocabulary. |
| **7** | **Positional selectors live in `[#...]` only.** Positive selectors are 1-based; last-relative selectors count backward from the end. | `[#1]`, `[#4]`, `[#first]`, `[#last]`, `[#last-1]`, `[#4..#last-3]`, `[#1, #2, #7..#9, #11]`, `[#odd]`, `[#even]`, `[#only]`. |
| **8** | **Root auto-binds across pipes.** Readable labels after `\|` resolve against the root card, not the piped-in value. | `"Line Item"."Line Total" \| add = Subtotal` — `Subtotal` reads from the root. |
| **9** | **Presence is context-dependent.** `ISBLANK` is Excel-strict (null only). `present` is form-friendly (null or `""`). | `present(Email)` for form validation. `NOT ISBLANK(Email)` when you need Excel's semantics. |
| **10** | **Formatters pipe and interpolate.** `\| @fmt` transforms a value; `@fmt "… \(expr) …"` escapes every interpolation into a safe sink. | `@html "Hi \(Name)"` escapes XSS. `@uri` for URLs. `@json` / `@csv` / `@base64` for machine sinks. |

> **Honorable mentions.** `when(p, q)` / `implies(p, q)` for "if this, then that must hold" constraints. `nonempty(arr)` to strip `null` / `""` before counting. `words(s)` to count whitespace-separated tokens.

## Readable Paths

BXL keeps canonical jq valid and adds a schema-aware readable layer. Labels, one-based rows, predicates, and positional selectors compile to the same AST shape the jq evaluator already understands.

> **Runtime shape:** BXL is a compiler front-end for jq. It rewrites readable source to canonical jq, then uses the same tokenizer, parser, evaluator, formula helpers, and jq builtins. Async runtimes (`runNativeJqAsync`, `prepareNativeJqAsync`, `prepareBoxelRuntimeAsync`) also inspect expressions and lazy-load large FormulaJS extension libraries only when referenced. Sync evaluators use the eager formula core unless a lazy library is explicitly registered.

### Labels, rows, and implicit iteration

| Readable BXL | Canonical jq | Meaning |
| --- | --- | --- |
| `Total` | `.total` | Bare labels work when the schema resolves them unambiguously. |
| `"Bill To"."Country Code"` | `.billTo.countryCode` | Quoted labels handle spaces and punctuation. |
| `"Line Item"[#4].Quantity` | `.lineItems[3].quantity` | `[#N]` is the canonical one-based row shortcut. |
| `"Line Item"[#1..#3].SKU` | `[.lineItems[0:3][].sku]` | One-based inclusive range — first three SKUs. |
| `"Line Item"."Line Total"` | `[.lineItems[].lineTotal]` | **Implicit iteration** — navigating `.field` on an array field auto-materializes, just like `[all]`. |
| `"Line Item"[all].Quantity` | `[.lineItems[].quantity]` | Explicit form remains valid. |

> **Legacy row shortcuts.** `[row N]` and `[item N]` still parse but solidify rewrites them to `[#N]`. Keep `[0]` / `[0:3]` (zero-based, jq-native) as the escape hatch when you need it.

> **Range translation is intentional.** The preferred readable spelling is `[#4..#6]`: inclusive, one-based rows `4, 5, 6`. jq slices are zero-based and the end is exclusive, so the correct lowering is `[3:6]`, not `[3:5]`. Shorter `[#4..6]` remains accepted as an alias.

### Predicates: first-match and filter-all

| Readable BXL | Canonical jq | Shape |
| --- | --- | --- |
| `"Line Item"[SKU = "COPY-04"].Quantity` | `first(.lineItems[] \| select(.sku == "COPY-04")).quantity` | **First match** — scalar result. |
| `"Line Item"[* ."Category" = "Service"]` | `[.lineItems[] \| select(.category == "Service")]` | **Filter all** — `[* .pred]` keeps every matching row. |
| `SUM("Line Item"[* ."Taxable"]."Line Total")` | `SUM([.lineItems[] \| select(.taxable).lineTotal])` | Excel `SUMIF` shape — no dedicated `_BY` builtin needed. |
| `COUNTA("Line Item"[* .Quantity > 5])` | `COUNTA([.lineItems[] \| select(.quantity > 5)])` | Excel `COUNTIF` shape. |
| `"Line Item"[* .Quantity * ."Unit Price" > 15].SKU` | `[.lineItems[] \| select(.quantity * .unitPrice > 15).sku]` | Arbitrary boolean predicate — arithmetic across sibling fields. |
| `"Line Item"[SKU \| startswith("BRAND")]` | `first(.lineItems[] \| select(.sku \| startswith("BRAND")))` | String predicates use jq pipe form. |

> **Predicate truthiness.** `[* ."Taxable"]` uses jq item-scope truthiness — `true` keeps, `false` / `null` / missing filter out — same as jq's native `select(.taxable)`.

### Positional selectors

| Readable BXL | Canonical jq | Notes |
| --- | --- | --- |
| `"Line Item"[#first].SKU` | `.lineItems[0].sku` | First item. |
| `"Line Item"[#last]."Line Total"` | `.lineItems[-1].lineTotal` | Last item. |
| `"Line Item"[#last-1].SKU` | `.lineItems[-2].sku` | Second from the end. |
| `"Line Item"[#4].Quantity` | `.lineItems[3].quantity` | Positive selectors are 1-based. |
| `"Line Item"[#2..#last-1].SKU` | `[(.lineItems) as $__seq \| $__seq[1:(($__seq \| length) - 1)][].sku]` | Forward anchored range from the front to the back. |
| `"Line Item"[#last-3..#last-1].SKU` | `[(.lineItems) as $__seq \| $__seq[(($__seq \| length) - 4):(($__seq \| length) - 1)][].sku]` | Forward anchored range fully from the back. |
| `"Line Item"[#1, #2, #7..#9, #11].SKU` | `[(.lineItems) as $__seq \| ($__seq \| length) as $__len \| range(0; $__len) as $__idx \| select($__idx == 0 or $__idx == 1 or ($__idx >= 6 and $__idx < 9) or $__idx == 10) \| $__seq[$__idx].sku]` | Selector union. Output stays in collection order and overlaps collapse naturally. |
| `"Line Item"[#-1].SKU` | `.lineItems[-1].sku` | jq-native alias for the last item. |
| `"Line Item"[#odd]` | `[.lineItems \| .[range(0; length; 2)]]` | Positions 1, 3, 5 (1-based). |
| `"Line Item"[#even]` | `[.lineItems \| .[range(1; length; 2)]]` | Positions 2, 4, 6. |
| `Shipment[0:1][#only].Carrier` | `(([.shipments[0:1][]]) as $__seq \| ($__seq \| length) as $__len \| if $__len == 1 then $__seq[0] else error(...) end).carrier` | The only element, error unless length is exactly 1. |

> **Indexing asymmetry is intentional.** Positive selectors are 1-based (`[#1]` is the first row) because they are for human-authored row access. The preferred end-relative form is `[#last-N]`: `[#last]` is the last row, `[#last-1]` second-to-last, `[#last-3]` fourth-from-last. jq-native `[#-N]` aliases are still accepted (`[#-1]` = `[#last]`, `[#-2]` = `[#last-1]`) but the readable formatter prefers the `last-N` spelling.

> **Anchored ranges are forward-only.** `[#4..#last-3]`, `[#first..#last]`, and `[#last-119..#last-1]` are valid because they still move left-to-right in collection order. Reversed anchored ranges such as `[#last-3..#4]` or `[#last-1..#last-119]` are rejected instead of implying reverse traversal.

> **Selector unions are set-like.** `[#1, #2, #7..#9, #11]` means "include these positions." The result always comes back in collection order, not textual order, and overlapping terms do not duplicate rows.

> **Boolean size checks are regular expressions now.** CSS-style `:only`, `:empty`, `:not`, `:has`, `:is`, and `:where` are gone. Use normal BXL instead: `(X | length) = 0`, `(X | length) = 1`, `select(not ...)`, `has("x")`, or explicit `or` chains.

### Formula composition

_Readable BXL · Excel-style comparisons_

```
ROUND(Subtotal * "Tax Rate" / 100, 2) = "Tax Amount"
```

_Canonical jq · runtime form_

```
ROUND(.subtotal * .taxRate / 100; 2) == .taxAmount
```

> **Equality is Excel-style in readable BXL.** Use `=` for equality and `<>` for inequality everywhere — top-level, inside `[pred]`, `[* .pred]`, `all(…)`, `any(…)`, `IF(…)`. Both `==` / `!=` still parse as input; the canonicalizer rewrites. Compiled jq keeps `==` / `!=` because jq requires them at runtime.

> **Root-scope across pipes is automatic.** BXL detects readable labels that appear after a top-level pipe and auto-binds the root via `. as $root`. You can write `"Line Item"[all]."Line Total" | add == Subtotal` without parentheses — it compiles to `. as $root | [.lineItems[].lineTotal] | add == $root.subtotal`. Explicit jq paths (`.subtotal`) still mean "read from the current piped input"; readable labels mean "read from the root."

### Grammar and linter

| Artifact | Purpose |
| --- | --- |
| `grammar.ebnf` | Standalone formal grammar for the BXL readable-syntax overlay. |
| `syntax/bxl.tmLanguage.json` | Portable TextMate syntax highlighting definition for BXL expressions. |
| `lintBxlExpression(source, options)` | Non-evaluating linter for readable syntax confusion, compiler warnings, and native parse errors. |
| `tests/linter-cli.ts` | CLI coverage for edge cases the grammar allows but authors can easily misread. |

> **Lint targets:** missing quotes around multi-word labels, root labels after a top-level pipe, legacy `[row N]` shortcuts, predicate selectors that return only the first match, top-level `==` (info-level `prefer-excel-equality` — BXL canonicalizes to `=`), removed CSS-style pseudo-classes, and helper-dependent predicates such as `IN`.

> **Forgiving text fields:** BXL accepts extra whitespace, mixed capitalization for readable keywords/selectors/predicates/positional-selector keywords, lowercase or mixed-case formula function names, comma-separated or semicolon-separated formula arguments, uppercase booleans, and unquoted multi-word labels when the schema resolves them unambiguously. The canonical compiler output still normalizes to jq.

## Excel Paste Compatibility

BXL absorbs five Excel-specific idioms so a formula from a spreadsheet works verbatim:

| Excel idiom | What BXL does | Example |
| --- | --- | --- |
| Leading `=` (cell-formula prefix) | Stripped by the preprocessor. | `=ROUND(x, 2)` → `ROUND(x, 2)` |
| `<>` inequality | Canonicalized to `!=` for jq; displayed as `<>` in readable BXL. | `Status <> "closed"` |
| `^` power operator | Right-associative rewrite to `POWER(a, b)`. | `2^8` → `POWER(2, 8)` |
| `&` string concat | Rewrite to `((a\|tostring) + (b\|tostring))` — Excel-style coercion. | `"Invoice-" & "Invoice Number"` |
| Unknown characters | Caught by the linter as `untokenizable-character`; never crashes solidify. | — |

> **Paste test:** Sampled FormulaJS cases across math/trig, text, logical, statistical, engineering, information, date/time, and financial formulas work unchanged in the async compatibility runtime. Known paste gap: `MODE` is not implemented. `AND` / `OR` / `XOR` use array-style arguments, and `DEC2HEX` returns lowercase.

## Interesting Patterns

Compact idioms that showcase how labels, `[* .pred]`, implicit iteration, and Excel operators braid together. Each one-liner replaces 5–10 lines of imperative TypeScript.

### Excel SUMIF / COUNTIF without the `_BY` builtin

_Conditional sum_

```
SUM("Line Item"[* ."Taxable"]."Line Total")
```

_Conditional count (with explicit predicate)_

```
COUNTA("Line Item"[* ."Category" = "Service"])
```

_Average with a numeric predicate_

```
AVERAGE("Line Item"[* .Quantity > 2]."Line Total")
```

_Predicate with arithmetic across sibling fields_

```
"Line Item"[* .Quantity * ."Unit Price" > 15].SKU
```

### Self-auditing constraints

_Stored tax matches computed tax_

```
ROUND(SUM("Line Item"[* ."Taxable"]."Line Total") * "Tax Rate" / 100, 2) = "Tax Amount"
```

_Subtotal matches line-item aggregate (root-scope across pipe)_

```
"Line Item"."Line Total" | add = Subtotal
```

_Payments cover balance_

```
Total - SUM(Payment[* .Status = "captured"].Amount)
```

### Policy predicates with `all` / `any`

_Every step complete_

```
all(Step[], Status = "done")
```

_Any shipment outstanding_

```
any(Shipment[], Delivered = false)
```

_No payments overdue_

```
all(Payment[], "Days Late" = 0)
```

### Named rows, the human way

_First / last_

```
"Line Item"[#first].SKU & " through " & "Line Item"[#last].SKU
```

_One-based shortcut_

```
"Line Item"[#4].SKU
```

_Inclusive range_

```
SUM("Line Item"[#1..#3]."Line Total")
```

### Excel-style string composition with `&`

_Build a display string_

```
"Invoice-" & "Invoice Number" & " (" & Status & ")"
```

_Coerces numbers to strings automatically_

```
Customer.Name & " (" & Customer.Tier & ") has " & (COUNTA("Line Item") | tostring) & " items"
```

### Visibility / gate checks without pseudo-classes

_Reveal reviewer section_

```
Status = "in-review"
```

_Empty check_

```
(Payment[* .Status = "failed"] | length) = 0
```

_Exactly one match, then take it_

```
"Line Item"[* ."Category" = "Service"][#only]
```

### Multi-line analytics pipeline

_Category rollup — written in a textarea, collapses to one line on demand_

```
"Line Item"[all]
| group_by(.Category)
| map({
    category: .[0].category,
    total: (map(.lineTotal) | add)
  })
```

> **Toggle via the workbench.** `expandBxlExpression` wraps at pipe boundaries and multi-arg function calls when the inline length exceeds 40 chars; `collapseBxlExpression` round-trips back to the canonical single-line form.

### Excel operators `^` and `&` paste unchanged

_Power_

```
ROUND(Principal * (1 + Rate) ^ Years, 2)
```

_Inequality + power combined_

```
IF("Year End" <> "Start Year", 2 ^ 8, 0)
```

## Use Cases

Eleven real-world patterns that combine readable labels, jq pipelines, and Excel-style formulas. Each one falls apart without all three. Expressions below are idiomatic BXL (equality is `=`, inequality `<>`); the canonical jq form is available through the workbench.

### 1 · Invoice integrity auditor

Prove line items sum to the stored subtotal, tax applies only to taxable items, the grand total recomputes from parts.

_Sum check_

```
("Line Item"[all]."Line Total" | add) = Subtotal
```

_Total recompute_

```
ROUND(Subtotal - "Discount Amount" + "Tax Amount" + Shipping, 2) = Total
```

_Taxable-only tax_

```
ROUND(("Line Item"[* ."Taxable"]."Line Total" | add) * "Tax Rate" / 100, 2) = "Tax Amount"
```

_Per-item consistency_

```
all("Line Item"[], "Line Total" = Quantity * "Unit Price" - Discount)
```

### 2 · Gradebook — weighted averages and letter grades

Category averages × weights, plus threshold-based letter assignment. Flag missing work.

_Weighted total_

```
ROUND(
  AVERAGEIF_BY(Assignment[], Category = "homework", Score) * Course."Weight Homework" +
  AVERAGEIF_BY(Assignment[], Category = "quiz",     Score) * Course."Weight Quiz" +
  AVERAGEIF_BY(Assignment[], Category = "project",  Score) * Course."Weight Project" +
  AVERAGEIF_BY(Assignment[], Category = "exam",     Score) * Course."Weight Exam",
  1)
```

_Letter grade_

```
if FinalScore >= 93 then "A"
elif FinalScore >= 90 then "A-"
elif FinalScore >= 87 then "B+"
elif FinalScore >= 83 then "B"
elif FinalScore >= 70 then "C"
else "F"
end
```

_Missing-submission flag_

```
Assignment[* .Submitted = false].Title
```

### 3 · Mortgage / loan comparison

Rank a set of loan offers by monthly payment, total interest, and true cost after closing.

_Per-offer summary_

```
Loan[all].{
  name: Name,
  monthly: ROUND(PMT("Annual Rate" / 12, "Term Months", -Principal), 2),
  total_interest: ROUND(PMT("Annual Rate" / 12, "Term Months", -Principal) * "Term Months" - Principal, 2),
  true_cost: ROUND(PMT("Annual Rate" / 12, "Term Months", -Principal) * "Term Months" + "Closing Costs", 2)
}
```

### 4 · Expense policy auditor

Flag violations: meals over per-diem by city, missing receipts above $75, late submissions.

_Per-diem over-limit_

```
Item[* .Category = "meal" and .Amount > VLOOKUP(.City, Policy."Per Diem", 2, false)].Category
```

_Missing receipt_

```
Item[* .Amount > 75 and ."Has Receipt" = false]
```

_Late submission_

```
NETWORKDAYS("Incurred Date", "Submitted Date") > 30
```

### 5 · Sales commission engine

Per-rep revenue, quota attainment, tier-based rate with accelerators, strategic-account kicker.

_Quarter revenue_

```
SUMIF_BY(Deal[], Stage = "closed-won" and "Close Date" >= "2026-01-01" and "Close Date" <= "2026-03-31", Amount)
```

_Tiered commission_

```
if Attainment >= 1.2 then Revenue * 0.15
elif Attainment >= 1.0 then Revenue * 0.12
elif Attainment >= 0.8 then Revenue * 0.10
else                         Revenue * 0.08
end
```

### 6 · Medical lab panel interpretation

Label each lab result against the patient's age-and-sex reference range. Flag deviations from personal baseline.

_Per-test status_

```
Panel.Test[all].{
  name: Name,
  value: Value,
  status: if Value < "Reference Low"  then "low"
          elif Value > "Reference High" then "high"
          else "normal"
          end
}
```

_Z-score vs personal history_

```
Panel.Test[all].{
  name: Name,
  z_score: STANDARDIZE(
    Value,
    AVERAGE(History.Panel[all].Test[Name = Name].Value),
    STDEV_P(History.Panel[all].Test[Name = Name].Value))
}
```

### 7 · Rental property pro forma

10-year cash flow projection, NOI, cap rate, IRR.

_NOI_

```
(Property.Units * Property."Monthly Rent Per Unit" * 12 * (1 - Property."Vacancy Rate"))
  - Property."Annual Operating Expenses"
```

_Monthly debt service_

```
ROUND(PMT(Loan."Annual Rate" / 12, Loan."Term Years" * 12, -Loan.Amount), 2)
```

_IRR over the projection_

```
IRR([-Equity] + Projection.Year[all]."Net Cash Flow" + [ReversionValue])
```

### 8 · Payroll / timesheet validator

Regular vs overtime hours, holiday multipliers, PTO-balance sanity check, lunch-break compliance.

_Regular-hours pay_

```
SUMIF_BY(Timesheet[], "Hours Worked" <= 8, "Hours Worked") * "Hourly Rate"
```

_Overtime pay (1.5x)_

```
SUMIF_BY(Timesheet[], "Hours Worked" > 8, "Hours Worked" - 8) * "Hourly Rate" * 1.5
```

_Lunch-break policy_

```
Timesheet[* ."Hours Worked" > 6 and ."Lunch Taken" = false].Date
```

### 9 · Form conditional logic and auto-fill

Show / hide sections, compute dependent field values, cross-field validation.

_Visibility_

```
if Income > 100000 then "show high-earner section" else "hide" end
```

_Monthly payment auto-fill_

```
ROUND(
  "Loan Amount" * ("Annual Rate" / 12) *
  POWER(1 + "Annual Rate" / 12, "Term Months") /
  (POWER(1 + "Annual Rate" / 12, "Term Months") - 1),
  2)
```

_Assets-vs-liabilities sanity_

```
if SUM(Asset[all].Value) < SUM(Liability[all].Balance) then "red flag" else "ok" end
```

### 10 · Scientific measurement QA

Outlier detection, rolling statistics, drift alerts.

_Outlier list (> 3 sigma)_

```
Reading[*
    ABS((.Value - AVERAGE(Reading[all].Value)) / STDEV_P(Reading[all].Value)) > 3
].Timestamp
```

_Drift vs historical_

```
ABS(AVERAGE(Reading[all].Value) - History."Weekly Average") > 2 * History."Weekly Std Dev"
```

### 11 · Compound policy predicate — `all` / `any` / `not` composition

A business rule that fuses every row-level check into a single boolean expression. Works across collections, does pipe-like arithmetic comparison, and negates nested quantifiers. Every clause reads like a policy bullet.

_"Invoice is ready to close" rule — multi-line for textarea authoring_

```
all("Line Item"[], Taxable or "Line Total" < 5)
  and any(Payment[], Status = "captured")
  and not(any(Shipment[], Delivered = false))
  and (Customer."Credit Limit" - Total) > 0
```

_Reads as four bullet points_

```
1. Every line item is either taxable or trivially small (< $5).
2. Some payment has been captured.
3. No shipment is still outstanding.
4. The customer still has credit headroom.
```

_Compiles to canonical jq_

```
all(.lineItems[]; (.taxable) or (.lineTotal < 5))
  and any(.payments[]; .status == "captured")
  and ((any(.shipments[]; .delivered == false)) | not)
  and (.customer.creditLimit - .total) > 0
```

> **Why it composes cleanly:** `all` / `any` are first-class — they evaluate a predicate over a collection and return a boolean, which boolean operators (`and`, `or`, `not`) combine as usual. No nested loops, no intermediate variables. The readable surface maps 1:1 to the english version; the compile stays jq-idiomatic so the sandbox runs it without surprises.

## Excel vs jq vs BXL — a VLOOKUP walkthrough

One end-to-end comparison. The business problem: "Given a travel expense, flag any line item that exceeds its city's per-diem rate." We need a LOOKUP from city to rate, then a comparison.

_Data shape_

```
{
  "Item": [
    { "Date": "2026-03-01", "City": "NYC", "Amount": 85 },
    { "Date": "2026-03-02", "City": "Austin", "Amount": 45 },
    { "Date": "2026-03-03", "City": "NYC", "Amount": 110 }
  ],
  "PerDiem": [
    { "City": "NYC",    "Limit": 90 },
    { "City": "Austin", "Limit": 60 },
    { "City": "SF",     "Limit": 100 }
  ]
}
```

### Excel

_\=VLOOKUP + over-limit flag (spreadsheet form)_

```
=IF(B2 > VLOOKUP(A2, PerDiem!A:B, 2, FALSE), "over", "ok")
```

_Assumes the data lives across sheets — Items on the current sheet, PerDiem as a named table. Copy the formula down every row, one cell at a time. Works, but the filter lives outside the formula: you have to manually drag-copy, and the match mode (`FALSE` for exact) is Excel boilerplate._

### Raw jq

_Imperative — lookup + compare + label, per item_

```
.Item[] |
  . as $item |
  (.Amount >
    (($item | .City) as $c |
     .. | objects | select(.City == $c) | .Limit | values)
  ) as $over |
  $item + { status: (if $over then "over" else "ok" end) }
```

_Works but reads like a pointer dance. Recursive descent to find the matching entry, bind the city with `as`, assemble the output manually._

### Raw jq (more disciplined)

_Using INDEX-MATCH pattern via map + select_

```
.Item | map(
  . as $row |
  ((.Amount) >
    (($PerDiem // root.PerDiem)[] | select(.City == $row.City) | .Limit)) as $over |
  $row + {status: (if $over then "over" else "ok" end)}
)
```

_Still 5 lines, still needs `as` bindings to carry context across nested iterations. Reasonable jq, readable to a jq native._

### BXL readable

_One-line, schema-aware, reads as a policy check_

```
IF(Item.Amount > VLOOKUP(Item.City, PerDiem[all].{City, Limit}, 2, false), "over", "ok")
```

_Alt: per-row projection via implicit \[all\]_

```
Item.{
  date: Date,
  city: City,
  status: IF(Amount > VLOOKUP_BY(PerDiem[all], "City", City, "Limit"), "over", "ok")
}
```

_Compiles to canonical jq — VLOOKUP\_BY walks the PerDiem rows by City key, returns the matching Limit_

```
[.Item[] | {
  date: .date,
  city: .city,
  status: IF(.amount > VLOOKUP_BY([.PerDiem[]]; "City"; .city; "Limit"); "over"; "ok")
}]
```

### Side-by-side — the same rule in three forms

| Form | Lines | Reads as | Requires |
| --- | --- | --- | --- |
| Excel | 1 (per row, drag-to-copy) | a spreadsheet cell formula | A/B sheet references, manual dragging |
| Raw jq | 5 | a script with intermediate bindings | jq fluency, `as $var` chaining |
| BXL readable | 1–3 | a policy check in plain English | a schema — which Boxel already has |

> **Where BXL earns its keep.** The Excel form is the one business users recognize, but it lives one row at a time in a grid. The jq form is expressive but asks the reader to follow variable bindings across 5 lines. The BXL form preserves the Excel mental model (`VLOOKUP`, `IF`, labels you see in the UI) while operating over the entire card's data in one expression that compiles to safe, sandboxed jq.

> **Where BXL is used in Boxel.** Formula fields, Guide constraints, form visibility rules, workflow gates, notification predicates, annotation target paths, and inline document expressions. The same expression language in every authoring surface — one syntax, one evaluator, one sandbox.

## Dot Paths & Navigation

Everything jq does still works. BXL sits _on top_ of jq — canonical jq expressions are valid BXL. The readable surface above is the preferred authoring style when a schema is available; canonical jq is the compile target and the lingua franca for everything else (log output, machine-generated queries, jq-compatibility tests).

### Basic Access

| Expression | Result |
| --- | --- |
| `.` | The entire current value (like "this row") |
| `.name` | Value of the `name` field |
| `.patient.name` | Nested field access |
| `.orders[0]` | First element of the `orders` array (zero-based in jq) |
| `.orders[-1]` | Last element |
| `.orders[2:5]` | Slice: elements at index 2, 3, 4 |

### Safe Access & Fallbacks

| Expression | Result |
| --- | --- |
| `.owner?.email` | Optional access -- no error if `owner` is null |
| `.owner?.email // "none"` | Alternative operator -- fallback if null/missing |
| `.items[]` | Iterate: emit each element as a separate value |
| `..` | Recursive descent -- all values at every depth |

## Pipes & Transforms

The pipe `|` chains operations left-to-right. Each step feeds its output to the next.

### map, select, sort

_Transform every element_

```
.lineItems | map(.qty * .unitPrice)
```

_Filter by condition_

```
.orders | map(select(.status == "paid"))
```

_Sort and reverse_

```
.orders | sort_by(.placedAt) | reverse
```

_Deduplicate_

```
.tags | map(ascii_downcase) | unique | sort
```

### group\_by, flatten, add

_Group and count_

```
.orders
| group_by(.region)
| map({ region: .[0].region, count: length })
```

_Flatten nested arrays_

```
.departments | map(.employees) | flatten
```

_Sum an array_

```
.scores | add
```

### Operators

| Operator | Meaning | Example |
| --- | --- | --- |
| `\|` | Pipe | `.items \| map(.x)` |
| `,` | Both outputs | `.a, .b` emits two values |
| `+` `-` `*` `/` `%` | Arithmetic | `.price * .qty` |
| `==` `!=` `<` `<=` `>` `>=` | Comparison | `.age >= 18` |
| `and` `or` `not` | Logical | `.a and .b` |
| `//` | Alternative (fallback) | `.x // 0` |
| `=` `\|=` `+=` `-=` | Update | `.count += 1` |

## Constructing Values

### Objects

| Expression | Result |
| --- | --- |
| `{id, status, total}` | Shorthand -- pulls fields from current value |
| `{patient: .patientName, ward: .ward}` | Renamed fields |

### Arrays

| Expression | Result |
| --- | --- |
| `[.name, .ward, .diagnosis]` | Array from specific fields |
| `[.items[] \| .name]` | Collect iterated values into array |

### String Interpolation

| Expression | Result |
| --- | --- |
| `"Patient: \(.firstName) \(.lastName)"` | Embed computed values in strings |

## Bindings & Variables

Use `as $name` to capture intermediate values. Avoids repeating complex sub-expressions.

_Bind and reuse_

```
(.items | map(.qty * .price) | add) as $subtotal
| {
    subtotal: $subtotal,
    tax: ROUND($subtotal * 0.0825, 2),
    total: ROUND($subtotal * 1.0825, 2)
  }
```

> **Tip:** When in doubt, bind it. `$subtotal` is clearer than repeating the pipeline three times, and safer than threading it through pipes that might break when edited later.

## User-defined helpers (`def`)

Any BXL expression can open with its own named helpers. Syntax and scoping match jq's `def`. Because user helpers aren't from Excel, they follow the lowercase naming convention — a `def UPPERCASE` would lie about paste-compatibility. (See [UPPERCASE is Excel, lowercase is BXL-native](#naming-convention-uppercase-is-excel-lowercase-is-bxl-native).)

| Form | Meaning |
| --- | --- |
| `def name: body;` | Zero-arg helper. Applied as a pipeline filter: `.items \| map(name)`. |
| `def name(arg): body;` | One-arg helper. Call site: `name(value)`. |
| `def name(a; b; c): body;` | Multi-arg helper. **Definition and call both use `;`.** BXL's comma-to-`;` rewrite is a convenience for Excel built-ins only — paste `ROUND("Unit Price", 2)` from a spreadsheet and BXL handles the translation to jq behind the scenes. User `def` calls don't get that rewrite; `clamp(0, 100, x)` won't resolve. |

_Single-arg helper next to a built-in:_

```
def emoji(w): ["🐕", "🐈", "🦊", "🐸", "🦉"][w | explode | add % 5];
def triple(x): x * 3;

{
  pet:     emoji(.name),
  tripled: triple(.score),
  total:   SUM([.items[].price])
}
```

_Recursion:_

```
def fact: if . <= 1 then 1 else . * (. - 1 | fact) end;
5 | fact
```
→ `120`

_Multi-arg (semicolons required at both sides):_

```
def clamp(lo; hi; x): (x | if . < lo then lo elif . > hi then hi else . end);
clamp(0; 100; .score)
```

Helpers are **scoped to the expression**. There is no module system, and that's deliberate: a BXL expression is a self-contained, serializable piece of data, not a program that imports from other files. If you need the same helper in ten expressions, prepend the `def` to each one at build time, or materialize a single larger expression that holds them together.

## Control Flow

| Pattern | Syntax |
| --- | --- |
| Conditional | `if .x > 0 then "positive" elif .x == 0 then "zero" else "negative" end` |
| Try/catch | `try (.x / .y) catch "division error"` |
| Reduce | `reduce .items[] as $i (0; . + $i.amount)` |
| Foreach | `foreach .items[] as $i (0; . + $i.amount)` |
| Define function | `def double: . * 2; .values \| map(double)` — see [User-defined helpers](#user-defined-helpers-def) for full syntax. |
| Label/break | `label $out \| foreach .[] as $x (0; .+$x; if .>100 then ., break $out else . end)` |

* * *

## Math & Rounding

| Function | Description | Example |
| --- | --- | --- |
| `ROUND(n, d)` | Round to _d_ decimal places | `ROUND(3.14159, 2)` → `3.14` |
| `ROUNDUP(n, d)` | Round away from zero | `ROUNDUP(3.141, 2)` → `3.15` |
| `ROUNDDOWN(n, d)` | Round toward zero | `ROUNDDOWN(3.149, 2)` → `3.14` |
| `ABS(n)` | Absolute value | `ABS(-42)` → `42` |
| `CEILING(n, s)` | Round up to significance (alias: `CEILING_MATH`) | `CEILING(2.3, 1)` → `3` |
| `FLOOR(n, s)` | Round down to significance (alias: `FLOOR_MATH`) | `FLOOR(2.7, 1)` → `2` |
| `INT(n)` | Floor to integer | `INT(3.9)` → `3` |
| `MOD(a, b)` | Modulo (always non-negative) | `MOD(10, 3)` → `1` |
| `POWER(n, p)` | Exponentiation | `POWER(2, 10)` → `1024` |
| `SQRT(n)` | Square root | `SQRT(144)` → `12` |
| `PRODUCT(arr)` | Product of all numbers | `PRODUCT([2, 3, 4])` → `24` |
| `PI` | Constant 3.14159... | `PI` → `3.14159...` |
| `SIGN(n)` | Returns -1, 0, or 1 | `SIGN(-42)` → `-1` |
| `EVEN(n)` | Round up to nearest even | `EVEN(3)` → `4` |
| `ODD(n)` | Round up to nearest odd | `ODD(4)` → `5` |
| `GCD(arr)` | Greatest common divisor | `GCD([12, 8, 20])` → `4` |
| `LCM(arr)` | Least common multiple | `LCM([4, 6, 10])` → `60` |
| `FACT(n)` | Factorial | `FACT(5)` → `120` |
| `FACTDOUBLE(n)` | Double factorial | `FACTDOUBLE(7)` → `105` |
| `COMBIN(n, k)` | Combinations | `COMBIN(10, 3)` → `120` |
| `COMBINA(n, k)` | Combinations with repetition | `COMBINA(4, 2)` → `10` |
| `PERMUT(n, k)` | Permutations | `PERMUT(10, 3)` → `720` |
| `MROUND(n, m)` | Round to nearest multiple | `MROUND(7.5, 3)` → `9` |
| `QUOTIENT(n, d)` | Integer division | `QUOTIENT(7, 2)` → `3` |
| `DEGREES(rad)` | Radians to degrees | `DEGREES(PI)` → `180` |
| `RADIANS(deg)` | Degrees to radians | `RADIANS(180)` → `3.14159...` |
| `RAND` | Random number 0--1 | `RAND` → `0.7291...` |
| `RANDBETWEEN(lo, hi)` | Random integer in range | `RANDBETWEEN(1, 100)` |
| `SUMPRODUCT(arrays)` | Sum of element-wise products | `SUMPRODUCT([[1,2],[3,4]])` → `11` |
| `SUMSQ(arr)` | Sum of squares | `SUMSQ([3, 4])` → `25` |
| `MULTINOMIAL(arr)` | Multinomial coefficient | `MULTINOMIAL([2, 3, 4])` |
| `SERIESSUM(x, n, m, coeffs)` | Power series sum | `SERIESSUM(2, 1, 1, [1,2,3])` |
| `SQRTPI(n)` | Square root of `n * PI` | `SQRTPI(2)` |
| `SUMX2MY2(x, y)` | Sum of `x^2 - y^2` pairs | `SUMX2MY2([1,2], [3,4])` |
| `SUMX2PY2(x, y)` | Sum of `x^2 + y^2` pairs | `SUMX2PY2([1,2], [3,4])` |
| `SUMXMY2(x, y)` | Sum of squared differences | `SUMXMY2([1,2], [3,4])` |

## Statistics

| Function | Description | Example |
| --- | --- | --- |
| `SUM(arr)` | Sum of numbers (skips nulls) | `SUM([10, 20, 30])` → `60` |
| `AVERAGE(arr)` | Mean (skips nulls) | `AVERAGE([10, 20, 30])` → `20` |
| `COUNT(arr)` | Count of finite numbers | `COUNT([1, "a", 3])` → `2` |
| `COUNTA(arr)` | Count of non-blank values | `COUNTA([1, "a", null])` → `2` |
| `MAX(arr)` | Maximum | `MAX([3, 1, 4])` → `4` |
| `MIN(arr)` | Minimum | `MIN([3, 1, 4])` → `1` |
| `STDEV(arr)` | Sample standard deviation (alias: `STDEV_S`) | `STDEV([2, 4, 4, 4, 5, 5, 7, 9])` |
| `STDEV_P(arr)` | Population standard deviation | `STDEV_P([2, 4, 4, 4, 5, 5, 7, 9])` |
| `MEDIAN(arr)` | Middle value | `MEDIAN([1, 3, 5, 7])` → `4` |
| `VAR(arr)` | Sample variance (alias: `VAR_S`) | `VAR([2, 4, 4, 4, 5, 5, 7, 9])` |
| `VAR_P(arr)` | Population variance | `VAR_P([2, 4, 4, 4, 5, 5, 7, 9])` |
| `LARGE(arr, k)` | Kth largest | `LARGE([3, 1, 4, 1, 5], 2)` → `4` |
| `SMALL(arr, k)` | Kth smallest | `SMALL([3, 1, 4, 1, 5], 2)` → `1` |
| `COUNTBLANK(arr)` | Count of empty/null values | `COUNTBLANK([1, null, "", 3])` → `2` |
| `RANK_EQ(n, arr)` | Rank (descending) | `RANK_EQ(4, [5, 4, 3, 2])` → `2` |
| `RANK_AVG(n, arr)` | Rank with average for ties | `RANK_AVG(4, [5, 4, 4, 2])` → `2.5` |
| `PERCENTILE_INC(arr, k)` | Percentile (inclusive) | `PERCENTILE_INC([1,2,3,4], 0.75)` → `3.25` |
| `QUARTILE_INC(arr, q)` | Quartile (0--4) | `QUARTILE_INC([1,2,3,4], 1)` → `1.75` |
| `CORREL(x, y)` | Correlation coefficient | `CORREL([1,2,3], [2,4,6])` → `1` |
| `SLOPE(y, x)` | Linear regression slope | `SLOPE([2,4,6], [1,2,3])` → `2` |
| `INTERCEPT(y, x)` | Linear regression intercept | `INTERCEPT([2,4,6], [1,2,3])` → `0` |
| `FORECAST(x, y, knownX)` | Linear prediction | `FORECAST(4, [2,4,6], [1,2,3])` → `8` |
| `GEOMEAN(arr)` | Geometric mean | `GEOMEAN([2, 8])` → `4` |
| `HARMEAN(arr)` | Harmonic mean | `HARMEAN([2, 8])` → `3.2` |
| `TRIMMEAN(arr, pct)` | Mean excluding outliers | `TRIMMEAN([1,2,3,4,100], 0.4)` |
| `AVEDEV(arr)` | Average absolute deviation | `AVEDEV([2, 4, 8, 16])` |
| `DEVSQ(arr)` | Sum of squared deviations | `DEVSQ([2, 4, 8, 16])` |
| `SKEW(arr)` | Distribution skewness | `SKEW([1, 2, 3, 4, 100])` → positive |
| `KURT(arr)` | Distribution kurtosis | `KURT([1, 2, 3, 4, 100])` → heavy-tailed |
| `MAXIFS([vals, range, crit])` | Conditional max | `MAXIFS([[5,3,8], [1,2,1], 1])` → `8` |
| `MINIFS([vals, range, crit])` | Conditional min | `MINIFS([[5,3,8], [1,2,1], 1])` → `5` |
| `PERCENTILE_EXC(arr, k)` | Percentile (exclusive) | `PERCENTILE_EXC([1,2,3,4,5], 0.4)` |
| `QUARTILE_EXC(arr, q)` | Quartile exclusive (1--3) | `QUARTILE_EXC([1,2,3,4,5], 1)` |
| `PERCENTRANK_INC(arr, x)` | Percentile rank (inclusive) | `PERCENTRANK_INC([1,2,3,4], 3)` → `0.667` |
| `PERCENTRANK_EXC(arr, x)` | Percentile rank (exclusive) | `PERCENTRANK_EXC([1,2,3,4], 3)` → `0.6` |
| `PEARSON(x, y)` | Pearson correlation (alias for CORREL) | `PEARSON([1,2,3], [2,4,6])` → `1` |

> `SUM` and `AVERAGE` automatically skip nulls and non-numeric values, just like their spreadsheet counterparts.

### Lazy Distribution & Test Functions

FormulaJS statistical distributions, inverse distributions, confidence intervals, and tests live in the lazy `formula-statistical` extension. Async runtimes load it only when an expression references one of these functions. Canonical BXL uses underscore names such as `NORM_DIST(...)`; pasted Excel dotted names such as `NORM.DIST(...)` and `T.TEST(...)` are accepted in readable syntax and rewritten to the underscore form.

| Family | Functions |
| --- | --- |
| Beta / binomial | `BETA_DIST`, `BETA_INV`, `BINOM_DIST`, `BINOM_DIST_RANGE`, `BINOM_INV`, `NEGBINOM_DIST` |
| Chi-square / F / T tests | `CHISQ_DIST`, `CHISQ_DIST_RT`, `CHISQ_INV`, `CHISQ_INV_RT`, `CHISQ_TEST`, `F_DIST`, `F_DIST_RT`, `F_INV`, `F_INV_RT`, `F_TEST`, `T_DIST`, `T_DIST_2T`, `T_DIST_RT`, `T_INV`, `T_INV_2T`, `T_TEST` |
| Normal / lognormal / exponential / Poisson / Weibull | `NORM_DIST`, `NORM_INV`, `NORM_S_DIST`, `NORM_S_INV`, `LOGNORM_DIST`, `LOGNORM_INV`, `EXPON_DIST`, `POISSON_DIST`, `WEIBULL_DIST` |
| Gamma / hypergeometric | `GAMMA`, `GAMMA_DIST`, `GAMMA_INV`, `GAMMALN`, `GAMMALN_PRECISE`, `HYPGEOM_DIST` |
| Confidence / standardization | `CONFIDENCE_NORM`, `CONFIDENCE_T`, `GAUSS`, `PHI`, `STANDARDIZE`, `Z_TEST` |

## Conditional Aggregation

Two flavors: **range-based** (classic Excel) and **\_BY** variants for arrays of objects.

### Range-Based (Classic)

| Function | Description |
| --- | --- |
| `SUMIF(range, criteria)` | Sum where criteria matches |
| `SUMIF(range, criteria, sumRange)` | Sum from a different range |
| `COUNTIF(range, criteria)` | Count where criteria matches |
| `AVERAGEIF(range, criteria)` | Average where criteria matches |

### Row-Object Variants (\_BY)

| Function | Example |
| --- | --- |
| `SUMIF_BY(rows, valueKey, criteriaKey, criteria)` | `SUMIF_BY(., "amount", "region", "East")` |
| `SUMIFS_BY(rows, valueKey, criteriaObj)` | `SUMIFS_BY(., "amount", {,region: "East", team: "A"},)` |
| `COUNTIF_BY(rows, criteriaKey, criteria)` | `COUNTIF_BY(., "status", "active")` |
| `COUNTIFS_BY(rows, criteriaObj)` | `COUNTIFS_BY(., {,region: "East", team: "A"},)` |
| `AVERAGEIF_BY(rows, valueKey, criteriaKey, criteria)` | `AVERAGEIF_BY(., "score", "grade", "A")` |
| `AVERAGEIFS_BY(rows, valueKey, criteriaObj)` | `AVERAGEIFS_BY(., "score", {,grade: "A"},)` |

> **Criteria strings** support prefixes: `=`, `<>`, `>`, `>=`, `<`, `<=`. Wildcards: `*` (any chars), `?` (single char). Escape with `~`.

## Lookups

| Function | Description |
| --- | --- |
| `VLOOKUP(val, table, colIdx)` | Vertical lookup -- search first column, return nth column |
| `VLOOKUP(val, table, colIdx, rangeLookup)` | Set `rangeLookup` to `false` for exact match |
| `VLOOKUP_BY(rows, lookupKey, val, resultKey)` | Row-object VLOOKUP |
| `XLOOKUP(val, lookupArr, returnArr)` | Exact lookup across independent lookup/return arrays |
| `XLOOKUP(val, lookupArr, returnArr, fallback)` | Exact lookup with fallback for missing values |
| `HLOOKUP(val, table, rowIdx)` | Horizontal lookup |
| `LOOKUP(val, lookupArr, resultArr)` | Simple lookup with two arrays |
| `LOOKUP_BY(rows, lookupKey, val, resultKey)` | Row-object LOOKUP |
| `MATCH(val, arr, matchType)` | Position of match (1-based). matchType: 1, 0, or -1 |
| `INDEX(arr, row)` | Value at position |
| `INDEX(arr, row, col)` | Value at row and column |
| `CHOOSE(idx, options)` | Select from list by 1-based index |
| `COL(rows, key)` | Extract column values from array of objects |

_VLOOKUP\_BY example_

```
VLOOKUP_BY(., "label", "ventilator", "amount")
```

_INDEX + MATCH pattern_

```
INDEX(.names, MATCH("target", .ids, 0))
```

## Text

| Function | Description | Example |
| --- | --- | --- |
| `TEXTJOIN(delim, skipEmpty, arr)` | Join with delimiter | `TEXTJOIN(", ", true, .names)` |
| `CONCAT(arr)` | Concatenate array values (alias: `CONCATENATE`) | `CONCAT(["a", "b"])` → `"ab"` |
| `LEFT(text, n)` | First n characters | `LEFT("Hello", 3)` → `"Hel"` |
| `RIGHT(text, n)` | Last n characters | `RIGHT("Hello", 2)` → `"lo"` |
| `MID(text, start, n)` | Substring (1-based) | `MID("Hello", 2, 3)` → `"ell"` |
| `LEN(text)` | String length | `LEN("Hello")` → `5` |
| `words(text)` | **BXL** — count of whitespace-separated non-empty tokens. No Excel equivalent. | `words("Ada Lovelace")` → `2` |
| `UPPER(text)` | Uppercase | `UPPER("hi")` → `"HI"` |
| `LOWER(text)` | Lowercase | `LOWER("HI")` → `"hi"` |
| `PROPER(text)` | Title Case | `PROPER("hello world")` → `"Hello World"` |
| `TRIM(text)` | Trim + collapse spaces | `TRIM(" hi there ")` → `"hi there"` |
| `SUBSTITUTE(text, old, new)` | Replace all occurrences | `SUBSTITUTE("aaa", "a", "b")` → `"bbb"` |
| `SUBSTITUTE(text, old, new, n)` | Replace nth occurrence | `SUBSTITUTE("aaa", "a", "b", 2)` → `"aba"` |
| `REPLACE(text, pos, len, new)` | Replace by position | `REPLACE("Hello", 1, 2, "Ya")` → `"Yallo"` |
| `REPT(text, n)` | Repeat | `REPT("ab", 3)` → `"ababab"` |
| `FIND(find, within)` | Case-sensitive position (1-based) | `FIND("lo", "Hello")` → `4` |
| `SEARCH(find, within)` | Case-insensitive position | `SEARCH("LO", "Hello")` → `4` |
| `EXACT(a, b)` | Case-sensitive equality | `EXACT("Hi", "hi")` → `false` |
| `CHAR(n)` | Code point to character (`UNICHAR` is the lazy FormulaJS spelling) | `CHAR(65)` → `"A"` |
| `CODE(text)` | First char to code point (alias: `UNICODE`) | `CODE("A")` → `65` |
| `CLEAN(text)` | Remove control chars | Strips 0x00-0x1F |
| `VALUE(text)` | Parse string as number | `VALUE("42")` → `42` |
| `NUMBERVALUE(text, dec, grp)` | Locale-aware parsing | `NUMBERVALUE("1.234,56", ",", ".")` |

### Formatting Helpers

| Function | Description | Example |
| --- | --- | --- |
| `TEXT(val, fmt)` | Format number as string | `TEXT(.date, "yyyy-mm-dd")` |
| `DOLLAR(n, d)` | Format as currency | `DOLLAR(1234.5, 2)` → `"$1,234.50"` |
| `FIXED(n, d, noCommas)` | Fixed decimal string | `FIXED(1234.5, 2, false)` → `"1,234.50"` |

## Logic & Type Checking

### Conditionals

| Function | Description | Example |
| --- | --- | --- |
| `IF(test, then, else)` | Excel-style conditional | `IF(.score >= 90, "A", "B")` |
| `IFERROR(val, fallback)` | Catch any error | `IFERROR(.x / .y, 0)` |
| `IFNA(val, fallback)` | Catch only #N/A | `IFNA(VLOOKUP(...), "missing")` |
| `IFS(c1, v1, c2, v2, ...)` | Multiple conditions (2--4 pairs) | `IFS(.x > 90, "A", .x > 80, "B", true, "C")` |
| `LET(name, value, expr)` | Excel-style local binding lowered to jq `as $name` | `LET(limit, 10000, .amount > limit)` |
| `SWITCH([expr, v1, r1, ...])` | Value-based dispatch (commas inside array) | `SWITCH([.status, "A", "Active", "I", "Inactive", "Unknown"])` |
| `when(p, q)` | **BXL** — implication shortcut. Equivalent to `IF(p, q, TRUE)`. Useful for "if this applies, then this must hold" constraints. | `when(Payment = "Credit card", present("Bill To".Zip))` |
| `implies(p, q)` | **BXL** — alias for `when`. Preferred when the expression reads as logic. | `implies(Status = "shipped", "Tracking Number" != null)` |

### Boolean Functions

| Function | Description |
| --- | --- |
| `TRUE` | Literal `true` |
| `FALSE` | Literal `false` |
| `NA` | Produce #N/A error (use as sentinel) |
| `NOT(val)` | Boolean NOT |
| `AND(arr)` | All truthy (skips nulls/strings) |
| `OR(arr)` | Any truthy (skips nulls/strings) |
| `XOR(arr)` | Odd count of truthy values |

### Presence & Nullability

| Function | Description | When to use |
| --- | --- | --- |
| `ISBLANK(val)` | **Excel-strict** — true only when `val` is `null` / `undefined`. Empty string is _not_ blank. | When you need Excel's exact semantics (paste-compatibility, audit rules that mirror a spreadsheet). |
| `present(val)` | **BXL** — true when `val` is neither `null` nor `""`. Form-friendly opposite of `ISBLANK`. | Form validation, "is this filled in?" checks. Usually what you want. |
| `nonempty(arr)` | **BXL** — returns `arr` with `null` and `""` entries removed. Chainable. | Cleaning up split results or optional-field collections before counting or joining. |

_Presence helpers side-by-side_

```
ISBLANK(Campaign)            -- true only when Campaign is null (Excel-strict)
present(Campaign)            -- false for both null and "" (form-friendly)
NOT ISBLANK(Campaign)        -- Excel-equivalent "filled in" check
nonempty(split(Donor, " "))  -- drop empty tokens before counting
words(Donor) >= 2            -- same intent, BXL shortcut
```

### Type Checking & Error Detection

| Function | Description |
| --- | --- |
| `ISNUMBER(val)` | True if finite number |
| `ISTEXT(val)` | True if string |
| `ISERROR(val)` | True if any error |
| `ISNA(val)` | True if #N/A error |
| `ISERR(val)` | True if error but not #N/A |
| `TYPE(val)` | Returns 1 (num), 2 (str), 4 (bool), 16 (error), 64 (array) |
| `N(val)` | Convert to number (1/0 for bool) |
| `T(val)` | Return string or `""` |
| `ERROR_TYPE(val)` | Error type code (1--8) |
| `ISEVEN(val)` | True if even integer |
| `ISODD(val)` | True if odd integer |
| `ISLOGICAL(val)` | True if boolean |
| `ISNONTEXT(val)` | True if not a string |

## Date

### Formula Helpers

| Function | Description |
| --- | --- |
| `DATE(year, month, day)` | Build Excel date serial number |
| `DAY(date)` | Day of month (1--31) |
| `MONTH(date)` | Month (1--12) |
| `YEAR(date)` | Year |
| `YEARFRAC(start, end, basis)` | Fraction of year between dates (basis 0--4) |
| `DAYS(end, start)` | Days between two date serials |
| `TODAY` | Current date as Excel serial number |
| `HOUR(serial)` | Hour component (0--23) |
| `MINUTE(serial)` | Minute component (0--59) |
| `SECOND(serial)` | Second component (0--59) |
| `WEEKDAY(serial, type)` | Day of week (type 1: Sun=1..Sat=7) |
| `ISOWEEKNUM(serial)` | ISO week number |
| `EDATE(start, months)` | Date offset by N months |
| `EOMONTH(start, months)` | End of month, offset by N months |
| `DATEDIF(start, end, unit)` | Difference in "Y", "M", "D", "MD", "YM", "YD" |
| `DATEVALUE(text)` | Parse date string to serial number |
| `DAYS360(start, end, method)` | Days on 360-day year (US/European) |
| `WEEKNUM(serial, type)` | Week number (type 1: Sun start, 2: Mon start) |
| `NETWORKDAYS(start, end, holidays)` | Business days between dates |
| `WORKDAY(start, days, holidays)` | Date offset by N business days |
| `TIME(hour, min, sec)` | Time as fraction of day |
| `TIMEVALUE(text)` | Parse time string ("14:30") to fraction |

### jq Date Functions

| Function | Description |
| --- | --- |
| `now` | Current Unix timestamp |
| `strptime(fmt)` | Parse date string |
| `strftime(fmt)` | Format timestamp |
| `mktime` | Broken-down time to Unix timestamp |
| `gmtime` | Unix timestamp to UTC time array |
| `todate` | Timestamp to ISO-8601 string |
| `fromdate` | ISO-8601 string to timestamp |

_Date difference in days_

```
((.endDate | strptime("%Y-%m-%d") | mktime)
 - (.startDate | strptime("%Y-%m-%d") | mktime)) / 86400
```

## Financial

> Financial functions are a lazy FormulaJS extension. Async runtimes (`runNativeJqAsync`, `prepareNativeJqAsync`, `prepareBoxelRuntimeAsync`) auto-load `formula-financial` when an expression references one of these functions. Sync `evaluateBxl` / `runNativeJq` does not load them unless the lazy library has been explicitly registered.

### Time Value of Money

| Function | Description |
| --- | --- |
| `PMT(rate, nper, pv, fv, type)` | Payment per period |
| `IPMT(rate, per, nper, pv, fv, type)` | Interest portion of payment |
| `PPMT(rate, per, nper, pv, fv, type)` | Principal portion of payment |
| `FV(rate, nper, pmt, pv, type)` | Future value |
| `PV(rate, nper, pmt, fv, type)` | Present value |
| `NPER(rate, pmt, pv, fv, type)` | Number of periods |
| `RATE(nper, pmt, pv, fv, type, guess)` | Interest rate per period |
| `FVSCHEDULE(principal, schedule)` | FV with variable rates |

### Investment Analysis

| Function | Description |
| --- | --- |
| `NPV(rate, values)` | Net present value |
| `NPV_BY(rate, rows, valueKey)` | NPV from row objects |
| `IRR(values, guess)` | Internal rate of return |
| `IRR_BY(rows, valueKey, guess)` | IRR from row objects |
| `MIRR(values, finRate, reinRate)` | Modified IRR |
| `XNPV(rate, values, dates)` | NPV for irregular cash flows |
| `XNPV_BY(rate, rows, valKey, dateKey)` | XNPV from row objects |
| `XIRR(values, dates, guess)` | IRR for irregular cash flows |
| `XIRR_BY(rows, valKey, dateKey, guess)` | XIRR from row objects |

### Other Financial

| Function | Description |
| --- | --- |
| `CUMIPMT(rate, nper, pv, start, end, type)` | Cumulative interest between periods |
| `CUMPRINC(rate, nper, pv, start, end, type)` | Cumulative principal between periods |
| `EFFECT(nominal, npery)` | Effective annual rate |
| `NOMINAL(effective, npery)` | Nominal annual rate |
| `SLN(cost, salvage, life)` | Straight-line depreciation |
| `SYD(cost, salvage, life, per)` | Sum-of-years depreciation |
| `ACCRINT(issue, first, settle, rate, par, freq)` | Accrued interest |
| `DB(cost, salvage, life, period, month)` | Declining balance depreciation |
| `DDB(cost, salvage, life, period, factor)` | Double declining balance |
| `ISPMT(rate, per, nper, pv)` | Interest for straight-line payments |
| `PDURATION(rate, pv, fv)` | Periods to reach target value |
| `RRI(nper, pv, fv)` | Required rate of return |
| `DOLLARDE(frac, denom)` | Fractional dollar to decimal |
| `DOLLARFR(dec, denom)` | Decimal dollar to fractional |
| `DISC(settle, maturity, pr, redemption, basis)` | Discount rate of a security |
| `PRICEDISC(settle, maturity, disc, redemption, basis)` | Price of discounted security |
| `COUPDAYS(settle, maturity, freq, basis)` | Days in coupon period |
| `TBILLEQ(settle, maturity, discount)` | T-bill bond-equivalent yield |
| `TBILLPRICE(settle, maturity, discount)` | T-bill price per $100 |
| `TBILLYIELD(settle, maturity, price)` | T-bill yield |

_Monthly car payment_

```
PMT(0.065 / 12, 60, 25000, 0, 0)
```

_Project NPV_

```
NPV(0.08, [-40000, 8000, 9200, 10000, 12000])
```

## Engineering

> Most engineering helpers below are lazy FormulaJS extensions: base conversion, bitwise operations, complex numbers, `ERF` / `ERFC`, `CONVERT`, and `UNICHAR`. `ROMAN` and `ARABIC` remain eager formula helpers. Bessel functions are lazy too, but live in the smaller `formula-bessel` extension rather than the shared engineering/financial bundle.

### Base Conversion

| Function | Description |
| --- | --- |
| `BIN2DEC` / `DEC2BIN` | Binary ↔ Decimal |
| `BIN2HEX` / `HEX2BIN` | Binary ↔ Hex |
| `BIN2OCT` / `OCT2BIN` | Binary ↔ Octal |
| `DEC2HEX` / `HEX2DEC` | Decimal ↔ Hex |
| `DEC2OCT` / `OCT2DEC` | Decimal ↔ Octal |
| `OCT2HEX` / `HEX2OCT` | Octal ↔ Hex |
| `BASE(n, radix, minLen)` | Arbitrary base conversion |
| `DECIMAL(text, radix)` | Parse from arbitrary base |

### Bitwise Operations

| Function | Description |
| --- | --- |
| `BITAND(a, b)` | Bitwise AND |
| `BITOR(a, b)` | Bitwise OR |
| `BITXOR(a, b)` | Bitwise XOR |
| `BITLSHIFT(n, shift)` | Left shift |
| `BITRSHIFT(n, shift)` | Right shift |

### Roman numeral conversion

| Function | Description | Example |
| --- | --- | --- |
| `ROMAN(n)` | Arabic integer → Roman numeral string. Errors on negative input; floors non-integers. | `ROMAN(42)` → `"XLII"` |
| `ARABIC(text)` | Roman numeral string → Arabic integer. Errors on malformed input (validates via strict regex). | `ARABIC("MCMXCIV")` → `1994` |

> Both helpers match Microsoft Excel exactly and round-trip: `ARABIC(ROMAN(N)) = N` for any non-negative integer N.

### Complex Numbers

| Function | Description |
| --- | --- |
| `COMPLEX(real, imag, suffix)` | Construct complex number string |
| `IMABS(val)` | Modulus |
| `IMREAL(val)` | Real part |
| `IMAGINARY(val)` | Imaginary part |
| `IMCONJUGATE(val)` | Complex conjugate |
| `IMSUB(a, b)` | Complex subtraction |
| `IMSUM(values)` | Complex sum |
| `DELTA(a, b)` | 1 if equal, 0 otherwise |
| `GESTEP(n, step)` | 1 if ≥ step, 0 otherwise |
| `IMCOS(z)` | Complex cosine |
| `IMCOSH(z)` | Complex hyperbolic cosine |
| `IMCOT(z)` | Complex cotangent |
| `IMCSC(z)` | Complex cosecant |
| `IMCSCH(z)` | Complex hyperbolic cosecant |
| `IMSIN(z)` | Complex sine |
| `IMSINH(z)` | Complex hyperbolic sine |
| `IMTAN(z)` | Complex tangent |
| `IMSEC(z)` | Complex secant |
| `IMSECH(z)` | Complex hyperbolic secant |
| `IMEXP(z)` | Complex exponential |
| `IMLN(z)` | Complex natural log |
| `IMLOG10(z)` | Complex log base 10 |
| `IMLOG2(z)` | Complex log base 2 |
| `IMDIV(a, b)` | Complex division |
| `IMPRODUCT(values)` | Complex product |
| `IMPOWER(z, n)` | Complex power |
| `IMSQRT(z)` | Complex square root |
| `IMARGUMENT(z)` | Angle (argument) of complex number |
| `ERF(lower, upper)` | Error function (Gauss) |
| `ERFC(x)` | Complementary error function |
| `BESSELI(x, n)` | Modified Bessel function In (lazy async) |
| `BESSELJ(x, n)` | Bessel function Jn (lazy async) |
| `BESSELK(x, n)` | Modified Bessel function Kn (lazy async) |
| `BESSELY(x, n)` | Bessel function Yn (lazy async) |
| `CONVERT(n, from, to)` | Unit conversion (120+ units, SI prefixes) |
| `UNICHAR(n)` | Code point to character (lazy FormulaJS spelling; `CHAR` is eager) |

_CONVERT examples_

```
CONVERT(1, "mi", "km")       // 1.609344
CONVERT(100, "C", "F")       // 212
CONVERT(1, "gal", "L")      // 3.785...
CONVERT(1, "kg", "lbm")    // 2.204...
CONVERT(1024, "byte", "kibyte") // 1 (binary prefix)
```

* * *

## Computed Fields

In Boxel, BXL expressions live inside `computeVia` on a field definition. The field type acts as the output contract. `expression()` validates the source against the `derive` profile when it is constructed, so volatile calls, request/mutation context, authored jq `try` / `catch`, jq `def` / `error`, and runtime metadata helpers are rejected before the field runs.

_Basic pattern_

```
import { expression } from '@cardstack/bxl';

@field total = contains(NumberField, {
  computeVia: expression('ROUND(.subtotal * (1 + .taxRate), 2)'),
});
```

_Structured result_

```
@field summary = contains(SummaryField, {
  computeVia: expression(`
    (.items | map(.qty * .price) | add) as $sub
    | {
        subtotal: $sub,
        tax: ROUND($sub * 0.0825, 2),
        total: ROUND($sub * 1.0825, 2)
      }
  `, { as: SummaryField }),
});
```

_Array result_

```
@field alerts = containsMany(AlertField, {
  computeVia: expression(`
    .issues
    | map(select(.severity == "high"))
    | map({ label: .title, owner: (.owner.name // "unassigned") })
  `, { as: AlertField }),
});
```

### Field Type → Expression Return Type

| Field Declaration | Expression Must Return |
| --- | --- |
| `contains(NumberField)` | A number |
| `contains(StringField)` | A string |
| `contains(BooleanField)` | A boolean |
| `contains(SomeFieldDef)` | An object matching the FieldDef shape |
| `containsMany(NumberField)` | An array of numbers |
| `containsMany(SomeFieldDef)` | An array of objects |

### Chaining Computed Fields

_One field references another_

```
@field subtotal = contains(NumberField, {
  computeVia: expression('.lineItems | map(.qty * .unitPrice) | add'),
});

@field total = contains(NumberField, {
  computeVia: expression('ROUND(.subtotal * 1.0825, 2)'),
});
```

> Computed fields can reference other computed fields on the same card. Each field is one step -- explicit, testable, and easy to trace.

### Reading Across Relationships

| Expression | Result |
| --- | --- |
| `.attendingClinician.name` | Read a field from a linked card |
| `.consultTeam \| map(.name)` | Map over a linksToMany relationship |
| `.patient.firstName + " " + .patient.lastName` | Concatenate across a link |

## jq Builtins Index

Complete index of core jq functions available in BXL.

### Array / Object

| Function | Description |
| --- | --- |
| `length` | Length of string/array/object |
| `keys` / `keys_unsorted` | Sorted / unsorted keys |
| `has(key)` | Test if key/index exists |
| `contains(v)` | Deep containment check |
| `in(obj)` | Test if input is key in obj |
| `inside(v)` | Test if input is contained in v |
| `map(f)` | Apply f to each element |
| `map_values(f)` | Apply f to all values |
| `select(f)` | Keep elements where f is truthy |
| `del(f)` | Delete paths |
| `add` | Sum/fold array |
| `sort` / `sort_by(f)` | Sort array |
| `reverse` | Reverse array |
| `unique` / `unique_by(f)` | Deduplicate |
| `group_by(f)` | Group by key |
| `min_by(f)` / `max_by(f)` | Extremes by key |
| `flatten` / `flatten(n)` | Flatten to depth |
| `join(sep)` | Join array to string |
| `to_entries` | Object to \[{key, value}\] |
| `from_entries` | \[{key, value}\] to object |
| `with_entries(f)` | Transform entries |
| `transpose` | Matrix transpose |
| `indices(v)` | All indices of v |
| `index(v)` / `rindex(v)` | First / last index |
| `range(n)` / `range(a;b)` | Number range |
| `walk(f)` | Apply f to all nodes bottom-up |
| `recurse(f)` | Recursive descent |
| `paths` / `leaf_paths` | All / leaf paths |
| `getpath(p)` / `setpath(p; v)` | Path access |
| `pick(pathexps)` | Pick paths from input |
| `ROWS(arr)` / `COLUMNS(arr)` | Row/column count |

### String

| Function | Description |
| --- | --- |
| `ascii_downcase` / `ascii_upcase` | Case conversion |
| `ltrimstr(s)` / `rtrimstr(s)` | Remove prefix / suffix |
| `trim` / `ltrim` / `rtrim` | Trim whitespace |
| `startswith(s)` / `endswith(s)` | Test prefix / suffix |
| `split(s)` | Split on string |
| `test(re)` / `match(re)` | Regex test / match |
| `capture(re)` | Named capture groups |
| `scan(re)` | All regex matches |
| `sub(re; s)` / `gsub(re; s)` | Regex substitution |
| `tostring` / `tonumber` | Type conversion |
| `tojson` / `fromjson` | JSON encode/decode |
| `explode` / `implode` | String ↔ codepoints |

### Type Selectors

| Function | Description |
| --- | --- |
| `type` | Return type name as string |
| `arrays` / `objects` / `strings` / `numbers` / `booleans` / `nulls` | Select by type |
| `values` / `scalars` | Non-null / scalar values |
| `iterables` | Arrays or objects |
| `isnan` / `isinfinite` / `isnormal` / `isfinite` | Number predicates |
| `nan` / `infinite` | IEEE constants |

### Iteration & Flow

| Function | Description |
| --- | --- |
| `first` / `first(g)` | First element / output |
| `last` / `last(g)` | Last element / output |
| `nth(n; g)` | Nth output |
| `limit(n; g)` | First n outputs |
| `skip(n; g)` | Skip first n outputs |
| `isempty(g)` | True if generator is empty |
| `any` / `any(f)` / `any(g; f)` | Existential test |
| `all` / `all(f)` / `all(g; f)` | Universal test |
| `while(cond; update)` | Emit while condition holds |
| `until(cond; next)` | Apply until condition holds |
| `repeat(f)` | Repeat forever |
| `combinations` | Cartesian product |
| `empty` | Produce no output |

### Math (jq native)

The jq math library is available in BXL with C/IEEE semantics. Both unary (pipe-input) and binary forms are supported where C provides them — write `x | pow(y)` or `pow(x; y)`, both work.

| Category | Functions |
| --- | --- |
| Trig | `sin` `cos` `tan` `asin` `acos` `atan` `atan2(x)` `atan2(y; x)` |
| Hyperbolic | `sinh` `cosh` `tanh` `asinh` `acosh` `atanh` |
| Exp/Log | `exp` `exp2` `exp10` `expm1` `log` `log2` `log10` `pow(y)` `pow(b; e)` `pow10` `sqrt` `cbrt` |
| Rounding | `floor` `ceil` `round` `trunc` `nearbyint` `rint` `fabs` |
| Binary math | `hypot(y)` `hypot(x; y)` `fmax(y)` `fmax(x; y)` `fmin(y)` `fmin(x; y)` `fdim(x; y)` `copysign(x; y)` `fmod(x; y)` `drem(x; y)` `remainder(x; y)` |
| Bessel | `j0` `j1` `jn(n; x)` `y0` `y1` `yn(n; x)` |
| Special | `gamma` `lgamma` `lgamma_r` `tgamma` `erf` `erfc` |
| IEEE float | `frexp` `ldexp(x; n)` `scalb(x; n)` `scalbln(x; n)` `logb` `significand` `modf` `fma(a; b; c)` `nextafter(x; y)` `nexttoward(x; y)` |
| Misc | `scalars_or_empty` |

> **Collision warning — `atan2`.** The binary jq form is `atan2(y; x)` and follows C/POSIX order. The Excel form is `ATAN2(x, y)` with comma separators. See [_How `MATCH` and `match` dispatch_](#how-match-and-match-dispatch) for the full story.

> **Sandbox-blocked.** `input/0`, `input_filename/0`, `input_line_number/0`, and `modulemeta/0` raise `#NAME?` because BXL has no input stream or module loader to back them. These are the only jq math/IO builtins that intentionally remain unimplemented.

## String Formats

Used as `@fmt "..."` or `format("fmt")` for string interpolation.

| Format | Description | Example |
| --- | --- | --- |
| `@text` | Convert to string (default) | `42 \| @text` → `"42"` |
| `@json` | JSON-encode | `{a:1} \| @json` → `'{"a":1}'` |
| `@html` | HTML-escape | `"<b>" \| @html` → `"<b>"` |
| `@uri` | Percent-encode | `"a b" \| @uri` → `"a%20b"` |
| `@urid` | Percent-decode | `"a%20b" \| @urid` → `"a b"` |
| `@csv` | CSV row | `["a","b"] \| @csv` → `"\"a\",\"b\""` |
| `@tsv` | TSV row | `["a","b"] \| @tsv` → `"a\tb"` |
| `@sh` | Shell-escape | `"it's" \| @sh` → `"'it'\\''s'"` |
| `@base64` | Base64 encode | `"hello" \| @base64` |
| `@base64d` | Base64 decode | `"aGVsbG8=" \| @base64d` |

### How to use formatters

Three patterns, in order of how often you'll reach for them.

#### 1 · Pipe form — _"transform this value"_

_Most common. Put | @fmt at the end of any expression._

```
"Bill To".Name | @html                         -- HTML-escape for safe render
Invoice | @json                                  -- serialize the whole card
"Upload Token" | @base64                         -- encode a secret
[Customer.Name, Customer.Email] | @csv        -- one CSV row
```

#### 2 · Literal-with-interpolation form — _"inject values into a string safely"_

Following a format with a literal string runs every `\(expr)` inside it through that formatter. Use this whenever you're building output that lands in HTML, a URL, a shell command, JSON, CSV, or anywhere else with escaping rules.

_Each interpolation is auto-escaped by the format in front._

```
@html "Hi <b>\(Customer.Name)</b>, order \(Order Number)"
  -- Customer.Name and Order Number are HTML-escaped before insertion

@uri "/search?q=\(Query)&page=\(Page)"
  -- Query ("cats & dogs") becomes "cats%20%26%20dogs"

@sh "echo \(Message)"
  -- Shell-escapes the message so `'` / `$` / `\\` stay literal

@csv "\(Invoice Number),\(Total),\(Currency)"
  -- Produces a valid CSV row with commas quoted when they appear in fields
```

> **When to reach for this.** Anywhere an interpolation value could break the surrounding format — user-typed fields in HTML, search terms in URLs, filenames in shell commands, free text in CSV. The format-prefix contract guarantees every `\(…)` inside the string is pre-escaped for that sink. Without the prefix you'd hand-call `@html` / `@uri` / `@sh` on each interpolation separately and hope you remembered all of them.

#### 3 · Round-trip encode → decode

_Encoders come paired. Use the d variant to reverse._

```
"Opaque Token" | @base64 | @base64d    == "Opaque Token"
"Query String" | @uri    | @urid       == "Query String"
```

#### Common recipes

| Need | BXL |
| --- | --- |
| Safe-render a user string into HTML | `@html "Hello \(Name)"` |
| Build a URL query string | `@uri "/api?q=\(Query)"` |
| Serialize a card for logging / debugging | `. \| @json` |
| Emit one CSV row per invoice | `Invoice[all] \| map([.Number, .Total] \| @csv)` |
| Encode a binary payload | `Attachment.Bytes \| @base64` |
| Build a safe shell command | `@sh "mv \(Source) \(Dest)"` |

## Error Codes

BXL uses Excel-compatible error codes. Catch them with `IFERROR`, `IFNA`, or `try/catch`.

| Error | Code | Meaning |
| --- | --- | --- |
| `#NULL!` | 1 | Null reference |
| `#DIV/0!` | 2 | Division by zero |
| `#VALUE!` | 3 | Wrong value type |
| `#REF!` | 4 | Invalid reference |
| `#NAME?` | 5 | Unknown function name |
| `#NUM!` | 6 | Numeric error (overflow, domain) |
| `#N/A` | 7 | Value not available |
| `#GETTING_DATA` | 8 | Data still loading |

_Handling errors_

```
IFERROR(.revenue / .headcount, 0)

try (.x | tonumber) catch "not a number"

IF(ISERROR(.lookup), "fallback", .lookup)
```

* * *

## Excel Function Coverage

BXL implements 300+ functions from the Excel/Google Sheets function set, plus 16 BXL-only extensions (the `_BY` row-object variants). This section maps coverage against the [FormulaJS](https://formulajs.info/) library.

### jq-only idioms (lowercase, no Excel counterpart)

These functions exist only in jq's vocabulary — there's no Excel paste-equivalent, so the lowercase form is the canonical spelling:

| jq idiom | Category | Notes |
| --- | --- | --- |
| `map(f)` `select(f)` `sort_by(f)` `unique_by(f)` `group_by(f)` | Array | Pure jq pipe transforms |
| `add` | Array | Sum of pipe input (`[1,2,3] \| add` → `6`) |
| `transpose` | Array | Transpose a 2-D array |
| `to_entries` `from_entries` `with_entries(f)` | Object | Object↔key/value-array conversion |
| `keys` `keys_unsorted` `values` `has(k)` `del(p)` | Object | Structural |
| `range(n)` `range(a; b)` `range(a; b; step)` | Iter | Numeric generator |
| `recurse(f)` `walk(f)` | Iter | Tree walks |
| `paths` `leaf_paths` `getpath(p)` `setpath(p; v)` | Path | JSONPath access |
| `length` `type` `tostring` `tonumber` `tojson` `fromjson` | Type | Coercion + introspection |
| `now` | Date | Unix timestamp |
| `pow(b; e)` `pow(e)` (unary) | Math | C-style exponent. Different name from `POWER`, no collision. |
| `fmod(a; b)` | Math | Dividend-signed modulo. Different name (and semantics) from `MOD`. |
| `fmax(a; b)` `fmin(a; b)` | Math | NaN-skipping. Different name from `MAX`/`MIN`. |
| `hypot(a; b)` `copysign(a; b)` `fdim(a; b)` `expm1` `pow10` `ldexp` | Math | C-only; no Excel counterpart |
| `jn(n; x)` `yn(n; x)` `j0` `j1` `y0` `y1` | Bessel | C order. `BESSELJ`/`BESSELY` use Excel order. |

These are all **honest jq-native idioms** — the linter does NOT flag the lowercase spelling, because no Excel counterpart exists (or the names differ).

### Excel functions with case-folded jq counterparts

Functions where a lowercase jq spelling case-folds to an Excel-style name. **UPPERCASE is preferred only when dispatch resolved to Excel**; lowercase is preferred when arity/call shape or semicolon dispatch resolved to jq:

| Preferred (Excel) | Also accepted (lowercase) | Notes |
| --- | --- | --- |
| `SIN(x)` `COS(x)` `TAN(x)` `ASIN(x)` `ACOS(x)` `ATAN(x)` | `sin(x)` … `atan(x)` | Lint: prefer UPPERCASE |
| `ATAN2(x, y)` | `atan2(y; x)` | Comma form is Excel order. Semicolon form is jq/POSIX order. See [collision rules](#how-match-and-match-dispatch). |
| `SINH(x)` `COSH(x)` `TANH(x)` `ASINH(x)` `ACOSH(x)` `ATANH(x)` | `sinh(x)` … `atanh(x)` | Lint: prefer UPPERCASE |
| `EXP(x)` `LOG10(x)` `SQRT(x)` | `exp(x)` `log10(x)` `sqrt(x)` | Lint: prefer UPPERCASE |
| `LN(x)` | (use `LN`, not lowercase `log`) | jq's `log/0` is natural log (no explicit arg); Excel `LOG/1` is base-10. Different math at one-arg arity — arity decides. |
| `LOG(x)` | `x \| log` | Excel `LOG(x)` = base-10. jq bare filter `log` = natural log. |
| `POWER(b, e)` | (use `POWER` for Excel-flavoured code; `pow(b; e)` is the jq idiom and stays lowercase) | Different names — no lint either way. Pick by intent. |
| `GAMMA(x)` | `gamma(x)` | True Γ. Lint: prefer UPPERCASE. For log-Γ use `GAMMALN` / `lgamma`. |
| `ERF(x)` `ERFC(x)` | `erf(x)` `erfc(x)` | Lint: prefer UPPERCASE |
| `FLOOR(x)` `ROUND(x)` `TRUNC(x)` | `floor(x)` `round(x)` `trunc(x)` | Lint: prefer UPPERCASE |
| `ABS(x)` | (use `ABS`; `fabs` is the jq idiom — different name) | Different names — no lint |

> **Read [_How `MATCH` and `match` dispatch_](#how-match-and-match-dispatch)** for the full collision rules, the `ATAN2` argument-order story, `NOW` call-shape rule, and `GAMMA` / log-Γ resolution. The linter rule that backs the casing advice in this table is documented under [Linter style nudges](#linter-style-nudges).

> Range-based multi-criteria functions (`SUMIFS`, `COUNTIFS`, `AVERAGEIFS`) are not implemented as uppercase helpers because BXL's `_BY` variants (`SUMIFS_BY`, `COUNTIFS_BY`, `AVERAGEIFS_BY`) are more natural for JSON data. Use those instead.

### Lazy Extensions and Unsupported Families

Some FormulaJS families are implemented but intentionally lazy because they pull heavier optional dependencies or are rarely needed. Others are explicitly not supported in BXL because they assume a spreadsheet grid, criteria ranges, or array-returning analysis shapes that do not fit JSON computed fields.

| Category | Functions | Status |
| --- | --- | --- |
| Lazy statistical distributions and tests | `BETA.DIST` `BINOM.DIST` `CHISQ.DIST` `F.DIST` `GAMMA.DIST` `NORM.DIST` `POISSON.DIST` `T.DIST` `WEIBULL.DIST` and their `.INV`, `.RT`, `.TEST` variants | Loaded only by async runtimes when an expression calls one of these functions. Canonical BXL uses underscore names such as `NORM_DIST(...)`; pasted dotted names are accepted in readable syntax. |
| Lazy financial formulas | `PMT` `NPV` `IRR` `XIRR` `FV` `PV` `RATE` `COUPDAYS` `TBILLPRICE` and the rest of the Financial section | Loaded by async runtimes as `formula-financial`. Shares the `formula-extras` bundle with lazy engineering. |
| Lazy engineering formulas | `BIN2DEC` `BITAND` `COMPLEX` `IM*` `ERF` `ERFC` `CONVERT` `UNICHAR` and related helpers | Loaded by async runtimes as `formula-engineering`. `ROMAN` and `ARABIC` remain eager. |
| Lazy Bessel functions | `BESSELI` `BESSELJ` `BESSELK` `BESSELY` | Loaded by async runtimes as `formula-bessel` when an expression calls one of these specialized engineering functions. |
| Database | `DAVERAGE` `DCOUNT` `DCOUNTA` `DGET` `DMAX` `DMIN` `DPRODUCT` `DSTDEV` `DSTDEVP` `DSUM` `DVAR` `DVARP` | **Unsupported in BXL.** Excel database functions assume a flat cell range with criteria ranges. BXL uses `map`/`select`/`_BY` variants instead -- more powerful on JSON. |
| Grid reference | `COLUMN` `ROW` `SUBTOTAL` `AGGREGATE` | **Unsupported in BXL.** These require a cell grid model. No equivalent concept exists in JSON expressions. Note: `ROWS(arr)` and `COLUMNS(arr)` are supported array-shape helpers; singular `ROW` / `COLUMN` are not. |
| Matrix | `MMULT` `MUNIT` | **Unsupported in BXL.** Matrix multiplication and identity belong in jq array pipelines or dedicated math libraries. |
| Regression | `LINEST` `LOGEST` `GROWTH` `TREND` | **Unsupported in BXL.** These return regression arrays / projections whose shapes don't map cleanly to single computed fields. |

### Coverage Summary

| Status | Count | Notes |
| --- | --- | --- |
| Implemented | 300+ | All targeted Excel-compatible formula functions; large FormulaJS extension families load lazily in async runtimes |
| Lazy extension libraries | 4 | `formula-statistical`, `formula-bessel`, `formula-engineering`, `formula-financial` |
| BXL-only extensions | 16 | `_BY` row-object variants, `COL`, `ERROR_TYPE` |
| Excel name with case-folded jq counterpart | ~25 | Trig, exp/log, rounding, gamma, erf — UPPERCASE preferred (lint nudges lowercase) |
| jq-only idioms (no Excel counterpart) | ~30 | `map`, `select`, `add`, `sort_by`, `pow`, `fmod`, `hypot`, `jn`, etc. — lowercase canonical |
| Won't add | ~30 | Database functions, grid reference functions, matrix helpers, regression arrays |
