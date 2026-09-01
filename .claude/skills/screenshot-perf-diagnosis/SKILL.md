---
name: screenshot-perf-diagnosis
description: Diagnose why a screenshot capture took a given amount of time, from the per-capture stage telemetry the screenshot pipeline emits — one JSON log line per event on the `boxel:screenshot-perf` channel (the same `| json` convention as `boxel:client-perf`), plus the same `capture` breakdown persisted onto the capture's `media_cache_ledger.diagnostics` row so it is readable by SQL. Two event types cover the pipeline's processes — a `request` event from a serving surface (the GET `{realm}_screenshot/…` DSL route or `POST /_screenshot-card`) recording what the caller experienced (hit / rendered / congested / timeout / gated / error) and where the surface wall-clock went, and a `capture` event from the worker's `screenshot-card` task recording queue wait, the prerender stage breakdown, and the persist leg — joined on `jobId`/`reservationId`, joined back to the realm-server's `realm:requests` lines by the `x-boxel-logging-correlation-id` `correlationId`, and joined to the prerender server/manager logs by the `prerenderRequestId`. Covers (1) a "this screenshot was slow" complaint given a served URL, a (realm + cardId + capture spec) triple, a matrix user/session, a time window, or a correlation id — locate the timing record(s) and break the wall-clock across the stages (queue-wait, page-acquire launch-vs-reuse, settle, image-paint wait, `page.screenshot`, persist upload-vs-dedupe-hit, serve) and name the dominant one; (2) separating a ledger hit (zero Chrome work, `outcome=hit`, no `capture` event) from an on-demand render (`outcome=rendered`); (3) separating a congested per-realm lane (a fail-fast `outcome=congested` 503 from the queue-depth pre-check, or a long `jobWaitMs`/`queueWaitMs` behind the serialized `screenshot:{realmURL}` lane) from a genuinely slow render (`renderMs`); (4) separating a cold-pool Chrome launch (`tabReused=false`, high `launchMs`/`tabStartupMs`) from a warm affinity reuse; (5) separating a real S3 upload (`persistOutcome=uploaded`) from a dedupe-on-write hit (`persistOutcome=deduped`); (6) separating a cache miss forced by a generation bump — the card was edited, so a prior `media_cache_ledger` row exists for the same `(realm_url, source_url, capture_spec_hash)` at a lower `source_generation` — from a genuinely new capture spec (no prior row for that `capture_spec_hash`); and (7) recognizing an `outcome=timeout` (the sync wait expired with a 503 + Retry-After; the job keeps running, persists, and the caller's retry becomes a hit) and an `outcome=gated` (the realm's `allowArbitraryScreenshots` gate is closed; existing captures still serve). Reads the "Screenshot Capture Performance" Grafana dashboard (grafanactl name `boxel-screenshot-perf`: capture latency by stage p50/p95, hit-vs-render and queue-vs-render splits, warm/cold page-acquire, persist outcome, sliced by realm and surface). For staging/prod this layers on `aws-access` (the AWS session + SSM port-forward to the read-only DB) and `tail-logs` (the Loki wrapper); hand off to `prerender-sizing` when the bottleneck is pool contention and to `indexing-diagnostics` for the prerender render internals (the `Timings`/`PoolMeta` the render itself records). Use when someone says a screenshot was slow, a capture URL took seconds, a `_screenshot/` request 503'd, or asks why a specific capture cost what it did.
allowed-tools: Read, Grep, Glob, Bash
---

# Screenshot capture performance diagnosis

The screenshot pipeline emits one structured per-capture timing record so a slow capture is explainable rather than a mystery. It is the screenshot-service sibling of `client-perf-diagnosis` (client telemetry) and `indexing-diagnostics` (the indexer's `diagnostics` columns), and it reuses both of their conventions: a `| json` Loki channel **and** a `diagnostics` JSONB blob persisted next to the artifact.

This is the tool for turning "this screenshot was slow" into a stage-attributed breakdown that sums to the wall-clock, plus a plain-language root cause, cited to the exact log line / ledger row it came from.

## The pipeline and where each stage is measured

```
request on a surface ─────────────────────────────────────────────────►  response
  GET {realm}_screenshot/…                                            (hit / rendered /
  POST /_screenshot-card                                               congested / timeout /
        │                                                              gated / error)
        │  gen lookup · ledger lookup · gate(GET) · congestion precheck · enqueue
        │
        └── enqueue ──► [ screenshot:{realmURL} serialized lane ] ──► worker screenshot-card task
                          queue wait                                    │
                                                                        ├─ permissions
                                                                        ├─ prerender call ──► prerender server
                                                                        │    page acquire (launch vs reuse)
                                                                        │    render (nav · settle · imagePaint · screenshot)
                                                                        ├─ base64 decode
                                                                        └─ persist (putMedia: upload vs dedupe)
```

Two event types, both on the **`boxel:screenshot-perf`** channel, defined in `packages/runtime-common/screenshot-perf.ts`:

- **`request`** — emitted by the serving surface when a capture-relevant request completes: the GET `_screenshot/` DSL route (`packages/runtime-common/realm.ts`) or `POST /_screenshot-card` (`packages/realm-server/handlers/handle-screenshot-card.ts`). It records what the caller experienced and how the **surface** wall-clock split. Plain uncaptured-miss 404s and request-shape 400s deliberately do **not** emit — absence of a `request` event for a URL means it never did capture work.
- **`capture`** — emitted by the worker's `screenshot-card` task (`packages/runtime-common/tasks/screenshot-card.ts`) when a job finishes: queue wait, the prerender stage breakdown, and the persist leg. The same record (minus the envelope) is also written onto the capture's **`media_cache_ledger.diagnostics`** row for uploaded/deduped captures, so a completed capture's breakdown is readable by SQL as well as by Loki.

Every `*Ms` field is flat and top-level so LogQL can `unwrap` it directly; the stage fields sum to at most `totalMs` (the remainder is unattributed overhead).

### `request` event fields

Envelope (shared): `eventType="request"`, `surface` (`get-dsl` | `post`), `outcome`, `realmURL`, `sourceURL`, `captureSpecHash`, `sourceGeneration`, `lane`, `correlationId`, `jobId`, `reservationId`, `totalMs`.

| Field                | Stage                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`            | `hit` (ledger hit, ~0 Chrome) · `rendered` (job finished inside the sync wait) · `congested` (fail-fast 503, no job enqueued) · `timeout` (sync wait expired, 503 + Retry-After; job keeps running + persists) · `gated` (403, `allowArbitraryScreenshots` closed, GET only) · `error` |
| `hasTwin`            | congestion pre-check found a queued/in-flight twin to coalesce onto (null when it didn't run)                                                                                                                                                                                          |
| `generationLookupMs` | narrow index read for the instance's live generation                                                                                                                                                                                                                                   |
| `ledgerLookupMs`     | `media_cache_ledger` lookup for the canonical identity (the hit fast-path)                                                                                                                                                                                                             |
| `gateMs`             | GET only: reading the realm's `allowArbitraryScreenshots` config                                                                                                                                                                                                                       |
| `precheckMs`         | the fail-fast congestion pre-check query (`estimateScreenshotQueueWait`)                                                                                                                                                                                                               |
| `enqueueMs`          | publishing the job (incl. coalesce evaluation)                                                                                                                                                                                                                                         |
| `jobWaitMs`          | enqueue → job completion or sync-wait expiry — **the leg that holds queue-wait + render**                                                                                                                                                                                              |
| `serveMs`            | streaming the capture (GET) or draining it to base64 (POST)                                                                                                                                                                                                                            |

### `capture` event fields

Envelope (shared): `eventType="capture"`, `surface`, `status` (`ready` | `error` | `unusable`), `runAs`, `format`, `realmURL`, `sourceURL`, `captureSpecHash`, `sourceGeneration`, `lane`, `correlationId`, `jobId`, `reservationId`, `prerenderRequestId`, `totalMs`.

| Field            | Stage                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueWaitMs`    | enqueue → reservation claim (from the queue's own clock) — **time behind the `screenshot:{realmURL}` lane**                                                          |
| `permissionsMs`  | realm/user permission fetches before the render                                                                                                                      |
| `prerenderMs`    | the whole prerender call (incl. transport to the remote prerenderer)                                                                                                 |
| `launchMs`       | page acquire inside the pool; components `semaphoreMs`, `admissionMs`, `tabQueueMs`, `tabStartupMs`, `tabProbeMs`                                                    |
| `tabReused`      | `true` = warm affinity hit; `false` = **cold-start tax** (a fresh Chrome tab)                                                                                        |
| `renderMs`       | server render wall (navigation → capture bytes); components `navMs`, `settleMs`, `imagePaintMs`, `screenshotMs`                                                      |
| `decodeMs`       | base64 → bytes ahead of persist                                                                                                                                      |
| `persistMs`      | `putMedia` (content hash + object write + ledger upsert)                                                                                                             |
| `persistOutcome` | `uploaded` (new object written) · `deduped` (identical bytes already stored, ledger row only) · `skipped` (no persist target / no store / capture failed) · `failed` |

## Correlation — three processes, one story

- `request` ↔ `capture`: join on **`jobId`** (and `reservationId`). A `hit`/`congested`/`gated` request has no `capture` event (no job ran); its `jobId` is null.
- Either event → the realm-server's own `realm:requests` / `realm:search-timing` lines: join on **`correlationId`** (the request's `x-boxel-logging-correlation-id`).
- `capture` → the prerender server's and manager's logs: join on **`prerenderRequestId`** (`x-boxel-prerender-request-id`; null for an in-process prerenderer).

## Start from the complaint

Resolve the input to `(realmURL, sourceURL)` and, when you can, a `captureSpecHash` / `sourceGeneration`, then pull the record(s).

- **A served URL** `{realm}_screenshot/{path}?{params}` — `realmURL` = the realm root; `sourceURL` = `{realm}{path}` (the instance URL, drop the `_screenshot/` segment); the query params (`format`, `viewport`, `dsf`, `fullPage`, `clip`) are the capture spec. Find `request`/`capture` events for that `sourceURL`, or the `media_cache_ledger` rows for it.
- **A (realm + cardId + capture spec) triple** — `sourceURL` = `cardId` without a trailing `.json`. Same lookups.
- **A matrix user / session** — `capture` events carry `runAs`; filter `| runAs="@user:…"`. `request` events don't carry the user, so pivot user → `correlationId` via the realm-server request log (which has the authenticated user), then to `boxel:screenshot-perf`.
- **A time window** — `--since` / a Grafana range; scope with `realmURL`/`surface`.
- **A correlation id** — filter both event types by `correlationId` to get the request + its capture in one shot.

## Reading the records

Everything below layers on **`aws-access`** for staging/prod (the AWS session, the SSM port-forward to the read-only DB as `claude_readonly_user`, and the Loki auth). Read that skill first for a deployed environment.

### Loki (Grafana Explore, `logcli`, or the dashboard)

`request` events are on `service="realm-server"`; `capture` events come from the worker task, so match `service=~"realm-server|worker"`. Keep the `|=` line filter **ahead of** `| json` — it is load-bearing, exactly as in `client-perf-diagnosis`: without it, `| json` parses every request-log line in the range first and the query times out. In deployed environments each line is firelens-wrapped, so unwrap before the real parse.

```logql
# request events (surface wall-clock + outcome)
{service="realm-server", env="$env"} |= "boxel:screenshot-perf" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:screenshot-perf" | eventType="request"
  | realmURL="<realm>" | sourceURL="<sourceURL>"

# capture events (queue wait + prerender breakdown + persist)
{service=~"realm-server|worker", env="$env"} |= "boxel:screenshot-perf" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:screenshot-perf" | eventType="capture"
  | sourceURL="<sourceURL>"

# pin one capture by its correlation id (both events)
{service=~"realm-server|worker", env="$env"} |= "boxel:screenshot-perf" |= "<correlationId>" | json
  | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:screenshot-perf"
```

The **"Screenshot Capture Performance"** dashboard (grafanactl name `boxel-screenshot-perf`, under `boxel-status`) already renders these with `env` / `realm` / `surface` template vars: requests-by-outcome, request wall-clock, capture latency by stage (p95), the queue-wait-vs-render split, page-acquire by warm/cold tab, persist outcome, and a "slowest captures by card" table. Start there for the shape, drill to raw lines for one capture.

### From a laptop via `tail-logs` (see the `tail-logs` skill)

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --filter 'boxel:screenshot-perf' --since 1h --no-follow
packages/observability/scripts/tail-logs.sh --env staging --service worker \
  --filter 'boxel:screenshot-perf' --since 1h --no-follow
# one capture, both events: substring + regex both apply (|= then |~)
packages/observability/scripts/tail-logs.sh --env staging --service worker \
  --filter 'boxel:screenshot-perf' --regex '<correlationId>' --since 6h --no-follow
```

### Ledger diagnostics by SQL (the durable copy)

The `capture` record (minus the envelope) is persisted onto `media_cache_ledger.diagnostics` for `uploaded`/`deduped` captures — so a completed capture's breakdown survives log retention. The row is keyed by `(realm_url, source_url, capture_spec_hash, source_generation)`; `created_at`/`last_accessed_at` are unix-ms bigints.

```sql
SELECT source_generation, lane, width, height,
       to_timestamp(created_at/1000)        AS created,
       to_timestamp(last_accessed_at/1000)  AS last_accessed,
       diagnostics->>'totalMs'        AS total_ms,
       diagnostics->>'queueWaitMs'    AS queue_wait_ms,
       diagnostics->>'tabReused'      AS tab_reused,
       diagnostics->>'launchMs'       AS launch_ms,
       diagnostics->>'renderMs'       AS render_ms,
       diagnostics->>'settleMs'       AS settle_ms,
       diagnostics->>'imagePaintMs'   AS image_paint_ms,
       diagnostics->>'screenshotMs'   AS screenshot_ms,
       diagnostics->>'persistOutcome' AS persist_outcome,
       diagnostics->>'persistMs'      AS persist_ms
FROM media_cache_ledger
WHERE source_url = '<sourceURL>'
ORDER BY source_generation DESC, last_accessed_at DESC;
```

Only on-demand renders write `diagnostics`; a pure ledger **hit** serves without rewriting it, so the blob reflects the render that last created/replaced that row (which is exactly the render whose cost you're explaining).

## Root-cause playbook

Name the dominant stage, then place it in one of these:

1. **Ledger hit vs on-demand render.** `request.outcome=hit` with only `ledgerLookupMs` + `serveMs` and **no `capture` event** ⇒ zero Chrome work; the wall-clock is a store read. `outcome=rendered` ⇒ a real capture ran (join to the `capture` event by `jobId`).
2. **Congested lane vs slow render.** `outcome=congested` ⇒ the fail-fast queue-depth pre-check tripped (`precheckMs`, `hasTwin=false`); no job ran — the lane is backed up. Otherwise compare `capture.queueWaitMs` (time behind the serialized `screenshot:{realmURL}` lane) against `capture.renderMs`: a large `queueWaitMs` with a small `renderMs` is a **queue** problem (too much concurrent demand on one realm, or the pool draining slowly); a small `queueWaitMs` with a large `renderMs` is a **render** problem (this card is expensive to settle).
3. **Cold launch vs warm reuse.** In the `capture` event, `tabReused=false` with a large `launchMs` (usually `tabStartupMs`-dominated) is the **cold-pool tax** — a fresh Chrome tab. `tabReused=true` with a small `launchMs` is a warm affinity hit. If cold launches dominate across many captures, the pool is under-warmed for the load → hand off to **`prerender-sizing`**.
4. **Real upload vs dedupe hit.** `persistOutcome=uploaded` moved bytes to the store (`persistMs` includes the object write); `deduped` means the content hash already existed — only a ledger row was written, so `persistMs` is small. A slow `uploaded` persist points at the object store, not the render.
5. **Generation-bump miss vs new spec.** A `rendered` outcome is a cache miss. Query `media_cache_ledger` for the same `(realm_url, source_url, capture_spec_hash)`: a **prior row at a lower `source_generation`** means the card was edited (each edit bumps the generation, invalidating the cached capture) — the render was forced by a content change, not a cold cache. **No prior row for that `capture_spec_hash`** means a genuinely new capture spec (first request for that format/geometry).
6. **Timeout / gated.** `outcome=timeout` — the sync wait expired (503 + Retry-After); the job keeps running and persists, so the caller's _retry_ is a `hit`. The user-perceived latency is the wait budget, not the render; the real render cost is in the (later) `capture` event with the same `jobId`. `outcome=gated` — the realm's `allowArbitraryScreenshots` gate is closed (GET only); no capture ran, but already-persisted captures still serve as hits.

## Worked examples (the deliverable)

Always: sum the stages to the wall-clock, name the dominant one, give a plain-language cause, and cite the `correlationId` + the field/row each number came from.

- **Queue-bound.** `request`: `outcome=rendered`, `totalMs=25000`, `jobWaitMs≈23800`. `capture` (same `jobId`): `queueWaitMs≈23000`, `renderMs≈1200` (`settleMs 700`, rest small), `tabReused=true`. Pre-check at the time showed 4 pending on `screenshot:{realm}`.
  → _"23s of the 25s was queue-wait behind 4 pending captures on that realm's serialized lane; the render itself was 1.2s. This is lane congestion, not a slow card. (correlationId `…`; `capture.queueWaitMs`, `capture.renderMs`.)"_
- **Cold launch + heavy settle.** `capture`: `queueWaitMs≈200`, `tabReused=false`, `launchMs≈8000` (`tabStartupMs≈7600`), `renderMs≈6800` (`settleMs≈6000`), `persistOutcome=uploaded`, `persistMs≈400`; `totalMs≈15400`.
  → _"Cold Chrome launch 8s + a 6s settle; the paint/screenshot itself was ~0.8s. A warm tab (steady state) would save the 8s launch. (correlationId `…`; `capture.tabReused=false`, `launchMs`, `settleMs`.)"_ — if cold launches recur, escalate to `prerender-sizing`.

## Hand-offs

- **`aws-access`** — prerequisite for any staging/prod query (AWS session, read-only DB via SSM, Loki auth).
- **`tail-logs`** — the Loki wrapper used above.
- **`prerender-sizing`** — when the bottleneck is pool contention (recurring cold launches, `tabQueueMs`/`admissionMs`/`semaphoreMs` dominating page-acquire): that skill decides the pool envelope and task size.
- **`indexing-diagnostics`** — for the render internals behind `prerenderRequestId` (the prerender `Timings`/`PoolMeta`, per-format render breakdown, stall classification); the screenshot render goes through the same prerender pipeline that skill already maps.
