# Realm-server health signals

The realm-server is a single Node process with a single event loop. Every request
it serves — every JSON:API serialization, every `loadLinks` fan-out, every search
result assembly — competes for that one thread. Under enough concurrent load the
loop turns late, and everything on it waits, including whatever is asking whether
the server is healthy.

That makes "is this server healthy?" two different questions with two different
right answers, and confusing them is expensive. This document is about which
signal answers which question, and what to do with each.

## The three signals

### `GET /` — the load balancer's check

`healthCheck` in `packages/realm-server/middleware/index.ts` answers `OK` from
memory to any request whose user-agent starts with `ELB-HealthChecker`, ahead of
the host-app and realm-serving middleware. It touches no database, no filesystem,
and no realm state.

It is served **by the event loop**, so it answers only when the loop has capacity
to answer. That is what makes it the right signal for routing: a target that
cannot answer this cannot serve a user's request either, and traffic should go
elsewhere.

### `GET /_liveness` — the wedge check

Served off a `worker_threads` worker bound to `127.0.0.1` on the port given by
`--livenessPort`, from `packages/realm-server/liveness/`. The main thread writes a
monotonic reading into a `SharedArrayBuffer` on a 250ms interval; the worker reads
it and reports its age:

```
{ "alive": true, "heartbeatAgeMs": 41, "wedgeMs": 30000 }
```

200 while the age is within `wedgeMs`, 503 past it. `REALM_LIVENESS_WEDGE_MS`
tunes the threshold, with a 5s floor. The clock is `process.hrtime.bigint()`
rather than wall time, so an NTP or hypervisor step can neither age a fresh beat
into a false wedge nor rejuvenate a stale one.

Because the answer comes off a different thread and depends on nothing but shared
memory, it is available exactly when `GET /` is not. And because the value it
reports is a measurement the main thread itself produced, it distinguishes the two
cases `GET /` cannot tell apart:

| Main loop               | `GET /`   | `/_liveness`                       |
| ----------------------- | --------- | ---------------------------------- |
| idle or busy, turning   | 200       | 200                                |
| saturated, turning late | times out | 200, with a large `heartbeatAgeMs` |
| stopped turning         | times out | 503                                |

Both middle and bottom rows look identical to a load balancer. Only the bottom one
is worth a restart.

What the beat proves is that the timers phase runs — not that the process can
accept a connection or make useful progress. A server thrashing on a near-full
heap, or out of file descriptors, still beats and still answers 200. That is
tolerable because the ALB check keeps its own replacement power over exactly
those cases, but it is a reason not to over-trust a 200 here on its own.

### The `realm:health` log line

`health-sampler.ts` samples `monitorEventLoopDelay` every 5s and logs when peak
lag crosses a threshold or a search is in flight:

```
eventLoopLagMs(mean/p99/max)=… inFlightSearch=… heapMB=…
```

Silent on an idle, healthy server — so its presence in the logs is itself the
signal. Lag climbing in step with `inFlightSearch` is the fingerprint of the loop
being starved by concurrent search serialization.

## An event-loop-gated failure is honest

When the loop is saturated and the load balancer's check times out, the check is
not broken and it is not lying. A server that cannot answer a request from memory
cannot serve a card either. The check must never be made to answer from somewhere
that isn't subject to the same constraint as real traffic — a check that stays
green through an outage is worse than no check.

What is wrong in that situation is the **reaction**. On ECS, an unhealthy target
gets its task replaced, and replacing a saturated realm-server does not relieve the
saturation: the replacement starts with an empty definition and transpile cache,
pays every miss again, and lands in the same load. Under sustained load that is a
loop, and each turn of it is slower than the last.

So the fix for a saturated server is never to soften the check. It is to bound the
work (`packages/runtime-common/search-bounds.ts` caps page size and wall-clock per
item-leg search), to tolerate the transient (health-check timeout and unhealthy
threshold set wide enough that a blip cannot cross them), and to restart only for a
loop that has genuinely stopped.

## Why there are two signals instead of one

Kubernetes splits this natively: a failed readiness probe removes a pod from
service without restarting it, a failed liveness probe restarts it. ECS has no
equivalent split. It has two health signals — the ALB target-group check and the
container `healthCheck` — and **both** replace the task when they fail. There is no
"stop routing but keep this task".

The two signals approximate the split as closely as ECS allows:

- The **ALB check** (`GET /`) drives routing and deregistration, with its timeout
  and unhealthy threshold set wide enough that transient saturation cannot cross
  them.
- A **container `healthCheck`** curls `/_liveness` on the loopback port and
  decides replacement, on a signal that only a stalled loop trips.

The container check lives in the task definition, not in this repo. The
realm-server serves the endpoint whenever `--livenessPort` is set, whether or not
anything is checking it — so the presence of the endpoint does not by itself mean
the trigger is wired up.

The parameters matter as much as the endpoint. Replacement should require the
endpoint to say "wedged" several times over: at 30s intervals with 3 retries, on
top of the endpoint's own 30s threshold, that is roughly two minutes of a loop
that has not turned. A `startPeriod` is required — there is a window early in boot
where the module graph is still evaluating and nothing is listening yet, and every
check in it is refused.

The probe should also fail _open_: only an affirmative 503 means unhealthy. A
plain `curl -f || exit 1` treats a refused connection the same as a wedge, which
turns a responder that failed to bind into a task-replacement loop — and outside a
deployment there is no circuit breaker to bound it. The endpoint is an operational
signal, and losing it should cost the signal, not the service.

The result is not a true readiness/liveness split — a saturated target is still
eventually deregistered, and a broad flood still produces 5xx at the load balancer.
What it buys is that transient saturation stops causing task replacement, so
recovery once load abates is fast instead of being fought by a cold cache.

`/_liveness` binds IPv4 loopback only, so it is reachable from inside the task and
nowhere else. Under `awsvpc` every container in the task shares that network
namespace, so any sidecar can reach it too. It is unauthenticated, which is why it
stays off the routable address. Point checks at `127.0.0.1` rather than
`localhost`, which can resolve to `::1` first.

## Operating

**Ship the endpoint before wiring a check at it.** With a fail-open probe an
unreachable endpoint reads as healthy, so getting this backwards is not
destructive — but the check is then silently inert, reporting green on a server
nobody is watching for wedges. Verify `curl 127.0.0.1:<port>/_liveness` from
inside a task before trusting the trigger, and on rollback expect the same
inertness rather than an outage.

**A responder that is not answering is invisible by design.** A bind failure or a
dead responder thread leaves serving untouched — that is the intent — so the only
notice is a `realm:liveness` log line and a Sentry report. Those are the signal
that wedge detection has stopped working; nothing else will say so.

**When `GET /` starts failing**, read `realm:health` for the same window before
concluding anything:

- Lag in the hundreds of ms to seconds, `inFlightSearch` elevated → saturation. The
  server will recover when load drops. Look for what is generating the load;
  restarting makes it worse.
- Lag low, heap flat, but checks failing anyway → not saturation. Look at what sits
  between the load balancer and the process.
- No heartbeat at all and `/_liveness` returning 503 → the loop has stopped.
  Replacement is the correct response.

**Load that loops back through the public load balancer** — internal fan-out that
resolves cross-realm links or re-enters `_search` through the external address —
counts twice against the same event loop, and turns a degraded server into a source
of its own load. Traffic that does not need to leave the process should not.

## Note on naming

`livenessCheck` in `packages/realm-server/middleware/index.ts` is a different thing
from the endpoint described above: a trivial loop-served 200 used by the
worker-manager and prerender apps. It answers "this process is listening", which the
event loop must be free to say. `/_liveness` answers "this process's event loop is
turning", which is only meaningful when asked from off that loop.
