---
name: realm-load-harness
description: Run and interpret the realm load harness (`packages/realm-server/scripts/load-harness/`) — a dependency-free driver that authenticates N real Matrix users against a non-production realm server, holds unbounded `_federated-search` queries open from `--readers` sessions while `--writers` sessions POST cards into the same realm, and reports per-query-shape payload bytes, split headers-vs-body latency, write latency, and (under `--subscribe`) realm-event re-run counts. Covers (1) reproducing a saturation incident — many concurrent dashboards plus a steady write rate — so the realm server's own `heapMB` / `eventLoopLagMs` health-sampler signals can be read under load, alongside the concurrency the run itself reports (the sampler's `inFlightSearch` is a five-second point sample and answers neither threshold question); (2) A/B-ing a payload, throttle, or admission-control change across a deploy, where the trustworthy signal is the per-shape KB column and NOT wall-clock, because a driver outside the realm server's AWS region measures its own connection (an out-of-region run read 6,101 ms p50 end-to-end against 225 ms of actual server time; the same run in-region reads 521 ms — itself about one handshake above the server's own number, since `fetch` resolves only after any TCP+TLS setup, which is why the driver primes each batch's connections outside the timed window and why `--prime-connections=false` relabels `headers` as including setup); (3) confirming a deploy actually finished before comparing two runs — matching image tags prove nothing, `aws ecs describe-services … deployments[0].rolloutState` must read `COMPLETED` with `updatedAt` earlier than the test start, and skipping this check has produced a confidently-wrong conclusion; (4) measuring rather than modelling the live-search fan-out with `--subscribe`, which reads `app.boxel.realm-event` over Matrix `/sync` and applies the host's `#indexEventCannotMatch` skip test — with the caveat that the harness compares type keys literally where the host resolves them through its module loader, so its re-run counts are indicative and quoting them as the host's behaviour produces a wrong bug report; (5) adding a second authenticated round trip per write with `--model-calls`, which forwards through `_request-forward` to a refused destination so no tokens are spent — reaching JWT verification, body parsing, and the `AllowedProxyDestinations` / `proxy_endpoints` lookup, but stopping in front of `withUserCostLock`, so it does not reproduce per-user cost-lock contention (a `400` in the response tally is expected); (6) choosing which of the two documents `_federated-search` returns a run measures, via `--fieldset` or a workload's `fieldset` member — `item` sends `fields: { entry: ['item'] }` and is the card-data-only path `store.search` takes for a query-backed field, while the default `entries` sends no fieldset and gets the prerendered renderings a grid or the search panel displays, four to six times the bytes for the same filter (94 KB against 405–537 KB measured on a deployed realm), so a figure quoted without its path is not interpretable and every run prints the path it modelled; (7) choosing the spread a run asks over via a query's `variants` — filter fragments cycled per re-run and offset per reader, because a shape with a fixed filter asks one question that the realm's live-search cache answers after the first miss (the same query six times reads miss/miss/miss/miss/hit-48ms/hit-50ms on a deployed realm), whose signature is latency falling as the request rate rises, so a variant-less run reports cache-hit cost rather than what answering costs and the `spread:` summary line states which it was; and (8) choosing where the queries come from, in three modes of increasing specificity — the committed `workload.experiments.json` targeting the experiments realm that ships in the repo as `packages/experiments-realm` and exists in every deployed environment (the recommended starting point: zero setup, and numbers comparable to anyone else's run **against the same target**, since the repo realm and a deployed one are not kept in step); `--derive-workload`, which reads the realm's own `GET <realm>/_types` card-type summary, ranks its `kind: 'instance'` entries by `attributes.total`, splits each `id` at the last `/` into an `item.on` module/name anchor, and queries the top `--derive-top` (default 8) — so two people testing one realm need no shared config, and `--emit-workload` turns the result into a committable file; and a hand-written workload file transcribed from a specific card's `load()` / `loadData()` bodies into the `_federated-search` entry wire grammar where the type anchor is `item.on` and field paths carry an `item.` prefix. Also covers the credential CSV (`username`, `initial_password`; never commit one, never log a password) and the requirement that each reader join its invited Matrix session room or it receives no events at all. Use when asked to load-test, stress, or saturate a realm server, to reproduce a search-saturation or heap incident on staging, to measure the payload cost of a dashboard's query set, to get a load number comparable to a teammate's, or to check whether a search/payload change moved the numbers. The AWS session, ECS/CloudWatch reads, and log pulls this skill depends on come from `aws-access` (a prerequisite for anything deployed) and `tail-logs`; the browser-side half of a slowness complaint — what the client did with the bytes once they arrived — is `client-perf-diagnosis`, which this harness deliberately cannot see.
allowed-tools: Read, Grep, Glob, Bash
---

# Realm load harness

`packages/realm-server/scripts/load-harness/` drives a non-production realm
server with the load a cohort of users produces: many sessions holding unbounded
dashboard queries open while a few sessions write cards into the same realm.
Read its `README.md` for the flags and the workload-file format; this skill is
about running it so the numbers mean something, and about which numbers those
are.

The harness is dependency-free by design — global `fetch` and `node:` built-ins
only — because where it runs decides what it measures.

## Which path a run measures — decide this before the queries

`_federated-search` serves two documents from the same filter, selected by the
`fields[entry]` sparse fieldset, and they differ by four to six times in bytes.
Choosing wrongly measures a different code path from the one under
investigation, and no amount of care about _which types_ get queried fixes that.

| `--fieldset`        | on the wire                          | comes back                              | models                          |
| ------------------- | ------------------------------------ | --------------------------------------- | ------------------------------- |
| `entries` (default) | no fieldset                          | prerendered renderings (`html` + `css`) | a grid, card list, search panel |
| `item`              | `fields: { entry: ['item'] }`        | card serializations only                | a query-backed field            |
| `item-html`         | `fields: { entry: ['item','html'] }` | both                                    | —                               |

Measured on a deployed realm, same filter and page size: 94 KB on the item path
against 405 KB and 537 KB on the entries path for two types.

**`store.search` sends `fields: { entry: ['item'] }`** and instantiates cards
live from the result, so **`item` is the path a query-backed field takes** — and
the path a search-saturation investigation is usually about. Grids and the
search panel send no fieldset and get the renderings, which is right for them
because they display prerendered HTML.

A workload file pins the choice with a `"fieldset"` member and `--fieldset`
overrides it; both committed workloads pin one. **A file that pins neither is
refused** — a default is recorded nowhere, so a figure produced under one cannot
be read back to the path it describes — and an emitted workload carries the path
its deriving run resolved. Every run prints the path it modelled in its header
and summary. **Never quote a payload or latency figure from this harness without
saying which path produced it.**

## How much spread a run asks over — decide this with the path

A shape with a fixed filter asks the same question on every re-run, and a realm
answers a repeated query from its live-search cache. On a deployed realm the
same query six times reads miss, miss, miss, miss, **hit 48 ms**, **hit 50 ms**.
Past the first pass, such a run reports what a cache hit costs rather than what
answering costs — the same class of mistake as measuring the `entries` path when
the question is about `item`, and just as invisible in the output.

The signature is **latency falling as the rate rises**. Measured on staging at
`--fieldset item`: headers p50 1,399 ms at 880 searches/min, and 695 ms at
1,498/min. More load, faster responses, because the second run hit the cache
more often.

`variants` on a query is the fix: filter fragments merged over its own filter,
one per re-run, offset per reader so concurrent readers ask different questions.
The README has the format. Two rules when writing them:

- **The values have to match rows.** A fragment selecting nothing is a cheap
  search, so a set of them reports a realm answering instantly while measuring
  none of the work the shape does when it has an answer.
- **Model the spread the screen has.** A dashboard whose day-scoped queries walk
  a term gets one variant per day; a list filtered by status gets one per
  status. Inventing a wider spread than the screen has overstates the miss rate
  as surely as omitting one understates it.

The `spread:` line in the run summary reports how many distinct questions were
asked, next to the path. Quote both or neither.

Write rate is a second, weaker lever on the same thing: a write invalidates only
the queries it affects, so a workload with one write target leaves every other
shape hitting cache however fast the writers go.

## Where the queries come from

Three modes, in increasing order of specificity. Reach for the first one unless
there is a reason not to.

### 1. The standard workload — recommended starting point

`workload.experiments.json` targets the experiments realm, which ships in the
repo as `packages/experiments-realm` and exists in every deployed environment.
It is the one realm everybody can point at, so it is how a run becomes
comparable to someone else's with zero setup and nothing to exchange.

```sh
node run-load.ts --csv ./accounts.csv --realm <experiments realm url> \
  --workload ./workload.experiments.json
```

Its eight query shapes are the realm's highest-count instance types, chosen by
count rather than by interest.

**Comparable across runs against the same target, not across targets.** The repo
realm and a realm deployed from it are not kept in step — `Spec` is 117
instances deployed against 28 in the repo, `CardListing` is 26 against 0. The
workload file records both columns. Compare an environment against its own
earlier run; a smaller shape on a repo clone is the realm differing, not a
regression.

The writers post an `Author`, which is in the read set, so each write
invalidates a query the readers are running.

**On a deployment, `--writers 0` is usually the only run that works.** The shared
realms an ordinary user can reach — `catalog`, `submissions`, `skills`,
`software-factory` — are granted read-only, so writers against them fail at the
first POST. Take a clone with `setup-realm.ts` if you want the write-driven load;
otherwise run read-only and read the payload and latency columns.

**Know the cost before a long run.** The realm sizes these queries, and it is not
a realm you sized: bounded at 20 cards the six largest shapes on a deployed realm
total roughly 2.2 MB per pass, and the standard workload is unbounded. Every
reader fires the whole set per re-run, so multiply by `--readers` and the re-run
rate. The summary prints the exact per-pass total — read it after a short run
before committing to a long one from CloudShell.

### 2. `--derive-workload` — for the realm you actually care about

Don't share a config; derive one from the target. `GET <realm>/_types` returns
one `card-type-summary` entry per type with an instance count; the harness keeps
`kind: 'instance'` entries, ranks by `attributes.total` (with the id as
tiebreak, so a tie cannot reorder the selection between runs), splits each `id`
at the **last** `/` into an `item.on` module/name anchor, and queries the top
`--derive-top` (default 8).

```sh
node run-load.ts --csv ./accounts.csv --realm <url> --derive-workload
```

Both id spellings in circulation split correctly: the prefix form
(`@cardstack/base/spec/Spec`) and the URL form
(`https://…/experiments/author/Author`).

`--derive-page-size` (default 20) bounds every derived query; `0` leaves them
unbounded. The standard workload is unbounded, so **a derived run and a standard
run are not comparable to each other**.

**Leave the default page in place and the run loads almost nothing.** Measured
against a deployed realm of roughly 2,650 instances at `--fieldset item`, the
same derived workload:

| page               | readers |      rate | concurrency |
| ------------------ | ------: | --------: | ----------: |
| `page: {size: 20}` |      10 |   602/min |         1.2 |
| `page: {size: 20}` |      19 | 1,850/min |         1.2 |
| unbounded          |      19 |   298/min |         5.3 |

Six times the request rate produced a quarter of the load, because in-flight is
rate multiplied by service time and service time is the term that moves.
**Request rate on its own is not a load signal.** Per search the gap is wider
than the rows suggest — dividing each row's load by its rate, an unbounded
search costs about nine times a page-bounded one, which is why 19 readers on
the bounded workload sit at the load 10 readers produced. Pass
`--derive-page-size 0` whenever the question is about load rather than about a
bounded screen.

**A derived workload is the unmitigated shape by construction**, and that bounds
what it can be used for. The type summary carries names and counts, so every
derived query is type-only with no predicate — a whole-table read per type. That
is a faithful reproduction of the problem and useless as a measurement of a fix:
when the change under test is "push a client-side predicate into the query", a
derived workload cannot express the mitigated side. Emit it, add predicates by
hand, and A/B the two files. A workload's filter is passed through whole, so
`eq` / `contains` / `range` / `any` sit alongside the `item.on` anchor;
`workload.example.json` has committed examples.

To make a derived workload shared, emit it and commit it:

```sh
node run-load.ts --csv ./accounts.csv --realm <url> --derive-workload \
  --emit-workload ./workload.mine.json     # '-' writes to stdout
```

That writes and exits without running, so what you run next is reproducibly what
is in the file. Realm-local modules are emitted as `${realm}…` so the file
travels between clones. The emitted `write` block has empty attributes — the
summary endpoint reports counts, not field schemas — so fill it in before
committing.

**A derived workload can come back read-only.** The write target must be a type
defined in the realm itself; an external module is not addressable relative to
the realm, so naming one would be a guess discovered at write time. When no
selected type is realm-local the `write` block is omitted, stderr says so and
names the types that ranked, and the run needs `--writers 0`. On a deployment's
`catalog` realm every top type is `@cardstack/…`, so this is the expected result
there — and it lines up with those realms being read-only anyway.

**`_types` needs the realm's own JWT.** A bare realm-server session token gets
`401 User permissions in the JWT payload do not match the server's permissions`.
A 401/404 here **stops the run**; it never falls back to a built-in workload,
because two people believing they ran the same test and not having done is worse
than a failed run.

### 3. A hand-written workload file

For reproducing a specific card's query pattern. `workload.example.json` is the
shape. Transcribe out of the card source — the `load()` / `loadData()` bodies,
the query-backed fields — rather than inventing a plausible set: a workload that
asks for less than the screen does measures nothing.

All three are written in the `_federated-search` **entry wire grammar**, not the
card-query grammar: the type anchor is `item.on`, and field paths inside `eq` /
`contains` / `in` / `range` carry an `item.` prefix. The card spelling gets a 400. Everything alongside `label` is passed through, so `sort` and `page` work.

## The first decision: where the driver runs

**Run the driver inside the same AWS region as the realm server.** This is the
single biggest source of wrong conclusions from this tool.

| Same run, two vantage points                            | end-to-end p50 |
| ------------------------------------------------------- | -------------: |
| Laptop, across the internet                             |       6,101 ms |
| In-region (CloudShell, same region)                     |         521 ms |
| The realm server's own request duration for that window |         225 ms |

96% of what looked like platform latency from the laptop was the observer's
connection pulling hundreds of kilobytes per response. Reported as a platform
result it would have been wrong by a factor of twenty-seven.

The harness splits the two legs so this cannot be misread silently:

- **`headers`** — the server deciding what to send, plus one round trip.
- **`body`** — bytes crossing the network. This is your connection.

It prints a warning when the body leg takes more than half the end-to-end time.
Treat that warning as "these latency numbers are not about the realm server".

**Byte counts are trustworthy regardless of where the driver runs; latency is
not.** So a payload change can be evaluated from anywhere, but a latency claim
cannot.

### `headers` excludes connection setup only because the driver primes for it

`fetch` resolves when response headers arrive, and a request that had to open a
socket first has a TCP and a TLS handshake inside that promise. Readers re-run on
an interval far longer than undici's keep-alive, so on a realm nobody is writing
to — what `--writers 0` makes normal — a naive driver pays setup on nearly every
sample and reports it as server time. Measured against a local server: with
priming disabled 59 of 60 timed searches opened a connection; with it on, 0 of 60.

The driver therefore opens each batch's connections before starting the clock,
priming with the batch's own concurrency (N concurrent requests want N sockets,
and undici prefers a free client to a new one, so a single primer would funnel
the batch onto one socket and change what is being measured). It also measures
what a cold socket costs on the current link and prints it at startup, with both
raw samples beside the difference.

The measurement carries the same trap as the primer: the first request after
process start is cold, and so is the second, because the socket has not returned
to the pool yet. Subtracting the second from the first compares two handshakes
and reports the jitter between them — against a control charging a known 295 ms
handshake, that spelling reads 11 ms. A yield plus the cheapest of several warm
samples reads 296 ms. **If a run reports a setup cost in single-digit
milliseconds from a laptop, distrust it**: on a laptop link this is hundreds of
milliseconds, and only in-region should it be small.

Two consequences when reading someone's numbers:

- If the run used `--prime-connections=false`, `headers` **includes** setup and
  the summary says so. Do not quote it as server time.
- Even primed, `headers` is a round trip away from the server's own duration.
  **Compare runs from the same place**, and hold `--readers` fixed: `headers`
  rises with reader count because that is the server under concurrent load,
  which is the thing being measured, not an artifact to correct for. The 521 ms in-region figure above sits
  about one handshake above the server's own 225 ms, which is exactly this
  effect — it is an end-to-end observation, not a server measurement.

Getting in-region is a copy, not a build — zip the directory, upload it and the
credential file to a CloudShell session in the right region, and run it there.
Any in-region box works (EC2, CloudShell, an ECS task). CloudShell's home
directory persists, so delete the credential file afterwards. The driver needs a
Node that runs `.ts` directly (24.x, or 22.18+); CloudShell may ship something
older, in which case `nvm install 24`.

## Before any A/B: prove the deploy finished

Comparing a run before a change against a run after it is only valid if the
"after" run actually hit the new code. **Matching image tags do not prove that**
— a new task definition is registered before the rollout completes, so the tag
moves while old tasks are still serving.

```sh
aws ecs describe-services --cluster <env> \
  --services boxel-realm-server-<env> boxel-worker-<env> \
  --query 'services[].[serviceName,deployments[0].rolloutState,deployments[0].updatedAt]' \
  --output text
```

Every service must read `COMPLETED`, with `updatedAt` **earlier** than the
moment the run starts. Skipping this check has produced a confident conclusion
that was simply measuring the old code twice. The AWS session for this call
comes from `aws-access`.

## What each mode measures, and what it cannot

**Default (no `--subscribe`) — models the fan-out.** Readers re-run their whole
query set whenever this driver makes a write. That produces realistic server
load, so it is the right mode for admission control, per-search heap, and write
latency under read load. But the decision to re-run is the harness's own, so a
client-side change that makes browsers skip re-runs cannot show up in the
numbers at all.

**`--subscribe` — measures the fan-out.** Readers open their own Matrix `/sync`,
consume the realm's `app.boxel.realm-event` messages, and apply the host's skip
test: an index event names the types it invalidated, and a query whose types are
disjoint from that set does not re-run. The summary then reports re-runs
performed against re-runs skipped.

**The caveat that decides how you may quote the result.** The host resolves a
query's type keys through its module loader, so a filter naming a type through a
re-exporting module still matches rows stamped with the canonical
defining-module spelling. The harness has no loader and compares the literal
`module/name`. On a realm whose queries name their types directly the two agree;
on a realm that filters through re-exports the harness skips where a browser
re-runs, and understates traffic. **Report the re-run counts as indicative.
Quoting them as the host's behaviour produces a wrong bug report.** Payload and
latency are faithful in both modes.

**Neither mode has a browser.** The final hop — invalidation reaching a tab and
re-rendering — is invisible here. That half is `client-perf-diagnosis`, which
reads the host's own telemetry.

## `--model-calls`

Each writer issues a `_request-forward` call before it saves — the position a
card that generates before saving occupies. The destination is one the realm
server refuses, so **no tokens are spent**. A `400` in the response tally is the
expected shape, not a failure.

**Know the boundary before you quote this flag.** `handleRequestForward`
verifies the JWT, parses the body, and looks the destination up in
`AllowedProxyDestinations` (a `proxy_endpoints` read, cached five seconds per
replica) — and rejects there. That lookup sits **in front of**
`withUserCostLock`, so a refused destination never takes the per-user cost lock.
This flag therefore does **not** reproduce the serialization where one user's
second generation waits out their first; reaching the lock takes an allowlisted
destination, which means real spend and real upstream latency.

What it does add is a second authenticated round trip per write, at the realm
server and at the database, with its latency sitting between that writer's
writes.

## Credentials

A CSV with `username` (the Matrix localpart) and `initial_password` columns;
other columns are ignored. **Never commit one** — the directory's `.gitignore`
refuses `*.csv` — and never log a password; the harness reports login failures
by status and error code only.

Each simulated session authenticates as its own user. Searches authorize per
realm and realm events are broadcast into each user's own session room, so a
single shared account reproduces neither.

**Readers must join their invited Matrix session room.** `_realm-auth` creates
each user's DM session room and _invites_ them to it; an invited-but-not-joined
user receives no events at all. A browser joins during its Matrix startup, so
the harness does too — and it reports any session that ended up with no room,
because otherwise that silence reads exactly like a change working.

One manual step has no CLI equivalent: granting the non-owner users read access
to the realm. That is a UI action or a direct API call after `setup-realm.ts`
runs.

## Reference numbers

From an in-region run on 2026-09-14 against a realm clone of roughly 2,300
files, 14 readers / 3 writers / 15 minutes with `--subscribe`:

```
end-to-end p50   730 ms
  headers p50    663 ms      ← server work + 1 RTT (+ setup: unprimed run)
  body    p50     29 ms
write       p50 2524 ms
rate            889 searches/min sustained
```

Payload, which is the signal that does not depend on where the driver ran:

```
one dashboard render   ≈ 5.4 MB across its query set
  largest shape          1756 KB
  second                 1485 KB
  third                  1297 KB
  remaining shapes       133–544 KB each
```

Server side over the same window, from the realm-server health sampler —
`inFlightSearch` shown as the raw sample range it is, which is not the mean the
link-shape policy reads:

```
inFlightSearch   0–30 (instantaneous samples)
heapMB           peak 1180
eventLoopLagMs   max ~500
```

A throttle or payload change that works shrinks the shapes above 1 MB, and
`headers` should follow. Compare **ratios** — searches per minute, heap per
in-flight search — rather than absolute ceilings whenever two environments with
different memory limits are being read together.

### Experiments realm, 20-card pages

A derived workload against a deployed experiments realm, top 6 types, `page:
{ size: 20 }`. Every query returned 200 with 20 results; `_types` itself took
245 ms.

```
 count  server   payload   type
   117   203ms    417 KB   Spec
    37  1129ms    301 KB   FileDefFormatPreview
    30  1258ms    297 KB   Author
    30   393ms    293 KB   Model
    26   223ms    566 KB   CardListing
    25   586ms    325 KB   Company
```

Two things in that table are the reason the harness prints a spread line and a
per-render total:

- **Server time spans 6× across types in one realm** (203 ms to 1258 ms), and it
  does not track instance count — the 117-instance type is the fastest. An
  average over shapes describes none of them; read the rows.
- **A 20-card page costs 300–566 KB.** Page size bounds the row count, not the
  payload: each row carries its `included[]` closure.

## Getting a run to a threshold, and telling whether it did

Two realm-server mechanisms engage at a level of concurrency: the admission gate
bounds in-flight searches at a cap, and the link-shape policy degrades a live
read's link closure one rung earlier, at a time-weighted mean of the same count
(120-second half-life by default, `LINK_SHAPE_LOAD_HALF_LIFE_MS` per
deployment). Both are **per replica**, so a fleet of N tasks needs N times the
load one process would.

The gate does not shed at the cap: an arrival above it queues and is answered
`429` only if no slot frees within the admission wait. So a process can sit
pinned at its ceiling with no shedding at all, and a `429` count measures how
long the queue stayed full rather than whether the cap was reached.

A run that reaches neither has measured neither — and "the policy never
degraded" is compatible with a policy that correctly declined and with one that
could not have engaged. Two different questions, two different answers:

- **Is the threshold where real traffic can reach it?** That needs load, and
  the credential pool is the ceiling: one session per CSV row, so a 20-row file
  caps a run at 19 readers. At `--derive-page-size 0` that held a peak
  120-second mean of **6.3** searches in flight. Read it against the rungs and
  the cap in `packages/runtime-common/search-bounds.ts`: that run cost about
  three readers per unit of mean, so the lower rung at 4 wants roughly 13
  readers and the upper one at 12 roughly 36, **per replica**. So a pool of
  this size already clears the lower rung, while the upper rung and the
  admission cap still need one several times larger. Those are a floor, not an
  estimate — the scaling is linear only while service time holds, and service
  time is what rises first as a realm saturates. Growing the pool is the only
  fix, and it is what puts the admission queue under enough pressure to shed.

  The reading is also a count and not a cost: `inFlight` moves once per
  admitted search whatever that search is doing. An unbounded derived workload
  reaches a given mean with far fewer requests than ordinary traffic does, so
  two runs' readings are comparable only at a similar workload shape.

- **Does the mechanism work?** That does not need the load. The rungs are
  thresholds on the load reading, settable per environment —
  `LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD`, `LINK_SHAPE_ALL_ENGAGE_THRESHOLD`
  and the matching `_RELEASE` pair. Lower them on a non-production fleet for
  the duration of a run and a real deployment goes through both transitions,
  the dwell, the hysteresis band and the validator and cache-variant
  fragmentation each transition causes, at a load the existing pool produces.
  What each threshold means, the per-replica caveat, and the sequence for
  setting one are in `search-shape-diagnosis` — they arrive as SSM parameters
  read once at container start, so writing a parameter changes nothing until a
  deployment applies it.

**How to tell**, in order of authority:

- `boxel:link-shape-policy` — one record per transition plus a 60-second
  heartbeat. The heartbeat is the only line that separates a policy that
  declined from one that is not running, so read it before drawing anything from
  an absence of transitions.
- `boxel:search-shape` — per request: `linkMode`, `linkModeDowngraded`,
  `linkShapeLevel`, `linkShapeLoad`. Where a specific degraded response and the
  reading that degraded it can be seen together.
- The run's own `concurrency:` summary line — the peak of the same mean plus the
  highest count open at one moment, measured from the driver over the window the
  line names (pass `--load-half-life-ms` to match a target that overrides
  `LINK_SHAPE_LOAD_HALF_LIFE_MS`, or the two are not one measurement); the
  `load=` progress line carries the mean's current value while the run is still
  going. Both bound what one replica saw of this traffic **from above**: the
  fleet divides the requests across replicas, and a request counts as in flight
  here while its body crosses the network, after the server released the slot.
  So under a threshold is evidence the run did not reach it; over one is not
  evidence that it did.

## Reading the server side

The harness's own numbers are the client's view. The ones that decide whether a
change landed come from the realm server:

- `heapMB` — a single in-flight search costs tens of megabytes
- `eventLoopLagMs` — saturation shows here long before any response stops being
  a 200

Its `inFlightSearch` is a point sample taken every five seconds, so it swings
across the whole range a run touches — the evidence block above shows 0-30 over
one window — and no single value answers either question the thresholds pose:
the policy acts on a two-minute mean rather than on any sample, and the cap is
about the peak rather than the typical. Take concurrency from the two log
channels and the run's own summary line above.

Every search the harness issues carries an `x-boxel-logging-correlation-id`,
which the realm server logs as `corr=<id>`, so an individual slow request joins
to the server's own `realm:search-timing` and `realm:requests` (`dur=`) lines
rather than being inferred. Pull those with `tail-logs`; pull metrics and ECS
state with `aws-access`.

## Procedure

1. `aws-access` for the session; confirm the deploy rolled (`rolloutState`
   `COMPLETED`, `updatedAt` before the run).
2. `setup-realm.ts` to clone the realm under test, then grant the other users
   read access. Skip this when pointing at an existing experiments realm you are
   willing to dirty, or run with `--writers 0`.
3. Pick the path: `--fieldset item` for a query-backed-field investigation,
   the default `entries` for a grid. Getting this wrong measures the other code
   path and is off by four to six times.
4. Pick the workload: `workload.experiments.json` for a comparable number,
   `--derive-workload` for the realm you actually care about, a hand-written
   file for a specific card's query pattern. A derived one cannot express a
   predicate, so it cannot measure a mitigation that adds one.
5. Get the driver in-region, with the credential file.
6. Run. Start without `--subscribe` for server-load questions; add it when the
   question is about re-run volume.
7. Read the per-shape KB column first, `headers` second, and the health-sampler
   signals over the same window third. If the body-transfer warning printed, the
   latency numbers are about your connection.
8. Delete the credential file from wherever you uploaded it.

## Safety

The harness refuses to run against any `boxel.ai` host, with no override flag.
It drives a realm server to saturation on purpose; doing that to production is
an outage for real users. If a run needs to target something the guard rejects,
the answer is a different target, not a patched guard.
