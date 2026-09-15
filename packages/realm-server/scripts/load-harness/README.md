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
invalidates a query the readers are running. Point it at a realm you are willing
to dirty — a clone made by `setup-realm.ts` — or pass `--writers 0` for a
read-only run.

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

## Running

```sh
node run-load.ts --csv ./accounts.csv \
  --realm https://realms-staging.stack.cards/<owner>/load-test/ \
  --workload ./workload.experiments.json
```

| Option               | Default | Meaning                                                                         |
| -------------------- | ------: | ------------------------------------------------------------------------------- |
| `--readers`          |      12 | Sessions that only search.                                                      |
| `--writers`          |       2 | Sessions that write, and search not at all.                                     |
| `--minutes`          |      10 | Run length. `Ctrl-C` ends early and still prints the summary.                   |
| `--write-every-ms`   |   20000 | Per-writer write interval — this sets the invalidation rate, which is the load. |
| `--idle-re-run-ms`   |   60000 | Floor, so readers still poll a realm nobody is writing to.                      |
| `--secondary-every`  |       3 | Every Nth reader also opens the workload's `secondaryQueries`.                  |
| `--extra-queries`    |     off | Also issue the workload's `extraQueries`.                                       |
| `--derive-workload`  |     off | Build the workload from the realm's own `_types` instead of a file.             |
| `--derive-top`       |       8 | How many types a derived workload queries.                                      |
| `--derive-page-size` |      20 | Page size for derived queries; `0` leaves them unbounded.                       |
| `--emit-workload`    |       — | Write the derived workload here and exit. `-` is stdout.                        |
| `--model-calls`      |     off | A forwarded request before each write (see below).                              |
| `--subscribe`        |     off | React to real realm events instead of modelling them (see below).               |

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

## Reading the results

Read `headers` as the platform number and `body` as your connection. The
per-shape byte counts in the summary table are the signal that does not depend on
where the driver ran.

The numbers that matter most come from the realm-server health sampler over the
same window:

- `inFlightSearch` — what admission control has to bound
- `heapMB` — a single in-flight search costs tens of megabytes
- `eventLoopLagMs` — saturation shows here long before any response is not a 200

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
- `lib/common.ts` — credential reading, the production guard, arg parsing, stats

`tests/load-harness-test.ts` in this package covers the pure logic: credential
parsing, the production guard, argument parsing, workload validation and
derivation, and the skip test.
