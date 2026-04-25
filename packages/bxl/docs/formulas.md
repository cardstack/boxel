# BXL Formulas

BXL ships a curated library of helpers that can be called inline in any
expression. Two conventions govern every name in this library.

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

Both conventions are enforced socially in review, not by the compiler.
The compiler is case-insensitive, so `ISBLANK(x)`, `isblank(x)`, and
`IsBlank(x)` all resolve to the same function. The convention is about
communicating *intent* to the reader:

| Reader sees | Interpretation                                   |
| ----------- | ------------------------------------------------ |
| `ISBLANK`   | "This is Excel. I could paste it into a cell."   |
| `present`   | "This is BXL-native. Not portable to Excel."     |

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
nonempty(split(Donor; " "))  → drop empty tokens before counting
```

**When to use which:**
- `present(x)` — form fields, user input. An empty string counts as "not filled in."
- `NOT ISBLANK(x)` — matches Excel semantics. Empty string counts as filled.

### Conditional logic

| Name               | Case      | Source | Purpose                                      |
| ------------------ | --------- | ------ | -------------------------------------------- |
| `IF(p; t; e)`       | UPPERCASE | Excel  | Standard if/then/else.                       |
| `IF(p; t)`          | UPPERCASE | Excel  | Two-arg: defaults else-branch to `false`.    |
| `IFS(c1; v1; …)`    | UPPERCASE | Excel  | Chained if/elif/else.                        |
| `IFERROR(v; e)`     | UPPERCASE | Excel  | Swallow errors with fallback.                |
| `when(p; q)`        | lowercase | BXL    | `IF(p, q, TRUE)` — implication shortcut.     |
| `implies(p; q)`     | lowercase | BXL    | Alias of `when`, preferred in logic text.    |

```bxl
-- Excel canonical form:
IF(Payment = "Credit card", NOT ISBLANK("Bill To".Zip), TRUE)

-- BXL shortcut for the same thing:
when(Payment = "Credit card"; present("Bill To".Zip))
```

### Text / string

| Name             | Case      | Source | Purpose                                       |
| ---------------- | --------- | ------ | --------------------------------------------- |
| `UPPER(s)`       | UPPERCASE | Excel  | Uppercase.                                    |
| `LOWER(s)`       | UPPERCASE | Excel  | Lowercase.                                    |
| `TRIM(s)`        | UPPERCASE | Excel  | Strip leading/trailing/double whitespace.     |
| `LEN(s)`         | UPPERCASE | Excel  | Length in characters.                         |
| `CONCAT(…)`      | UPPERCASE | Excel  | String concatenation.                         |
| `SUBSTITUTE(…)`  | UPPERCASE | Excel  | Replace occurrences.                          |
| `EXACT(a; b)`     | UPPERCASE | Excel  | Case-sensitive equality.                      |
| `contains(sub)`  | lowercase | jq     | Input contains `sub` (string or structural).  |
| `startswith(p)`  | lowercase | jq     | Input starts with `p`.                        |
| `endswith(s)`    | lowercase | jq     | Input ends with `s`.                          |
| `split(sep)`     | lowercase | jq     | Split string into array by separator.         |
| `words(s)`       | lowercase | BXL    | Count whitespace-separated non-empty tokens.  |

```bxl
UPPER(Currency) = "USD"        -- Excel idiom
words(Donor) >= 2              -- BXL, no Excel equivalent
Email | contains("@")          -- lowercase jq pipe form
```

### Numbers & math

| Name          | Case      | Source | Purpose                             |
| ------------- | --------- | ------ | ----------------------------------- |
| `ROUND(n; d)`  | UPPERCASE | Excel  | Round to d decimal places.          |
| `ABS(n)`      | UPPERCASE | Excel  | Absolute value.                     |
| `POWER(b; e)`  | UPPERCASE | Excel  | `b^e`.                              |
| `SQRT(n)`     | UPPERCASE | Excel  | Square root.                        |
| `MOD(n; d)`    | UPPERCASE | Excel  | Modulo.                             |
| `length`      | lowercase | jq     | Array/string/object length.         |
| `min`, `max`  | lowercase | jq     | Array min/max.                      |
| `add`         | lowercase | jq     | Sum of array.                       |

For the full catalog, see the in-repo registry
(`src/bxl/registry/index.ts`) — it is the authoritative source.

## Adding new helpers

When you want a helper that doesn't exist:

1. **Check Excel first.** Run `EXCELFORMULA()` in a spreadsheet. If Excel
   has it under that name, add it UPPERCASE to BXL with matching semantics.
2. **If Excel doesn't have it,** pick a lowercase name. Add it to
   `CASE_INSENSITIVE_JQ_FUNCTIONS` and define it in
   `src/bxl/bridge/formula-contrib-jq.ts` (jq source) or
   `src/bxl/bridge/formula-contrib-native.ts` (JS impl).
3. **Never invent a new UPPERCASE name.** If you catch yourself doing
   this, you're probably missing an existing Excel function, or you
   should be using lowercase.

This keeps the catalog honest: every UPPERCASE name is a promise that
Excel works the same way, and every lowercase name is an acknowledgment
that the helper is BXL-specific.
