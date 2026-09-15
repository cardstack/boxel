---
name: realm-load-harness
description: Run and interpret the realm load harness (`packages/realm-server/scripts/load-harness/`) — a dependency-free driver that authenticates N real Matrix users against a non-production realm server, holds unbounded `_federated-search` queries open from `--readers` sessions while `--writers` sessions POST cards into the same realm, and reports per-query-shape payload bytes, split headers-vs-body latency, write latency, and (under `--subscribe`) realm-event re-run counts. Covers (1) reproducing a saturation incident — many concurrent dashboards plus a steady write rate — so the realm server's own `inFlightSearch` / `heapMB` / `eventLoopLagMs` health-sampler signals can be read under load; (2) A/B-ing a payload, throttle, or admission-control change across a deploy, where the trustworthy signal is the per-shape KB column and NOT wall-clock, because a driver outside the realm server's AWS region measures its own connection (an out-of-region run read 6,101 ms p50 end-to-end against 225 ms of actual server time; the same run in-region reads 521 ms); (3) confirming a deploy actually finished before comparing two runs — matching image tags prove nothing, `aws ecs describe-services … deployments[0].rolloutState` must read `COMPLETED` with `updatedAt` earlier than the test start, and skipping this check has produced a confidently-wrong conclusion; (4) measuring rather than modelling the live-search fan-out with `--subscribe`, which reads `app.boxel.realm-event` over Matrix `/sync` and applies the host's `#indexEventCannotMatch` skip test — with the caveat that the harness compares type keys literally where the host resolves them through its module loader, so its re-run counts are indicative and quoting them as the host's behaviour produces a wrong bug report; (5) exercising the per-user cost lock with `--model-calls`, which forwards through `_request-forward` to a refused destination so no tokens are spent while the `withUserCostLock` contention is real (a `400` in the response tally is expected); and (6) writing a workload file — the query shapes and write card, transcribed from the realm's card source into the `_federated-search` entry wire grammar where the type anchor is `item.on` and field paths carry an `item.` prefix. Also covers the credential CSV (`username`, `initial_password`; never commit one, never log a password) and the requirement that each reader join its invited Matrix session room or it receives no events at all. Use when asked to load-test, stress, or saturate a realm server, to reproduce a search-saturation or heap incident on staging, to measure the payload cost of a dashboard's query set, or to check whether a search/payload change moved the numbers. The AWS session, ECS/CloudWatch reads, and log pulls this skill depends on come from `aws-access` (a prerequisite for anything deployed) and `tail-logs`; the browser-side half of a slowness complaint — what the client did with the bytes once they arrived — is `client-perf-diagnosis`, which this harness deliberately cannot see.
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

- **`headers`** — the server deciding what to send, plus one round trip. This is
  the platform number.
- **`body`** — bytes crossing the network. This is your connection.

It prints a warning when the body leg takes more than half the end-to-end time.
Treat that warning as "these latency numbers are not about the realm server".

**Byte counts are trustworthy regardless of where the driver runs; latency is
not.** So a payload change can be evaluated from anywhere, but a latency claim
cannot.

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

Each writer generates before it saves, the way a card that calls a model does.
The call goes to `_request-forward` with a destination the realm server refuses,
so **no tokens are spent** — but it passes auth and takes the per-user cost
lock, held for the whole upstream call, which is the contended resource. A `400`
(or `403`) in the response tally is the expected shape, not a failure: the
request reached the handler and was rejected at the destination allowlist.

Without this flag a driver never sees the queueing where one user's second write
waits out their first.

## Credentials

A CSV with `username` (the Matrix localpart) and `initial_password` columns;
other columns are ignored. **Never commit one** — the directory's `.gitignore`
refuses `*.csv` — and never log a password; the harness reports login failures
by status and error code only.

Each simulated session authenticates as its own user. Searches authorize per
realm and the cost lock is keyed by Matrix user, so a single shared account
reproduces neither.

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
  headers p50    663 ms      ← the platform number
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

Server side over the same window, from the realm-server health sampler:

```
inFlightSearch   0–30
heapMB           peak 1180
eventLoopLagMs   max ~500
```

A throttle or payload change that works shrinks the shapes above 1 MB, and
`headers` should follow. Compare **ratios** — searches per minute, heap per
in-flight search — rather than absolute ceilings whenever two environments with
different memory limits are being read together.

## Reading the server side

The harness's own numbers are the client's view. The ones that decide whether a
change landed come from the realm server:

- `inFlightSearch` — what admission control has to bound
- `heapMB` — a single in-flight search costs tens of megabytes
- `eventLoopLagMs` — saturation shows here long before any response stops being
  a 200

Every search the harness issues carries an `x-boxel-logging-correlation-id`,
which the realm server logs as `corr=<id>`, so an individual slow request joins
to the server's own `realm:search-timing` and `realm:requests` (`dur=`) lines
rather than being inferred. Pull those with `tail-logs`; pull metrics and ECS
state with `aws-access`.

## Procedure

1. `aws-access` for the session; confirm the deploy rolled (`rolloutState`
   `COMPLETED`, `updatedAt` before the run).
2. `setup-realm.ts` to clone the realm under test, then grant the other users
   read access.
3. Write the workload file: transcribe the queries out of the card source, in
   the entry wire grammar. A workload that asks for less than the screen does
   measures nothing. `workload.example.json` is the shape.
4. Get the driver in-region, with the credential file.
5. Run. Start without `--subscribe` for server-load questions; add it when the
   question is about re-run volume.
6. Read the per-shape KB column first, `headers` second, and the health-sampler
   signals over the same window third. If the body-transfer warning printed, the
   latency numbers are about your connection.
7. Delete the credential file from wherever you uploaded it.

## Safety

The harness refuses to run against any `boxel.ai` host, with no override flag.
It drives a realm server to saturation on purpose; doing that to production is
an outage for real users. If a run needs to target something the guard rejects,
the answer is a different target, not a patched guard.
