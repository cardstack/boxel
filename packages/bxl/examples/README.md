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

- `bxl-150-examples.ts` — 150 increasing-complexity cases
- `bxl-formula-examples.ts` — Excel-style formula helpers (~120 cases)
- `bxl-edge-examples.ts` — warnings, confusing syntax, hostile text
- `bxl-contexts-examples.ts` — formulas, constraints, transforms, workflow gates
- `realm-collaboration-examples.ts` — gateway admission, transition,
  event, clock, and decision-test cases from the collaboration realm
- `bxl-mutation-examples.ts` — accepted and rejected DML fixtures
  pairing human-readable and schema-solidified streamed statements, structured tool
  operations, loaded Card/Field snapshots, and normalized mutation plans; see
  [`bxl-mutation-examples.md`](./bxl-mutation-examples.md)
- `authorization/` — runnable generalized coordination and software-release
  capability policies using the public `bxl-authorization/1` API
- `readable-syntax-cases.json` — shared readable-syntax fixtures the unit
  suites (Excel paste, predicate filters, conversion) consume
- `hospital/`, `insurance/` — standalone runnable walkthroughs, each with its
  own README

And a package-level formula bundle export:

- `@cardstack/bxl/examples` — source-level bundles extracted from
  internal Boxel realm fixtures. These preserve the business formulas as
  runnable data: airline profitability, acoustic resonance/Bessel
  screening, and insurance tracking formulas covering financial,
  statistical, and engineering lazy FormulaJS helpers.

## Running

The example modules are data — the unit suites drive them:

```sh
node tests/unit/bxl-150-cli.ts
node tests/unit/bxl-formula-cli.ts
node tests/unit/bxl-realm-formula-bundles-cli.ts
node tests/unit/realm-collaboration-cli.ts
pnpm example:mutation
pnpm example:mutation:realm
```

Each script prints a pass/fail summary and exits non-zero on failure.
