---
name: prerender-sizing
description: Pick or adjust the prerender server's pool envelope (`PRERENDER_PAGE_POOL_MIN` / `_MAX` / `_HIGH_PRIORITY_MAX` / `_HIGH_PRIORITY_THRESHOLD` / `_IDLE_CONTRACTION_MS` / `_SHARED_CONTEXT_CAP`) and ECS task CPU/memory using observed telemetry, not round-number intuition. Use this skill whenever an operator asks "are we sized right?", wants to change the envelope after a workload shift, considers a new ECS task size, or hits memory pressure / OOM on the prerender service. Layers on top of the `aws-access` skill for the underlying CloudWatch + DB plumbing; that skill is a prerequisite.
allowed-tools: Read, Grep, Glob, Bash
---

# Prerender server sizing

The prerender pool's tab capacity is governed by a small set of SSM-driven knobs:

| Env var                                   | What it controls                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `PRERENDER_PAGE_POOL_MIN`                 | Idle floor — pool never contracts below this.                                    |
| `PRERENDER_PAGE_POOL_MAX`                 | Burst ceiling reachable by any priority.                                         |
| `PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX`   | Extra ceiling, reachable only when caller `priority >= HIGH_PRIORITY_THRESHOLD`. |
| `PRERENDER_HIGH_PRIORITY_THRESHOLD`       | Priority bar that unlocks the upper tier.                                        |
| `PRERENDER_PAGE_POOL_IDLE_CONTRACTION_MS` | Hysteresis window before each contraction tick.                                  |
| `PRERENDER_SHARED_CONTEXT_CAP`            | Absolute LRU cap for cached BrowserContexts.                                     |

Plus the ECS task definition's `cpu` and `memory`. All these together form the **memory envelope** that bounds how many warmed BrowserContexts the system can hold and how much burst headroom it has.

The right values aren't fixed once. As the workload shifts — more realms, larger card fan-outs, busier user traffic — the envelope needs re-tuning. This skill is the methodology to derive new values from telemetry rather than guessing.

## When to use this skill

Trigger on any of:

- "Are we sized right for prerender?" / "should we resize the prerender ECS task?"
- "We're hitting memory pressure / OOM on the prerender service."
- "We added more realms / a bigger card schema, do we need more prerender capacity?"
- "Why does the dashboard show prerender memory peak at X%?"
- "Should I bump `PRERENDER_PAGE_POOL_MAX` from N to M?"

If the user is asking "why did this single render time out", that's the `indexing-diagnostics` skill, not this one. This skill is for _capacity planning_.

## The sizing model

The pool's memory cost decomposes as:

```
total_memory_used = node_baseline + N × marginal_per_tab
```

where:

- `node_baseline`: Node + base Chrome process + standby + idle-state structures. Roughly 2 GB on the boxel prerender server today; varies with Node version, V8 heap retained, and whether standby refresh is active.
- `N`: number of warmed pool entries (active tabs + standby contexts the LRU is holding).
- `marginal_per_tab`: cost of one additional warmed BrowserContext + its cached fetches + tab queue state. Empirically derived per environment.

**CPU follows a different shape.** Each _actively rendering_ tab consumes approximately one busy CPU core (Chromium docs / observed). But tabs alternate between rendering, host-side waits (fetches, store loads), and idle. So:

```
cpu_peak ≈ (# tabs rendering simultaneously) × 1 vCPU
```

The "rendering simultaneously" number is rarely the full pool — it's bounded by both the global render semaphore and the per-tab queue. Empirically on staging today, peak observed simultaneous rendering is 1–2 even when the pool is at 7 tabs.

These two facts mean **memory is almost always the binding constraint** for prerender sizing on Fargate. CPU rarely dominates; if a CPU peak appears it's usually a sign of synthetic stress, not steady-state.

## Procedure

The skill has four required steps plus an optional fifth. Do steps 1–4 in order; the later ones depend on numbers you derive earlier. Step 5 (Fargate pricing comparison) is optional — only needed when the resize affects task size.

A note on units before you start: ECS / Fargate task memory is configured in **MiB** (binary, 2^20 bytes), and the CloudWatch `MemoryUtilization` percentage is computed against that allocated MiB value. So an "8 GB" task is really 8 GiB = 8192 MiB, and 98 % of it is 8030 MiB ≈ 7.84 GiB. The math below uses MiB / GiB throughout for consistency with what the AWS APIs actually return; if you see "GB" in this skill it's shorthand for "GiB" — never decimal gigabytes.

### Step 1: Capture the telemetry window

Goal: a snapshot of how the existing fleet is behaving. Three sources:

#### CloudWatch — CPU and memory utilisation

Get 24-hour AND 7-day windows. The 24 h shows steady state; the 7 d catches bursts you'd otherwise miss. Run the snippet below twice — once with `WINDOW=24h`, once with `WINDOW=7d` — and compare.

```sh
ENV=staging  # or production
PROFILE=claude-${ENV}  # provisioned via the aws-access skill
WINDOW=24h   # change to 7d for the second run; the case statement below picks the matching --period
END=$(date -u +%FT%TZ)
case "$WINDOW" in
  24h) START=$(date -u -d '24 hours ago' +%FT%TZ); PERIOD=300  ;;  # 5-min datapoints
  7d)  START=$(date -u -d '7 days ago'  +%FT%TZ); PERIOD=3600 ;;  # 1-hour datapoints
  *) echo "WINDOW must be 24h or 7d" >&2; exit 1 ;;
esac

echo "=== CPU $WINDOW (% of allocated vCPU) ==="
aws --profile $PROFILE cloudwatch get-metric-statistics \
  --namespace AWS/ECS --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=boxel-prerender-server-${ENV} \
               Name=ClusterName,Value=${ENV} \
  --start-time "$START" --end-time "$END" --period $PERIOD \
  --statistics Average Maximum \
  --query '{count: length(Datapoints), peakAvg: max(Datapoints[*].Average), peakMax: max(Datapoints[*].Maximum)}' \
  --output json

echo "=== Memory $WINDOW (% of allocated MiB) ==="
aws --profile $PROFILE cloudwatch get-metric-statistics \
  --namespace AWS/ECS --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=boxel-prerender-server-${ENV} \
               Name=ClusterName,Value=${ENV} \
  --start-time "$START" --end-time "$END" --period $PERIOD \
  --statistics Average Maximum \
  --query '{count: length(Datapoints), peakAvg: max(Datapoints[*].Average), peakMax: max(Datapoints[*].Maximum)}' \
  --output json
```

For the peak window, find the timestamp:

```sh
aws --profile $PROFILE cloudwatch get-metric-statistics \
  --namespace AWS/ECS --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=boxel-prerender-server-${ENV} \
               Name=ClusterName,Value=${ENV} \
  --start-time "$START" --end-time "$END" --period 3600 --statistics Maximum \
  --query 'sort_by(Datapoints, &Maximum) | [-3:].[Timestamp, Maximum]' \
  --output table
```

#### Queue-snapshot logs — what was the pool actually doing at peak?

This is the bridge from "memory was at X%" to "X% corresponds to N tabs". The prerender server logs `prerender-queue-snapshot` periodically with the live `totalTabs` and `totalPending`.

```sh
PEAK_START='2026-04-29 02:00:00 UTC'   # from the CloudWatch query above
PEAK_END='2026-04-29 02:30:00 UTC'

aws --profile $PROFILE logs filter-log-events \
  --log-group-name ecs-boxel-prerender-server-${ENV} \
  --start-time $(date -u -d "$PEAK_START" +%s)000 \
  --end-time $(date -u -d "$PEAK_END" +%s)000 \
  --filter-pattern '"prerender-queue-snapshot"' \
  --query 'events[*].message' --output text \
| tr '\t' '\n' \
| grep -oE "totalTabs=[0-9]+ totalPending=[0-9]+" \
| sort | uniq -c | sort -rn | head -10
```

The output is a histogram: how many snapshots saw each `(totalTabs, totalPending)` combination. The mode is the typical state during the peak; the max `totalTabs` is what the pool actually grew to.

#### DB — render-timing distribution

Confirms whether the system held under pressure (zero render-timeouts) or was at the edge. Queries the `boxel_index.diagnostics` JSONB column via the `aws-access` skill's port-forward + `claude_readonly_user` flow.

```sql
-- 7-day render-timing histogram. The `::int` casts assume the
-- diagnostic shape Prerenderer emits today; if a row is missing
-- a key (older diagnostic shape, partial write, manual edit) the
-- whole query errors. If that happens, narrow the WHERE clause to
-- skip the malformed rows: e.g. `AND diagnostics->'waits' ?
-- 'tabQueueMs'` (the JSONB `?` operator tests for a key) keeps
-- only rows with that key present.
SELECT
  count(*) AS rows_with_diag,
  count(*) FILTER (WHERE (diagnostics->>'totalElapsedMs')::int >= 145000) AS at_or_over_timeout,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (diagnostics->>'totalElapsedMs')::int) AS p95_total_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (diagnostics->>'totalElapsedMs')::int) AS p99_total_ms,
  max((diagnostics->>'totalElapsedMs')::int) AS max_total_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (diagnostics->'waits'->>'tabQueueMs')::int) AS p95_tabq_ms,
  max((diagnostics->'waits'->>'tabQueueMs')::int) AS max_tabq_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (diagnostics->'waits'->>'semaphoreMs')::int) AS p95_sem_ms,
  max((diagnostics->'waits'->>'semaphoreMs')::int) AS max_sem_ms
FROM boxel_index
WHERE diagnostics IS NOT NULL
  AND diagnostics ? 'totalElapsedMs'
  AND (diagnostics->>'indexedAt') ~ '^[0-9]+$'
  AND (diagnostics->>'indexedAt')::bigint > extract(epoch from now() - interval '7 days')*1000;
```

Key signals to look for:

- `at_or_over_timeout > 0`: the system is _already_ dropping renders. Sizing change is needed urgently.
- `max_tabq_ms` of seconds-to-tens-of-seconds: the user was waiting for a tab. This is the UX-visible pressure that priority routing + dynamic expansion exists to mitigate.
- `max_sem_ms` of seconds-to-tens-of-seconds: global render-semaphore saturation. Indicates pool is too small or fleet is too small.
- `p99_total_ms` near `145000` (the timeout budget): system was at the edge. Even if no timeouts fired, you're one bad burst from a 504.

### Step 2: Derive the marginal cost

From the peak snapshot — memory used, baseline, and active tabs:

```
marginal_per_tab = (peak_memory_bytes − baseline_bytes) / N_at_peak
```

`peak_memory_bytes` = `peak_memory_pct × allocated_memory`. If the task is 8 GB and peak is 98 %, that's 7.84 GB used.

`baseline_bytes` is approximately 2 GB on the current boxel prerender. If the workload changes substantially (Node major version, Chrome major version, observability instrumentation), measure it directly: tail the prerender server logs at idle and capture the `RSS` of the process after standby refresh has settled and the pool has 0 active tabs.

`N_at_peak` is the max `totalTabs` from the queue-snapshot histogram above. Note that this includes standby (the standby contexts also pin memory).

The number you derive is environment-specific. The original CS-10976 plan estimated 625 MB/tab from a quieter window; refreshed staging telemetry on 2026-04-30 measured **836 MB/tab** under heavier load. **Always re-derive from current data, never reuse a stale number.**

### Step 3: Project the proposed envelope's memory footprint

Make a table of memory at each candidate `MAX` / `HP_MAX` value against each candidate task size. Threshold: stay under 80 % of allocated memory under sustained operation.

```
N_tabs    memory_used = baseline + N × marginal
                       % of allocated for each task size

Example with baseline=2 GB, marginal=836 MB:

N tabs | Memory used | 8 GB task | 12 GB task | 16 GB task
   2   |    3.7 GB   |    46 %   |     31 %    |    23 %
   4   |    5.4 GB   |    67 %   |     45 %    |    34 %
   6   |    7.1 GB   |    89 %   |     59 %    |    44 %    ← MAX
   8   |    8.7 GB   |   109 %   |     72 %    |    55 %    ← HP_MAX
  10   |   10.4 GB   |   130 %   |     86 %    |    65 %
```

The 80 % line is the working ceiling. Anything that exceeds it under expected operation is undersized (see fallback below).

`HP_MAX` is the largest the pool can grow to — that's the value that has to fit. `MAX` is the most likely steady-state ceiling but `HP_MAX` is the **memory invariant**.

### Step 4: Choose the values

Now apply the projection plus operational judgment:

- **`MIN`** — the idle floor. From queue-snapshot data: what's the typical low-load tab count? Pick `MIN` slightly above that so the manager's warm-vacancy routing has cached affinities to route to. On boxel today, MIN=2 covers the steady state.
- **`MAX`** — the any-priority burst ceiling. From queue-snapshot data: what's the observed peak `totalTabs`? Pick `MAX` at-or-just-above that. Values above the 80 % memory line are undersized; values below the observed peak will throttle under existing workload. On boxel today, MAX=6 covers all 7 d observations.
- **`HP_MAX`** — the high-priority ceiling. Should give priority-10 traffic 1–2 reserved expansion slots beyond `MAX` for the worst-case "low-priority workload has saturated MAX, user comes in" scenario. Has to fit memory at 80 %. On boxel today, HP_MAX=8 fits 16 GB at 55 %.
- **`HIGH_PRIORITY_THRESHOLD`** — the bar that unlocks HP tier. Above the system-initiated tiers (`systemInitiatedPriority = 1`, `systemInitiatedPrerenderHtmlPriority = 0`), at-or-below the user-initiated tiers (`userInitiatedPriority = 10`, `userInitiatedPrerenderHtmlPriority = 9`). Default 5 leaves room for an intermediate priority level (e.g. live-refresh) to also benefit without re-tuning.
- **`IDLE_CONTRACTION_MS`** — the hysteresis window. Long enough to absorb sequential render trains from a typical fan-out; short enough that contraction reaches MIN within a few minutes. Default 60 000 ms (1 minute) works for most workloads.
- **`SHARED_CONTEXT_CAP`** — the absolute LRU cap on cached BrowserContexts. Default `HP_MAX × 1.5` keeps the LRU stable across expansion + contraction cycles.

### Step 5 (optional): Pricing comparison

If the resize affects task size, do a Fargate pricing comparison. us-east-1 on-demand:

- 1 vCPU @ $0.04048/hr
- 1 GB @ $0.004445/hr

So:

| Task size      |   $/hr | /month per task |
| -------------- | -----: | --------------: |
| 1 vCPU / 4 GB  | $0.058 |             $42 |
| 2 vCPU / 8 GB  | $0.117 |             $85 |
| 2 vCPU / 16 GB | $0.152 |            $111 |
| 4 vCPU / 8 GB  | $0.197 |            $144 |
| 4 vCPU / 16 GB | $0.233 |            $170 |

If the resize is "swap memory for CPU" (the typical case for prerender — memory-bound, CPU over-provisioned), the cost may actually drop. **Always show the pricing delta in the PR description.** It's a meaningful data point for the resize decision.

## Worked example — the 2026-04-30 staging resize

Captured on 2026-04-30 ~20:00 UTC for the CS-10976 PR 12 staging activation.

### Telemetry

| Metric                  |   24 h |    7 d |
| ----------------------- | -----: | -----: |
| CPU avg of 5-min Avg    |  1.1 % |  1.5 % |
| CPU 5-min peak          | 67.5 % | 97.5 % |
| Memory avg of 5-min Avg |   35 % |   39 % |
| Memory 5-min peak       |   64 % | 98.3 % |

7-d render-timing histogram from `boxel_index.diagnostics`:

- 58,549 rows with diagnostics
- 0 timeouts (`totalElapsedMs ≥ 145 000`)
- All-time DB-wide timeouts: 0
- p95 totalElapsedMs = 3 675 ms
- p99 totalElapsedMs = 13 804 ms
- max totalElapsedMs = 100 984 ms (under but approaching the 145 s budget)
- max tabQueueMs = 90 019 ms (90 s of waiting!)
- max semaphoreMs = 17 620 ms

Queue-snapshot at the memory peak:

```
115 totalTabs=5 totalPending=0
 60 totalTabs=6 totalPending=0
 25 totalTabs=6 totalPending=4
  9 totalTabs=6 totalPending=5
  4 totalTabs=7 totalPending=4
```

### Marginal cost

- Peak memory: 98.3 % × 8 GB = 7.86 GB
- Baseline: 2 GB
- Peak tabs: 7
- Marginal per tab: (7.86 − 2.0) / 7 = **836 MB / tab**

(Original plan estimated 625 MB. Re-derived against actual peak: 836 MB. Use this number, not the plan's.)

### Memory projection

|         N tabs | Memory used |  8 GB (today)   | 16 GB (resized) |
| -------------: | ----------: | :-------------: | :-------------: |
|        2 (MIN) |      3.7 GB |     46 % ✓      |     23 % ✓      |
|              4 |      5.4 GB |     67 % ✓      |     34 % ✓      |
|    **6 (MAX)** |  **7.1 GB** |   **89 % ✗**    |   **44 % ✓**    |
| **8 (HP_MAX)** |  **8.7 GB** | **109 % ✗ OOM** |   **55 % ✓**    |

The 16 GB resize is what makes HP_MAX=8 safe. On the existing 8 GB task, MAX=6 is already tight; HP_MAX=8 would OOM.

### Chosen values

- `MIN = 2`
- `MAX = 6`
- `HP_MAX = 8`
- `HIGH_PRIORITY_THRESHOLD = 5`
- `IDLE_CONTRACTION_MS = 60_000`
- `SHARED_CONTEXT_CAP = 12` (HP_MAX × 1.5)

### Cost delta

4 vCPU / 8 GB ($0.197/hr) → 2 vCPU / 16 GB ($0.152/hr) = **−23 %** per task. Doubles the memory ceiling while reducing spend.

## Pitfalls

- **Don't reuse stale marginal-cost numbers.** Re-derive every time. Workload changes shift the per-tab cost.
- **Don't ignore standby in the tab count.** The pool maintains `maxPages + 1` standbys; those count against memory the same as active tabs.
- **CPU < memory in priority for prerender.** If you're tempted to bump CPU, check the simultaneous-rendering count first. Almost always you can shrink CPU and grow memory for net wins.
- **80 % is the working ceiling, not the maximum.** Reserve the last 20 % for LRU growth, standby refresh churn, runtime-exception capture buffers, and Node V8 retained-heap overhead.
- **`HP_MAX` is the memory invariant, not `MAX`.** The pool can reach `HP_MAX` under any priority-10 burst; size memory for that worst case.
- **Validate with a synthetic stress test before promoting to prod.** Concurrent catalog full reindex + simulated user reindex; pass criteria: high-priority p95 `tabQueueMs` < 1 s, memory peak < 80 %, CPU peak < 80 %, zero 145 s timeouts.

## Where to set the values

Two surfaces:

- **SSM parameters** at `/<env>/boxel/PRERENDER_*` drive the runtime envelope. The activation procedure (including the exact `aws ssm put-parameter` calls, the required force-deploy of the ECS service after, the validation gate, and the rollback path) lives in [`docs/aws-operations.md` → "Activate the dynamic-pool prerender server"](../../../docs/aws-operations.md#activate-the-dynamic-pool-prerender-server). Use that runbook rather than ad-hoc shell — it covers the pre-requisites that make the difference between a real activation and a runtime no-op.
- **ECS task definition** is in `cardstack/infra` at `configs/boxel-prerender/base/main.tf` (`cpu` and `memory` properties). Resize via Terraform PR + apply.

After applying values, re-run **Step 1** at +1 hour, +24 hours, +48 hours to validate. If memory stays under 80 % and tab-queue waits don't regress, promote to prod with the same values (or adjust per the projection if prod's load profile differs).
