---
name: indexing-diagnostics
description: Investigate slow or failing indexing using the diagnostics persisted on every `boxel_index` row (`timing_diagnostics` JSONB column, mirrored onto `error_doc.diagnostics` for error rows) plus the matching prerender-server / manager logs. Covers (1) a render inside indexing timed out — classify which part of the prerender pipeline stalled, and (2) an incremental or full reindex was slow but didn't fail — attribute time across the invalidation fan-out and find the rows that cost the most. Use when indexing fails with "Render timeout", when a user sees a 504, when a reindex took much longer than expected, when an `.gts` edit triggers a surprising amount of re-render work, or when investigating the CS-10820 saturation class of incidents. For staging/prod investigations this skill layers on top of `aws-access`, which provides the AWS session and the SSM port-forward path into the in-VPC database (authenticated as `claude_readonly_user`) — read that skill first when the question is about a deployed environment.
allowed-tools: Read, Grep, Glob, Bash
---

# Indexing diagnostics

Every indexer write (`IndexWriter.updateEntry`) persists a diagnostic blob on the row it wrote. The blob captures what the prerender pipeline spent its time on and what category of stall (if any) the render was stuck in. It's the primary tool for investigating:

- **A render that timed out during indexing** — classify the stall, fix the right layer. (Also applies to user-facing 504s since the UI path goes through the same prerender.)
- **A reindex that was slow but succeeded** — attribute wall-clock across the cards that got re-rendered, find the real culprit in the fan-out.

Both use cases read from the same data. The difference is the query you start with.

## Where the diagnostics live

Three places, all correlated:

1. **`boxel_index.timing_diagnostics` (and `boxel_index_working.timing_diagnostics`)** — JSONB column, populated for **every** row the indexer writes, regardless of `has_error`. Source of truth. Carries the full `RenderTimeoutDiagnostics` payload plus three write-side stamps: `invalidationId`, `indexedAt`, `requestId`.
2. **`error_doc.diagnostics`** — derived copy of `timing_diagnostics`, written only for error rows. Exists so the existing UI read path (`error_doc` → `CardErrorJSONAPI.meta.diagnostics` via `formattedError`) keeps working without a schema rename. Non-error rows have `error_doc = null`; go to `timing_diagnostics` directly.
3. **Logs** — `prerender-server`, `manager`, and `remote-prerenderer` lines all carry `requestId=…`. `grep requestId=<uuid>` collates one call across all three processes. For saturation incidents there's also the periodic `prerender-queue-snapshot` line on each prerender server.

For UI triage you'll typically read the JSON error response (which surfaces `error_doc.diagnostics` as `meta.diagnostics`). For operator / SQL triage — especially slow non-failing reindexes — query the `timing_diagnostics` column directly.

## How to actually run these queries

The SQL examples below are environment-agnostic — they work the same against local dev, staging, or prod. What changes is *how you reach the database*:

- **Local dev**: `psql "$DATABASE_URL"` (or whatever your local boxel server uses) directly.
- **Staging / prod**: the RDS instances are private to the cardstack VPC. Use the `aws-access` skill — it covers (a) provisioning a Claude-usable AWS session via `mise run claude-aws <env> <token>`, (b) the SSM port-forward tunnel through the realm-server ECS task to RDS, and (c) connecting via psql as the read-only `claude_readonly_user` (member of `readonly_role`). This skill assumes you've already got that connection working; it doesn't re-document the AWS plumbing.

When wrapping a query below into the staging/prod form, run it through the `psql -h localhost -p <local-port> -A -t` invocation that the `aws-access` skill sets up — same SQL, different transport.

## The four stall categories

Every slow or timed-out render falls into one of:

- **Launch stall**: the request waited in the render-semaphore or tab queue and never got a real render attempt. Fix is capacity, not host code.
- **Loader stall**: the render started but was still pulling `.gts` modules when the timer fired. Fix is module graph / network.
- **Data stall**: the render got past module load but is still fetching cards, file-meta, or query-field results. Fix is the host data layer or the backend search.
- **Render stall**: the render is in DOM rendering / stability-wait but nothing is in flight. Fix is Glimmer / template side.

If you pick the wrong category you waste a day. The diagnostic fields in the [Classify in one pass](#classify-in-one-pass) table below pick it for you.

## Mode A — a render timed out

Pull the diagnostic JSON for the erroring row:

```sql
SELECT timing_diagnostics
FROM boxel_index
WHERE url = '<errored-card-url>'
  AND type = 'instance';
```

(Or read `error_doc.diagnostics` from the JSON:API error response — same shape.)

Walk the fields per [Classify in one pass](#classify-in-one-pass). The *first* positive signal wins; stop there.

## Mode B — an incremental reindex was slow

Every `Batch.invalidate(urls)` call mints a UUID stashed into `timing_diagnostics.invalidationId` for every row written during that fan-out. If a `.gts` edit invalidates 8 rows (one file + seven card instances), all eight carry the same `invalidationId` — so you can look at the whole reindex as a group.

**Step 1 — find the invalidation you care about.** If you don't already have the ID, discover recent big ones:

```sql
-- Biggest fan-outs in the realm, most recent first
SELECT
  timing_diagnostics->>'invalidationId' AS id,
  count(*)                              AS rows_touched,
  to_timestamp(
    max((timing_diagnostics->>'indexedAt')::bigint) / 1000
  )                                     AS last_indexed_at,
  sum((timing_diagnostics->>'renderElapsedMs')::int)
                                        AS total_render_ms,
  max((timing_diagnostics->>'renderElapsedMs')::int)
                                        AS slowest_ms
FROM boxel_index
WHERE realm_url = 'http://localhost:4201/user/your-realm/'
  AND timing_diagnostics->>'invalidationId' IS NOT NULL
GROUP BY 1
ORDER BY last_indexed_at DESC
LIMIT 20;
```

**Step 2 — walk the fan-out.** Given an `invalidationId`, pull every row it touched, ordered by render cost:

```sql
SELECT
  url,
  type,
  has_error,
  timing_diagnostics->>'renderStage'                  AS stage,
  (timing_diagnostics->>'renderElapsedMs')::int       AS render_ms,
  (timing_diagnostics->>'launchMs')::int              AS launch_ms,
  timing_diagnostics->'waits'                         AS waits,
  jsonb_array_length(
    COALESCE(timing_diagnostics->'queryLoadsInFlight', '[]'::jsonb)
  )                                                   AS queries_stuck,
  jsonb_array_length(
    COALESCE(timing_diagnostics->'inFlightModuleImports', '[]'::jsonb)
  )                                                   AS modules_stuck,
  to_timestamp((timing_diagnostics->>'indexedAt')::bigint / 1000)
                                                      AS indexed_at
FROM boxel_index
WHERE realm_url = 'http://localhost:4201/user/your-realm/'
  AND timing_diagnostics->>'invalidationId' = '<uuid>'
ORDER BY render_ms DESC NULLS LAST;
```

**Step 3 — classify each slow row.** For the top offenders, pull the full `timing_diagnostics` and apply the [Classify in one pass](#classify-in-one-pass) table to each. Common patterns:

- One row dominates (e.g. a dashboard card) and the rest are cheap. The big row is the real target — investigate its `queryLoadsInFlight` / `recentModuleEvaluations` / `cardDocLoadsInFlight`.
- All rows share a large `launchMs`. Capacity contention during the reindex, not the cards' fault.
- The first row in the batch (min `indexedAt`) has a large `renderElapsedMs` but the rest are cheap — this is the cold-loader tax paid by whichever card was rendered first after `clearCache: true` fired. Expected on any executable invalidation; only worth chasing if the cold cost is disproportionate to the dep closure.
- The `deps` / `types` columns on the same rows tell you *why* each row was invalidated — useful for discovering unintentionally-heavy transitive deps (e.g. a dashboard re-renders because one of its metrics modules has a runtime reference to the changed module).

**Other useful queries:**

```sql
-- Slowest single renders in the realm, regardless of error state
SELECT
  url,
  to_timestamp((timing_diagnostics->>'indexedAt')::bigint / 1000) AS indexed_at,
  (timing_diagnostics->>'renderElapsedMs')::int                   AS render_ms,
  timing_diagnostics->>'renderStage'                              AS stage,
  timing_diagnostics->>'invalidationId'                           AS group,
  has_error
FROM boxel_index
WHERE realm_url = 'http://localhost:4201/user/your-realm/'
ORDER BY render_ms DESC NULLS LAST
LIMIT 20;

-- p95 render time by realm
SELECT
  realm_url,
  avg((timing_diagnostics->>'renderElapsedMs')::int) AS avg_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY (timing_diagnostics->>'renderElapsedMs')::int
  )                                                   AS p95_ms,
  count(*)                                            AS rows
FROM boxel_index
WHERE timing_diagnostics->>'renderElapsedMs' IS NOT NULL
GROUP BY 1
ORDER BY p95_ms DESC NULLS LAST
LIMIT 20;
```

## Field-by-field reading

`timing_diagnostics` carries `RenderTimeoutDiagnostics` (defined in `packages/runtime-common/index.ts`) plus `invalidationId` / `indexedAt` / `requestId`. Every render-side field is optional — absent means the hook wasn't available in that build or the page died before the capture could read it.

```jsonc
{
  "requestId": "b14e…",          // single ID across client/manager/prerender-server
  "invalidationId": "a3e1…",     // single ID across every row written by the same Batch.invalidate()
  "indexedAt": 1776964391615,    // wall-clock ms when IndexWriter.updateEntry ran
  "launchMs": 18720,             // waiting-in-page-pool time (server-side)
  "waits": {
    "semaphoreMs": 18500,        //   └ of that, waiting on the global render semaphore
    "admissionMs": 0,            //   └ waiting on the per-affinity file-admission cap (= affinity tab max − 1)
    "tabQueueMs": 200,           //   └ waiting behind a same-affinity tab already rendering
    "tabStartupMs": 20           //   └ warming a fresh tab / standby
  },
  "renderElapsedMs": 71280,      // time inside withTimeout()
  "totalElapsedMs": 90000,       // launch + render (matches the timeout on errored rows)
  "renderStage": "waiting-stability", // last breadcrumb set by the host route
  "stageAgeMs": 62110,           // ms since `renderStage` was last set
  "cardDocsInFlight": ["…/CardA.json", …], // URLs the store was still loading (legacy, strings only)
  "fileMetaDocsInFlight": […],
  "cardDocLoadsInFlight": [      // same loads, with per-URL ageMs
    { "url": "…/Manager.json", "ageMs": 68500 },
    { "url": "…/Team.json", "ageMs": 1900 }
  ],
  "fileMetaDocLoadsInFlight": […],
  "recentCardDocLoads": [        // top-N slowest completed linked-field loads
    { "url": "…/HeavyList.json", "ms": 3200 }
  ],
  "recentFileMetaLoads": [ … ],
  "inFlightModuleImports": ["…/foo.gts", …], // Loader cache misses still fetching
  "currentlyEvaluatingModule": "…/card-with-big-template.gts", // or null
  "recentModuleEvaluations": [   // top-N slowest module evaluations so far
    { "url": "…/card-with-big-template.gts", "ms": 4200 },
    { "url": "…/util.ts", "ms": 18 }
  ],
  "queryLoadsInFlight": [        // SearchResource loads (incl. query fields)
    {
      "source": "search-resource:search:query-field-support:…",
      "fieldName": "topRelated",
      "cardId": "…/Product.json",
      "realms": ["…"],
      "query": { … },
      "ageMs": 71000
    }
  ],
  "affinitySnapshot": {          // server-side: what else was on this tab's affinity
    "affinityKey": "realm:…/my-realm/",
    "tabCount": 1,
    "pendingTotal": 7,           // peak across periodic samples during this call
    "maxPending": 7,
    "sameAffinityActivity": [    // excludes self. Module sub-prerenders
                                 // run on their own tab via the queue
                                 // split — entries here during healthy
                                 // operation show concurrent work on
                                 // the *other* queue (e.g. a `module`
                                 // call running alongside a `file`
                                 // render). A non-empty list with
                                 // `queue: 'module', state: 'queued'`
                                 // on a `waiting-stability` stall is a
                                 // regression signal — see the
                                 // "Classify in one pass" table row
                                 // below.
      { "url": "…/customer.gts", "kind": "module", "queue": "module", "state": "running", "ageMs": 68000 },
      { "url": "…/order.gts",    "kind": "module", "queue": "module", "state": "running", "ageMs": 66500 }
    ]
  },
  "recentQueryLoads": [          // top-N slowest completed query loads
    {
      "meta": {
        "source": "search-resource:search",
        "fieldName": "staff",
        "cardId": "…/Directory.json",
        "query": { … }
      },
      "ms": 8100
    }
  ],
  "docsInFlight": 3,             // legacy count, kept for rollback safety
  "capturedDom": "<section data-prerender>…</section>",
  "blockedTimerSummary": "Timers blocked during prerender: …"
}
```

### How the time fields relate

All ms values are server-observed walltime.

- `launchMs` + `renderElapsedMs` ≈ `totalElapsedMs`. A small mismatch (< 100 ms) is capture overhead; a large mismatch means the render-runner retried with `clearCache: true` (you're looking at the final attempt's timings).
- `waits.semaphoreMs` + `waits.tabQueueMs` + `waits.tabStartupMs` ≤ `launchMs`. `launchMs` is measured around the full `PagePool.getPage` call; the three sub-waits cover the three awaits (semaphore acquire, affinity-entry selection, standby warmup) but not the synchronous bookkeeping between them (affinity reassignment, LRU touch, standby top-up kickoff). For a healthy fleet the residual is < 5 ms; a large residual is unusual and worth inspecting `PagePool` directly.
- `renderElapsedMs` is wall time *inside* `withTimeout()` — includes host fetches, store settle, and the actual render pass. It hits the configured `RENDER_TIMEOUT_MS` on a timeout.
- `stageAgeMs` is host-observed — it's computed as `Date.now() - stageSetAt` at the moment the post-timeout capture ran, so there can be a small read-delay offset vs. `renderElapsedMs`. For triage, `stageAgeMs` represents "how long the render has been stuck in its current stage".
- `recentModuleEvaluations[*].ms` are per-module evaluation times measured inside `Loader.evaluate()` via `performance.now()`; they're wall time for the synchronous body of the module (Glimmer compile + top-level init). Sum them to estimate the sync-compile budget eaten by module evaluation on this page.
- `queryLoadsInFlight[*].ageMs` is the wall time since that specific search/query-field load started — i.e. how long it's been hanging.
- `recentQueryLoads[*].ms` is the wall time a completed query-field/search load ultimately took. The store keeps a bounded top-N so even queries that resolved just before the timer fired stay visible. Compare with `renderElapsedMs` to see which fraction of the render budget went to query work.
- `cardDocLoadsInFlight[*].ageMs` / `fileMetaDocLoadsInFlight[*].ageMs` mirror the query version for linked-field (card doc) / file-meta loads. One URL with a very large `ageMs` = one slow linksTo target; many URLs with small `ageMs` = fan-out.
- `recentCardDocLoads[*].ms` / `recentFileMetaLoads[*].ms` are the completed-load histories; same usage as `recentQueryLoads`.

Keep the field names in lock-step with the type in `packages/runtime-common/index.ts`.

### Classify in one pass

Walk the fields top-down. The *first* positive signal wins; stop there.

| Signal | Category | What to look at next |
|---|---|---|
| `waits.semaphoreMs` ≈ `totalElapsedMs` | **Launch stall (capacity)** | Fleet-wide: `prerender-queue-snapshot` lines on every prerender server around that timestamp. Is `totalPending` piled up? Add capacity, don't touch host. |
| `waits.admissionMs` ≈ `totalElapsedMs` (and semaphoreMs small) | **Per-affinity admission stall** | This realm hit its own file-admission cap — the server had capacity but wasn't letting this realm use it. The signal means ≥ cap concurrent file renders on one affinity. Default cap = `affinityTabMax − 1` (4 on the standard 5-tab deployment), so a single realm fanning out to ≥ 4 concurrent renders (typical catalog-sized reindex) already produces this. Grep the queue-snapshot log for `admission=pending=N/cap=N` on the same affinity to confirm waiters were piling up. If the cap looks too tight for the workload and cross-realm fairness isn't the concern, `PRERENDER_AFFINITY_FILE_CONCURRENCY` is the knob (see the tuning-knobs section). |
| `waits.tabQueueMs` ≈ `totalElapsedMs` (and semaphoreMs / admissionMs small) | **Same-affinity contention** | Same realm's batch is serialized on one tab. Check whether `PRERENDER_AFFINITY_TAB_MAX` is 1 for this fleet, or whether a rogue user request is sharing the tab (see CS-10873 for the cancel-on-abort follow-up). |
| `launchMs` small **and** `renderStage` is `null`/`model:start` | **Very early render stall** — transition hadn't yet rendered anything. Usually means the route threw before setting a real stage. Look at `capturedDom` (`<data-prerender-error>` is common) and console errors. |
| `renderStage` ∈ `buildModel:fetching-source` / `buildModel:deriving-type` / `buildModel:hydrating` | **Backend stall during model build** | Usually a slow realm server or cross-realm fetch. Check realm-server logs for the same requestId; check the fetch target from `capturedDom` / `cardDocsInFlight`. |
| `inFlightModuleImports.length > 0` | **Loader stall** | Each URL is a `.gts` / `.ts` we'd already started a `fetchModule(...)` for. Confirm the realm serves those URLs and that there's no import cycle. Often resolves with `clearCache: true` on retry (already in place) — if that's failing check for 500s on the module URL. |
| `queryLoadsInFlight.length > 0` with `fieldName` set | **Query-field stall** | This is the CS-10820 field-driven hot path. Look at the `query`/`realms` fields — is the search hitting a remote realm server that's slow? Check `_federated-search` latency for that realm on the realm-server side. |
| `cardDocsInFlight.length > 0` or `fileMetaDocsInFlight.length > 0` (no query fields) | **Data stall** | Usually linksTo targets that the template pulled on. Prefer `cardDocLoadsInFlight[*].ageMs` / `fileMetaDocLoadsInFlight[*].ageMs` — they tell you which individual URL is the slow one vs. a fan-out. If it's a card from a different realm, that realm may be slow or misconfigured. Also check `recentCardDocLoads` for loads that completed just before the timer fired but still dominated the budget. |
| `renderStage` = `waiting-stability` **AND** `queryLoadsInFlight` has a `search-resource:*` entry **AND** `affinitySnapshot.sameAffinityActivity` contains `{ queue: 'module', state: 'queued' }` entries **on the same affinity as the stuck render** | **Self-referential prerender deadlock — admission invariant broken** | A search that can't resolve a `_cardType` filter without a card definition causes `CachingDefinitionLookup` to fire a same-affinity `prerenderModule` to extract it. The queue-split + admission cap in PagePool is supposed to reserve at least one tab per affinity for `module` / `command` work precisely to prevent this sub-prerender from queuing behind the render that needs it. **Seeing this fingerprint means the invariant didn't hold**: check `PRERENDER_AFFINITY_TAB_MAX >= 2` (PagePool logs a warning at startup if not), verify the admission semaphore is acquired on `'file'` calls (`PagePool.#acquireFileAdmission`), and confirm `disposeAffinity` isn't dropping the admission semaphore mid-flight. |
| `renderStage` = `waiting-stability` with empty in-flight arrays | **Render stall** | Nothing is loading but settlement never finishes. Classic Glimmer tracking loop — template is invalidating itself. `capturedDom` usually shows the partially-rendered component. `blockedTimerSummary` will list swallowed timers that may hint at a scheduling loop. |
| `currentlyEvaluatingModule` non-null, or `stageAgeMs` large with empty in-flight arrays | **Synchronous browser stall (typically Glimmer compile during module eval)** | `recentModuleEvaluations` shows the worst offenders. A single URL with `ms > 5000` usually means "this module has a giant template that takes forever to compile". Many small entries (say 50+ at 100–500 ms each) summing into the stall budget mean card fan-out where each dependent card contributes a compile. Split the module, lazy-load the template, or reduce the component fan-out. |
| `blockedTimerSummary` populated | Supplementary. Tells you which timer-driven code is fighting the render. Not a root cause on its own. |

### Special cases

- **`launchMs` is tiny AND `renderElapsedMs` ≈ `totalElapsedMs` but `renderStage` is `null`** — the host's stage hook didn't install. Either the render.ts deactivate ran before the capture, or you're on an older host build. Look at `capturedDom` for the last prerender status.
- **`totalElapsedMs` substantially less than the configured `RENDER_TIMEOUT_MS`** — the outer request aborted, not the inner render timeout. That's a client/manager timeout (remote-prerenderer's abort message includes the elapsed). The stall is still meaningful but the budget isn't the render-timeout budget.
- **`queryLoadsInFlight` but no `fieldName`** — this is an ad-hoc `store.search()` call, not a query field. The `source` string carries the SearchResource's `source` tag (`seed` / `search` / `live-refresh`) to help.
- **`launchMs + renderElapsedMs ≠ totalElapsedMs`** — possible under retry, since render-runner re-enters with `clearCache: true` on known error signatures. Treat each attempt as its own story; the final stored attempt wins.

## Cross-referencing logs

Every prerender log line carries `requestId=<uuid>`. Join them:

```sh
# Manager proxy lines (including queueMs + target assignment)
grep "requestId=b14e" manager.log

# Prerender-server per-endpoint line: includes launch breakdown + renderMs
grep "requestId=b14e" prerender-server.log

# Client-side remote-prerenderer abort message (if it timed out at the boundary)
grep "requestId=b14e" realm-server.log
```

The periodic `prerender-queue-snapshot` line does NOT carry requestId (it's a fleet snapshot):

```
prerender-queue-snapshot totalTabs=5 totalPending=7 affinities=3 | realm:acme(tabs=2, pending=5, max=5, busy=file:1/module:1/command:0) realm:lib(tabs=2, pending=2, max=1, busy=file:1/module:0/command:0) user:u-123(tabs=1, pending=0, max=0)
```

Read this alongside a timeout when `waits.semaphoreMs` is large. A snapshot with `totalPending >> totalTabs` near the timestamp confirms saturation.

## Quick triage rubric (Mode A — timeout)

1. **Is `waits.semaphoreMs` > 50% of totalElapsedMs?** If yes, this is capacity. Go look at fleet snapshots, not host code.
2. **Is `renderStage` still a `buildModel:*` stage?** If yes, the render never started real template work — it's upstream of the host.
3. **Is anything in `inFlightModuleImports`?** If yes, it's a loader stall.
4. **Is `currentlyEvaluatingModule` non-null, or `recentModuleEvaluations` showing evaluations that sum to > 30% of `renderElapsedMs`?** If yes, it's a synchronous compile stall — inspect the listed module(s).
5. **Is anything in `queryLoadsInFlight` with a `fieldName`?** If yes, it's a query field.
6. **Is `stageAgeMs` large with all in-flight arrays empty?** If yes, suspect a sync stall that completed just before the diagnostic read, or a Glimmer render loop. Correlate with `recentModuleEvaluations` to distinguish.
7. **Otherwise** — render stall. Look at `capturedDom` + `blockedTimerSummary`.

In practice steps 1-5 catch ~90% of timeouts.

## Quick triage rubric (Mode B — slow reindex)

1. **Pull the fan-out with the `invalidationId` query above** — you now have every row touched.
2. **Does one row dominate total `render_ms`?** If yes, it's the real target. Read its `timing_diagnostics` and apply Mode A's rubric to it.
3. **Are `launch_ms` and `waits.semaphoreMs` large across all rows?** If yes, capacity contention during the reindex, not the cards' fault.
4. **Is only the first-indexed row (min `indexedAt`) slow and the rest fast?** That's the cold-loader tax paid by the first render after a `.gts` invalidation (`clearCache: true` fired once for the batch). Expected on any executable invalidation — only worth chasing if the cold cost is disproportionate to the module graph.
5. **Is the sum of `render_ms` wildly larger than the card count × a reasonable per-card budget?** Look for `queryLoadsInFlight` / `recentQueryLoads` entries that repeat across rows — that's a query-field that multiple dependents all wait on.
6. **Is the fan-out bigger than you expected?** The `types` and `deps` columns on the same rows tell you *why* each row was invalidated — useful for discovering unintentionally-heavy transitive deps (e.g. a dashboard re-renders because one of its metrics modules has a runtime reference to the changed module).

## When the diagnostics disagree with each other

The host-side hooks are best-effort and the page may die mid-capture. Trust this precedence:

1. `renderStage` — set synchronously by the host.
2. `inFlightModuleImports` — read from the loader which is still alive even after the timeout.
3. `cardDocsInFlight` / `fileMetaDocsInFlight` / `queryLoadsInFlight` — read from the store; can go stale if the store reset between timeout fire and capture.
4. `docsInFlight` number — legacy, only use if none of the above are present.

If `renderStage` says `buildModel:fetching-source` but `cardDocsInFlight` is empty, trust `renderStage` — the store clears its in-flight map once a load resolves, including failed loads, but the stage isn't touched until the next stage sets it.

## Reproducing a render interactively

Sometimes the written diagnostics aren't enough — you want to replay the exact render the indexer saw in a real browser (Chrome MCP, Puppeteer, or your own tab) to step through it, watch network, edit source and reload, etc. Every ingredient is already in the system; you just have to wire them up.

Two separate tokens are involved; keep them straight up front:

- **User JWT** — a *realm-scoped* token you mint yourself, used to call the authenticated reindex endpoint (`POST <realm-url>_full-reindex` or `_reindex`). Without this you can't trigger the reindex, which means you don't get the artifacts below. This is the only reason you'll do the Matrix dance by hand.
- **Indexer `boxel-session` value** — the full `boxel-session` localStorage value the indexer's prerender tab uses. You never construct this yourself; you read it verbatim out of the `prerenderer-reproduce` log for the card you want to replay, and paste it into `localStorage['boxel-session']` so the prerender tab authenticates as the indexer did. Format: a JSON-stringified map `{ <realmUrl>: <realm-scoped-JWT>, … }`, one entry per realm the indexer has auth for — the host reads it with `JSON.parse(...)` and picks the right JWT per cross-realm fetch. **Copy the whole string from the log**, not just one of the inner JWTs.

So the end-to-end flow is: mint user JWT → call `_full-reindex` with it → indexer runs → log emits render URLs + session values → paste into browser. Mint-your-own-JWT and read-value-from-log are *both* needed; they're not alternatives.

### The `prerenderer-reproduce` log channel

`packages/realm-server/prerender/render-runner.ts` defines a dedicated logger `prerenderer-reproduce` that emits a line **per card render** with a ready-to-use URL and the exact `boxel-session` value the indexer used (a JSON-stringified map from realm URL to realm-scoped JWT):

```
manually visit prerendered url <card-id> at: <boxel-host>/render/<encoded-card-id>/<nonce>/<encoded-options>/html/isolated/0 with boxel-session = {"http://localhost:4201/user/my-realm/":"eyJ…","https://cardstack.com/base/":"eyJ…", …}
```

This channel is **off** by default. Turn it on by adding `prerenderer-reproduce=debug` to `LOG_LEVELS` when starting the realm server. Example:

```sh
LOG_LEVELS='prerenderer-reproduce=debug' pnpm start-all
# or, alongside other levels:
LOG_LEVELS='*=info,prerenderer-reproduce=debug' pnpm start-all
```

Then trigger the render you care about (see [Triggering a reindex](#triggering-a-reindex) below — this is where your user JWT gets used) and grep the realm-server log for `manually visit prerendered url`. You get two things: the URL and the indexer's full `boxel-session` value (the JSON string after `boxel-session = `). Paste that whole string verbatim into `localStorage['boxel-session']` on the host tab and navigate to the URL — don't extract just one JWT from the map, the host needs the full map to handle cross-realm fetches.

### Minting the user JWT to trigger the reindex

The per-realm reindex endpoints (`POST <realm>_reindex`, `POST <realm>_full-reindex`) are authenticated — they require a realm-scoped JWT on the `Authorization` header. Mint one the same way the UI does, in two hops:

1. **Matrix login**, user/password → Matrix access token, then request an OpenID token:

   ```sh
   # Step 1a: Matrix password login
   curl -s -X POST "$MATRIX_URL/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"<user>"},"password":"<pw>"}' \
     | jq -r .access_token

   # Step 1b: trade for an OpenID token
   curl -s -X POST "$MATRIX_URL/_matrix/client/v3/user/<@user:server>/openid/request_token" \
     -H "Authorization: Bearer <access_token>" \
     -d '{}'
   ```

2. **Realm-auth exchange**, OpenID token → realm-scoped JWT:

   ```sh
   curl -s -X POST "$REALM_SERVER/_realm-auth" \
     -H 'Authorization: <realm-server-JWT or matrix-openid-token, per handler>' \
     -H 'Content-Type: application/json' \
     -d '{ "user": "@user:server", "realms": ["<realm-url>/"] }'
   ```

   The response carries a map of `{ <realm-url>: <realm-JWT> }`. **That** is the token you pass on `Authorization` when calling the reindex endpoint in the next section. It's *not* the token the prerender tab uses — that one comes from the `prerenderer-reproduce` log.

Three different JWTs float around in this area, so always be explicit about which one you mean:

| Token | Who mints it | Used for |
|---|---|---|
| Realm-server-level JWT | `/_realm-auth` top-level, signed by server secret seed | Server admin endpoints (publish, etc.); *not* accepted by card endpoints |
| Realm-scoped JWT (this section) | Same `/_realm-auth` call, one per realm in the response map | Authenticating as a user to a specific realm — including `POST <realm>_full-reindex` |
| Indexer `boxel-session` value (from `prerenderer-reproduce`) | Minted internally by the indexer — a JSON-stringified `{ <realmUrl>: <realm-scoped-JWT> }` map, one entry per realm the indexer has auth for | Pasted verbatim into `localStorage['boxel-session']` on the prerender tab |

Mix them up and you get 401s with no obvious reason.

### Visiting a render page

The render URL format is what the indexer uses and what `prerenderer-reproduce` logs:

```
<boxel-host>/render/<encoded-card-id>/<nonce>/<encoded-options>/html/isolated/0
```

- `<boxel-host>` — `HOST_URL` / whichever host the realm server points its prerender at (usually `http://localhost:4200` locally).
- `<encoded-card-id>` — `encodeURIComponent(url)`; e.g. `http%3A%2F%2Flocalhost%3A4201%2Fuser%2Fmyrealm%2FProduct%2F1.json`.
- `<nonce>` — monotonically-incremented per prerender call; `1` is fine for manual replays.
- `<encoded-options>` — `encodeURIComponent(JSON.stringify(renderOptions))`; `%7B%7D` (`{}`) works.
- `html/isolated/0` — format / format-variant / recursion-depth; what card rendering uses.

Before navigating, set `localStorage['boxel-session']` to the **full JSON string** that the `prerenderer-reproduce` log prints after `boxel-session = ` (a `{ <realmUrl>: <jwt> }` map, not a single JWT — the host `JSON.parse`s it). Without it the page sees an unauthenticated load and the store fails to fetch anything. If you set it to a bare JWT by mistake, the page fails on `JSON.parse` at load.

### Chrome MCP / headful replay recipe

```
1. mcp__chrome-devtools__navigate_page → <boxel-host>  (any page under the host so we can set its localStorage)
2. mcp__chrome-devtools__evaluate_script → localStorage.setItem('boxel-session', '<session-value-from-log>')
   // <session-value-from-log> is the JSON string the reproduce log printed after `boxel-session = `
   // (a `{ <realmUrl>: <jwt> }` map), not a bare JWT.
3. mcp__chrome-devtools__navigate_page → <render-url from the log>
4. mcp__chrome-devtools__wait_for   → text like the card's title, or poll data-prerender-status
5. mcp__chrome-devtools__evaluate_script → document.querySelector('[data-prerender]').dataset.prerenderStatus
   // returns 'loading' | 'ready' | 'error' | 'unusable'
6. Once 'ready', inspect the DOM, the console, the network tab — anything the indexer would have seen.
```

The container's `data-prerender-status` attribute is the authoritative "the page is done" signal for manual replays — same one the indexer waits on. `ready` means the snapshot would have been taken; `error` / `unusable` means the indexer would have captured the error state.

For slow-load investigation you can also grab live diagnostics with the same hook the indexer uses:

```js
(globalThis as any).__boxelRenderDiagnostics?.()
```

It returns the current `RenderTimeoutDiagnostics` blob — `renderStage`, in-flight arrays, etc. Evaluate it repeatedly while the page is stuck to see which array is growing / which stage is stalled.

### Triggering a reindex

There are two families of reindex endpoints. Pick based on what auth you have:

**Per-realm, user-authenticated** (the common case — use the realm-scoped JWT you minted above):

```sh
# Default reindex: refreshes stale entries based on mtime / error state.
curl -X POST \
  -H "Authorization: $REALM_SCOPED_JWT" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "<realm-url>_reindex"

# Full reindex: clears last-modified state so every file is revisited.
curl -X POST \
  -H "Authorization: $REALM_SCOPED_JWT" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "<realm-url>_full-reindex"
```

Both return `204 No Content` and enqueue `userInitiatedPriority` jobs. The caller must have realm-owner or similar write permission on that realm — the server checks the JWT against the realm's permission table. This is the path the in-browser "reindex" / "full reindex" commands take.

**Gotcha**: the realm router matches routes by MIME, not just path — these endpoints are registered with `SupportedMimeType.JSON`, so omitting `Accept: application/json` makes the request fall through to the card-GET/POST handler and you get a confusing `404 not found` against a phantom card at `/_full-reindex`. Always send the Accept header and a JSON body (even `{}`).

**Grafana shared-secret** (admin / ops path — only works if `GRAFANA_SECRET` is configured on the server):

```sh
# Single realm
curl -H "Authorization: $GRAFANA_SECRET" \
  "$REALM_SERVER/_grafana-reindex?realm=<realm-path-without-leading-or-trailing-slash>"

# Full server (enqueues one full-reindex job covering every realm on this server)
curl -H "Authorization: $GRAFANA_SECRET" "$REALM_SERVER/_grafana-full-reindex"
```

`GET` (because grafana-driven), takes the secret as a bare `Authorization` header with no `Bearer` prefix. Clears module caches before enqueuing. Use when you don't have a user account on the realm but do have access to the server's grafana secret.

A single card (not a whole realm) re-renders the moment you save its backing file, so "reindex one card" usually means "save the file, then watch the next log lines and DB rows for that card" — no endpoint call needed.

### Putting it together — a full reproduction

Locally on a private realm where indexing is flaky:

```sh
# Terminal 1 — realm server with reproduce channel on
LOG_LEVELS='*=info,prerenderer-reproduce=debug' pnpm start-all

# Terminal 2 — mint the realm-scoped user JWT (matrix-login → /_realm-auth),
# save it as $REALM_SCOPED_JWT. See "Minting the user JWT" above.

# Terminal 2 — kick off a full reindex using that JWT.
# NOTE the Accept header + JSON body: the route is registered with
# SupportedMimeType.JSON, so without them the request falls through to
# the card handler and you get a confusing "phantom card at /_full-reindex"
# 404 instead of the 204 that means "job enqueued".
curl -X POST \
  -H "Authorization: $REALM_SCOPED_JWT" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://localhost:4201/user/<realm>/_full-reindex"

# Terminal 1 — grep for the indexer's reproduce line for the card you're chasing
grep 'manually visit prerendered url .*<card-id>' realm-server.log | tail -1
# The line hands you: a render URL, plus the full `boxel-session` JSON
# string the indexer's tab is using (a { <realmUrl>: <jwt> } map).

# Now paste the URL + that full JSON string into Chrome MCP (or any real
# browser): set localStorage['boxel-session'] to the whole string from
# after `boxel-session = ` (don't extract one inner JWT), navigate to
# the URL, poll data-prerender-status, call __boxelRenderDiagnostics()
# while the page is stuck.
```

Two different tokens do two different jobs: the user-minted realm-scoped JWT got you the reindex, the indexer's full session map gets the browser tab past its auth checks for every realm the render touches.

If `GRAFANA_SECRET` is configured on your server, you can skip the user-JWT step and use `curl -H "Authorization: $GRAFANA_SECRET" http://localhost:4201/_grafana-full-reindex` instead (grafana endpoint is a GET, no MIME gotcha). In dev the per-realm JWT path is almost always easier.

## Prerender capacity tuning knobs

Three env vars control the per-prerender-server shape. They're resolved once at `PagePool` construction; changes require a process restart.

| Env var | Default | What it controls | When to change it |
|---|---|---|---|
| `PRERENDER_PAGE_POOL_SIZE` | `5` | Total simultaneous Chrome tabs the pool can manage. Also the `capacity` the server reports to the manager on each heartbeat, which drives warm-vacancy routing. | Fleet capacity. Raise when `waits.semaphoreMs` dominates `launchMs` across rows from all realms (server-wide saturation); lower if you need to reduce memory footprint and you can confirm from snapshots that pending rarely approaches `totalTabs`. |
| `PRERENDER_AFFINITY_TAB_MAX` | `5` (clamped to `PRERENDER_PAGE_POOL_SIZE`) | Max tabs a single affinity (realm or user) can simultaneously hold from the pool. | Rarely. Must be ≥ 2 for the self-referential prerender deadlock to be prevented — PagePool logs a warning at startup when it isn't. Lower only if you want to force multi-realm fairness at the tab-routing level. |
| `PRERENDER_AFFINITY_FILE_CONCURRENCY` | unset → `max(1, PRERENDER_AFFINITY_TAB_MAX − 1)` (the deadlock-safety ceiling) | Cap on concurrent `file` renders within a single affinity. Module and command calls bypass admission; they're never capped by this knob. | Cross-realm fairness. When one realm's fan-out (e.g. a catalog reindex) is stealing render budget from every other realm, lower this below the ceiling to reserve tabs for other affinities. The effective cap is always `min(env, ceiling)` so this can't accidentally break the deadlock-safety invariant. |

**Default invariant**: when `PRERENDER_AFFINITY_FILE_CONCURRENCY` is unset, the effective file-admission cap equals the deadlock-safety ceiling — same behavior as before the knob existed. Changing the knob is an explicit operator decision driven by `admissionMs` telemetry; don't adjust it without data.

When the cap is active and below the ceiling, PagePool logs one info line at construction:

```
file-queue admission: cap=2 (affinityTabMax=5, deadlock-safety ceiling=4)
```

Grep for `file-queue admission: cap=` in prerender-server logs to confirm the effective value in a running fleet.

## Extending the diagnostics

If you find you want a signal that isn't here, add it to `RenderTimeoutDiagnostics` in `packages/runtime-common/index.ts` (optional field), populate it in `packages/realm-server/prerender/utils.ts` (the `withTimeout` capture block) by evaluating a new globalThis hook on the page, and expose that hook from `packages/host/app/routes/render.ts::__boxelRenderDiagnostics`. The Prerenderer decorator lifts it onto `response.meta.diagnostics` and the indexer persists it into `timing_diagnostics` unchanged.

Remember to also surface it on the error log line in `withTimeout` so operators see it without opening the JSON.
