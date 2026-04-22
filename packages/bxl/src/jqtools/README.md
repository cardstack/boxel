# src/jqtools/

**Origin:** derived from [alexxander/jq-tools](https://github.com/alexxander/jq-tools)
at `v0.0.11` (MIT). See [`/NOTICE.md`](../../NOTICE.md) for full attribution.

This directory contains the canonical **jqxl v1** runtime — the parser,
tokenizer, AST, evaluator, and builtin filters. It is the pure jq-in-TypeScript
implementation that the BXL readable layer compiles down to.

## Layering rules

`src/jqtools/` **must not** import from `src/bxl/` or `src/formulajs/`. It
stands alone as a jq runtime.

- Formula libraries (`'formula'`) are layered on top in `src/bxl/registry/`.
- The core builtin registry here (`evaluate/filters/registry.ts`) only knows
  about jq's own `'core'` library.

## Our additions on top of upstream

- `evaluate/runtimeState.ts` — sandbox budgets (step/output/byte/wall-clock +
  AbortSignal) and diagnostic capture.
- `evaluate/dateTime.ts` — date math utilities shared by comparison and
  formatting.
- `evaluate/filters/registry.ts` — the library-registry **mechanism**.
  (The formula-library composition happens in `src/bxl/registry/`.)
- `evaluate/evaluate.ts` — registry parameterization of `Environment`,
  `evaluateWithRegistry()` entry point, `checkRuntimeBudget()` call sites.

See [`UPSTREAM-DIFFS.md`](./UPSTREAM-DIFFS.md) for the file-by-file audit.

## Contributing upstream

Where our patches are generally useful (e.g. `runtimeState.ts`), we welcome
sending them back to `alexxander/jq-tools`. The mapping for each file is
documented in `UPSTREAM-DIFFS.md`.
