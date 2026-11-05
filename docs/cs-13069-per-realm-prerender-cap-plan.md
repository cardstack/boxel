# CS-13069: Nothing caps one realm's share of the prerender pool — plan

## Survey: what changed since the ticket was filed (2026-09-22)

Merged work that reduces the feedback loop, without capping it:

- #6252: render-only dependents stay out of the index pass, so one write renders fewer cards.
- #6241, CS-13071: an indexing render builds its model from the source its visit already read.
- #6368: each request's non-search database work is ordered as the realm it names. One busy realm no longer starves other realms' page loads, but it still uses the pool.
- #6725 (CS-13951): a timed-out render gives its tab back on a Node clock, not when Chrome answers.
- #6723, #6724, #6756 (CS-13947, CS-13948, CS-13949): the standby refill does not evict busy tabs, and the pool cap is enforced at hand-out.
- #6515 (CS-13515): manager eviction spreads across the fleet again.
- CS-12221: a client-aborted prerender_html visit persists an error row, and the reconcile backs off.

Still open, related: CS-13942 (Triage; indexing renders abort at 120 s under a write burst, attributed to CS-13947 now), CS-14030 and CS-14035 (one tribecaprep card type's render grows past the budget), CS-12059 (multi-tab per realm, Backlog).

## What already caps a realm, and what does not

- The manager routes by the bare `realm:<url>` key with `PRERENDER_MULTIPLEX=1`, so one realm's renders go to one prerender server.
- On that server, a realm has at most `PRERENDER_AFFINITY_TAB_MAX` tabs (default 5). Its session affinities share one file-admission semaphore (`#fileAdmission`, keyed by realm).
- So a per-realm cap on concurrent visits already exists. It is static: it does not shrink when the realm's renders time out.
- A timeout evicts the affinity's tab (`#evictAffinity`, `retainSharedContext: true`). The next visit starts on a fresh page. With 5 tabs still admitted, the realm keeps its full share while every render times out.
- The tab cap does not limit HTTP requests. Each render loads sibling cards in parallel, so 5 tabs make many concurrent requests to the realm. The realm server has no per-realm admission: `searchAdmission` is a global ceiling for searches, and indexing traffic bypasses it.
- The index path has no backoff on a timeout streak. The reconcile's rejection-streak backoff covers only prerender_html jobs.

## Goals

1. Make the per-realm visit cap adaptive: shrink it when the realm's renders time out, grow it back when they succeed.
2. Back off on the index path when a realm's renders keep timing out.
3. Cap concurrent requests per realm at the realm server, with a bounded queue.

## Steps

### 1. Adaptive per-realm file admission (prerender server) — this PR

- `PagePool.recordVisitOutcome(affinityKey, 'in-time' | 'timed-out')`. A timed-out visit halves the realm's file-admission cap (floor 1) with `AsyncSemaphore.setCapacity`. Renders already admitted keep their tabs.
- After 3 visits in a row finish in time, the cap goes up by 1, up to `#fileAdmissionCap`. A timeout restarts that count.
- The lowered cap is kept in `#reducedFileAdmission`, apart from the `#fileAdmission` semaphore, because that semaphore is dropped whenever the realm goes idle. Cleared in `closeAll`.
- `RenderRunner.prerenderVisitAttempt` reports the outcome in its `finally`, before `release()`, so the slot it frees is handed out under the new cap. A visit that threw (cancelled, or failed before it rendered) reports nothing. Captures and module renders report nothing.
- Each change is logged: `file-queue admission for <realm>: cap X -> Y …` (warn on a decrease, info on an increase). The queue snapshot's `admission.cap` shows the live cap.

Target files: `packages/realm-server/prerender/page-pool.ts`, `prerender/render-runner.ts`.

### 2. Index-path backoff

- In the index runner's visit loop, count consecutive visit timeouts in the pass.
- After K consecutive timeouts (start with K = 3), wait an exponential delay before the next visit (base 2 s, cap 60 s), reset on a success.
- The delay holds the job's reservation, so the cap must stay below the lease. Confirm the lease length before choosing the cap.

Target files: `packages/runtime-common/index-runner/*.ts` (exact file to confirm).

Deferred to CS-14870: decide after step 1 is live. Step 1 may make it unnecessary.

### 3. Per-realm request admission (realm server)

- New middleware after `orderConnectionsByRealm`: per-realm in-flight limit (env `REALM_REQUEST_CONCURRENCY`, default to decide) with a bounded FIFO queue. Past the queue depth, answer 503 with `Retry-After`.
- Key by the realm URL from `knownRealmURL`. Requests that name no known realm pass.
- Decision: render-originated requests (with `PRERENDER_JOB_ID_HEADER` / `DURING_PRERENDER_HEADER`) bypass the cap at first. Capping them slows renders, which can cause more timeouts, and step 1 shrinks that traffic at the source.
- Decision: off by default until tuned.
- Deferred to a separate PR: CS-14871.

Target files: `packages/realm-server/middleware/index.ts`, `server.ts`.

## Testing

- Step 1: `tests/page-pool-adaptive-admission-test.ts` (the cap halves, holds while the realm is idle, comes back, leaves other realms alone, and never preempts an admitted render), and a test in `tests/prerender-unresponsive-render-timeout-test.ts` where a visit really times out and its realm's next file render waits.
- Step 2: an index-runner test with a prerenderer that times out, asserting the delay between visits.
- Step 3: a realm-server test that holds N requests to one realm, asserts the next waits and the one past the queue gets 503, while a request to another realm passes.
- Realm-server tests run in CI; not locally.
