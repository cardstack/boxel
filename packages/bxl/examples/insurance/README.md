# Insurance pricing & reserving example

A miniature actuarial scenario, vendored as plain JS data + a set of
expressions + a runner. Mirrors the structure of `examples/hospital/`
and `examples/airline/`-style fixtures, but exercises:

- Five-pair `IFS` (the arity that the airline fixture uncovered as
  not-yet-defined; now covers up to 8 pairs).
- `Earned - (Loss + Expense)` — the parenthesized cost-sum shape
  that the parser fix unblocked.
- `IF(AppliesFlag = "Yes", …, 0)` reinsurance guard.
- LDF chain `(Paid + Case) × LDF × ScenarioLDF` with parenthesized
  sum on the LHS of `*`.

Source spec: `insurance_pricing_reserving_excel_spec.md` from the
matching insurance fixture.

## Files

| File             | Purpose                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `policy.json`    | One policy×coverage instance (commercial auto, profitable case).                            |
| `expressions.ts` | Eight expressions covering the actuarial pipeline; each notes the BXL feature it exercises. |
| `run.ts`         | Runnable script — evaluates every expression and prints pass/fail.                          |

## Running

```sh
node examples/insurance/run.ts
```

Expected: `8/8 expressions evaluated successfully`.

## What this example shows beyond `examples/hospital/`

- `IFS` with five condition/value pairs — arity 10, well past the
  two-pair shape most examples reach for.
- `Earned - (Loss + Expense)` — a parenthesized subtraction. Getting
  this wrong (associating it as `(Earned - Loss) + Expense`) turns
  every expense into a positive contribution, so the shape is worth
  seeing evaluated.
- The insurance fixture composes these expressions across a
  `PolicyCoverage` CardDef with seven FieldDefs. See
  [`docs/realm-composition.md`](../../docs/realm-composition.md) for
  the threading pattern.
