---
name: search-shape-diagnosis
description: Read the per-request query-shape telemetry the federated search emits — one JSON log line per `_federated-search` request on the `boxel:search-shape` channel (the same `| json` convention as `boxel:client-perf` and `boxel:capture-perf`), carrying the query's *shape* with every caller-supplied value elided, plus which cache answered, the result counts, and the wall-clock. Use it to answer what a search load was actually made of, which the request rate alone cannot show: (1) what a burst of searches asked for — the filter trees, type anchors, page sizes and fieldsets behind a spike, and how many distinct shapes (`shapeHash`) it decomposes into; (2) which shapes dominate a window by volume, by latency, or by rows returned; (3) how much of a load the caches absorbed — `miss`/`join`/`hit` on the live-search cache and `job-miss`/`job-hit`/`not-modified` on the indexer's job-scoped cache — and therefore how much of it reached the index at all; (4) separating prerender search load from live browser load via `linkMode`, since a prerender skips the `loadLinks` relationship-assembly pass and so costs a different amount for the same query; (5) attributing live search load to a person or a tab session, by joining `correlationId` to the `server-request` event on `boxel:client-perf`; (6) attributing in-render search load to the indexing job that caused it via `jobId` and `consumingRealm`; and (7) authoring a replay that exercises the same index paths a real load did; and (8) auditing the link-shape policy, which picks how much of each result's link graph a live read carries from the load the process is under and may overrule a caller — answering "was this page served a degraded shape, and why" from `requestedLinkMode` / `linkModeDowngraded` / `linkShapeLoad` / `linkShapeLevel` beside the served `linkMode`, and "is the policy engaging more than it should" from the per-realm transition records and sampled no-change records on the `boxel:link-shape-policy` channel, whose `dwellMs` is the flapping signal. Carries the traps that make naive aggregates silently wrong: a cache hit reports no counts, an incomplete merge reports no total, `correlationId` is minted per search so nothing on the line groups one render (`jobId` is a whole index pass), `linkMode` is what was *served* rather than what was asked for, `linkShapeLoad` is a sustained mean that will not match a health line's instantaneous `inFlightSearch`, and a search the admission gate sheds emits no line at all — so under saturation this counts admitted searches rather than arriving ones. Joins to `realm:requests` and the `realm:search-timing` stage breakdown on `correlationId`. For staging/prod this layers on `aws-access` (the AWS session and Loki auth) and `tail-logs` (the Loki wrapper); hand off to `indexing-diagnostics` when the cost is inside the indexer rather than in what was asked for, and to the `search` skill when the task is authoring a query rather than reading one. Use when someone asks what a search spike was made of, which queries a realm is issuing, why search load is high, what a representative query looks like, or wants to replay a real load.
allowed-tools: Read, Grep, Glob, Bash
---

# Federated search query-shape diagnosis

A federated search is a `QUERY` (or `POST`) whose query travels in the request body. Access logs carry method, URL, status and timing and never bodies — so without this channel a search load is legible only as a rate: how many ran and how long each took, with nothing about what any of them asked for.

`boxel:search-shape` closes that. One flat JSON line per `_federated-search` request, emitted from the single call site in `packages/realm-server/handlers/handle-search.ts`, defined in `packages/runtime-common/search-shape.ts`. It is the search sibling of `client-perf-diagnosis` (browser telemetry) and `capture-perf-diagnosis` (capture telemetry), and shares their emit convention.

The module header in `search-shape.ts` defines what each member means. This skill is about querying the channel and the ways a reasonable query returns a wrong number; where it touches a field's meaning it does so only far enough to explain the consequence, and points at the header for the rest.

## Where the lines come from

Every line is emitted by the realm-server, so `service="realm-server"` is complete — there is no worker-side emission. One line per request that reaches the handler and parses a query, on **every** path that answers: a fresh compute, each cache outcome, a 304, the time-budget 408, and an escaping 500.

Three things emit nothing at all, and the third is the one that bites:

- a request whose query fails to parse (a malformed body, a bad field path) — it never became a search;
- a request `multiRealmAuthorization` rejects;
- **a search the admission gate sheds.** `searchAdmission` (`packages/realm-server/middleware/index.ts`) answers an over-ceiling search with a 429 _before_ the handler runs, and logs it on `realm:search-admission` instead.

That last one means this channel counts **admitted** searches, not arriving ones. Under exactly the saturation it exists to explain, the missing lines are the excess — so pair any spike with the shed count or you will read a ceiling as a plateau.

## The traps

Each of these produces a believable wrong number.

### 1. The counts are null whenever a cache answered

`results`, `total` and `incomplete` are populated only where the handler built a document. On `hit`, `join`, `job-hit` and `not-modified` the response came from a body some other request computed, and all three are null rather than re-derived.

So `avg(results)` over a window is the average **over cache misses only** — during a load event, the unrepresentative subset. Constrain the outcome before aggregating a count:

```logql
| cache=~"none|miss|job-miss" | unwrap results
```

That filter is necessary but not sufficient: the live-search cache records its outcome the moment it decides, before the populate runs, so a 408 or an escaping 500 also reports `miss` with no counts. Unwrapping is unaffected (Loki drops the empty values); if you are _counting lines_ rather than unwrapping, add `| status=200`.

`totalMs` and `status` are populated on every line, cache hits included — a hit is a real request with a real latency. Only the counts are conditional.

### 2. `total` has two null causes

Null because a cache answered, **or** null because the merge was incomplete — a realm the query fanned out to failed to answer, so the count would sum only the realms that did. `incomplete: true` distinguishes the second; `incomplete: null` means no document was built at all.

A window where `incomplete` is ever true is a window where some realm was failing, which is worth noticing whatever you came to measure.

### 3. Nothing on this line groups one render

`correlationId` is minted per search, so every line that carries one carries its own — and a live request whose client-telemetry instrument is dormant carries none, so those lines share the _absence_ of an id rather than each having one. Counting distinct `shapeHash` within a `correlationId` therefore returns 1, or silently lumps together every uninstrumented line in the range.

What the other candidates actually group:

| key                                                    | groups                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobId`                                                | one **indexing job** (queue job + reservation), held across the job's whole file sweep — every file it visited, both visit types. Not one render. |
| `consumingRealm`                                       | the realm whose render issued the search, for the life of that job                                                                                |
| `correlationId` → `boxel:client-perf` `server-request` | a live browser **tab session** (`session_id`) and the person driving it (`matrix_user_id`)                                                        |

There is no per-render key. "Searches per page render" is not answerable from this channel as posed; per index pass and per tab session are.

### 4. `linkMode` splits one query into different costs

`prerender` means the `loadLinks` relationship-assembly pass was skipped outright — the largest per-result cost there is. A panel that mixes modes averages two different amounts of work for identical queries, so split by `linkMode` before comparing anything.

`prerender` is **not** a synonym for indexing. It derives from `x-boxel-during-prerender`, which the module, file-extract and command-runner routes raise alongside the indexing render route — so the bucket is all headless traffic. Indexing is the subset with a non-null `jobId`, which only the render route's visit carries.

### 4a. `linkMode` is what was _served_, which is not always what was asked for

Between `full` and `links-only` the choice is not the caller's alone. The link-shape policy picks the shape per read from the load the process is under, and may overrule a caller that asked for the closure. So `linkMode` alone cannot tell "the caller asked for links-only" from "the caller asked for the closure and was downgraded" — and those are different findings about a slow page.

`requestedLinkMode` carries the preference and `linkModeDowngraded` carries the comparison. Read them together:

| `requestedLinkMode` | `linkMode`   | what happened                                                       |
| ------------------- | ------------ | ------------------------------------------------------------------- |
| `full`              | `full`       | the quiet case — no policy engagement                               |
| `full`              | `links-only` | **the policy degraded this read**; `linkShapeLevel` says which rung |
| `links-only`        | `links-only` | the caller asked for it; the policy is not implicated               |

`linkShapeLoad`, `linkShapeLevel` and `linkShapeRowClass` are the inputs the decision was taken on, stamped on the request that was decided. They are what separates "the policy did the right thing on bad inputs" from "the policy misjudged good inputs" — different fixes. All three are null on a `prerender` line, which never reaches the policy.

The shape hash folds the **served** mode only: two requests that asked differently and were served the same body are one shape. So `shapeHash` keeps aggregating correctly across a policy change, and `requestedLinkMode` is a filter rather than a grouping key.

### 5. `shapeHash` groups across realms and pages on purpose

The members it folds are the list built in `describeSearchShape`. What matters for reading it: the realm list, page number, pinned generation and request identity are deliberately **out**. A shared hash means the same query _shape_ — not the same request, and not the same realm. Two hits on one hash are often two realms being asked the same thing, which is usually what you want to know but not if you assumed otherwise.

### 6. Truncated `filter` text can hide two shapes

`truncated: true` means a rendered member hit the cap and was cut with a `…[+N]` marker. The hash is taken **before** the cap, so two shapes differing only past the cut hash differently while their rendered `filter` can be indistinguishable. Group by `shapeHash`, never by the `filter` string.

## Querying it

For staging/prod, read **`aws-access`** first (the AWS session and Loki auth). The `|=` line filter must come **ahead of** `| json` — without it the parser reads every realm-server line in the range and the query times out. Deployed lines are firelens-wrapped, so unwrap before the real parse, exactly as the sibling channels do.

```logql
{service="realm-server", env="$env"} |= "boxel:search-shape" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:search-shape"
```

The recipes below write `<base>` for that selector — substitute it inline before pasting into Grafana Explore.

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

### Headless load vs live user load

```logql
sum by (linkMode) (count_over_time(<base> [5m]))
```

`full` and `links-only` are live user traffic. `prerender` is headless traffic of every kind; narrow to indexing with `| jobId != ""` and hand those off to `indexing-diagnostics`.

### Searches per index pass, by card type

Indexing only (trap 3). `filter` carries the type anchor, so the anchor is the card type:

```logql
# searches per indexing job — one job sweeps many files, so this is a pass total
topk(20, sum by (jobId) (count_over_time(<base> | linkMode="prerender" | jobId != "" [5m])))

# then the shapes within one pass
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

## The link-shape policy

How much of each result's link graph a live read carries is decided per realm from that realm's own load: under sustained request load on a realm, its responses are degraded rather than served with their full link closure, while realms that are not generating the load keep theirs. This is independent of admission control, which refuses requests on bursts against its cap and can do so at readings below the lower rung. Two channels record it — the per-request fields above, and a low-volume transition channel, `boxel:link-shape-policy`, on the same `| json` convention.

A policy that reacts to load is only debuggable if it records the conditions it reacted to, because by the time anyone asks "why was this page slow" the concurrency that caused the decision is gone. These are the two questions an operator actually arrives with.

### "Was this page served a degraded shape, and why?"

**Scope first: these per-request fields cover the federated search only.** `boxel:search-shape` is emitted from the `_federated-search` handler and nowhere else, while the policy also decides the card+json `GET`/`HEAD` and the card+html item read — which emit nothing on this channel. So for a card read there is no line to find, and an absent line does not mean "not degraded". Those are also the two routes whose validators and response-cache entries a rung change fragments, so a "why did this stop 304-ing" investigation lands exactly where the channel is silent. For a card read, use the transition channel below to establish which rung the realm was on at that timestamp.

Start from the per-request fields. Given a `correlationId` from the browser (`x-boxel-logging-correlation-id`, carried on `boxel:client-perf` `server-request`):

```logql
<base> | correlationId="<id>"
  | line_format "served={{.linkMode}} asked={{.requestedLinkMode}} downgraded={{.linkModeDowngraded}} load={{.linkShapeLoad}} level={{.linkShapeLevel}} rows={{.linkShapeRowClass}} ms={{.totalMs}}"
```

Without a correlation id, pivot on the realm and the window:

```logql
# how much of a realm's live traffic was degraded, over time
sum by (linkModeDowngraded) (count_over_time(<base> | linkMode!="prerender" | realms=~".*<realm>.*" [5m]))
```

A downgraded line is only half an answer: `linkShapeLevel` says which rung was in force and `linkShapeLoad` says the reading that put it there. A `multi-row` level degrades only reads that may return more than one row, so a single-card read degraded at that level would be a bug, not a policy decision.

### "Is the policy engaging more than it should?"

The per-request fields cannot answer this cheaply — they tell you what happened to one page, not how often the policy engages or whether it is stable. That is the transition channel:

```logql
{service="realm-server", env="$env"} |= "boxel:link-shape-policy" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:link-shape-policy"
```

Call that `<policy>`. Two record shapes share it, discriminated by `changed`:

- `changed=true` — one realm's level moved. Carries `realm`, `previousLevel`, `level`, the `threshold` crossed and its `thresholdKind` (`engage` / `release`), the `load` at the decision (the realm's own reading), the process's reading beside it as `processLoad` — the gap between the two is what other realms were contributing — and **`dwellMs`, the time spent in the level being left**. Dwell is what distinguishes stable operation from flapping, and flapping is the specific failure this design risks: the mode is folded into both response validators and keys the card+json response cache, so every change costs a realm its cached entries.
- `changed=false` — the sampled no-change record, one per process per cadence, carrying `load` (the process's reading, since the record names no realm) and how many realms sit at each level (`realmsAtFull` / `realmsAtMultiRow` / `realmsAtAll`). It exists so that "the policy never engaged" is distinguishable from "the policy was not running" — without it the two look identical.

```logql
# transition rate — the flapping signal
sum by (realm) (count_over_time(<policy> | changed="true" [30m]))

# the short dwells, which are the ones that cost cache entries
<policy> | changed="true" | unwrap dwellMs | __error__="" [30m]

# the level distribution this process is reporting
<policy> | changed="false" | line_format "load={{.load}} full={{.realmsAtFull}} multi={{.realmsAtMultiRow}} all={{.realmsAtAll}}"
```

Those counts are over realms the process has **served since start**, each at the level it was last left in — not the realms it currently mounts. A realm enters on its first read and is never dropped, so one that has since been unmounted keeps being counted, and a mounted realm nothing has read is absent. On a server that mounts lazily and unmounts, `realmsAtAll` therefore drifts up and does not come back down; read it as a high-water description of what the policy has done, and use the transition rate above to judge whether it is over-engaging.

A `dwellMs` of `null` is a realm's first move, not a zero-length dwell — it had no prior level to have dwelt in.

### The thresholds: what they mean and how to set them

Four values decide when a realm changes rung. All four are **thresholds on the
load reading** — the time-weighted mean of search requests in flight, joiners included, per replica —
and none of them selects a link shape. Which shape a rung serves is fixed by
the ladder; these only decide when a realm arrives at that rung. The
`_THRESHOLD` suffix is there because a bare `…_ENGAGE` reads as a switch that
turns a shape on, which is the one thing it does not do.

| Parameter                                | Ships as | Crossing it                                                               |
| ---------------------------------------- | -------: | ------------------------------------------------------------------------- |
| `LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD`  |       14 | reads that may return more than one row start shedding their link closure |
| `LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD` |        7 | those reads carry it again                                                |
| `LINK_SHAPE_ALL_ENGAGE_THRESHOLD`        |       28 | every live read sheds it, including a single-card read                    |
| `LINK_SHAPE_ALL_RELEASE_THRESHOLD`       |       14 | single-row reads carry it again                                           |

Three more shape the same mechanism without being rungs:
`LINK_SHAPE_LOAD_HALF_LIFE_MS` (120000, how far back the mean reaches),
`LINK_SHAPE_MIN_DWELL_MS` (60000, the floor on how often a realm may change
level) and `LINK_SHAPE_HEARTBEAT_MS` (60000, the no-change record's cadence).
All seven are settable the same way.

Four properties decide whether a change to any of these does what you expect:

1. **Per replica, no shared store.** Each process reads only its own
   requests, so a fleet-wide in-flight of 28 spread over N tasks is ~28/N
   per replica. A threshold is only meaningful stated together with the fleet
   size it was chosen against, and adding tasks raises the fleet-wide load
   needed to engage roughly linearly. Read the current count rather than
   assuming it: distinct containers per 30-minute bucket, not distinct
   container ids over a short probe, which counts a deployment rollover as
   concurrency.
2. **The gap between an engage and its release is the hysteresis band**, and
   the band is what keeps a realm from flapping. A release at or above its own
   engage is self-cancelling; the parser clamps that case rather than
   honouring it, so a nonsensical pair silently becomes a different one than
   what was typed. Check the value the process reports on a transition record,
   not the one in Parameter Store.
3. **Every rung change costs a realm its cached validators.** The link mode is
   folded into both response validators and keys the card+json response cache,
   so a lower engage buys earlier protection and pays in cache fragmentation
   landing exactly when the server is busiest. The upper rung, which degrades
   even single-card reads, is placed above every load it has been observed on,
   because nothing has measured it helping; `search-bounds.ts` records the
   evidence for each rung.

   The fragmentation _rate_, though, does not track the engage as directly as
   that trade suggests, so "lower engage, more flapping" is not a safe thing to
   tune by. Replaying production against candidate pairs, the rate inside a
   busy stretch was at or below the higher engage's, while over all replayed
   time it rose — the reliable effect of a lower engage is more time spent
   degraded, not more transitions. Two cautions on that: a replay of a recorded
   reading is open-loop, so it cannot show degradation lowering service time
   and therefore lowering the reading that chose it; and it consults the ladder
   on every health sample rather than on every read, which overstates how often
   a quiet realm moves. Judge a candidate on the `dwellMs` distribution its
   transitions actually report, and treat a distribution piled at
   `LINK_SHAPE_MIN_DWELL_MS` as the band being too narrow rather than as noise.

4. **Anything that is not a number is the shipped default.** Each is parsed
   with a fallback, so an absent, empty or non-numeric value leaves the
   application's default in force rather than disabling the policy. That is
   load-bearing rather than incidental — see below.

   Careful with `0`: it is a number, and each knob clamps up to its own
   minimum rather than reading as unset. For an engage threshold that minimum
   is 1, so `0` means _permanently engaged_, not _off_.

5. **The reading counts searches, not work.** `inFlight` is incremented once
   per admitted search regardless of what that search costs, so a reading of 5
   made of unbounded whole-table queries and a reading of 5 made of typical
   production traffic are the same number over very different quantities of
   work. A threshold fitted against one population does not transfer to the
   other, and a reading measured under a synthetic load is not evidence about
   the load a comparable production reading represents. This is the reason a
   rung chosen from a saturation run wants checking against production traffic
   before it ships.

**Setting one.** These reach the container as ECS `secrets` resolved from SSM
Parameter Store at `/<env>/boxel/<NAME>`, so a change takes three steps and the
middle one is the one people forget:

```sh
aws ssm put-parameter --name /staging/boxel/LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD \
  --value 5 --type String --overwrite
aws ecs update-service --cluster boxel-staging --service boxel-realm-server-staging \
  --force-new-deployment
```

The value is read **once, at container start**. Writing the parameter changes
nothing on a running fleet — the deployment is what applies it, and until it
completes the fleet serves both values. Confirm the new one took effect from a
transition record's `threshold` field rather than from the parameter, and give
the fleet a load pass before trusting any measurement: the first pass after any
deployment is cold and worthless.

Terraform creates all seven where they are missing, seeded with the literal
`default` — a word, not a number, so the application's own value stays in
force. That is what keeps the shipped defaults authoritative: `ignore_changes =
[value]` ignores the seed exactly as it ignores an operator's edit, so a number
seeded in Terraform would become the environment's value permanently and a
later change to a shipped default would never reach a deployed environment.

So an unmodified environment reads `default` on all seven, and a threshold that
has been tuned reads a number. To put one back, **write `default` again — do
not delete the parameter**: every task-definition revision that names one fails
to start if it is absent, including a rollback to an earlier revision.

**Production is a shared environment.** A threshold change there is a deploy
with user-visible effect on every realm the fleet serves, so it is an operator
decision rather than an investigative step — propose it, do not arrange it.

### Traps specific to reading load alongside this

Three of these cost real time on the investigation that produced the policy, and they apply directly here.

- **`meanLag` is pinned at its own floor.** `realm:health` samples the event loop with `monitorEventLoopDelay({resolution: 20})`, so a `meanLag` of 20–22 ms means _unmeasurably low_, not "20 ms of lag". Only max and p99 carry signal. Reading a flat meanLag as "the loop was fine" and a degraded policy as "the policy over-reacted" is the same mistake twice.
- **`busyMs(parallel-sum)` is not CPU.** It sums concurrently-awaited work, so it double-counts waiting — it has read 46× wall clock on a single-threaded loop. It cannot be used to argue the process was or was not saturated.
- **The `realm:search-timing` stage lines carry no job marker.** A `loadLinks` share computed from them mixes worker traffic into live: in one 55-minute window 533 of 1,355 searches were `prerender`/job traffic. Separate them with this channel's `jobId` (via `correlationId`), not with the stage lines alone.

One more, specific to the policy: the load it reads is the **sustained count of search requests in flight** — every admitted request from admission until its response ends, joiners included, as a time-weighted mean with a multi-minute half-life. It is not the health line's `inFlightSearch`, which differs from it twice over: `inFlightSearch` is an instantaneous sample, and it counts admission slots — computations — which a request the live-search cache answers from another's computation hands back early, so it runs below the request count by the cache's miss rate. It is also **per realm**: a request counts toward each realm it names (in full toward each, for a fan-out), and a realm's level follows only its own reading, so `linkShapeLoad` is the realm's reading — for a fan-out, the reading of the realm whose level decided it. The health line carries the process-wide form as `searchLoad=` (instantaneous: `searchRequests=`) and the busiest realm's reading as `realmSearchLoadMax=`; compare `linkShapeLoad` against the latter, never against `inFlightSearch=`. Load spread thinly across many realms can put `searchLoad` well above every realm's reading with no ladder engaging — that case is left to the admission gate.

## Authoring a replay

The line is designed so a load can be reproduced without ever having held the user data that produced it. `filter` gives the operator tree and the field paths; `sort`, `pageSize`, the fieldset members, `scope` and `linkMode` give the rest of the request. What it deliberately withholds is the bound values — so a replay substitutes its own and exercises the same index paths at the same cardinality without the originals.

Reconstruct the request body from the shape (see the `search` skill for the wire grammar), then drive it at the observed rate: `count_over_time` by `shapeHash` gives the per-shape rate to reproduce, and the `cache` distribution tells you how much of it must be distinct to avoid being absorbed by the live-search cache — a replay that issues one query repeatedly measures the cache, not the index.

## Where to run these

`boxel:client-perf`, `boxel:capture-perf` and `boxel:actions-queue` each have a dashboard under `packages/observability/grafanactl/resources/dashboards/boxel-status/`; this channel is read from Grafana Explore with the recipes above. The traps are what any panel set has to respect: split by `linkMode`, constrain counts to the miss outcomes, group by `shapeHash` rather than `filter`, and show the `realm:search-admission` shed count beside any request rate.
