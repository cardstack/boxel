# jqtools — Upstream Diff Audit

**Upstream:** `alexxander/jq-tools` @ `v0.0.11` (commit `c58581c`, MIT).
**Audited:** 2026-04-22.

Maps every file in `src/jqtools/` to its upstream source at
`packages/jq/src/lib/...` and records our modifications.

## Verbatim (differ only in import-path `.js` suffixes for ESM resolution)

| File                                            | Upstream path                                   | Status                            |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `parser/AST.ts`                                 | `parser/AST.ts`                                 | ✓ verbatim                        |
| `parser/InputStream.ts`                         | `parser/InputStream.ts`                         | ✓ verbatim                        |
| `parser/Parser.ts`                              | `parser/Parser.ts`                              | ✓ verbatim                        |
| `parser/Tokenizer.ts`                           | `parser/Tokenizer.ts`                           | ✓ verbatim (+2 LOC extension fix) |
| `evaluate/applyBinary.ts`                       | `evaluate/applyBinary.ts`                       | ✓ near-verbatim                   |
| `evaluate/applyFormat.ts`                       | `evaluate/applyFormat.ts`                       | ✓ near-verbatim                   |
| `evaluate/compare.ts`                           | `evaluate/compare.ts`                           | ✓ near-verbatim                   |
| `evaluate/evaluateErrors.ts`                    | `evaluate/evaluateErrors.ts`                    | ✓ near-verbatim                   |
| `evaluate/generateCombinations.ts`              | `evaluate/generateCombinations.ts`              | ✓ near-verbatim                   |
| `evaluate/generateObjects.ts`                   | `evaluate/generateObjects.ts`                   | ✓ near-verbatim                   |
| `evaluate/utils/binaryOperator.ts`              | `evaluate/utils/binaryOperator.ts`              | ✓ near-verbatim                   |
| `evaluate/utils/getPath.ts`                     | `evaluate/utils/getPath.ts`                     | ✓ near-verbatim                   |
| `evaluate/utils/nestedIterators.ts`             | `evaluate/utils/nestedIterators.ts`             | ✓ near-verbatim                   |
| `evaluate/utils/setPath.ts`                     | `evaluate/utils/setPath.ts`                     | ✓ near-verbatim                   |
| `evaluate/utils/utils.ts`                       | `evaluate/utils/utils.ts`                       | ✓ near-verbatim                   |
| `evaluate/filters/builtinJqFilters.ts`          | `evaluate/filters/builtinJqFilters.ts`          | ✓ near-verbatim                   |
| `evaluate/filters/builtinNativeFilters.ts`      | `evaluate/filters/builtinNativeFilters.ts`      | ✓ near-verbatim                   |
| `evaluate/filters/lib/nativeFilter.ts`          | `evaluate/filters/lib/nativeFilter.ts`          | ✓ verbatim                        |
| `evaluate/filters/lib/parseBuiltinJqFilters.ts` | `evaluate/filters/lib/parseBuiltinJqFilters.ts` | ✓ verbatim                        |
| `errors.ts`                                     | `errors.ts`                                     | ✓ verbatim                        |

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
- `sort/0` sorts a copy instead of calling `input.sort()` in place —
  upstream mutates the caller's array, which corrupts live inputs (card
  arrays with change subscribers, read-only lazy views).
- `cbrt/0` answers `Math.cbrt`, which is exact on perfect cubes where a
  libm `cbrt` is not: `27|cbrt` is 3 here and 3.0000000000000004 in
  jq 1.7. The exact answer is the one a card author expects, so this is
  the rare place the fork prefers its own result to jq's.

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

## Filled-in libm / numerical stubs (BXL-specific)

Upstream `@jq-tools/jq@0.0.11` declares 100+ jq native filters but stubs many
libm-style math, special-function, and IEEE-float builtins as
`throw notImplementedError`. BXL fills these in directly inside
`evaluate/filters/builtinNativeFilters.ts` because they're broadly useful for
realm computed fields and have no portable answer outside this layer.

### 7 binary-form additions

Upstream registers the unary form (`pow/1`, `atan2/1`, `hypot/1`, `fdim/1`,
`fmax/1`, `fmin/1`, `copysign/1`) but never the binary form, so calling
`pow(2; .)` (vanilla-jq spelling) errors with `'pow/2' is not defined`. BXL
adds the binary entries:

- `pow/2(base; exp)` — `Math.pow`. No impedance.
- `hypot/2(x; y)` — `Math.hypot`. No impedance.
- `fdim/2(x; y)` — `Math.max(x - y, 0)`.
- `fmax/2(x; y)`, `fmin/2(x; y)` — **NaN-skipping** (C semantics). If one arg
  is NaN, returns the other. Excel `MAX`/`MIN` (different name) propagate
  errors instead.
- `copysign/2(x; y)` — magnitude of x with sign of y.
- `atan2/2(y; x)` — jq/POSIX argument order. Excel's `ATAN2(x, y)` reverses
  it, and the two are separate live registry entries rather than one canonical
  signature: `atan2/2` here, `ATAN2/2` in the formula bridge, which the
  readable compiler routes between by the name that was written. This filter
  returns `0` for `atan2(0; 0)` (POSIX-compat) where `ATAN2` raises Excel's
  `#DIV/0!`.

### 33 stubs filled with libm-equivalent implementations

| Filter                            | Backing impl                              | Notes                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drem/2`, `remainder/2`           | `ieeeRemainder`                           | x - n·y, n = round-half-to-even(x/y).                                                                                                                                 |
| `nextafter/2`, `nexttoward/2`     | `ieeeNextafter`                           | IEEE 754 step via DataView bits.                                                                                                                                      |
| `ldexp/2`, `scalb/2`, `scalbln/2` | `x * 2^trunc(n)`                          | All three identical in IEEE 754.                                                                                                                                      |
| `fmod/2`                          | JS `%`                                    | Dividend-signed (matches C, NOT Excel `MOD`).                                                                                                                         |
| `fma/3`                           | `a*b + c`                                 | Best-effort; JS lacks a single-rounded FMA.                                                                                                                           |
| `frexp/0`                         | DataView unpack                           | Yields `[mantissa, exponent]` array.                                                                                                                                  |
| `modf/0`                          | `Math.trunc` split                        | Yields `[fracPart, intPart]` array.                                                                                                                                   |
| `logb/0`                          | `Math.floor(Math.log2(\|x\|))`            | With `0`, `±Inf`, `NaN` special cases.                                                                                                                                |
| `significand/0`                   | `x / 2^logb(x)`                           | ∈ [1, 2) for normal x.                                                                                                                                                |
| `nearbyint/0`, `rint/0`           | `roundHalfToEven`                         | Banker's rounding.                                                                                                                                                    |
| `pow10/0`                         | `Math.pow(10, x)`                         |                                                                                                                                                                       |
| `expm1/0`                         | `Math.expm1`                              |                                                                                                                                                                       |
| `scalars_or_empty/0`              | scalars, plus empty collections           | The empty array and empty object are what separate it from `scalars/0`.                                                                                               |
| `erf/0`, `erfc/0`                 | Abramowitz & Stegun 7.1.26                | ~1.5e-7 max error, where a libm `erf` is exact to the last bit. Excel's `ERF`/`ERFC` in the formula bridge are computed to full double precision instead.             |
| `gamma/0`, `tgamma/0`             | Lanczos g=7, n=9                          | **True Γ** (Excel-canonical). POSIX `gamma()` was historically log-Γ on Linux, true Γ on BSD — BXL picks the modern interpretation. Use `lgamma`/`GAMMALN` for log-Γ. |
| `lgamma/0`, `lgamma_r/0`          | Lanczos log form                          | `lgamma_r` yields the `[ln \|Γ(x)\|, sign of Γ(x)]` pair jq does; the sign follows from ⌊x⌋'s parity, and is reported as positive at the poles.                       |
| `j0/0`, `j1/0`, `y0/0`, `y1/0`    | Numerical Recipes polynomial+asymptotic   | Bessel functions of integer orders 0 and 1; J/Y.                                                                                                                      |
| `jn/2`, `yn/2`                    | Recurrence on top of `j0`/`j1`, `y0`/`y1` | C/POSIX argument order: `jn(n; x)`. Excel's `BESSELJ(x, n)` (different name, swapped order) lives in the formula bridge.                                              |

### 4 sandbox-only stubs intentionally kept

`input/0`, `input_filename/0`, `input_line_number/0`, `modulemeta/0` remain
`throw notImplementedError`. These represent jq's stdin-streaming and module
loader, which BXL doesn't (and won't) implement — BXL evaluates a single
expression against a single input value, with no input stream and no `import`
path resolution.

`inputs/0` is native here rather than jq's `repeat(input)`, and yields an empty
stream. jq's definition absorbs the end-of-input signal `input` raises when the
stream runs out; `input/0` above raises a different error, which that `catch`
would let escape. A runtime with no input stream is permanently out of inputs,
so the empty stream is the answer jq would give. Restore the jq-source
definition if `input/0` ever reads a real stream.

### Sentinels standing in for host facts

`get_search_list/0`, `get_jq_origin/0` and `get_prog_origin/0` answer with
BXL-invented values — `[]`, `"bxl://jq-origin"`, `"native-inline"` — because
the module search path and program origin they report are jq CLI concepts with
no BXL equivalent. They are stubs like the four above, but ones that return
rather than raise, since a caller asking where a program came from can be given
an answer.

`builtins/0` returns its names sorted, where jq's order is unspecified. Sorted
is the BXL contract, and the list is built from the libraries a program actually
resolved, so it changes with the library set.

### Cross-references

These design decisions are documented user-facing in
`docs/syntax-reference.md` under "How `ROUND` and `round` resolve to the same
function" and "Linter style nudges". The collision policy (case-fold + arity →
unique entry; same-case-fold-same-arity gets a single canonical signature) is
enforced in code by the linter rule `excel-name-uppercase-preferred`.

## What was removed

- `parser/*.spec.ts`, `parser/__snapshots__/`, `evaluate/spec/` — Jest specs.
  BXL uses `node --test` instead; equivalent coverage lives in `tests/unit/`.
- Nx / Yarn-workspace build files.
- Upstream CommonJS + ts-jest config.

## Version pinning

`v0.0.11` is the audit basis. Future merges from upstream are opt-in; we are
not on a rolling pull. When upstream ships a release with relevant fixes or
features, we cherry-pick into this folder and update this doc.
