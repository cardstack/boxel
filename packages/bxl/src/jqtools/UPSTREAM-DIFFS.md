# jqtools — Upstream Diff Audit

**Upstream:** `alexxander/jq-tools` @ `v0.0.11` (commit `c58581c`, MIT).
**Audited:** 2026-04-22.

Maps every file in `src/jqtools/` to its upstream source at
`packages/jq/src/lib/...` and records our modifications.

## Verbatim (differ only in import-path `.js` suffixes for ESM resolution)

| File | Upstream path | Status |
| --- | --- | --- |
| `parser/AST.ts`        | `parser/AST.ts`        | ✓ verbatim |
| `parser/InputStream.ts`| `parser/InputStream.ts`| ✓ verbatim |
| `parser/Parser.ts`     | `parser/Parser.ts`     | ✓ verbatim |
| `parser/Tokenizer.ts`  | `parser/Tokenizer.ts`  | ✓ verbatim (+2 LOC extension fix) |
| `evaluate/applyBinary.ts`             | `evaluate/applyBinary.ts`             | ✓ near-verbatim |
| `evaluate/applyFormat.ts`             | `evaluate/applyFormat.ts`             | ✓ near-verbatim |
| `evaluate/compare.ts`                 | `evaluate/compare.ts`                 | ✓ near-verbatim |
| `evaluate/evaluateErrors.ts`          | `evaluate/evaluateErrors.ts`          | ✓ near-verbatim |
| `evaluate/generateCombinations.ts`    | `evaluate/generateCombinations.ts`    | ✓ near-verbatim |
| `evaluate/generateObjects.ts`         | `evaluate/generateObjects.ts`         | ✓ near-verbatim |
| `evaluate/utils/binaryOperator.ts`    | `evaluate/utils/binaryOperator.ts`    | ✓ near-verbatim |
| `evaluate/utils/getPath.ts`           | `evaluate/utils/getPath.ts`           | ✓ near-verbatim |
| `evaluate/utils/nestedIterators.ts`   | `evaluate/utils/nestedIterators.ts`   | ✓ near-verbatim |
| `evaluate/utils/setPath.ts`           | `evaluate/utils/setPath.ts`           | ✓ near-verbatim |
| `evaluate/utils/utils.ts`             | `evaluate/utils/utils.ts`             | ✓ near-verbatim |
| `evaluate/filters/builtinJqFilters.ts`    | `evaluate/filters/builtinJqFilters.ts`    | ✓ near-verbatim |
| `evaluate/filters/builtinNativeFilters.ts`| `evaluate/filters/builtinNativeFilters.ts`| ✓ near-verbatim |
| `evaluate/filters/lib/nativeFilter.ts`       | `evaluate/filters/lib/nativeFilter.ts`       | ✓ verbatim |
| `evaluate/filters/lib/parseBuiltinJqFilters.ts`| `evaluate/filters/lib/parseBuiltinJqFilters.ts`| ✓ verbatim |
| `errors.ts` | `errors.ts` | ✓ verbatim |

## Materially modified

### `evaluate/evaluate.ts`

Upstream: 638 LOC. Ours: 700 LOC. **Delta: ~62 LOC.**

Changes:

1. **Registry parameterization.** `Environment` ctor now takes a
   `ResolvedBuiltinRegistry` parameter. Builtin lookup goes through
   `this.builtins.jq` / `this.builtins.native` instead of closed-over module
   imports.
2. **`evaluateWithRegistry()`** added as a new top-level entry point that
   accepts a pre-resolved registry. Used by BXL to pass the combined jq +
   formula registry.
3. **Runtime-budget hooks.** `checkRuntimeBudget()` called at each iterator
   boundary inside `evaluateForeach`, around expensive builtin calls, and at
   `generateValues` entry. Allows BXL's sandbox layer to enforce step /
   output / byte / wall-clock limits without re-architecting the evaluator.
4. **Default registry** switched to core-only (`resolveCoreRegistry()`). BXL's
   entry points explicitly pass the formula-enabled registry.

### `evaluate/filters/builtinJqFilters.ts` and `builtinNativeFilters.ts`

Upstream signatures preserved. Minor surface additions that should be
contributed upstream:

- `tonumber/0`, `startswith/1`, `endswith/1` — already merged in recent
  upstream versions; our fork predates them.
- Nil-safe path resolution fixes.

## Additions (new files, no upstream equivalent)

### `evaluate/runtimeState.ts`

Sandbox-layer utilities. Exports:

- `NativeRuntimeLimits` — public shape of `{ maxSteps, maxOutputs,
  maxOutputBytes, maxWallClockMs, signal }`.
- `withRuntimeDiagnostics(fn, limits)` — runs `fn` within a budgeted
  context, captures diagnostics and halt conditions.
- `checkRuntimeBudget()` — called from `evaluate.ts` at iterator boundaries
  to enforce budgets without corrupting generator state.
- `HaltSignal` — thrown when budgets exceed; callers unwrap the diagnostic.

Good candidate for upstream contribution if `alexxander/jq-tools` adopts a
pluggable runtime-hook API.

### `evaluate/dateTime.ts`

Date/time helpers used by `compare.ts` and Excel-adjacent builtins
(`now/0`, `fromdate/0`, etc.). Thin wrapper over JS Date with ISO-8601 serialization and serial-day conversion for Excel parity.

### `evaluate/filters/registry.ts`

The library-registry **mechanism**. Defines `BuiltinLibrary`,
`ResolvedBuiltinRegistry`, `resolveRegistry()`, and `CORE_REGISTRY` (which
only contains jq's own builtins). BXL's formula layer composes on top in
`src/bxl/registry/`.

This file intentionally does not know about Excel formulas. The formula
library is assembled in `src/bxl/registry/index.ts`.

## What was removed

- `parser/*.spec.ts`, `parser/__snapshots__/`, `evaluate/spec/` — Jest specs.
  BXL uses `node --test` instead; equivalent coverage lives in `tests/unit/`.
- Nx / Yarn-workspace build files.
- Upstream CommonJS + ts-jest config.

## Version pinning

`v0.0.11` is the audit basis. Future merges from upstream are opt-in; we are
not on a rolling pull. When upstream ships a release with relevant fixes or
features, we cherry-pick into this folder and update this doc.
