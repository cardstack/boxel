# Realm Performance Benchmark

Wall-time regression bench for HTTP `GET` of card instances and `_search`
queries against the realm-server, modeled on `bench-amd`.

## Why this exists

The realm-server's read path goes through `populateQueryFields →
definitionLookup` for every layer in a card's link graph. A change here
can re-introduce the dotted-path materialization that made
`darkfactory.gts` 62 MB on disk and turned warm-cache GETs into a
~22-second-per-request cost. Type-checking and unit tests don't catch
that class of regression. This gate does.

## How to run locally

From `packages/realm-server`:

```bash
pnpm bench:realm        # measure-only, prints medians
pnpm bench:realm:check  # gate: enforce baseline.json (or report-only when absent)
```

Tunables:

| Var | Default | Meaning |
| --- | ---: | --- |
| `ITER` | 50 | Timed iterations per scenario. CI uses 100. |
| `WARMUP` | 5 | Warmup iterations (timing discarded). CI uses 10. |

The bench amortises a single ephemeral stack startup across every
scenario, so doubling `ITER` only adds tens of seconds.

## How the gate works

`check.ts` runs the bench, then:

* If `baseline.json` is absent → **report-only**: prints the medians and
  a paste-ready `baseline.json` snippet, exits 0. This is how we anchor
  the first real number from CI without locking in a local-dev artifact.
* If `baseline.json` is present → **enforce**: compares each scenario's
  median against `baseline_ms × tolerance`, with an optional
  `noise_floor_ms` for sub-second scenarios where relative tolerance
  alone gets eaten by runner jitter. Fails on any breach.

The committed `baseline.json` is the contract. We deliberately do not
auto-rebaseline on each merge — that would let regressions silently
ratchet the baseline up over time. When perf legitimately changes
(deliberate optimisation, accepted regression), update the file in the
same PR with a commit message explaining why.

## How to anchor the baseline

1. Land the bench harness without `baseline.json` (this PR).
2. Watch the first CI run print the report-only table + a snippet.
3. Open a follow-up PR copying that snippet to
   `packages/realm-server/scripts/bench-realm/baseline.json`. The gate
   automatically switches to enforce mode on next CI run.

## Fixture realm

`fixtures/realm-snapshot/` is a snapshot of `cs-11003-e2e-1` — the same
workload that surfaced the original 22-second warm-cache cost. It uses
the software-factory source realm (`packages/software-factory/realm/`)
for `adoptsFrom` resolution. The realm-test-harness package mounts both
under an isolated postgres + prerender + worker stack at bench time.

## Scenarios

| Name | Shape |
| --- | --- |
| `GET Validations/eval_sticky-note-1` | `linksTo` `Issues/sticky-note` which links a Project + Knowledge Articles. The CS-11079 hot path. |
| `GET Issues/sticky-note` | `linksTo` Project, `linksToMany` KnowledgeArticles. High-fanout layer. |
| `search filter-by-type Validations` | `_search` filter by `adoptsFrom` `EvalResult`. Exercises the index search + populateQueryFields + loadLinks chain. |

## CI

Defined in `.github/workflows/ci.yaml` as the `Realm Performance Benchmark` job.
Triggered when changes touch the runtime-common, base, host,
realm-server, realm-test-harness, software-factory source realm, or the
bench scripts/fixtures themselves. Concurrent runs on the same head ref
cancel each other (latest wins).
