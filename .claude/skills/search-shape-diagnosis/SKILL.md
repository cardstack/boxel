---
name: search-shape-diagnosis
description: Read the per-request query-shape telemetry the federated search emits — one JSON log line per `_federated-search` request on the `boxel:search-shape` channel (the same `| json` convention as `boxel:client-perf` and `boxel:screenshot-perf`), carrying the query's *shape* with every caller-supplied value elided, plus which cache answered, the result counts, and the wall-clock. Use it to answer what a search load was actually made of, which the request rate alone cannot show: (1) what a burst of searches asked for — the filter trees, type anchors, page sizes and fieldsets behind a spike, and how many distinct shapes (`shapeHash`) it decomposes into; (2) which shapes dominate a window by volume, by latency, or by rows returned; (3) how much of a load the caches absorbed — `miss`/`join`/`hit` on the live-search cache and `job-miss`/`job-hit`/`not-modified` on the indexer's job-scoped cache — and therefore how much of it reached the index at all; (4) separating prerender search load from live browser load via `linkMode`, since a prerender skips the `loadLinks` relationship-assembly pass and so costs a different amount for the same query; (5) attributing live search load to a person or a tab session, by joining `correlationId` to the `server-request` event on `boxel:client-perf`; (6) attributing in-render search load to the indexing job that caused it via `jobId` and `consumingRealm`; and (7) authoring a replay that exercises the same index paths a real load did. Carries the null-semantics traps that make naive aggregates silently wrong (a cache hit reports no counts; an incomplete merge reports no total; `correlationId` is minted per search and is not a per-render key). Joins to `realm:requests` and the `realm:search-timing` stage breakdown on `correlationId`. For staging/prod this layers on `aws-access` (the AWS session and Loki auth) and `tail-logs` (the Loki wrapper); hand off to `indexing-diagnostics` when the cost is inside the indexer rather than in what was asked for, and to the `search` skill when the task is authoring a query rather than reading one. Use when someone asks what a search spike was made of, which queries a realm is issuing, why search load is high, what a representative query looks like, or wants to replay a real load.
allowed-tools: Read, Grep, Glob, Bash
---

# Federated search query-shape diagnosis

A federated search is a `QUERY` whose query travels in the request body. Access logs carry method, URL, status and timing and never bodies — so without this channel a search load is legible only as a rate: how many ran and how long each took, with nothing about what any of them asked for.

`boxel:search-shape` closes that. One flat JSON line per `_federated-search` request, emitted from the single call site in `packages/realm-server/handlers/handle-search.ts`, defined in `packages/runtime-common/search-shape.ts`. It is the search sibling of `client-perf-diagnosis` (browser telemetry) and `screenshot-perf-diagnosis` (capture telemetry), and shares their emit convention.

Read `search-shape.ts`'s module header for the field semantics — it is the source of truth and this skill deliberately does not restate it. What follows is what the code cannot tell you: how to query it, and the ways a reasonable-looking query is wrong.

## Where the lines come from

Every line is emitted by the realm-server, so `service="realm-server"` is complete — there is no worker-side emission. One line per request that got far enough to parse a query, on **every** path that answers: a fresh compute, each cache outcome, a 304, the time-budget 408, and an escaping 500. A request rejected before its query parsed (a malformed body, a bad field path) emits nothing — absence of a line for a request means it never became a search.

## The traps

These are the reason this skill exists. Each one produces a plausible number that is quietly wrong.

### 1. The counts are null whenever a cache answered

`results`, `total` and `incomplete` are populated **only** when the handler built a document — that is, `cache` of `none`, `miss` or `job-miss`. On `hit`, `join`, `job-hit` and `not-modified` the response came from a body some other request computed, and all three are null rather than re-derived.

So `avg(results)` over a window is the average **over cache misses only**, and during a load event that is exactly the unrepresentative subset. Always constrain the outcome before aggregating a count:

```logql
| cache=~"none|miss|job-miss" | unwrap results
```

`totalMs` and `status` are populated on every line, cache hits included — a hit is a real request with a real latency. Only the counts are conditional.

### 2. `total` has two null causes

Null because a cache answered (above), **or** null because the merge was incomplete: a realm the query fanned out to failed to answer, so the count would sum only the realms that did and be a floor rather than a match count. `incomplete: true` distinguishes the second; `incomplete: null` means no document was built at all.

A window where `incomplete` is ever true is a window where some realm was failing — worth noticing in its own right, independent of whatever you came to measure.

### 3. `correlationId` is per search, not per render

It is minted fresh for each `_federated-search` fetch (`newCorrelationId()` in `packages/host/app/lib/prerender-fetch-headers.ts`, and the client-telemetry middleware does the same for live traffic). Every line has its own. Counting distinct `shapeHash` within one `correlationId` therefore always returns 1.

To group the searches of one render:

| traffic              | grouping key                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| prerender / indexing | `jobId` — per prerender visit; `consumingRealm` names the realm whose render issued it                                                            |
| live browser         | none on this channel — join `correlationId` to the `server-request` event on `boxel:client-perf`, which carries `session_id` and `matrix_user_id` |

The live-traffic join only works while the client telemetry instrument is armed; when it is dormant the request carries no correlation id at all and `correlationId` is null.

### 4. `linkMode` splits the same query into different costs

`prerender` means the `loadLinks` relationship-assembly pass was skipped outright — the largest per-result cost there is. `links-only` runs the pass and drops the closure; `full` assembles it. A latency panel that mixes modes is averaging two different amounts of work for identical queries. Split by `linkMode` before comparing anything.

### 5. `shapeHash` groups across realms and pages on purpose

It folds only what changes the work: filter, sort, htmlQuery, page size, fieldset (including `itemAsFallback`), `linkMode`, scope, and whether a `cardUrls` subset applies. It deliberately excludes the realm list, page number, pinned generation, and request identity.

So a shared hash means _the same query shape_, not the same request and not the same realm. Two hits on one hash may be two different realms being asked the same thing — which is usually what you want to know, but not if you assumed otherwise.

### 6. A truncated line is not a distinct shape

`truncated: true` means a rendered member hit `MAX_MEMBER_CHARS` and was cut with a `…[+N]` marker. The hash is taken **before** the cap, so two shapes differing only past the cut still hash differently even though their `filter` text is identical. Group by `shapeHash`, not by the `filter` string, or you will merge shapes the cap made look alike.

## Querying it

For staging/prod, read **`aws-access`** first (the AWS session and Loki auth). The `|=` line filter must come **ahead of** `| json` — without it the parser reads every realm-server line in the range and the query times out. Deployed lines are firelens-wrapped, so unwrap before the real parse, exactly as the sibling channels do.

```logql
# the base selector every recipe below builds on
{service="realm-server", env="$env"} |= "boxel:search-shape" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:search-shape"
```

### What is this spike made of?

```logql
# volume by shape — the shapes to care about, largest first
topk(10, sum by (shapeHash) (count_over_time(<base> [5m])))

# then read one line per interesting hash to see the actual query
<base> | shapeHash="<hash>" | line_format "{{.filter}} | sort={{.sort}} | page={{.pageSize}} | {{.linkMode}}"
```

### Which shapes cost the most?

Volume and cost are different rankings — a rare shape can dominate the index.

```logql
# p95 latency by shape
quantile_over_time(0.95, <base> | unwrap totalMs [5m]) by (shapeHash)

# rows actually assembled, misses only (see trap 1)
sum by (shapeHash) (sum_over_time(<base> | cache=~"none|miss|job-miss" | unwrap results [5m]))
```

### How much of the load reached the index?

```logql
sum by (cache) (count_over_time(<base> [5m]))
```

`hit` + `join` + `job-hit` + `not-modified` is the share that cost no index read. A spike that is mostly `hit` is a spike in _requests_, not in index work — the fix for it is upstream in the client, not in the query engine.

### Prerender load vs live user load

```logql
sum by (linkMode) (count_over_time(<base> [5m]))
```

`prerender` lines are indexing traffic; pair them with `jobId` and hand off to `indexing-diagnostics`. `full` / `links-only` are live user traffic.

### Searches per render, by card type

Prerender only (trap 3). `filter` carries the type anchor, so the anchor is the card type:

```logql
# searches per prerender visit
topk(20, sum by (jobId) (count_over_time(<base> | linkMode="prerender" [5m])))

# then the shapes within one visit
<base> | jobId="<jobId>" | line_format "{{.shapeHash}} {{.filter}}"
```

For live traffic, pivot through `boxel:client-perf`: find the `server-request` events for a `session_id`, collect their `correlation_id`s, and filter this channel by them.

### One request end to end

`correlationId` joins a line to the realm-server's `realm:requests` line and to the `realm:search-timing` stage breakdown for the same request — the latter emitted only when the client minted a correlation id, whereas this line is emitted regardless. So: this channel says _what was asked for_, `realm:search-timing` says _where the server spent it_.

```logql
{service="realm-server", env="$env"} |= "<correlationId>"
```

### From a laptop via `tail-logs`

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --filter 'boxel:search-shape' --since 1h --no-follow

packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex 'boxel:search-shape.*<correlationId>' --since 6h --no-follow
```

## Authoring a replay

The line is designed so a load can be reproduced without ever having held the user data that produced it. `filter` gives the operator tree and the field paths; `sort`, `pageSize`, the fieldset members, `scope` and `linkMode` give the rest of the request. What it deliberately does not give is the bound values — so a replay substitutes its own, and exercises the same index paths at the same cardinality without the originals.

Reconstruct the request body from the shape (see the `search` skill for the wire grammar), then drive it at the observed rate: `count_over_time` by `shapeHash` gives the per-shape rate to reproduce, and the `cache` distribution tells you how much of it must be distinct to avoid being absorbed by the live-search cache — a replay that issues one query repeatedly measures the cache, not the index.

## No dashboard yet

`boxel:client-perf`, `boxel:screenshot-perf` and `boxel:actions-queue` each ship one under `packages/observability/grafanactl/resources/dashboards/boxel-status/`. This channel does not, so the recipes above are written to be pasted into Grafana Explore. Anyone building the dashboard should start from them, and the traps above are the panel definitions that matter: split by `linkMode`, constrain counts to the miss outcomes, group by `shapeHash` rather than `filter`.
