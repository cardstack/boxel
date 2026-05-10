# BXL Formulas

BXL ships a curated library of helpers that can be called inline in any
expression. Three conventions govern names in this library.

## Naming convention

**UPPERCASE** — reserved for functions that exist in Microsoft Excel.

> If you see `UPPER(x)` in a BXL expression, you should be able to see the
> same thing in an Excel cell. Paste-compatibility is a first-class goal:
> Excel users can drop formulas into BXL fields and have them work.
>
> **We never invent new UPPERCASE names.** If you find yourself wanting
> `MYHELPER(x)` and it's not in Excel, use a lowercase name instead.

**lowercase** — BXL-native helpers that have no Excel equivalent, or jq
ecosystem primitives.

> These are open to addition when a useful pattern emerges. Examples:
> `present`, `when`, `words`, `nonempty`, `last`, `type`, `error`.
>
> Case-insensitivity still resolves them (`present(x) == PRESENT(x)`
> evaluate identically), but by convention they're written lowercase so
> readers know "this is BXL's contribution, not Excel's."

**camelCase** — upstream JavaScript library idioms that authors and LLMs
already know.

> Validator.js functions keep their upstream shape: `isEmail(value)`,
> `isURL(value, options)`, `isUUID(value, version)`. They still resolve
> case-insensitively, but authored examples use validator.js casing so
> copied code keeps its familiar API shape.

These conventions are enforced socially in review, not by the compiler.
The compiler is case-insensitive, so `ISBLANK(x)`, `isblank(x)`, and
`IsBlank(x)` all resolve to the same function. The convention is about
communicating *intent* to the reader:

| Reader sees | Interpretation                                      |
| ----------- | --------------------------------------------------- |
| `ISBLANK`   | "This is Excel. I could paste it into a cell."      |
| `present`   | "This is BXL-native. Not portable to Excel."        |
| `isEmail`   | "This is a validator.js function." |

## Lazy extension libraries

Most formula helpers are eager and available to both sync and async
evaluators. Large or specialized helper families are split into lazy
extension libraries so Boxel only loads them when an expression actually
calls one of their functions.

| Library | Examples | Runtime behavior |
| ------- | -------- | ---------------- |
| `formula-statistical` | `NORM_DIST`, `T_TEST`, `BETA_INV`, `POISSON_DIST` | Loaded by async runtimes when referenced. Dotted Excel names such as `NORM.DIST` are accepted in readable syntax and rewritten to underscores. |
| `formula-bessel` | `BESSELI`, `BESSELJ`, `BESSELK`, `BESSELY` | Loaded by async runtimes when referenced. |
| `formula-engineering` | `BIN2DEC`, `BITAND`, `COMPLEX`, `IM*`, `ERF`, `CONVERT`, `UNICHAR` | Loaded by async runtimes when referenced. `ROMAN` and `ARABIC` remain eager. |
| `formula-financial` | `PMT`, `NPV`, `IRR`, `XIRR`, `FV`, `PV`, `RATE`, `COUPDAYS` | Loaded by async runtimes when referenced; shares the `formula-extras` bundle with lazy engineering. |
| `validation` | `isEmail`, `isURL`, `isUUID`, `isPostalCode`, `isStrongPassword` | Loaded by async runtimes when referenced. Names and option shapes follow validator.js. |

Use `runNativeJqAsync`, `prepareNativeJqAsync`, or
`prepareBoxelRuntimeAsync` when expressions may call a lazy helper. The sync
APIs (`evaluateBxl`, `runNativeJq`) use the eager core unless the caller has
explicitly registered the lazy library.

## Unsupported FormulaJS / Excel families

These functions exist in Excel or upstream FormulaJS, but are intentionally
not supported in BXL.

| Family | Functions | Reason |
| ------ | --------- | ------ |
| Database | `DAVERAGE`, `DCOUNT`, `DCOUNTA`, `DGET`, `DMAX`, `DMIN`, `DPRODUCT`, `DSTDEV`, `DSTDEVP`, `DSUM`, `DVAR`, `DVARP` | Excel database functions assume a flat cell range with criteria ranges. Use `map`, `select`, and `_BY` helpers over JSON rows instead. |
| Grid reference | `COLUMN`, `ROW`, `SUBTOTAL`, `AGGREGATE` | These require a spreadsheet cell grid. BXL has no equivalent grid model. `ROWS(arr)` and `COLUMNS(arr)` are supported array-shape helpers; singular `ROW` / `COLUMN` are not. |
| Matrix | `MMULT`, `MUNIT` | Matrix multiplication and identity are better handled by jq array pipelines or dedicated math libraries. |
| Regression | `LINEST`, `LOGEST`, `GROWTH`, `TREND` | These return regression arrays / projections whose shapes do not map cleanly to single computed fields. |

## Built-in helper inventory (as of v0.1.0-dev)

### Presence & emptiness

| Name            | Case      | Source | Purpose                                                   |
| --------------- | --------- | ------ | --------------------------------------------------------- |
| `ISBLANK(x)`    | UPPERCASE | Excel  | TRUE if `x` is `null` / `undefined`. **Empty string is NOT blank** — matches Excel's strict behavior. |
| `present(x)`    | lowercase | BXL    | TRUE if `x` is neither `null` nor `""`. Looser than ISBLANK; usually what you want for form validation. |
| `nonempty(arr)` | lowercase | BXL    | Return `arr` stripped of `null` / `""` items.             |

```bxl
ISBLANK(Campaign)            → true only when Campaign is null (Excel-strict)
present(Campaign)            → false for both null and ""  (form-friendly)
NOT ISBLANK(Campaign)        → Excel-equivalent positive check
nonempty(Donor | split(" "))  → drop empty tokens before counting
```

**When to use which:**
- `present(x)` — form fields, user input. An empty string counts as "not filled in."
- `NOT ISBLANK(x)` — matches Excel semantics. Empty string counts as filled.

### Conditional logic

| Name               | Case      | Source | Purpose                                      |
| ------------------ | --------- | ------ | -------------------------------------------- |
| `IF(p, t, e)`       | UPPERCASE | Excel  | Standard if/then/else.                       |
| `IF(p, t)`          | UPPERCASE | Excel  | Two-arg: defaults else-branch to `false`.    |
| `IFS(c1, v1, …)`    | UPPERCASE | Excel  | Chained if/elif/else.                        |
| `IFERROR(v, e)`     | UPPERCASE | Excel  | Swallow errors with fallback.                |
| `when(p, q)`        | lowercase | BXL    | `IF(p, q, TRUE)` — implication shortcut.     |
| `implies(p, q)`     | lowercase | BXL    | Alias of `when`, preferred in logic text.    |

```bxl
-- Excel canonical form:
IF(Payment = "Credit card", NOT ISBLANK("Bill To".Zip), TRUE)

-- BXL shortcut for the same thing:
when(Payment = "Credit card", present("Bill To".Zip))
```

### validator.js functions

BXL supports validator.js's boolean validators where they make sense in an
expression language. The full supported list is in
[`docs/syntax-reference.md`](./syntax-reference.md#validatorjs-functions).

```bxl
isEmail(Email)
isURL(Website, {require_protocol:true})
isMobilePhone(Phone, "en-US", {strictMode:true})
isUUID(ID, 4)
isPostalCode(Zip, "US")
```

Validator.js functions are safe validators: non-string inputs and invalid
validator.js option values return `false` instead of throwing. Use jq
`test(re)` when the rule is a bespoke regex; use validator.js functions when
the rule is one of its well-known predicates.

### Lookups

BXL supports Excel lookup helpers, but BXL-shaped JSON usually reads better
when you navigate the object rows directly.

```bxl
-- Preferred when the lookup is naturally a row predicate.
"Line Item"[SKU = "B"]."Unit Price"

-- Excel XLOOKUP shape: root lookup value + aligned projections.
XLOOKUP("Target SKU", "Line Item".SKU, "Line Item"."Unit Price", null)

-- Excel VLOOKUP shape: build a two-column table, then return column 2.
VLOOKUP("Target SKU", (["Line Item".SKU, "Line Item"."Unit Price"] | transpose), 2, false)
```

Prefer the predicate path for ordinary BXL/json rules when the condition is
local to the row. Use `XLOOKUP` when porting Excel formulas, when the lookup
value is a separate root field, or when the lookup and return arrays are
already separate. Use `VLOOKUP` when preserving a spreadsheet table formula
matters. `XLOOKUP` is less brittle than `VLOOKUP` because it names the return
projection directly instead of relying on a column number.

### Text / string

| Name             | Case      | Source | Purpose                                       |
| ---------------- | --------- | ------ | --------------------------------------------- |
| `UPPER(s)`       | UPPERCASE | Excel  | Uppercase.                                    |
| `LOWER(s)`       | UPPERCASE | Excel  | Lowercase.                                    |
| `TRIM(s)`        | UPPERCASE | Excel  | Strip leading/trailing/double whitespace.     |
| `LEN(s)`         | UPPERCASE | Excel  | Length in characters.                         |
| `CONCAT(…)`      | UPPERCASE | Excel  | String concatenation.                         |
| `SUBSTITUTE(…)`  | UPPERCASE | Excel  | Replace occurrences.                          |
| `EXACT(a, b)`     | UPPERCASE | Excel  | Case-sensitive equality.                      |
| `contains(sub)`  | lowercase | jq     | Input contains `sub` (string or structural).  |
| `startswith(p)`  | lowercase | jq     | Input starts with `p`.                        |
| `endswith(s)`    | lowercase | jq     | Input ends with `s`.                          |
| `split(sep)`     | lowercase | jq     | Split string into array by separator.         |
| `words(s)`       | lowercase | BXL    | Count whitespace-separated non-empty tokens.  |

```bxl
UPPER(Currency) = "USD"        -- Excel idiom
words(Donor) >= 2              -- BXL, no Excel equivalent
SKU | startswith("BRAND")      -- lowercase jq pipe form
```

### Numbers & math

| Name          | Case      | Source | Purpose                             |
| ------------- | --------- | ------ | ----------------------------------- |
| `ROUND(n, d)`  | UPPERCASE | Excel  | Round to d decimal places.          |
| `ABS(n)`      | UPPERCASE | Excel  | Absolute value.                     |
| `POWER(b, e)`  | UPPERCASE | Excel  | `b^e`.                              |
| `SQRT(n)`     | UPPERCASE | Excel  | Square root.                        |
| `MOD(n, d)`    | UPPERCASE | Excel  | Modulo.                             |
| `length`      | lowercase | jq     | Array/string/object length.         |
| `min`, `max`  | lowercase | jq     | Array min/max.                      |
| `add`         | lowercase | jq     | Sum of array.                       |

For the full catalog, see the in-repo registry
(`src/bxl/registry/index.ts`) plus the lazy manifests in
`src/bxl/bridge/formula-*-manifest.ts` — those files are the authoritative
source.

## Adding new helpers

When you want a helper that doesn't exist:

1. **Check Excel first.** Run `EXCELFORMULA()` in a spreadsheet. If Excel
   has it under that name, add it UPPERCASE to BXL with matching semantics.
2. **If it is small and broadly useful,** add it to the eager formula bridge
   in `src/bxl/bridge/formula-contrib-native.ts`.
3. **If it pulls a heavier FormulaJS dependency or belongs to a specialized
   family,** add it as a lazy extension instead: define the manifest in
   `src/bxl/bridge/formula-*-manifest.ts`, implement the native bridge in
   `src/bxl/bridge/formula-*-native.ts`, expose it from `src/bxl/registry/`,
   and wire auto-loading through `src/bxl/bridge/lazy-formulas.ts`.
4. **If Excel doesn't have it,** pick a lowercase name unless you are
   intentionally preserving a known upstream JavaScript API such as
   validator.js. Add lowercase BXL/jq helpers to
   `CASE_INSENSITIVE_JQ_FUNCTIONS` and define it in
   `src/bxl/bridge/formula-contrib-jq.ts` (jq source) or
   `src/bxl/bridge/formula-contrib-native.ts` (JS impl).
5. **Never invent a new UPPERCASE name.** If you catch yourself doing
   this, you're probably missing an existing Excel function, or you
   should be using lowercase.

This keeps the catalog honest: every UPPERCASE name is a promise that
Excel works the same way, every lowercase name is an acknowledgment that
the helper is BXL-specific or jq-native, and every camelCase library helper
keeps the external API shape authors already recognize.
