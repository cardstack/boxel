# amd-transpile bench

Wall-time benchmark for the loader's ES → AMD transpilation step
(`packages/runtime-common/amd-transpile/`, entry point `index.ts`).
Compares the production `transpileAmd` against a babel baseline (the
previous `Loader.fetchModule` implementation), plus parse-only
candidates that bound the theoretical floor.

A CI gate (`pnpm bench:amd:check`) enforces that `production` median
times don't regress past a tolerance margin against the committed
baseline. See **CI gate** below.

## Run

From `packages/runtime-common`:

```bash
# Full bench: prints per-(candidate, fixture) stats and a speedup table.
pnpm bench:amd

# CI gate: production-only run, compares against baseline.json.
pnpm bench:amd:check

# Refresh fixtures from current card sources (intentional re-anchor only —
# see "Hermetic fixtures" below).
pnpm bench:amd:prep

# Tighter local run (faster, less stable):
ITER=20 WARMUP=3 pnpm bench:amd
```

## Candidates

| candidate            | what it measures                                                      |
| -------------------- | --------------------------------------------------------------------- |
| `babel-current`      | `@babel/core` + `@babel/plugin-transform-modules-amd` (baseline)      |
| `babel-no-sourcemap` | same as above with `sourceMaps: false` (isolates sourcemap cost)      |
| `parse-acorn-only`   | `acorn.parse` only (no emit) — floor for any acorn-based approach     |
| `parse-esml-only`    | `es-module-lexer.parse` only — floor for the smallest possible parser |
| `production`         | `transpileAmd` from `amd-transpile.ts` (what the loader runs)         |

Only `production` is gated by CI. The others stay for context (you can
see how the production transpiler stacks up against pure-parse floors
and the babel baseline).

## Hermetic fixtures

Fixtures live at `bench-fixtures/runtime-common/amd-transpile/` (repo
root). They're committed as static artifacts — the bench reads them
directly, not regenerated on each run.

This is deliberate: the gate measures the AMD transpiler's wall-time, not
the upstream `transpileJS` pipeline's output. Decoupling means a change
to `card-api.gts` (or to `transpile.ts` itself) doesn't ripple the perf
numbers and trip the gate for unrelated reasons.

| fixture        | bytes (post-transpile) |
| -------------- | ---------------------- |
| `enum.js`      | ~10 KB                 |
| `spec.js`      | ~62 KB                 |
| `skill-set.js` | ~71 KB                 |
| `card-api.js`  | ~119 KB                |

When you do want to refresh fixtures (e.g. fundamentally changed what
the loader receives, or want a richer set of inputs), run
`pnpm bench:amd:prep`. That overwrites the committed fixtures from the
current `packages/base/*.gts` sources. Treat that as a re-anchoring
event: regenerate `baseline.json` in the same commit, with a message
that explains why the fixtures moved.

## CI gate

`pnpm bench:amd:check` runs the bench against the committed fixtures,
then compares each `production` candidate's median against
`baseline.json`. The script has two modes:

- **Report-only** — when `baseline.json` is absent, the script prints
  the medians, writes a markdown summary to `$GITHUB_STEP_SUMMARY`
  (including a JSON snippet you can paste straight into the file), and
  exits 0. This mode is how the initial baseline is anchored: the gate
  ships first, the first CI run produces real numbers, then the
  baseline lands in a follow-up.
- **Enforce** — when `baseline.json` is present, the script fails
  (exit 1) on any fixture whose median exceeds
  `baseline_median_ms × tolerance`. The markdown summary shows the
  baseline / current / allowed values per fixture so a reviewer can
  see the speedup or regression at a glance.

CI runs the gate as a parallel-independent job (no `needs:` chain on
host or realm-server tests) so failures surface fast. CI uses
`ITER=100 WARMUP=10` (double the local default) to dampen runner noise.
Tolerance is set in `baseline.json` and starts at `1.25` (25% slack
above baseline) per CS-10983.

### `baseline.json` shape

```json
{
  "version": 1,
  "generated": "YYYY-MM-DD",
  "iterations": 100,
  "warmup": 10,
  "tolerance": 1.25,
  "candidate": "production",
  "fixtures": {
    "enum.js": { "median_ms": 2.1 },
    "skill-set.js": { "median_ms": 6.2 },
    "spec.js": { "median_ms": 8.3 },
    "card-api.js": { "median_ms": 23.1 }
  }
}
```

### When the gate trips

CI fails with a message like:

```
production median for spec.js is 10.5ms, exceeds baseline 8.3ms × 1.25 tolerance (= 10.4ms)
```

Author response:

1. **Re-run CI.** Wall-time benches on shared GH-runner hardware are
   noisy. If a single rerun passes, it was variance.
2. **Check whether the regression is real.** If consecutive reruns fail
   on the same fixtures, treat it as a real signal.
3. **Real and unintentional** — fix the regression in this PR. Do not
   bump the baseline.
4. **Real and intentional** (e.g. a correctness fix that costs perf, or
   a perf improvement that should re-anchor the baseline tighter) —
   update `baseline.json` in the same PR. The commit message should
   explain why. Reviewers sign off on the new baseline as part of code
   review.

There is **no auto-regeneration step**. The baseline drifts only by
intentional human action — that's the whole point. If we let CI
auto-bump after each merge, sub-tolerance regressions would silently
accumulate (a 25% gate that re-anchors after each merge can drift the
baseline 2× over ten merges without ever tripping).
