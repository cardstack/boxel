---
name: prerender-timeout-diagnostics
description: Interpret the diagnostics attached to a prerender-timeout error document (and the matching prerender-server/manager logs) to decide which part of the pipeline stalled. Use when indexing fails with "Render timeout", when a user sees a 504 on a live render, or when investigating the CS-10820 saturation class of incidents.
allowed-tools: Read, Grep, Glob, Bash
---

# Prerender timeout diagnostics

A "Render timeout" error document is the persisted outcome of a prerender whose render phase (not launch, not proxy hop) blew the `RENDER_TIMEOUT_MS` budget. As of CS-10872 the error document and the accompanying log lines carry enough signal to classify the stall in a single pass, without having to re-run the scenario.

This skill exists because the timeout message alone — `Render timed-out after 90000 ms` — does not distinguish the four very different failure modes:

- **Launch stall**: the request waited in the render-semaphore or tab queue and never got a real render attempt. Fix is capacity, not host code.
- **Loader stall**: the render started but was still pulling `.gts` modules when the timer fired. Fix is module graph / network.
- **Data stall**: the render got past module load but is still fetching cards, file-meta, or query-field results. Fix is the host data layer or the backend search.
- **Render stall**: the render is in DOM rendering / stability-wait but nothing is in flight. Fix is Glimmer / template side.

If you pick the wrong category you waste a day. The diagnostics below tell you which one.

## Where the diagnostics live

Two places, same correlation ID:

1. **The persisted error document** (`error_doc` JSONB column, e.g. `boxel_index_card` / `modules`). `error.diagnostics` was added in CS-10872.
2. **Logs** — the `prerender-server`, `manager`, and `remote-prerenderer` lines all carry `requestId=…` after CS-10872. `grep requestId=<uuid>` collates one call across all three processes. For saturation incidents there is also the periodic `prerender-queue-snapshot` line on each prerender server.

Expect both. If one is missing (e.g. older rollout), you can fall back to `capturedDom` / `blockedTimerSummary` which are still attached.

## Field-by-field reading

`error.diagnostics` is an optional object on any `RenderError` with the shape defined in `packages/runtime-common/index.ts` (`RenderTimeoutDiagnostics`). Every field is optional — absent means the hook wasn't available in that build or the timeout killed the page before we could read it.

```jsonc
{
  "requestId": "b14e…",          // single ID across client/manager/prerender-server
  "launchMs": 18720,             // waiting-in-page-pool time (server-side)
  "waits": {
    "semaphoreMs": 18500,        //   └ of that, waiting on the global render semaphore
    "tabQueueMs": 200,           //   └ waiting behind a same-affinity tab already rendering
    "tabStartupMs": 20           //   └ warming a fresh tab / standby
  },
  "renderElapsedMs": 71280,      // time inside withTimeout()
  "totalElapsedMs": 90000,       // launch + render (should match the timeout)
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

These field names are stable after CS-10872; the skill and the type in `packages/runtime-common/index.ts` should stay in lock-step.

### Classify in one pass

Walk the fields top-down. The *first* positive signal wins; stop there.

| Signal | Category | What to look at next |
|---|---|---|
| `waits.semaphoreMs` ≈ `totalElapsedMs` | **Launch stall (capacity)** | Fleet-wide: `prerender-queue-snapshot` lines on every prerender server around that timestamp. Is `totalPending` piled up? Add capacity, don't touch host. |
| `waits.tabQueueMs` ≈ `totalElapsedMs` (and semaphoreMs small) | **Same-affinity contention** | Same realm's batch is serialized on one tab. Check whether `PRERENDER_AFFINITY_TAB_MAX` is 1 for this fleet, or whether a rogue user request is sharing the tab (see CS-10873 for the cancel-on-abort follow-up). |
| `launchMs` small **and** `renderStage` is `null`/`model:start` | **Very early render stall** — transition hadn't yet rendered anything. Usually means the route threw before setting a real stage. Look at `capturedDom` (`<data-prerender-error>` is common) and console errors. |
| `renderStage` ∈ `buildModel:fetching-source` / `buildModel:deriving-type` / `buildModel:hydrating` | **Backend stall during model build** | Usually a slow realm server or cross-realm fetch. Check realm-server logs for the same requestId; check the fetch target from `capturedDom` / `cardDocsInFlight`. |
| `inFlightModuleImports.length > 0` | **Loader stall** | Each URL is a `.gts` / `.ts` we'd already started a `fetchModule(...)` for. Confirm the realm serves those URLs and that there's no import cycle. Often resolves with `clearCache: true` on retry (already in place) — if that's failing check for 500s on the module URL. |
| `queryLoadsInFlight.length > 0` with `fieldName` set | **Query-field stall** | This is the CS-10820 field-driven hot path. Look at the `query`/`realms` fields — is the search hitting a remote realm server that's slow? Check `_federated-search` latency for that realm on the realm-server side. |
| `cardDocsInFlight.length > 0` or `fileMetaDocsInFlight.length > 0` (no query fields) | **Data stall** | Usually linksTo targets that the template pulled on. Prefer `cardDocLoadsInFlight[*].ageMs` / `fileMetaDocLoadsInFlight[*].ageMs` — they tell you which individual URL is the slow one vs. a fan-out. If it's a card from a different realm, that realm may be slow or misconfigured. Also check `recentCardDocLoads` for loads that completed just before the timer fired but still dominated the budget. |
| `renderStage` = `waiting-stability` with empty in-flight arrays | **Render stall** | Nothing is loading but settlement never finishes. Classic Glimmer tracking loop — template is invalidating itself. `capturedDom` usually shows the partially-rendered component. `blockedTimerSummary` will list swallowed timers that may hint at a scheduling loop. |
| `currentlyEvaluatingModule` non-null, or `stageAgeMs` large with empty in-flight arrays | **Synchronous browser stall (typically Glimmer compile during module eval)** | `recentModuleEvaluations` shows the worst offenders. A single URL with `ms > 5000` usually means "this module has a giant template that takes forever to compile". Many small entries (say 50+ at 100–500 ms each) summing into the stall budget mean card fan-out where each dependent card contributes a compile. Split the module, lazy-load the template, or reduce the component fan-out. |
| `blockedTimerSummary` populated | Supplementary. Tells you which timer-driven code is fighting the render. Not a root cause on its own. |

### Special cases

- **`launchMs` is tiny AND `renderElapsedMs` ≈ `totalElapsedMs` but `renderStage` is `null`** — the host's stage hook didn't install. Either the render.ts deactivate ran before the capture, or you're on a pre-CS-10872 host build. Look at `capturedDom` for the last prerender status.
- **`totalElapsedMs` substantially less than the configured `RENDER_TIMEOUT_MS`** — the outer request aborted, not the inner render timeout. That's a client/manager timeout (remote-prerenderer's abort message includes the elapsed — see its error text). The stall is still meaningful but the budget isn't the render-timeout budget.
- **`queryLoadsInFlight` but no `fieldName`** — this is an ad-hoc `store.search()` call, not a query field. The `source` string carries the SearchResource's `source` tag (`seed` / `search` / `live-refresh`) to help.
- **`launchMs + renderElapsedMs ≠ totalElapsedMs`** — possible under retry, since render-runner re-enters with `clearCache: true` on known error signatures. Treat each attempt as its own story; the final error wins.

## Cross-referencing logs

Every log line emitted after CS-10872 for an indexing/user prerender carries `requestId=<uuid>`. Join them:

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
prerender-queue-snapshot totalTabs=4 totalPending=7 affinities=3 | realm:acme(tabs=1, pending=5, max=5) realm:lib(tabs=2, pending=2, max=1) user:u-123(tabs=1, pending=0, max=0)
```

Read this alongside a timeout when `waits.semaphoreMs` is large. A snapshot with `totalPending >> totalTabs` near the timestamp confirms saturation.

## Quick triage rubric

1. **Is `waits.semaphoreMs` > 50% of totalElapsedMs?** If yes, this is capacity. Go look at fleet snapshots, not host code.
2. **Is `renderStage` still a `buildModel:*` stage?** If yes, the render never started real template work — it's upstream of the host.
3. **Is anything in `inFlightModuleImports`?** If yes, it's a loader stall.
4. **Is `currentlyEvaluatingModule` non-null, or `recentModuleEvaluations` showing evaluations that sum to > 30% of `renderElapsedMs`?** If yes, it's a synchronous compile stall — inspect the listed module(s).
5. **Is anything in `queryLoadsInFlight` with a `fieldName`?** If yes, it's a query field.
6. **Is `stageAgeMs` large with all in-flight arrays empty?** If yes, suspect a sync stall that completed just before the diagnostic read, or a Glimmer render loop. Correlate with `recentModuleEvaluations` to distinguish.
7. **Otherwise** — render stall. Look at `capturedDom` + `blockedTimerSummary`.

In practice steps 1-5 catch ~90% of timeouts.

## When the diagnostics disagree with each other

The hooks are best-effort and the page may die mid-capture. Trust this precedence:

1. `renderStage` — set synchronously by the host.
2. `inFlightModuleImports` — read from the loader which is still alive even after the timeout.
3. `cardDocsInFlight` / `fileMetaDocsInFlight` / `queryLoadsInFlight` — read from the store; can go stale if the store reset between timeout fire and capture.
4. `docsInFlight` number — legacy, only use if none of the above are present.

If `renderStage` says `buildModel:fetching-source` but `cardDocsInFlight` is empty, trust `renderStage` — the store clears its in-flight map once a load resolves, including failed loads, but the stage isn't touched until the next stage sets it.

## Extending the diagnostics

If you find you want a signal that isn't here, add it to `RenderTimeoutDiagnostics` in `packages/runtime-common/index.ts` (optional field), populate it in `packages/realm-server/prerender/utils.ts` (the `withTimeout` capture block) by evaluating a new globalThis hook on the page, and expose that hook from `packages/host/app/routes/render.ts::__boxelRenderDiagnostics`. The server-side enrichment in `packages/realm-server/prerender/prerender-app.ts::decorateRenderErrorDiagnostics` then carries it to the error document unchanged.

Remember to also surface it on the error log line in `withTimeout` so operators see it without opening the JSON.
