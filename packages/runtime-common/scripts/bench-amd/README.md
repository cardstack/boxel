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
  "noise_floor_ms": 1.5,
  "candidate": "production",
  "fixtures": {
    "enum.js": { "median_ms": 0.65 },
    "skill-set.js": { "median_ms": 1.85 },
    "spec.js": { "median_ms": 2.14 },
    "card-api.js": { "median_ms": 10.04 }
  }
}
```

**Allowed threshold per fixture:**

```
allowed = max(baseline × tolerance, baseline + noise_floor_ms)
```

The relative `tolerance` (×1.25) handles regression detection for
larger fixtures. The absolute `noise_floor_ms` handles smaller fixtures
where GH-runner jitter is similar in absolute ms terms regardless of
fixture size — observed up to ~0.92ms for `spec.js` and ~0.21ms for
`enum.js` across a handful of runs. A flat absolute floor matches that
shape: every fixture gets a budget that absorbs sub-1.5ms jitter, while
larger fixtures fall through to the relative tolerance.

| Fixture        | Baseline | × 1.25  | Baseline + 1.5ms | Allowed (max) |
| -------------- | -------- | ------- | ---------------- | ------------- |
| `enum.js`      | 0.65ms   | 0.81ms  | 2.15ms           | **2.15ms**    |
| `skill-set.js` | 1.85ms   | 2.31ms  | 3.35ms           | **3.35ms**    |
| `spec.js`      | 2.14ms   | 2.68ms  | 3.64ms           | **3.64ms**    |
| `card-api.js`  | 10.04ms  | 12.55ms | 11.54ms          | **12.55ms**   |

**Regression-detection trade-off.** A 1.5ms floor means the gate
can't distinguish sub-1.5ms regressions from runner noise on the
smaller fixtures. Concretely:

- `enum.js` (0.65ms): catches > 3.3× regressions (a 2× regression at
  1.30ms falls under the 2.15ms ceiling and would not trip).
- `skill-set.js` (1.85ms): catches > 1.8× regressions.
- `spec.js` (2.14ms): catches > 1.7× regressions.
- `card-api.js` (10.04ms): catches > 1.25× regressions (relative
  dominates).

We accept the lower sensitivity on the tiny fixtures as the cost of
stable CI; the bench primarily exists to catch the 2×+ class of
regressions (e.g. an accidental `setTimeout` in the rewriter, an
O(N²) where O(N) suffices, a redundant pass added to the pipeline) on
the larger fixtures, where the gate still catches them comfortably.

If a future fixture refresh produces a baseline where 1.5ms over-
relaxes the relative tolerance (i.e. the fixture is large enough that
the absolute floor is dead weight), drop `noise_floor_ms` lower so
`× 1.25` resumes as the binding constraint.

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

## Verifying the gate's failure path

Two tests confirm the gate actually fails when it should — i.e. that
a green CI run means "the gate accepts the current code AND would
trip on a regression," not just "the gate ran without error."

### `pnpm bench:amd:check:trip-test` (synthetic, ~10s)

Runs in CI on every PR right after the main gate. Spawns `check.ts`
against a temp synthetic baseline (every fixture pinned at 0.001ms via
`BENCH_AMD_BASELINE_OVERRIDE`), asserts:

- Exit code 1.
- stderr matches the canonical
  `production median for X is Yms, exceeds baseline Zms × T tolerance (= Wms)`
  format.
- Every fixture appears in the breach list.

Doesn't touch the real `baseline.json`. Cheap enough to run on every
PR; proves the gate's exit-code, message format, and fixture-coverage
paths still work.

### `mise run bench:amd-trip-drill` (faithful, ~30s, manual)

Out-of-band drill. Wraps the real `transpileAmd` with an artificial
per-call delay (`TRIP_DRILL_DELAY_MS=5` by default), runs the bench,
compares against the committed `baseline.json`, asserts every fixture
trips. This is the literal "introduce a `setTimeout` in the rewriter
and watch the gate fail" drill the ticket calls out — the real
transpiler is invoked, just slowed down.

Not in CI by default — running it on every PR is wasteful (the cheap
synthetic test covers the same correctness assertion). Use the drill
when you touch the gate itself, or when you want hands-on confirmation
that a real perf regression in `transpileAmd` would be caught.
