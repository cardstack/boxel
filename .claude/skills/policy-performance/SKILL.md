---
name: policy-performance
description: Measure what operation-permission policies cost and read the telemetry that says so — the `policy-decision`, `policy-search-scope`, `policy-compile` and `policy-snapshot-read` records the realm server writes on the `boxel:operations` channel, and the "Policy Decisions" Grafana dashboard (uid `boxel-policy-decisions`) built on them. Covers (1) how long the gate takes to decide an invocation (`evaluationMs`) and how much of that is predicate evaluation (`predicateMs`), by realm, operation and tier; (2) what a policy adds to a search, per realm consulted (`policy-search-scope.evaluationMs`); (3) how often a realm's compiled policy is rebuilt rather than revalidated, and what a compile costs the request waiting on it; (4) gate reach — how many requests reach the policy at all — which is the multiplier on every per-decision cost; (5) pulling the raw records from staging or production with `tail-logs.sh` and computing percentiles locally with `jq`, and A/B-ing a change across a deploy; (6) asserting on the same records in a realm-server test through their sinks. Use when someone asks whether policies slow the realm server down, before and after a change to the gate, the policy compiler, the search lane or predicate evaluation, or when a policy-heavy realm is slow and you need to know whether the policy is why.
allowed-tools: Read, Grep, Glob, Bash
---

# Policy performance

A realm's policy is consulted only for a caller its ACL declined. For those callers every invocation passes the gate (`card-operations/gate.ts`), every search composes the policy's query filters (`card-operations/policy-query.ts`), and the realm keeps a compiled copy of the policy card (`RealmPolicyCache` in `card-operations/policy.ts`). Each of those writes one JSON record per event on the `boxel:operations` channel (`card-operations/telemetry.ts`). These records are how the cost is measured.

## The records

Every line is one JSON object with `channel: "boxel:operations"` and a `kind`. The same channel carries `kind`-less operation-execution records and `capability-check` records, so filter on `kind` first.

| `kind`                 | one line per                                                                                | cost fields                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `policy-decision`      | gate decision for a caller the ACL declined (and, for a write left to the lock, the lock's) | `evaluationMs`, `predicateMs`, `predicates`, `tier` |
| `policy-search-scope`  | realm a search consulted through its policy                                                 | `evaluationMs`                                      |
| `policy-compile`       | read of a realm's policy card by its cache: a compile or a revalidation                     | `durationMs`, `outcome`, `rules`, `grants`          |
| `policy-snapshot-read` | evaluation of a predicate annotated `snapshot: true` (reads the index row, Tier 1/2)        | (count only)                                        |
| `capability-check`     | `_capabilities` request                                                                     | `totalMs`, `pairs`                                  |

Fields that matter for cost:

- `evaluationMs` (decision): from the gate's entry to its answer. It covers typing the target (an index-row peek, or for a stored-bytes read a file read and a definition lookup), loading the policy (normally a cache hit), matching rules, the non-grantable chain check, reading the target's stored source, and evaluating predicates.
- `predicateMs` / `predicates`: the share of `evaluationMs` spent evaluating predicates, and how many ran. A deny with `reason: "predicate"` ran every matching grant's predicate; an allow stops at the first that holds.
- `tier`: `none` (no predicate ran), `stored` (Tier 0, the card's own source), `snapshot` (at least one predicate read the index row). A snapshot predicate pays an index read the first time the decision asks for it.
- `decidedAt`: `gate`, or `lock` for the write lock's re-judgment of a write the gate left `pending`. A write that reaches the lock has two records, `pending` at the gate and its final decision under the lock, and the lock record's `evaluationMs` is time spent holding the write lock. A write whose batch fails before the lock, or one an explain asks about, leaves only the `pending` record.
- `hypothetical: true` marks an explain's records. Leave them out of any cost or rate you report.
- `transport` / `route`: the surface that reached the gate — `envelope _operations`, `card-json GET|HEAD|POST|PATCH|DELETE`, `byte-route source|module`, `explain`, `internal`. Search-lane records use `search`, `federated-search`, `envelope`, `explain`.

No record carries card content, a target URL or a predicate's source. Rules and grants are named by their position in the policy card (`rules[2].grants[1]`); read the policy card for what they hold.

## Gate reach is the multiplier

A caller the realm ACL allows never reaches the gate and writes no decision record. So the number of decision records is the number of requests that paid for the policy at all, and the first thing to establish is whether that number is big. A realm whose callers are all realm-authorized should show none. Records from such a realm mean the ACL-before-policy ordering broke, which is a correctness problem before it is a performance one.

Capability checks are excluded from gate reach on purpose. A view asks about every control it renders, at the rate it renders, and counts them on its own `capability-check` line.

## Reading it in Grafana

The "Policy Decisions" dashboard (`packages/observability/grafanactl/resources/dashboards/boxel-status/policy-decisions.json`, uid `boxel-policy-decisions`) has a Performance row with p50/p95 of decision `evaluationMs`, of `predicateMs` for decisions that ran a predicate, and of search-lane `evaluationMs`; the compile rate split into compiled vs revalidated; and compile `durationMs` p95. The Realm variable narrows every panel to realm URLs containing a substring.

## Pulling raw records

`tail-logs.sh` (see the `tail-logs` and `aws-access` skills) fetches raw lines. Narrow on the channel and the kind with the line filter, then let `jq` do the arithmetic:

```sh
cd packages/observability
AWS_PROFILE=claude-staging ./scripts/tail-logs.sh --env staging --service realm-server \
  --since 1h --filter '"kind":"policy-decision"' --no-follow --limit 5000 > /tmp/decisions.log
```

`--no-follow` returns a single batch of at most `--limit` lines, so a busy window needs a larger limit or a shorter `--since`; check the count you got against the limit. Production needs `--confirm`. Deployed lines arrive wrapped by the log router, so unwrap `.log` when it is there:

```sh
grep -o '{.*}' /tmp/decisions.log \
  | jq -c 'if .log then (.log | fromjson) else . end
           | select(.channel == "boxel:operations" and .kind == "policy-decision"
                    and .hypothetical == false)' > /tmp/decisions.jsonl

# p50 / p95 / max evaluationMs per realm and transport
jq -s 'group_by([.realmURL, .transport]) | map({
    realm: .[0].realmURL, transport: .[0].transport, n: length,
    p50: (map(.evaluationMs) | sort | .[(length * 0.5 | floor)]),
    p95: (map(.evaluationMs) | sort | .[(length * 0.95 | floor)]),
    max: (map(.evaluationMs) | max) })' /tmp/decisions.jsonl

# how much of the decision is predicates, by tier
jq -s 'group_by(.tier) | map({ tier: .[0].tier, n: length,
    predicateShare: ((map(.predicateMs) | add) / ((map(.evaluationMs) | add) + 0.0001)) })' \
  /tmp/decisions.jsonl
```

Small samples make percentiles meaningless. Say how many records a number rests on. If a window holds no records at all, that is a finding too: either no caller in that window reached a policy, or the records are not shipping. Check that `capability-check` lines arrive from the same realm server before concluding the former.

## Interpreting the numbers

- **`evaluationMs` high, `predicateMs` low.** The time is in matching and reading, not predicates. Look at `transport`: a `byte-route` read types the target from its stored bytes (a file read and a definition lookup) where every other route peeks the index row. Look at `reason`: a deny before any predicate ran (`no-grant`, `non-grantable`, `unmatchable-target`) should be cheap. One that isn't points at the non-grantable chain check, which reads a definition per type in the target's adoption chain.
- **`predicateMs` dominates.** Each evaluation parses and validates the predicate's BXL and runs it. Divide `predicateMs` by `predicates` for a per-evaluation cost. A deny pays for every matching grant, so a type with many conditional grants on one operation pays the sum.
- **`tier: snapshot` slower than `stored`.** Expected: a snapshot predicate reads the target's index row. Compare the two tiers for the same operation before attributing anything else.
- **Lock records with high `evaluationMs`.** That time is spent holding the write lock, so it delays every other write to the same card. It re-reads the stored card's type and then evaluates the predicates.
- **`policy-compile` with `outcome: compiled` at a steady rate.** The cache is being invalidated by index moves under the policy card or under a type its rules name, and each request that lands on a stale cache waits for `durationMs`. A healthy realm shows mostly `revalidated` and a compile only after an edit. A revalidation happens when a read finds the held policy older than a few seconds, not on a timer, so a realm whose policy nobody reads records none.
- **`policy-search-scope.evaluationMs` high.** That is matching query grants and lowering their filters per realm consulted, before the search runs. A federated search pays it once per realm it reaches only through a policy. It is separate from the SQL the composed filter costs, which the search's own timing records (`realm:search-timing`, see `search-shape-diagnosis`).

## Measuring a change

1. Pick the slice the change touches: a transport, a reason, a tier, or the search lane.
2. Pull a window before the deploy and an equal window after, from the same environment, and compute the same percentiles over the same filter. Compare medians and p95, with the record count beside each.
3. Normalize by gate reach: a lower total policy cost with fewer decision records is a traffic change, not a speedup.
4. For a change that removes work rather than speeding it up — like the operations envelope deciding each entry once instead of twice — the signal is the count, not the duration: decision records per envelope request, and `predicateEvaluations` in a test.

## In tests

Each record has a sink that replaces the logger, so a realm-server test asserts on records rather than scraping stdout: `setPolicyDecisionSink`, `setPolicySearchScopeSink`, `setPolicyCompileSink`, `setPolicySnapshotReadSink` and `setCapabilityCheckSink` from `@cardstack/runtime-common/card-operations`. Clear each in the module's teardown. `realm.__testOnlyPolicyGateStats()` counts policy loads, predicate evaluations, pending discharges, definition lookups and snapshot reads per realm, and `realm.__testOnlyPolicyCacheStats()` counts compiles and revalidations. Assert on counts, never on durations, which vary with the machine. `realm-policy-decision-telemetry-test.ts` is the worked example.
