# Insurance pricing & reserving example

A miniature actuarial scenario, vendored as plain JS data + a set of
expressions + a runner. Mirrors the structure of `examples/hospital/`
and `examples/airline/`-style fixtures, but exercises:

- Five-pair `IFS` (the arity that the `middle-wolverine` realm
  uncovered as not-yet-defined; now covers up to 8 pairs).
- `Earned - (Loss + Expense)` — the parenthesized cost-sum shape
  that the parser fix unblocked.
- `IF(AppliesFlag = "Yes", …, 0)` reinsurance guard.
- LDF chain `(Paid + Case) × LDF × ScenarioLDF` with parenthesized
  sum on the LHS of `*`.

Source spec:
[`insurance_pricing_reserving_excel_spec.md`](https://realms-staging.stack.cards/ctse/prudent-octopus/)
(rendered against the matching realm).

## Files

| File              | Purpose                                                                            |
|-------------------|------------------------------------------------------------------------------------|
| `policy.json`     | One policy×coverage instance (commercial auto, profitable case).                   |
| `expressions.ts`  | Eight expressions covering the actuarial pipeline; each notes the BXL feature it exercises. |
| `run.ts`          | Runnable script — evaluates every expression and prints pass/fail.                 |

## Running

```sh
node scripts/run-ts-entry.mjs examples/insurance/run.ts
```

Expected: `8/8 expressions evaluated successfully`.

## What this example shows beyond `examples/hospital/`

- `IFS` with five condition/value pairs (10 args). Pre-fix this
  raised `'IFS/10' is not defined`.
- `Earned - (Loss + Expense)` — pure parsed-paren subtraction shape.
  Pre-fix this evaluated as `(Earned - Loss) + Expense`, which made
  every expense register as a positive contribution.
- The `prudent-octopus` realm composes these expressions across a
  `PolicyCoverage` CardDef with seven FieldDefs. See
  [`docs/realm-composition.md`](../../docs/realm-composition.md) for
  the threading pattern.
