# amd-transpile bench

Wall-time benchmark for the loader's ES → AMD transpilation step
(`amd-transpile.ts`). Compares the production `transpileAmd` against a
babel baseline (the previous `Loader.fetchModule` implementation), plus
parse-only candidates that bound the theoretical floor.

## Run

From `packages/runtime-common`:

```bash
# 1. Generate fixtures (transpiles real .gts cards through transpile.ts
#    so the bench input matches what the loader actually sees in
#    production). Fixtures land in `scripts/bench-amd/fixtures/` and are
#    gitignored.
pnpm bench:amd:prep

# 2. Run the bench. ITER=50 WARMUP=5 by default.
pnpm bench:amd

# Tighter run (faster, less stable):
ITER=20 WARMUP=3 pnpm bench:amd
```

## Candidates

| candidate | what it measures |
|-----------|------------------|
| `babel-current` | `@babel/core` + `@babel/plugin-transform-modules-amd` (baseline) |
| `babel-no-sourcemap` | same as above with `sourceMaps: false` (isolates sourcemap cost) |
| `parse-acorn-only` | `acorn.parse` only (no emit) — floor for any acorn-based approach |
| `parse-esml-only` | `es-module-lexer.parse` only — floor for the smallest possible parser |
| `production` | `transpileAmd` from `amd-transpile.ts` (what the loader runs) |

## Fixtures

Real card sources from `packages/base/`, transpiled through
`transpile.ts` so the input matches what the loader receives. Sizes:

| fixture | bytes (post-transpile) |
|---------|-----------------------|
| `enum.js` | ~10 KB |
| `spec.js` | ~61 KB |
| `skill-set.js` | ~71 KB |
| `card-api.js` | ~118 KB |

## Why aren't these CI-checked?

Fast iteration over the bench set has churned a lot during PR review
rounds, and the perf claim is verifiable on demand. If you want
automated guard against perf regressions, add a smoke test that asserts
production beats `babel-current` by ≥5× on `card-api.js`.
