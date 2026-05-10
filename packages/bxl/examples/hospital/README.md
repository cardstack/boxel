# Hospital example

A miniature Boxel-realm scenario, vendored as plain JS data, schema,
and expressions. Demonstrates the expression / jq / fx authoring
patterns used by the hospital fixture, but with **no Boxel runtime** —
runs straight against Node.

## Files

| File              | Purpose                                                                |
|-------------------|------------------------------------------------------------------------|
| `patient.json`    | One serialized HospitalPatient instance (cardiology, moderate severity).|
| `schema.ts`       | `ReadableSchema` mirroring the card's field layout — labels match the PascalCase identifiers used in `expressions.ts`. |
| `expressions.ts`  | Eight expressions covering the three syntax modes (plain string, `fx`, `jq`). Each notes which BXL feature it exercises. |
| `run.ts`          | Runnable script — evaluates every expression, prints result + pass/fail. |

## Running

From the repo root:

```sh
node scripts/run-ts-entry.mjs examples/hospital/run.ts
```

Or with `tsx` if you have it installed locally / globally:

```sh
tsx examples/hospital/run.ts
```

Expected: `8/8 expressions evaluated successfully`.

## What this example shows

- **Plain-string readable BXL** (`Severity == "High"`) — bare
  PascalCase identifiers resolve via the schema, or via the
  no-schema PascalCase fallback if you remove the `schema:` arg.
- **`` fx`…` `` for Excel-like sources** —
  `ROUND(Vitals.BpSystolic / Vitals.BpDiastolic, 2)` reads like a
  spreadsheet formula and compiles to canonical jq.
- **`` jq`…` `` for jq interpolation** —
  `` jq`"\(.vitals.bpSystolic)/\(.vitals.bpDiastolic)"` `` keeps
  the `\(...)` backslash that a regular JS string literal silently
  drops.
- **The `expression(...)` factory** binds the source to `this` (the
  patient record) so the call site reads exactly the way a Boxel
  card's `computeVia` does.
- **`evaluateBxl(...)`** as the lower-level alternative — same
  result, no `this` binding required.

## What this example deliberately doesn't show

- No `@field` decorators, no `contains` / `containsMany`, no realm
  server. That layer lives in the realm-server repo; BXL's contract
  ends at the `expression(...) → function` boundary.
- No `getFields`-aware `as: SomeFieldDef` materialization — that
  needs Boxel's runtime to be loaded. The Node fallback (`new Cls();
  Object.assign(instance, raw)`) is exercised in
  [`tests/boxel/expression-factory.ts`](../../tests/boxel/expression-factory.ts).
