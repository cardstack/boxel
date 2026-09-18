# Realm load harness

Drives a non-production realm server with the load a cohort of users produces:
many readers holding unbounded dashboard queries open while a few writers commit
cards into the same realm.

## Why it is shaped this way

The load is **write-driven**, which is the part most easily got wrong. Opening a
dashboard issues a set of whole-table searches and then writes cards back. Each
write invalidates the index, the realm broadcasts it, and every connected client
re-runs its live searches, because an index event carries invalidated URLs and a
generation — a client cannot tell whether its query's membership changed without
asking again.

A read-only replay reproduces none of that. The harness drives writes.

## What it reproduces and what it does not

The final hop — invalidation reaching a browser and re-running its live searches
— happens in the host's live-search resources. The harness has no browser, so by
default it **models** that hop: when a writer's write lands, every reader re-runs
its whole query set, which is what the host would do.

So it faithfully reproduces **what the server experiences**, and is the right
tool for admission control, per-search heap cost, and write latency under read
load. It cannot validate a change to the fan-out itself, because such a change
edits the very client code the model stands in for. `--subscribe` (below) closes
part of that gap; real headless sessions driving real cards close the rest.

## Setup

Credentials come from a CSV with `username` and `initial_password` columns —
`username` being the Matrix localpart. Passwords are read, passed to Matrix
login, and never logged, never written to disk, never put in an error message.
**Never commit a credential file**; the `.gitignore` here refuses `*.csv` so a
file dropped in this directory cannot be added by accident.

```sh
node setup-realm.ts --csv ./accounts.csv --source ../some-realm-checkout
```

That creates the realm as the credential file's first user, pushes the realm
contents, and waits for the index. `--dry-run` prints the `boxel` commands
without running them; `--skip-push` re-runs just the create and wait steps. This
step needs the `boxel` CLI on `PATH`, so it runs from a workstation rather than
from the in-region box that runs the driver.

**One manual step remains.** The other users need read access to the realm.
Granting it is not a `boxel realm` subcommand, so it is a UI action or a direct
API call. Each session authenticates as its own user: searches authorize per
realm and realm events are broadcast into each user's own session room, so a
single shared account reproduces neither.

## Choosing a path: which document the searches ask for

This is the most consequential choice in a run, and it is not the one about
which types get queried. `_federated-search` serves two shapes from the same
filter, selected by the `fields[entry]` sparse fieldset:

| `--fieldset`        | on the wire                          | what comes back                         | models                                 |
| ------------------- | ------------------------------------ | --------------------------------------- | -------------------------------------- |
| `entries` (default) | no fieldset                          | prerendered renderings (`html` + `css`) | a grid, card list, or the search panel |
| `item`              | `fields: { entry: ['item'] }`        | card serializations only                | a query-backed field                   |
| `item-html`         | `fields: { entry: ['item','html'] }` | both                                    | —                                      |

They are not close in cost. Measured against a deployed realm at the same filter
and page size, the renderings run four to six times the card data — 94 KB
against 405 KB and 537 KB for two types.

**`item` is the query-backed-field path.** `store.search` sends
`fields: { entry: ['item'] }` and instantiates cards live from the result, so a
workload modelling query-backed fields has to pin `item`. The default measures a
grid instead, whatever the workload's queries say.

A workload file pins it with a `"fieldset"` member; `--fieldset` overrides the
file. Both committed workloads pin one, and every run states the path it
modelled in its header and its summary — a figure quoted without its path is not
interpretable.

A file that pins none is **refused**. A default is recorded nowhere, so a figure
produced under one cannot be read back to the document it describes; the refusal
names the member to add and the flag that states it for a one-off run instead.
An emitted workload carries the path the deriving run resolved, so re-running
that file is the same run rather than a different one at four to six times the
bytes.

## Choosing a workload

Which queries the readers issue, and what the writers write, is data rather than
code — the shapes that matter belong to whichever realm is under test. There are
three ways to get them, in increasing order of specificity.

### 1. The standard workload (start here)

`workload.experiments.json` targets the experiments realm, which ships in the
repo as `packages/experiments-realm` and exists in every deployed environment.
It is the one realm everybody can point at, so it is how you get a number
comparable to someone else's without exchanging anything:

```sh
node run-load.ts --csv ./accounts.csv --realm <experiments realm url> \
  --workload ./workload.experiments.json
```

Its types are the realm's highest-count instance types, picked by count rather
than by interest, so the set tracks where the cost actually is.

**Comparable across runs against the same target, not across targets.** The
realm in the repo and a realm deployed from it are not guaranteed to hold the
same instances, and nothing keeps them in step — the file records both counts
side by side. Compare an environment against its own earlier run.

The writers post an `Author`, which is in the read set, so each write
invalidates a query the readers are running.

**On a deployment, `--writers 0` is usually the only run that works.** The shared
realms an ordinary user can reach are granted read-only, so writers against them
fail at the first POST. Take a clone with `setup-realm.ts` if you want the
write-driven load; otherwise run read-only and read the payload and latency
columns.

**Know the cost before a long run.** The realm sizes these queries, and it is not
a realm you sized. Bounded at 20 cards, the six largest shapes on a deployed
realm total roughly 2.2 MB per pass; unbounded, as the standard workload has
them, they are larger again. Every reader fires the whole set on each re-run, so
multiply by `--readers` and the re-run rate. The summary prints the exact
per-pass total for the run you did — read it after a short run before committing
to a long one, particularly from CloudShell.

### 2. Derive one from the realm you care about

`--derive-workload` reads the realm's own `GET <realm>/_types` summary, ranks it
by instance count, and queries the top `--derive-top` (default 8) types. This is
the answer to sharing a config: don't share one, derive it from the target.

```sh
node run-load.ts --csv ./accounts.csv --realm <url> --derive-workload
```

`--derive-page-size` (default 20) bounds every derived query; `0` leaves them
unbounded. Because the standard workload above is unbounded, a derived run and a
standard run are not comparable to each other.

**A derived run that leaves the default page in place loads almost nothing.**
Measured against a deployed realm of roughly 2,650 instances at `--fieldset
item`, the same derived workload:

| page               | readers |      rate | concurrency |
| ------------------ | ------: | --------: | ----------: |
| `page: {size: 20}` |      10 |   602/min |         1.2 |
| `page: {size: 20}` |      19 | 1,850/min |         1.2 |
| unbounded          |      19 |   298/min |         5.3 |

Six times the request rate produced a quarter of the load. In-flight is rate
multiplied by service time, and service time is the term that moves — so
**request rate on its own is not a load signal**. Per search the gap is wider
than the table's rows suggest: dividing each row's load by its rate, an
unbounded search costs about nine times what a page-bounded one does, which is
why 19 readers on the bounded workload sit at the load 10 readers produced.
Pass `--derive-page-size 0` whenever the question is about load rather than
about a bounded screen.

**A derived workload is the unmitigated shape, by construction.** It produces
type-only queries with no predicate — a whole-table read per type — because the
type summary is all it has to go on. That makes it a faithful reproduction of
the problem and useless as a measurement of a fix: if the change under test is
"push a client-side predicate into the query", a derived workload cannot express
it. Emit one, add the predicates by hand, and A/B the two files.

To turn a derived workload into a shared one, emit it and commit the file:

```sh
node run-load.ts --csv ./accounts.csv --realm <url> --derive-workload \
  --emit-workload ./workload.mine.json     # '-' writes to stdout
```

That writes the file and exits without running, so the run you do next is
reproducibly the one in the file. Realm-local modules come out as `${realm}…`,
so the file travels between clones. Check the `write` block before committing:
its attributes are empty, because the type summary reports counts and not field
schemas.

**A derived workload can come back read-only.** The write target has to be a type
defined in the realm itself — an external module is not addressable relative to
the realm, so a POST naming one would be a guess discovered at write time. When
none of the selected types is realm-local, the `write` block is omitted, the
reason is printed on stderr naming the types that did rank, and the run needs
`--writers 0`. That is the normal outcome on a deployment's shared realms, whose
top types all come from `@cardstack/…`.

`_types` needs the same per-realm JWT the searches use — a bare realm-server
session token gets a 401. A failure here stops the run rather than falling back
to a built-in workload, because two people believing they ran the same test and
not having done is worse than a failed run.

### 3. Write one by hand

When you are reproducing a specific card's query pattern, transcribe it.
`workload.example.json` is the shape, filled with placeholders.

**Transcribe out of the card source** — the `load()` / `loadData()` bodies, the
query-backed fields — rather than inventing a plausible set. What a run measures
is the cost of the queries a real screen issues; a workload that asks for less
than the screen does measures nothing.

A filter is passed through whole, so `eq` / `contains` / `range` / `any` sit
alongside the `item.on` anchor untouched — which is how a run A/Bs adding a
predicate to a query that has none. `workload.example.json` carries committed
examples of all three.

### The wire grammar

Queries are written in the `_federated-search` **entry wire grammar**, not the
card-query grammar cards are written in. The host translates on the way out
(`searchEntryWireQueryFromQuery`): the type anchor `type` / `on` becomes
`item.on`, and every field path inside `eq` / `contains` / `in` / `range` gains
an `item.` prefix. The card spelling gets a 400 back. Everything alongside
`label` is sent to the endpoint as-is, so `sort` and `page` work too.

`${realm}` expands to the realm URL under test, so one file travels between
clones of the same realm. Write attributes additionally expand `${n}` (a
per-writer counter, so successive writes differ and each has something to
invalidate) and `${date}`.

### Asking more than one question per shape

A shape with a fixed filter asks the same question on every re-run, and the
realm answers a repeated query from its live-search cache. Measured against a
deployed realm, the same query six times reads miss, miss, miss, miss, **hit
48 ms**, **hit 50 ms** — so past the first pass such a run reports what a cache
hit costs, not what answering costs. The signature is latency _falling_ as the
rate rises.

`variants` is the spread a shape asks over: filter fragments merged over its own
filter, one per re-run.

```json
{
  "label": "Observation(by day)",
  "filter": {
    "item.on": { "module": "${realm}schema/observation", "name": "Observation" }
  },
  "page": { "size": 100 },
  "fields": { "entry": ["item"] },
  "variants": [
    { "eq": { "item.obsDate": "2026-09-14" } },
    { "eq": { "item.obsDate": "2026-09-15" } },
    { "eq": { "item.obsDate": "2026-09-16" } }
  ]
}
```

The index advances per re-run and is offset per reader, so readers running
concurrently ask different questions. In step they would issue one identical
query and the first answer would serve the rest from cache, which is the
behaviour variants exist to avoid.

Two things to get right:

- **Pick values that match rows.** A fragment selecting nothing is a cheap
  search, and a set of them reports a realm answering instantly while measuring
  none of the work the shape does when it has an answer.
- **Model the spread the screen has**, not an arbitrary one. A dashboard whose
  day-scoped queries walk a term has one variant per day; a list filtered by
  status has one per status. The `spread:` line in the summary reports how many
  distinct questions the run asked, alongside the path it measured.

A shape that names no variants is sent exactly as before, so adding the member
to one query changes nothing about the others.

## Running

```sh
node run-load.ts --csv ./accounts.csv \
  --realm https://realms-staging.stack.cards/<owner>/load-test/ \
  --workload ./workload.experiments.json
```

| Option                | Default | Meaning                                                                         |
| --------------------- | ------: | ------------------------------------------------------------------------------- |
| `--readers`           |      12 | Sessions that only search.                                                      |
| `--writers`           |       2 | Sessions that write, and search not at all. `0` is a read-only run.             |
| `--minutes`           |      10 | Run length. `Ctrl-C` ends early and still prints the summary.                   |
| `--write-every-ms`    |   20000 | Per-writer write interval — this sets the invalidation rate, which is the load. |
| `--idle-re-run-ms`    |   60000 | Floor, so readers still poll a realm nobody is writing to.                      |
| `--secondary-every`   |       3 | Every Nth reader also opens the workload's `secondaryQueries`.                  |
| `--extra-queries`     |     off | Also issue the workload's `extraQueries`.                                       |
| `--derive-workload`   |     off | Build the workload from the realm's own `_types` instead of a file.             |
| `--derive-top`        |       8 | How many types a derived workload queries.                                      |
| `--derive-page-size`  |      20 | Page size for derived queries; `0` leaves them unbounded.                       |
| `--emit-workload`     |       — | Write the derived workload here and exit. `-` is stdout.                        |
| `--fieldset`          | entries | Which path to measure: `entries` \| `item` \| `item-html`.                      |
| `--prime-connections` |      on | Open each batch's connections before timing it. `=false` disables.              |
| `--model-calls`       |     off | A forwarded request before each write (see below).                              |
| `--subscribe`         |     off | React to real realm events instead of modelling them (see below).               |
| `--load-half-life-ms` |  120000 | The window the target smooths its in-flight reading over.                       |

`--model-calls` puts a `_request-forward` call before each write, the position a
card that generates before saving occupies. The destination is one the realm
server refuses, so it costs no tokens.

**Know how far it gets.** `handleRequestForward` verifies the JWT, parses the
body, and looks the destination up in `AllowedProxyDestinations` — a
`proxy_endpoints` read cached for five seconds per replica — and rejects there.
That lookup sits in front of `withUserCostLock`, so a refused destination never
takes the per-user cost lock, and this flag does **not** reproduce the
serialization where one user's second generation waits out their first. Reaching
the lock takes an allowlisted destination, which means real spend and real
upstream latency. What the flag does add is a second authenticated round trip
per write, at the realm server and at the database. A `400` in the response
tally is the expected shape.

`extraQueries` is the place for a narrowed counterpart to one of the unbounded
shapes, so a single run measures the same question asked both ways — the
cheapest available demonstration that moving a filter server-side is worth doing.

## Measuring invalidation rather than modelling it

By default a reader re-runs its queries whenever this driver makes a write. That
models the fan-out: it produces realistic load, but the decision to re-run is the
harness's own, so a client-side change that makes browsers skip re-runs cannot
show up in the numbers.

`--subscribe` reads the realm's actual event stream instead — the same
`app.boxel.realm-event` messages the host receives over Matrix — and applies the
host's own test: an index event names the types it invalidated, and a query whose
types are disjoint from that set does not re-run. The run then reports how many
re-runs were performed against how many were skipped.

Two things it depends on:

- **A reader must join its session room.** `_realm-auth` creates each user's DM
  session room and _invites_ them to it. An invited-but-not-joined user receives
  nothing — a browser joins during its Matrix startup, so the harness does too. A
  session with no room is reported rather than left to look like a quiet realm.
- **The skip test here is simpler than the host's.** The host resolves a query's
  type keys through its module loader, so a filter naming a type through a
  re-exporting module still matches rows stamped with the canonical spelling.
  This compares the literal `module/name`. For a realm whose cards name their
  types directly the two agree; for one that filters through re-exports, this
  skips where a browser re-runs, and understates traffic. **Quote the re-run
  counts as indicative, never as the host's behaviour.**

## Run it where the numbers mean something

**Run the driver inside the same AWS region as the realm server.** This is not a
nicety. A run from a laptop measured 6.1 s end-to-end at p50 while the realm
server's own request duration for the same window was **225 ms** — 96% of what
looked like platform latency was the observer's connection pulling hundreds of
kilobytes per response across the internet. Reporting the first number as a
platform result would have been wrong by a factor of twenty-seven.

The harness splits the two so this cannot be misread silently: `headers` is the
server deciding what to send plus one round trip, `body` is bytes crossing the
network. It prints a warning when the body leg dominates. **Byte counts are
trustworthy regardless of where the driver runs; latency is not.**

### `headers` also has to exclude connection setup

`fetch` resolves when response headers arrive, and if the request had to open a
socket first that promise covers a TCP handshake and a TLS handshake too.
Readers re-run on an interval far longer than undici's keep-alive, so on a realm
nobody is writing to — what `--writers 0` makes normal — nearly every sample
would open a connection inside the timed window and report the setup as server
work. Measured against a local server: with priming disabled 59 of 60 timed
searches opened a connection, and with it on, 0 of 60.

So the driver opens the connections a batch will use **before** starting the
clock. It primes with the batch's own concurrency, because N concurrent requests
want N sockets and undici hands a request to an already-free client in
preference to opening another — priming with a single request would funnel the
whole batch down one socket and change the concurrency being measured. The
primer is a CORS preflight, which `@koa/cors` answers ahead of the router, so it
costs the server nothing beyond the connection it exists to open.

At startup the driver measures what a cold socket costs on this link and prints
it, so the correction is visible either way. `--prime-connections=false` turns
priming off, and `headers` is then labelled as including setup, because it does.

That measurement has the same trap in it. The first request after a process
starts is cold, but so is the second — the socket has not returned to the pool
yet — so a naive cold-minus-next subtraction compares two handshakes against
each other and reports the jitter between them. Against a control server
charging a known 295 ms handshake, that spelling reports **11 ms**; taking the
warm figure as the cheapest of several samples, after a yield, reports
**296 ms**. Both raw samples are printed alongside the difference so a wrong
subtraction is visible rather than authoritative.

Even primed, `headers` is still one round trip away from the server's own
duration. **Compare runs from the same place**, and take the server's own timing
when you need its absolute number.

`headers` also rises with `--readers`. That is the server under concurrent load,
which is the thing being measured — not an artifact to correct for. Hold the
reader count fixed when comparing two runs.

The driver is dependency-free — global `fetch` and `node:` built-ins only — so
getting it into the region is a copy, not a build:

```sh
zip -r harness.zip load-harness
# upload harness.zip and the credential file to CloudShell in the right region
unzip -o harness.zip && cd load-harness
node -v   # needs a Node that runs .ts directly: 24.x, or 22.18+
NODE_NO_WARNINGS=1 node run-load.ts --csv ../accounts.csv --realm … --workload …
```

Any box in the region works — an EC2 instance, a CloudShell session, an ECS
task. What matters is that it is not on the far side of a home connection.
CloudShell's home directory persists, so delete the credential file when the run
is done.

Each search is stamped with an `x-boxel-logging-correlation-id`, which the realm
server logs as `corr=<id>`, so an individual slow request can be joined to the
server's own timing rather than inferred.

## Driving it hard enough to reach a threshold

The realm server has two mechanisms that engage at a level of concurrency: the
admission gate bounds in-flight searches at a cap, and the link-shape policy
degrades a live read's link closure one rung earlier, at a time-weighted mean
of the same count (a 120-second half-life by default, `LINK_SHAPE_LOAD_HALF_LIFE_MS`
per deployment). Both are **per replica**, so a fleet of N tasks needs N times
the load a single process would.

The gate does not answer `429` at the cap. An arrival above it queues and is
shed only if no slot frees within the admission wait, so a run can hold a
process at its ceiling and see no shedding at all — a `429` count measures how
long the queue stayed full, not whether the cap was reached.

A run that reaches neither has measured neither, and its summary cannot tell
you which of two things happened: the mechanism declined, or it would not have
engaged had it needed to. The concurrency line in the summary is what makes
that distinction available from the run itself — see below.

**The credential pool is the ceiling.** Each session authenticates as its own
user, one per CSV row, so a 20-row file caps a run at 19 readers. Against a
deployed realm at `--derive-page-size 0`, 19 readers held a peak 120-second
mean of **6.3** searches in flight. Read that against the rungs and the cap in
`packages/runtime-common/search-bounds.ts`: this run cost about three readers
per unit of mean, so the lower rung at 4 wants roughly 13 readers and the upper
one at 12 roughly 36, **per replica**. A pool that reaches the lower rung is
therefore within easy reach, while driving a fleet to the upper rung or to the
admission cap still needs a pool several times larger. Treat those as a floor
rather than an estimate — the scaling is only linear while service time holds,
and service time is what rises first as a realm saturates. Growing the pool is
what makes a load number realistic, and it is what puts the admission queue
under enough pressure to shed.

**Exercising the mechanism is a different question, and much cheaper.** The
rungs are thresholds on the load reading, settable per environment —
`LINK_SHAPE_MULTI_ROW_ENGAGE_THRESHOLD` and `LINK_SHAPE_ALL_ENGAGE_THRESHOLD`,
with `LINK_SHAPE_MULTI_ROW_RELEASE_THRESHOLD` and
`LINK_SHAPE_ALL_RELEASE_THRESHOLD` for the hysteresis band. Lowering them on a
non-production fleet for the duration of a run puts a real deployment through
both transitions, the dwell, the band, and the validator and cache-variant
fragmentation each transition causes, at a load the existing pool can produce.
What it does not do is tell you where the shipped thresholds sit relative to
real traffic, which is the question the pool size answers.

They arrive as SSM parameters resolved once at container start, so writing a
parameter changes nothing until a new deployment applies it. What each
threshold means, and the sequence for setting one, is in the
`search-shape-diagnosis` skill.

**What to read while it runs**, in order:

- `boxel:link-shape-policy` — one record per transition, plus a 60-second
  heartbeat. The heartbeat is the only line that distinguishes a policy that
  declined from one that is not running at all, so read it before concluding
  anything from an absence of transitions.
- `boxel:search-shape` — per request: `linkMode`, `linkModeDowngraded`,
  `linkShapeLevel`, `linkShapeLoad`. This is where a specific degraded response
  and the reading that degraded it can be seen together.
- Status counts from the realm server's own log — `429` / `5xx` / `408`. These
  are vantage-independent, unlike any latency this driver reports. Read a `429`
  count as queue pressure sustained past the admission wait, not as "the cap was
  reached".
- The concurrency line in this run's summary, as a bound (below).

The realm server's health sampler reports `heapMB` and `eventLoopLagMs` over
the same window, and those are worth reading. Its instantaneous
`inFlightSearch` is not a substitute for the above: it is sampled on a cadence
coarser than the bursts it would have to catch, and the policy acts on a
two-minute mean rather than on any one sample, so the two do not agree even
when both are right.

## Reading the results

Read `headers` as the server's work plus a round trip, and `body` as your
connection. The
per-shape byte counts in the summary table are the signal that does not depend on
where the driver ran.

### The concurrency line

The summary reports the concurrency this driver held, in the two forms the
server's thresholds are written in: the peak of a time-weighted mean (what the
link-shape policy decides on) and the highest count open at one moment (what
the admission gate decides on). The mean's window is named in the line itself,
because it is a per-deployment setting rather than a constant — pass
`--load-half-life-ms` to match a target that overrides
`LINK_SHAPE_LOAD_HALF_LIFE_MS`, or the two are not the same measurement. The progress line carries the
current value of that same mean as `load=`, so a run can be steered while it is
still going — readers added, or a page bound dropped.

One thing the figure does not carry: `inFlight` counts searches, not work. A
search is one admission whatever it costs, so a reading of 5 on the unbounded
workload this harness drives stands for far more work than a reading of 5 on a
realm's ordinary traffic. The number is comparable to a server-side threshold
because it is the same quantity the server counts — it is not comparable
between two workloads as a measure of load.

Both are **bounds from above** on what any one replica saw of this driver's
traffic, twice over: the fleet divides these requests across its replicas, and
a request counts as in flight here for as long as its body is crossing the
network, after the server had already released the slot. So a figure under a
threshold is evidence this run did not reach it; a figure over one is not
evidence that it did, and neither accounts for whatever else is reading the
realm at the time. For the server's own reading, take the
`boxel:link-shape-policy` heartbeat.

The realm-server health sampler covers the same window, and two of its numbers
are what a saturation run is about:

- `heapMB` — a single in-flight search costs tens of megabytes
- `eventLoopLagMs` — saturation shows here long before any response is not a 200

Its `inFlightSearch` is a point sample taken every five seconds, so it swings
across the whole range a run touches and its individual values answer neither
question: the policy acts on a two-minute mean rather than on any sample, and
the cap is about the peak rather than the typical. Take concurrency from this
run's own summary and from the `boxel:link-shape-policy` heartbeat instead, as
"Driving it hard enough to reach a threshold" above describes.

Staging and production realm servers have different memory limits, so compare
**ratios** — searches per minute, heap per in-flight search — rather than
absolute ceilings, whenever the two environments are being read together.

## Safety

The scripts **refuse to run against production** — any `boxel.ai` host is
rejected, with no override flag. This drives a realm server to saturation on
purpose; doing that to production is an outage for real users.

## Files

- `setup-realm.ts` — create the realm, push contents, wait for the index
- `run-load.ts` — the driver
- `workload.experiments.json` — the standard workload, for comparable numbers
- `workload.example.json` — the shape of a workload file
- `lib/derive-workload.ts` — ranking a realm's `_types` into a workload
- `lib/auth.ts` — Matrix login → OpenID → `_server-session` → `_realm-auth`
- `lib/workload.ts` — workload loading, the wire grammar, substitution
- `lib/realm-events.ts` — Matrix `/sync` subscription and the host's skip test
- `lib/in-flight.ts` — the concurrency this driver holds, as a mean and a peak
- `lib/common.ts` — credential reading, the production guard, arg parsing, stats

`tests/load-harness-test.ts` in this package covers the pure logic: credential
parsing, the production guard, argument parsing, workload validation and
derivation, and the skip test.
