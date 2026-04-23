<div align="center">

# BXL

**The Boxel Expression Language.**
Spreadsheet-style formulas over your JSON — sandboxed by default, paste-compatible with Excel, readable by your users.

[![npm](https://img.shields.io/npm/v/@cardstack/bxl.svg?color=217346&labelColor=1a2e1a)](https://www.npmjs.com/package/@cardstack/bxl)
[![license](https://img.shields.io/npm/l/@cardstack/bxl.svg?color=217346&labelColor=1a2e1a)](./LICENSE)
[![node](https://img.shields.io/node/v/@cardstack/bxl.svg?color=217346&labelColor=1a2e1a)]()
[![typescript](https://img.shields.io/badge/TypeScript-strict-1d4ed8?labelColor=1a2e1a)]()
[![tests](https://img.shields.io/badge/tests-489%2B-217346?labelColor=1a2e1a)]()

</div>

```bxl
"Line Item"[SKU = "BRAND-RED"]."Unit Price"          -- first-match predicate
SUM("Line Item"[*Taxable]."Line Total")              -- SUMIF without the _BY
ROUND(Subtotal * "Tax Rate" / 100, 2) = "Tax Amount" -- paste from Excel, it runs
```

---

## What is BXL?

BXL is a small, safe expression language for computing over structured data. It's the formula bar your users already know, welded to jq's paths and pipelines, wrapped in a sandbox that refuses to do I/O.

**You author in BXL. The engine runs canonical jqxl.** One evaluator, one AST, one canonical form — with a readable surface that reads like English when your schema has good display names.

```ts
evaluateBxl('ROUND(Subtotal * "Tax Rate" / 100, 2)', invoice, { schema });
// => 12.38
```

> **Status: pre-release** (`0.1.0-dev.0`). First tagged release will be `0.1.0`. The public API is intentionally unstable below 1.0 — see [RELEASE-PLAN.md](./RELEASE-PLAN.md).

---

## Why BXL?

Every business application runs on small expressions — invoice totals, form validation, access rules, notification triggers, report filters. These expressions live close to the user, so they need to be **readable**, **safe**, and **composable across every surface**.

No existing option delivers all three:

|                                       | JavaScript | jq  | Excel | JSONPath | **BXL** |
| ------------------------------------- | :--------: | :-: | :---: | :------: | :-----: |
| Readable to non-engineers             |     −      |  −  |   ✓   |    −     |  **✓**  |
| Safe to run on user input             |     −      |  ✓  |   ✓   |    ✓     |  **✓**  |
| Walks nested JSON                     |     ✓      |  ✓  |   −   |    ✓     |  **✓**  |
| Paste Excel formulas directly         |     −      |  −  |   ✓   |    −     |  **✓**  |
| 300+ built-in formula helpers         |     −      |  −  |   ✓   |    −     |  **✓**  |
| Sandboxed by default (no I/O)         |     −      |  ✓  |   ✓   |    ✓     |  **✓**  |
| Schema-aware — labels, not key paths  |     −      |  −  |   −   |    −     |  **✓**  |
| Serializes as data (diffable, cache)  |     −      |  ✓  |   ✓   |    ✓     |  **✓**  |

If you're building CRUD apps with form validation, you've probably hand-rolled this half a dozen times. BXL is what you'd end up with after round six, given a year and someone to own the tests.

---

## Install

```sh
npm install @cardstack/bxl
```

Requires Node `>=18.17`. Zero runtime dependencies in the default bundle; the linter-only bundle strips formula helpers for editor tooling.

---

## At a glance

The eight design decisions that make BXL feel the way it does:

- **Labels instead of paths** — `Subtotal + "Tax Amount"` beats `.subtotal + .taxAmount`. Labels resolve against a schema at compile time.
- **1-based rows** — `"Line Item"[#4]` is the fourth row. `[3]` remains the jq-native 0-based escape hatch.
- **Implicit iteration** — `"Line Item"."Line Total"` auto-materializes across the array. No `map` for the common case.
- **Two predicate shapes** — `[pred]` picks the first match (scalar). `[*pred]` keeps every match (array). Replaces `VLOOKUP` / `SUMIF` without a separate builtin.
- **Structural pseudo-classes** — `:first`, `:last`, `:nth(N)`, `:nth-last(N)`, `:odd`, `:even`, `:only`, `:empty`, `:not(…)`. CSS for your data.
- **Paste Excel unchanged** — `=`, `<>`, `^`, `&`, leading `=` all work. `ROUND`, `SUM`, `IF`, `VLOOKUP` match Microsoft Excel exactly.
- **UPPERCASE is a promise, lowercase is a contribution** — `ROUND(x; 2)` is paste-compatible with Excel. `present(x)`, `when(p; q)`, `words(s)` are BXL-native.
- **One sandbox, many surfaces** — the same language powers computed fields, form validation, visibility rules, workflow gates, access policies, and annotation targets.

The full reference with syntax-highlighted examples lives in [`docs/syntax-reference.html`](./docs/syntax-reference.html); the formal grammar in [`docs/grammar.ebnf`](./docs/grammar.ebnf).

---

## A tour of the syntax

One fixture, nine examples. Skim it to taste the language.

```ts
import { evaluateBxl } from '@cardstack/bxl';

// Schema: what fields exist, what humans call them.
const schema = {
  fields: [
    { key: 'subtotal',  label: 'Subtotal' },
    { key: 'taxRate',   label: 'Tax Rate' },
    { key: 'taxAmount', label: 'Tax Amount' },
    { key: 'total',     label: 'Total' },
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: { fields: [
        { key: 'sku',       label: 'SKU' },
        { key: 'quantity',  label: 'Quantity' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'lineTotal', label: 'Line Total' },
        { key: 'taxable',   label: 'Taxable' },
      ] },
    },
  ],
};

// Fixture: any JSON that matches the schema.
const invoice = {
  subtotal: 150, taxRate: 8.25, taxAmount: 12.38, total: 162.38,
  lineItems: [
    { sku: 'COPY-01',   quantity: 1, unitPrice: 50,  lineTotal: 50,  taxable: true  },
    { sku: 'BRAND-RED', quantity: 5, unitPrice: 20,  lineTotal: 100, taxable: false },
  ],
};
```

```ts
// 1 · Labels replace paths
evaluateBxl('Subtotal + "Tax Amount"', invoice, { schema });
// => 162.38

// 2 · 1-based rows
evaluateBxl('"Line Item"[#2].SKU', invoice, { schema });
// => 'BRAND-RED'

// 3 · Implicit iteration — SUM across rows
evaluateBxl('SUM("Line Item"."Line Total")', invoice, { schema });
// => 150

// 4 · First-match predicate — the VLOOKUP shape
evaluateBxl('"Line Item"[SKU = "BRAND-RED"]."Unit Price"', invoice, { schema });
// => 20

// 5 · Filter-all predicate — the SUMIF shape
evaluateBxl('SUM("Line Item"[*Taxable]."Line Total")', invoice, { schema });
// => 50  (only the taxable row)

// 6 · Structural pseudo-classes
evaluateBxl('"Line Item":first.SKU',           invoice, { schema }); // => 'COPY-01'
evaluateBxl('"Line Item":last.Quantity',       invoice, { schema }); // => 5
evaluateBxl('"Line Item":nth(2)."Unit Price"', invoice, { schema }); // => 20

// 7 · Paste Excel unchanged
evaluateBxl(
  '=IF("Tax Rate" > 0, ROUND(Subtotal * "Tax Rate" / 100, 2), 0)',
  invoice, { schema },
);
// => 12.38

// 8 · Invariants — "if this applies, then this must hold"
evaluateBxl(
  'when(Subtotal > 0, Total = Subtotal + "Tax Amount")',
  invoice, { schema },
);
// => true

// 9 · Presence — form-friendly vs Excel-strict
evaluateBxl('present("Tax Amount")',     invoice, { schema }); // => true
evaluateBxl('NOT ISBLANK("Tax Amount")', invoice, { schema }); // => true (Excel semantics)
```

---

## Where BXL earns its keep

BXL shines in places where expressions are authored near the user, stored as data, and run on every read or save.

<table>
<tr><td valign="top" width="50%">

**Computed fields**

```ts
// In a card definition:
lineTotal: computed('Quantity * "Unit Price"')
total: computed('Subtotal + "Tax Amount"')
letterGrade: computed(`
  IF(Score >= 90, "A",
  IF(Score >= 80, "B",
  IF(Score >= 70, "C", "F")))
`)
```

</td><td valign="top" width="50%">

**Form validation**

```ts
// Per-field, schema-authored:
{ when: 'present("Bill To".Email)',
  constraint: '"Bill To".Email CONTAINS "@"',
  message: 'Email must contain @' }

{ when: 'Payment = "Credit card"',
  constraint: 'present("Bill To".Zip)',
  message: 'Zip required for card payments' }
```

</td></tr>
<tr><td valign="top" width="50%">

**Access rules**

```ts
// In a guide / policy:
visibleWhen: `
  Role = "admin" OR
  (Owner.Id = $user.Id AND Status <> "archived")
`

editableWhen: `
  Status = "draft" AND
  present("Assigned To")
`
```

</td><td valign="top" width="50%">

**Report filters / aggregates**

```ts
// In a dashboard card:
total: 'SUM(Order[*Status = "shipped"].Amount)'
topRevenue: '
  Order[*Status = "paid"]
    | group_by(.customer)
    | max_by(SUM(.[].Amount))
'
```

</td></tr>
</table>

---

## Security model

BXL is a **data sandbox**, not an OS sandbox. Expressions compute over a supplied JSON snapshot and return values. They cannot fetch, persist, load modules, call arbitrary JavaScript, or mutate any external state.

- **No ambient I/O.** `env()` is blocked and hidden from `builtins()`.
- **Runtime budgets on by default** — step count, output count, output bytes, wall-clock. Hosts may tighten via `runtimeLimits`.
- **Deterministic** for the same input — no clock or random unless the host injects them.
- **Worker-safe.** For hard memory ceilings or non-cooperative cancellation, run BXL in a Worker or isolate and terminate from the host.

See [`docs/sandbox.md`](./docs/sandbox.md) for the full threat model and contract.

---

## Built on two open-source giants

BXL is a thin, opinionated layer on proven foundations.

- **[jq-tools](https://github.com/alexxander/jq-tools)** (MIT) — the complete jq interpreter in TypeScript. Lives in `src/jqtools/` — tokenizer, parser, evaluator, filter registry. We've added deterministic ordering and a budget-aware runtime state.
- **[Formula.js](https://github.com/formulajs/formulajs)** (MIT) — Excel formulas in JavaScript. Curated subset in `src/formulajs/`, narrowed to the 300+ helpers that make sense on JSON (we dropped cell-grid, distribution, regression, and Bessel families — see `docs/formulas.md`).

Our own work — the readable-syntax compiler, linter, formatter, sandbox, and registry — lives in `src/bxl/`. Full attribution in [NOTICE.md](./NOTICE.md).

---

## API

```ts
import {
  evaluateBxl,      // readable BXL → JSON value (full runtime)
  compileBxl,       // readable BXL → canonical jqxl source (no evaluation)
  lintBxl,          // parser-only diagnostics (no formula helpers, no evaluator)
  solidifyBxl,      // normalize fuzzy input to Solid BXL (one-liner, canonical)
  expandBxl,        // wrap at pipes / multi-arg calls for readability
  collapseBxl,      // round-trip back to single-line canonical
  bxlToJq,          // strip BXL sugar, emit pure jq
  jqToBxl,          // upgrade jq source to readable BXL
} from '@cardstack/bxl';
```

Every function takes an optional `{ schema, runtimeLimits }` options object. Sub-entries in [`package.json`](./package.json) `exports` let consumers pick exactly what they need — the linter-only bundle omits formula helpers for editor and CI tooling:

```
@cardstack/bxl                 — full runtime + helpers
@cardstack/bxl/compiler        — parser + compiler only
@cardstack/bxl/linter          — parser-only diagnostics
@cardstack/bxl/runtime         — jq evaluator + helpers
@cardstack/bxl/runtime-bare    — jq evaluator, no helpers
@cardstack/bxl/syntax/textmate — TextMate grammar for editors
```

Full API reference in [`docs/api.md`](./docs/api.md).

---

## CLI

```sh
npm install --global @cardstack/bxl

bxl compile  '"Line Item"[#1].SKU'
bxl eval     '"Line Item":first.SKU'  --input invoice.json --schema invoice.schema.json
bxl lint     'Subtotal = 0 ? "empty" : Subtotal'
bxl solidify 'subtotal * tax rate'
```

One-shot pipes too: `echo '{"n":42}' | bxl eval 'n * 2'` prints `84`.

---

## Docs

- [`docs/syntax-reference.html`](./docs/syntax-reference.html) — canonical syntax reference, syntax-highlighted with runnable examples (open in a browser)
- [`docs/grammar.ebnf`](./docs/grammar.ebnf) — formal grammar
- [`docs/sandbox.md`](./docs/sandbox.md) — sandbox contract and threat model
- [`docs/excel-compatibility.md`](./docs/excel-compatibility.md) — what pasted Excel formulas support
- [`docs/formulas.md`](./docs/formulas.md) — Excel helper matrix (implemented, BXL-only, via jq, won't add)
- [`docs/api.md`](./docs/api.md) — TypeScript API and option defaults

---

## Development

```sh
npm install
npm test           # tests/unit/ + tests/smoke/ — 489+ cases
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/
```

### Layout

```
src/
├── jqtools/    jq runtime (parser, evaluator, sandbox) — derived from jq-tools
├── formulajs/  Excel formulas — derived from Formula.js
└── bxl/        Readable syntax, linter, formatter, bridge, registry — ours
```

Strict layering: `jqtools/` and `formulajs/` do not import each other or `bxl/`. `bxl/` imports both as needed.

### Contributing

Issues and PRs welcome. Add a regression test under `tests/unit/` for any parser/compiler change (see `tests/unit/compiler-bug-regressions.ts` for the pattern) and a matching note in `docs/grammar.ebnf` if the public surface shifts. UPPERCASE helper names are reserved for real Excel functions — see [`docs/formulas.md`](./docs/formulas.md#naming-convention).

Security reports: please email `security@boxel.ai` rather than filing a public issue.

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © Cardstack Foundation and contributors.
