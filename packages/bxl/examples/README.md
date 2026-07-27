# Examples

Every example is a TypeScript module that exports an array of cases. Each case
has the shape:

```ts
{
  id: string;
  name: string;
  expression: string;
  input: unknown;
  schema?: ReadableSchema;
  expected: unknown;
  expectedJq?: string;
  expectedIssues?: LintIssue[];
}
```

The test suite imports these modules and asserts compile output, evaluated
value, and diagnostics. Docs reference cases by `id`.

## Suites

- `bxl-150.ts`       — 150 increasing-complexity cases
- `formula.ts`       — Excel-style formula helpers (~120 cases)
- `edge-cases.ts`    — warnings, confusing syntax, hostile text
- `contexts.ts`      — formulas, constraints, transforms, workflow gates
- `realm-collaboration-examples.ts` — real gateway admission, transition,
  event, clock, and decision-test cases from the collaboration realm
- `excel-paste.ts`   — `=`, `<>`, `^`, `&`, formula coverage
- `pred-filter.ts`   — `[* .pred]`, `[#N]`, ranges, implicit iteration

Plus a browser harness:

- `browser.html`     — minimal v0.1 demo that loads the min bundle and runs
                       one compile + eval round-trip.

And a package-level formula bundle export:

- `@cardstack/bxl/examples` — source-level bundles extracted from
  internal Boxel realm fixtures. These preserve the business formulas as
  runnable data: airline profitability, acoustic resonance/Bessel
  screening, and insurance tracking formulas covering financial,
  statistical, and engineering lazy FormulaJS helpers.

## Running

```sh
tsx examples/bxl-150.ts
tsx examples/formula.ts
node scripts/run-ts-entry.mjs tests/unit/bxl-realm-formula-bundles-cli.ts
node scripts/run-ts-entry.mjs tests/unit/realm-collaboration-cli.ts
```

Each script prints a pass/fail summary and exits non-zero on failure.
