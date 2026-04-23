# @cardstack/bxl

**BXL** — the Boxel Expression Language. Write expressions that look like
spreadsheet formulas and path literals; run them against JSON with a sandboxed
evaluator.

BXL compiles to **jqxl v1** (the runtime target). You author in BXL; the
engine runs jqxl. One evaluator, one AST, one canonical form.

> Status: **pre-release** (`0.1.0-dev.0`). First tagged release will be
> `0.1.0`. The public API is intentionally unstable below 1.0 — see
> [RELEASE-PLAN.md](./RELEASE-PLAN.md).

## Built on two open-source predecessors

- **[jq-tools](https://github.com/alexxander/jq-tools)** (MIT) — the jq
  interpreter in TypeScript. Lives in `src/jqtools/`.
- **[Formula.js](https://github.com/formulajs/formulajs)** (MIT) — Excel
  formulas in JavaScript. Curated subset in `src/formulajs/`.

Our own readable-syntax layer, linter, formatter, sandbox, and registry
live in `src/bxl/`. Full attribution in [NOTICE.md](./NOTICE.md).

## Install

```sh
npm install @cardstack/bxl
```

Requires Node `>=18.17`.

## Quick Start

```ts
import { evaluateBxl } from '@cardstack/bxl';

const schema = {
  fields: [
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'taxRate',  label: 'Tax Rate' },
    {
      key: 'lineItems', label: 'Line Item', kind: 'array',
      item: {
        fields: [
          { key: 'sku',      label: 'SKU' },
          { key: 'quantity', label: 'Quantity' },
        ],
      },
    },
  ],
};

const invoice = {
  subtotal: 50,
  taxRate: 8.25,
  lineItems: [
    { sku: 'COPY-01',   quantity: 1 },
    { sku: 'BRAND-RED', quantity: 5 },
  ],
};

evaluateBxl('ROUND(Subtotal * "Tax Rate" / 100, 2)', invoice, { schema });
// => 4.13

evaluateBxl('"Line Item"[SKU ^= "BRAND"].Quantity', invoice, { schema });
// => 5
```

## What's in the box

- `compileBxl`         — readable BXL → canonical jqxl source
- `evaluateBxl`        — full runtime with formula helpers
- `lintBxl`            — parser-only diagnostics (no evaluator)
- `solidifyBxl`        — normalize fuzzy/readable input to Solid BXL
- `expandBxl` / `collapseBxl` — multi-line ↔ single-line
- `bxlToJq` / `jqToBxl` — conversion helpers
- TextMate grammar for syntax highlighting

## Sandbox

BXL is a **data sandbox**, not an OS sandbox. Expressions compute over a
supplied JSON snapshot and return values. They do not fetch, persist, load
modules, call arbitrary JavaScript, or mutate any store.

- `env()` is blocked and hidden from `builtins()`.
- Runtime budgets (step count, output count, output bytes, wall-clock) are on
  by default. Hosts may tighten them with `runtimeLimits`.
- For hard memory ceilings or non-cooperative cancellation, run BXL in a
  Worker or isolate and terminate it from the host.

See [`docs/sandbox.md`](./docs/sandbox.md) for the full contract.

## Docs

- [`docs/syntax-reference.html`](./docs/syntax-reference.html) — canonical syntax reference, rendered guide with syntax-highlighted examples (open in a browser)
- [`docs/grammar.ebnf`](./docs/grammar.ebnf) — formal grammar
- [`docs/sandbox.md`](./docs/sandbox.md) — sandbox contract
- [`docs/excel-compatibility.md`](./docs/excel-compatibility.md) — what
  pasted Excel formulas support
- [`docs/formulas.md`](./docs/formulas.md) — Excel helper matrix
- [`docs/api.md`](./docs/api.md) — TypeScript API and option defaults

## CLI

```sh
npm install --global @cardstack/bxl

bxl compile '"Line Item"[#1].SKU'
bxl eval    '"Line Item":first.SKU' --input invoice.json --schema invoice.schema.json
bxl lint    'Subtotal = 0 ? "empty" : Subtotal'
bxl solidify 'subtotal * tax rate'
```

See [`docs/api.md`](./docs/api.md) for all CLI flags.

## Development

```sh
npm install
npm test           # runs tests/unit/ + tests/smoke/ — currently 489+ cases
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/ (not yet implemented)
```

## Layout

```
src/
├── jqtools/    jq runtime (parser, evaluator, sandbox) — derived from jq-tools
├── formulajs/  Excel formulas — derived from Formula.js
└── bxl/        Readable syntax, linter, formatter, bridge, registry — ours
```

Strict layering:
- `jqtools/` and `formulajs/` do not import each other or `bxl/`.
- `bxl/` imports from both as needed.

Sub-entries in [package.json](./package.json) `exports` let consumers pick
exactly what they need: `@cardstack/bxl/compiler`, `/linter`, `/runtime`,
`/runtime-bare`, `/syntax/textmate`.

## License

MIT — see [LICENSE](./LICENSE).
