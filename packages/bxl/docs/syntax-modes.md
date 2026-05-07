# BXL syntax modes

BXL accepts three forms at the call site of `bxl()` / `expression()`:

1. A plain string — readable BXL syntax (default).
2. `` jq`…` `` — plain jq, readable-syntax compilation skipped.
3. `` fx`…` `` — Excel-like readable BXL, identical compilation to a
   plain string but explicit at the call site.

This document is the canonical reference for what each mode does,
why you'd pick one over another, and what surprises to watch for.
For the rules baked into the readable-syntax compiler itself (label
resolution, PascalCase fallback, jq keyword guard, etc.), see
[`docs/internals/port-from-jqxl.md`](./internals/port-from-jqxl.md)
§12 / §13.

## The decision tree

```
Is the source pasted from Excel, or does it use Excel
function names (SUM, ROUND, IF, IFS)?
  └─ yes → plain string, or fx`…` for clarity
  └─ no
     │
     Does the source use `\(…)` jq interpolation?
       └─ yes → jq`…`        (preserves the backslash through JS escape)
       └─ no
          │
          Does the source mention bare PascalCase identifiers?
            └─ yes → plain string  (the fallback resolves them to camelCase)
            └─ no  → either jq`…` (faster, no readable-syntax compile)
                            or plain string (still works, no-op)
```

## Mode by mode

### Plain string — readable BXL

```ts
expression('Severity == "High"')
expression('ROUND(Subtotal * "Tax Rate" / 100, 2)')
expression('if .dischargeDate then "discharged" else "active" end')
```

The compiler:
- runs the readable-syntax pass first (PascalCase → camelCase
  fallback, Excel functions, label resolution against a `schema` if
  one is provided);
- evaluates the resulting jq.

Use when:
- You want Excel-like syntax (PascalCase identifiers, `SUM`,
  `ROUND`, `IF`, …).
- You're writing a card field's `computeVia` and want the source to
  read like a spreadsheet formula.

Watch for:
- **`\(…)` interpolation**: a regular JS string literal silently
  drops the backslash. Use `` jq`…` `` instead.
- **Excel `IF` vs jq `if`**: BXL's compiler is case-sensitive at
  the dispatch boundary. `IF(cond; t; f)` is the Excel function;
  `if cond then … end` is the jq construct. Don't mix them in one
  source.

### `` jq`…` `` — plain jq

```ts
expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`)
expression(jq`if .severity == "Critical" then { tone: "red" } else { tone: "blue" } end`)
expression(jq`.medications | map(.name)`)
```

The compiler:
- skips the readable-syntax pass entirely;
- hands the source straight to the jq parser.

Use when:
- The source uses `\(…)` interpolation. Backticks preserve the
  backslash through JS string escaping; a regular string literal
  would silently drop it.
- You're already writing pure jq and don't want readable-syntax
  surprises (e.g. PascalCase fallback turning a jq variable name
  into a path).
- You want a small per-call performance win — skipping the
  compile step is cheaper.

Watch for:
- **PascalCase identifiers**: bare `Severity` won't resolve to
  `.severity` here. Write `.severity` directly.
- **Excel function names**: `SUM`, `ROUND`, `IF` aren't jq builtins.
  If you need them, use a plain string or `` fx`…` ``.

### `` fx`…` `` — explicit Excel-like BXL

```ts
expression(fx`ROUND(Salary / 2080, 2)`)
expression(fx`PatientId & " — " & FirstName & " " & LastName`)
expression(fx`SUM(Patients[].Billing.RoomCharge)`)
```

The compiler treats `` fx`…` `` exactly like a plain string —
readable-syntax compilation runs, Excel functions and PascalCase
fallback are in play. The only difference is that the tag makes the
intent obvious at the call site.

Use when:
- The same .gts file mixes `jq` and `fx` sources and you want the
  casing/PascalCase intent to be explicit.
- You're reaching for the spreadsheet `fx` mental model.

## Cross-cutting behaviors (all modes)

These apply regardless of the tag:

- **Excel-error tolerance.** Sentinels (`#N/A`, `#DIV/0!`,
  `#VALUE!`, etc.) raised inside evaluation are caught at the
  factory boundary and returned as `null`. The error doesn't
  propagate to the indexer.
- **`as: SomeFieldDef` materialization.** When the raw output is
  structured, `expression(..., { as: Cls })` materializes it as an
  instance of `Cls`. Uses Boxel's `getFields` when reachable;
  falls back to `Object.assign` otherwise.
- **Null-tolerant arithmetic.** `null - 5`, `5 / 0`, `null * x`,
  `null | startswith("a")` all return `null` / `false` instead of
  throwing.

## Mixed-syntax expressions

A single readable-syntax source can have a PascalCase head and jq
nested inside, or vice versa:

```ts
// PascalCase head + jq lowercase nested
expression(fx`Patients[Severity = "Critical"][.icuAdmissionDate != null]`)

// jq head + PascalCase nested via the readable-syntax compiler
expression(fx`.patients | map({ Name: .firstName, Acuity: .severity })`)
```

Both compile fine; the PascalCase fallback runs label-by-label.

## Choosing a tag — quick matrix

| Source has…                          | Plain string | `` jq`…` `` | `` fx`…` `` |
|--------------------------------------|:------------:|:-----------:|:-----------:|
| `\(…)` interpolation                 | ✗ (escape gotcha) | ✓ | ✗ (escape gotcha) |
| PascalCase bare identifier (`Severity`) | ✓        | ✗ (not resolved) | ✓ |
| Excel function (`ROUND`, `IFS`)      | ✓            | ✗            | ✓           |
| Pure jq pipe (`.x | length`)         | ✓            | ✓            | ✓           |
| Mixed PascalCase + jq                | ✓            | ✗            | ✓           |
| Hot-path performance matters         | OK           | ✓ (no compile) | OK         |

If in doubt: **plain string** is the safest default. Reach for
`` jq`…` `` only when you need the backslash preserved or you want
to opt out of readable-syntax compilation.

## Composing FieldDefs

A separate concern from "which tag to use": when a CardDef holds raw
inputs and threads them into one or more child FieldDefs via
`{ as: SomeFieldDef }` materialization, see
[`realm-composition.md`](./realm-composition.md) for the threading
shape (object literal whose keys match the FieldDef's `@field` names)
and the multi-stage pipeline pattern.
