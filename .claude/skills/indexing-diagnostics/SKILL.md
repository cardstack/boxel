---
name: indexing-diagnostics
description: Investigate slow or failing indexing using the per-row diagnostics persisted split by visit — the index visit's breakdown on `boxel_index.diagnostics`, the prerender-html visit's render breakdown (launch/wait/render timings, per-format render timings) on `prerendered_html.diagnostics`, each mirrored onto its table's `error_doc.diagnostics` for error rows, joinable per row via url + the two request ids — plus the matching prerender-server / manager logs. Covers (1) a render inside indexing timed out — classify which part of the prerender pipeline stalled, (2) an incremental or full reindex was slow but didn't fail — attribute time across the invalidation fan-out and find the rows that cost the most, (3) enumerating cards with broken `linksTo` / `linksToMany` targets via `diagnostics.brokenLinks` (those cards index cleanly, so this is the only indexed signal), (4) verifying the module pre-warm phase populates the definition cache under a key the indexer / on-demand prerender reads actually hit — i.e. it isn't a silent no-op — via the `definition-cache-key` hit/miss log channel, and (5) attributing a slow in-render `_search` round-trip to the realm-server's own request→response stages (parse / SQL / loadLinks / serialize / queue) via the `realm:search-timing`, `realm:requests` (`dur=`), and `realm:health` log channels keyed by the `x-boxel-logging-correlation-id` correlation id, and (6) capturing full CPU profiles / CDP traces / heap-allocation profiles to the prerender S3 artifact bucket (`boxel-prerender-artifacts-<env>`) when the summary signals name a hot function but you need the whole call tree, a JS-vs-GC-vs-layout breakdown, or a heap-growth story — the streaming trace is the only capture that survives a fully-wedged renderer; gated behind `PRERENDER_PROFILE_AFFINITY` + per-mode SSM flags and pulled with the `boxel-claude-readonly` S3 read grant, and (7) attributing a slow search-doc build to specific fields and link loads — the settle loop's per-target load timings (`searchDocSettleMs` / `searchDocLinkLoads`) vs the field walk's per-dotted-path evaluation timings (`searchDocMs` / `searchDocFieldsMs`), both on `boxel_index.diagnostics`, and (8) decomposing the between-visit / non-render slice of an index job's wall — the once-per-job phases (invalidation discovery, dependency ordering, module pre-warm, aggregate row writes, the final swap) on `jobs.result.phaseTimings` plus the per-row client overhead (file read / render round-trip transport / post-render bookkeeping) on `boxel_index.diagnostics.indexVisitClientMs` — the wall that runs serially between the server renders and is invisible in the per-row `totalElapsedMs`, and (9) decomposing a trivial card's fixed per-visit floor — the route machinery (the meta / icon / file-extract route transitions, instantiation, and per-visit request plumbing) around the search-doc work — into per-route wall-clock buckets on `boxel_index.diagnostics.indexRoutesMs` (the index-half sibling of the render channel's `renderFormatsMs`), so a floor that isn't the search doc reads as measured route steps rather than an inference from `renderElapsedMs`, and (10) recognizing a batch-level setup-phase failure of an incremental job — N error docs sharing one `error_doc.message` and `job_id`, carrying no visit diagnostics, from a rejected job whose whole batch failed before its visit loop — vs per-row render failures, and the re-push recovery those error docs enable. Use when indexing fails with "Render timeout", when a user sees a 504, when a reindex took much longer than expected, when an `.gts` edit triggers a surprising amount of re-render work, when investigating prerender-saturation incidents, when a render stalls in `waiting-stability` on a `_search` whose SQL is fast but whose response is slow to come back, when a row's index visit is slow and you need to know which field or link load inside the search doc ate the time, when a trivial-search-doc card still costs far more per visit than its doc justifies and you need to attribute the per-visit floor to a route step, or when asked to list / count cards with broken links in a realm. For staging/prod investigations this skill layers on top of `aws-access`, which provides the AWS session and the SSM port-forward path into the in-VPC database (authenticated as `claude_readonly_user`) — read that skill first when the question is about a deployed environment.
allowed-tools: Read, Grep, Glob, Bash
---

# Indexing diagnostics

Every indexer write (`IndexWriter.updateEntry`) persists a diagnostic blob on the row it wrote — the `diagnostics` JSONB column. Most of the blob is about what the prerender pipeline spent its time on and what category of stall (if any) the render was stuck in, but it also records non-timing render findings, notably `brokenLinks`. A row is produced by two visits on two channels, and each visit's diagnostics follow its writes: the index visit's breakdown lands on `boxel_index.diagnostics`, the prerender-html visit's render breakdown lands on `prerendered_html.diagnostics` (see [Two visits, two tables](#two-visits-two-tables--which-timings-live-where)). It's the primary tool for investigating:

- **A render that timed out during indexing** — classify the stall, fix the right layer. (Also applies to user-facing 504s since the UI path goes through the same prerender.)
- **A reindex that was slow but succeeded** — attribute wall-clock across the cards that got re-rendered, find the real culprit in the fan-out.
- **Which cards have broken links** — enumerate cards with a broken `linksTo` / `linksToMany` target straight from the column; those cards index cleanly, so `diagnostics.brokenLinks` is the only indexed signal. See [Mode E](#mode-e--enumerate-cards-with-broken-links).
- **Whether module pre-warm is effective** — confirm the pre-warm phase populates the definition cache under a key the indexer / on-demand reads actually hit (not a silent no-op), using the `definition-cache-key` hit/miss log channel. This one isn't about the `diagnostics` column — it reads the logs. See [Mode F](#mode-f--module-pre-warm-and-definition-cache-hitmiss).
- **Why an in-render `_search` was slow to come back** — when a render stalls in `waiting-stability` waiting on a query-backed `linksTo` / `linksToMany` search (the `boxel_index.diagnostics` shows it client-side as `queryLoadsInFlight` aging) but the SQL is fast, attribute the realm-server's request→response time across its stages (parse / SQL / loadLinks / serialize) and tell handler-time from queued-before-handler / event-loop saturation. Log-based, keyed by the correlation id. See [Mode G](#mode-g--an-in-render-_search-was-slow-server-side-search-timing).
- **A search doc that was slow to build** — attribute a slow index visit inside the search-doc build itself: the settle loop's link loads (`searchDocSettleMs`, per target in `searchDocLinkLoads`) vs the field walk (`searchDocMs`, per dotted field path in `searchDocFieldsMs`). See [Mode J](#mode-j--a-search-doc-was-slow-to-build-per-field--per-link-attribution).
- **The index job's wall didn't add up to its visits** — decompose the between-visit / non-render slice of an index job's wall (invalidation discovery, dependency ordering, module pre-warm, the serial per-visit client overhead, aggregate row writes, the final swap) into measured buckets: the once-per-job phases on `jobs.result.phaseTimings`, and the per-row client overhead on `boxel_index.diagnostics.indexVisitClientMs`. This is the wall that runs _between_ the server renders, so it's invisible in the per-row `totalElapsedMs` the other modes read. See [Mode K](#mode-k--the-index-jobs-between-visit-wall-non-render-overhead).
- **A trivial card still costs a fixed per-visit floor** — a card whose search doc is near-free (`searchDocMs`/`searchDocSettleMs` ~0) still pays a per-visit amount for the route machinery around the work (route transitions, instantiation, per-visit request plumbing). `indexRoutesMs` decomposes that floor into the wall-clock of each index-visit route step — `meta` / `icon` for a card, `fileExtract` / `icon` for a file — so the floor reads as measured buckets rather than being inferred from `renderElapsedMs`. See [Mode L](#mode-l--the-index-visits-per-route-floor-meta--icon--file-extract).

The first three read from the same `diagnostics` column; the difference is the query you start with. Modes F and G are log-based.

## Where the diagnostics live

Seven places, all correlated:

1. **`boxel_index.diagnostics` (and `boxel_index_working.diagnostics`)** — JSONB column, populated for **every** row the indexer writes, regardless of `has_error`. Source of truth for the **index visit** of a card/file: the `RenderTimeoutDiagnostics` server timings of that visit plus the host-side `PrerenderMetaDiagnostics` block (`serializeMs`, `searchDocMs`, `searchDocSettleMs`/`searchDocSettlePasses`, `searchDocFieldsMs`, `searchDocLinkLoads`, `computedCalls`/`computedCacheHits`), the per-route `indexRoutesMs` breakdown (the index-half sibling of the render channel's `renderFormatsMs` — the wall-clock of each index-visit route step, so the per-visit floor decomposes into `meta` / `icon` / `fileExtract` buckets; see [Mode L](#mode-l--the-index-visits-per-route-floor-meta--icon--file-extract)), and three write-side stamps: `invalidationId`, `indexedAt`, `requestId`. It also carries an `indexVisitClientMs` block (`read` / `renderRpc` / `bookkeeping`) — the indexer's per-row client-side overhead _outside_ the server render, i.e. this row's slice of the between-visit wall (see [Mode K](#mode-k--the-index-jobs-between-visit-wall-non-render-overhead)) — and a `brokenLinks` array on any card row whose render found a broken `linksTo` / `linksToMany` target — see [Mode E](#mode-e--enumerate-cards-with-broken-links). Note `brokenLinks` is the one block that isn't about _timing_: a card with broken links still indexes as a clean `type='instance'` (the broken slot renders a placeholder), so it's the only indexed signal that the row has a broken reference. Rows written by a fused single-visit pass (the SQLite in-browser path) carry one **combined** blob covering both visits here instead.
2. **`prerendered_html.diagnostics` (and `prerendered_html_working.diagnostics`)** — JSONB column, populated for every row the `prerender_html` job writes, success and render-error alike. Source of truth for the **prerender-html visit**: launch/wait timings, `renderElapsedMs`/`totalElapsedMs`, the per-format `renderFormatsMs` breakdown, and the visit's HTTP correlation id under `prerenderHtmlRequestId` (never `requestId` — that name always means an index visit). See [Two visits, two tables](#two-visits-two-tables--which-timings-live-where).
3. **`modules.diagnostics`** — JSONB column, populated for every row `persistModuleCacheEntry` writes (success and error paths). Source of truth for **module** renders (`prerenderModule` → definition extraction). Same `RenderTimeoutDiagnostics` shape with `requestId` flattened in; no `invalidationId` (modules don't go through `Batch.invalidate`). The row's existing `created_at` column is the wall-clock stamp for cross-table joins. See [Mode D](#mode-d--a-module-render-was-slow-or-hung) below.
4. **`error_doc.diagnostics`** — derived copy of the same table's `diagnostics`, written only for error rows: an index error's copy rides `boxel_index.error_doc`, a render error's rides `prerendered_html.error_doc` (an instance's effective error is the union of the two). Exists so the existing UI read path (`error_doc` → `CardErrorJSONAPI.meta.diagnostics` via `formattedError`) keeps working without a schema rename. Non-error rows have `error_doc = null`; go to `diagnostics` directly.
5. **Logs** — `prerender-server`, `manager`, and `remote-prerenderer` lines all carry `requestId=…`. `grep requestId=<uuid>` collates one call across all three processes. The same id lands on `boxel_index.diagnostics->>'requestId'` and `modules.diagnostics->>'requestId'` — and, for the render channel, on `prerendered_html.diagnostics->>'prerenderHtmlRequestId'` — so a hung card render and the module renders it triggered (via `getDefinition`) can be joined back to one investigation. For saturation incidents there's also the periodic `prerender-queue-snapshot` line on each prerender server.
6. **Realm-server search-timing logs** — separate from the prerender `requestId` chain above. The realm-server emits, per instrumented `_federated-search`, a `realm:search-timing` line (request→response stage breakdown) and a `realm:requests` `-->` line with `dur=` (total) — both keyed by `corr=<id>`, the `x-boxel-logging-correlation-id` the prerendered host stamps. A periodic `realm:health` line reports event-loop lag + in-flight `_search` count during saturation windows. These are the _server's_ view of the search the card is blocked on; the card's `boxel_index.diagnostics` only has the _client's_ view (`queryLoadsInFlight`). See [Mode G](#mode-g--an-in-render-_search-was-slow-server-side-search-timing).
7. **`jobs.result.phaseTimings`** — JSONB, one object per completed index job (on the `from-scratch-index` / `incremental-index` row's `result` column). The **job-level** phase decomposition: the once-per-job phases that surround and interleave the serial visit loop (`setupMs`, `discoverMs`, `orderMs`, `preWarmMs`, `swapMs`, and the from-scratch-only `mtimesMs`), plus `visitLoopMs` (the whole serial loop), `writeMs` (the aggregate row-write time — tracked here, not per row, because a row can't time its own INSERT), and `totalMs`. This is the only place the _between-visit_ wall is attributed; the per-row server render lives on `boxel_index.diagnostics.totalElapsedMs` and the per-row client overhead on `boxel_index.diagnostics.indexVisitClientMs`. See [Mode K](#mode-k--the-index-jobs-between-visit-wall-non-render-overhead).

For UI triage you'll typically read the JSON error response (which surfaces `error_doc.diagnostics` as `meta.diagnostics`). For operator / SQL triage — especially slow non-failing reindexes — query the `diagnostics` column directly.

## How to actually run these queries

The SQL examples below are environment-agnostic — they work the same against local dev, staging, or prod. What changes is _how you reach the database_:

- **Local dev**: `psql "$DATABASE_URL"` (or whatever your local boxel server uses) directly.
- **Staging / prod**: the RDS instances are private to the cardstack VPC. Use the `aws-access` skill — it covers (a) provisioning a Claude-usable AWS session via `mise run claude-aws <env> <token>`, (b) the SSM port-forward tunnel through the realm-server ECS task to RDS, and (c) connecting via psql as the read-only `claude_readonly_user` (member of `readonly_role`). This skill assumes you've already got that connection working; it doesn't re-document the AWS plumbing.

When wrapping a query below into the staging/prod form, run it through the `psql -h localhost -p <local-port> -A -t` invocation that the `aws-access` skill sets up — same SQL, different transport.

## Two visits, two tables — which timings live where

A URL is produced by two prerender visits on two channels, and each visit's diagnostics follow its writes:

| where                          | visit                | what's in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boxel_index.diagnostics`      | index visit          | that visit's server timings (`launchMs`, `waits`, `renderElapsedMs`, `totalElapsedMs`), the per-route floor split (`indexRoutesMs` — one number per index-visit route step, split into a `card` block `meta` / `icon` and a `file` block `fileExtract` / `icon`; see [Mode L](#mode-l--the-index-visits-per-route-floor-meta--icon--file-extract)), the search-doc build (`serializeMs`, `searchDocMs`, `searchDocSettleMs`/`searchDocSettlePasses`, the per-field `searchDocFieldsMs` and per-link-load `searchDocLinkLoads` detail, `computedCalls`/`computedCacheHits`), the indexer's own per-row client overhead outside the render (`indexVisitClientMs`: `read` / `renderRpc` / `bookkeeping` — see [Mode K](#mode-k--the-index-jobs-between-visit-wall-non-render-overhead)), `brokenLinks`, and the write-side stamps (`invalidationId`, `indexedAt`). HTTP id: `requestId`. |
| `prerendered_html.diagnostics` | prerender-html visit | that visit's server timings (`launchMs`, `waits`, `renderElapsedMs`, `totalElapsedMs`) plus `renderFormatsMs` — per-format wall-clock, split into a `card` and a `file` block with one number per html-route step (`isolated`, `head`, `atom`, `markdown`, `fitted`, `embedded`; the ancestor-driven `fitted`/`embedded` numbers each cover the whole ancestor chain). HTTP id: `prerenderHtmlRequestId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

So "why was indexing this card slow?" and "why was rendering this card slow?" are separately answerable per row: the index cost is `boxel_index.diagnostics`, the render cost is `prerendered_html.diagnostics`. Each side names the sub-step that dominated its channel: on the index side `indexRoutesMs` names the route (a slow `meta` build vs an `icon` render vs `fileExtract`), on the render side `renderFormatsMs` names the format (a slow `isolated` template vs a `fitted` render fanning out across many ancestors).

The field-name → visit mapping is constant across both tables: `requestId` always names an index visit's HTTP request, `prerenderHtmlRequestId` always names a prerender-html visit's. Join a row's two halves on url (each table keys on `(url, realm_url, type)`), then carry each side's id into the log search:

```sql
SELECT b.url,
       b.diagnostics->>'requestId'                 AS index_visit_request,
       (b.diagnostics->>'totalElapsedMs')::int     AS index_visit_ms,
       (b.diagnostics->>'searchDocMs')::int        AS search_doc_ms,
       p.diagnostics->>'prerenderHtmlRequestId'    AS render_visit_request,
       (p.diagnostics->>'totalElapsedMs')::int     AS render_visit_ms,
       p.diagnostics->'renderFormatsMs'            AS render_formats_ms
FROM boxel_index b
LEFT JOIN prerendered_html p
  ON p.url = b.url AND p.realm_url = b.realm_url AND p.type = b.type
WHERE b.url = '<card-url>'
  AND b.type = 'instance';
```

Caveats:

- Rows written by a fused single-visit pass (the SQLite in-browser path) carry one **combined** blob on `boxel_index.diagnostics` — summed timings across both visits, with the render visit's id under `prerenderHtmlRequestId` alongside `requestId` — and the inline prerendered_html write lands that same combined blob on the `prerendered_html` row.
- One prerender-html visit produces both of a URL's rows (`type='instance'` and `type='file'`), so both carry the same blob; the `card` block of `renderFormatsMs` describes the instance rendering and the `file` block the FileDef rendering.
- The two tables' generations advance independently: `p.rendered_at` / `p.generation` tell you _which_ index generation the persisted render diagnostics belong to (fresh when it equals `b.generation`).
- A `prerender_html` job that never ran (queued, crashed pre-write) leaves no diagnostics — check `jobs` / `job_reservations` for the realm's `prerender_html` lane instead.

## The four stall categories

Every slow or timed-out render falls into one of:

- **Launch stall**: the request waited in the render-semaphore or tab queue and never got a real render attempt. Fix is capacity, not host code.
- **Loader stall**: the render started but was still pulling `.gts` modules when the timer fired. Fix is module graph / network.
- **Data stall**: the render got past module load but is still fetching cards, file-meta, or query-field results. Fix is the host data layer or the backend search. When it's a query-field `_search` (`queryLoadsInFlight` aging), [Mode G](#mode-g--an-in-render-_search-was-slow-server-side-search-timing) attributes the backend search to the realm-server's own request→response stages.
- **Render stall**: the render is in DOM rendering / stability-wait but nothing is in flight. Fix is Glimmer / template side.

If you pick the wrong category you waste a day. The diagnostic fields in the [Classify in one pass](#classify-in-one-pass) table below pick it for you.

## Prerender priorities

A prerender request a worker job spawns carries a numeric `priority` — threaded from that job through the per-tab queue, the per-affinity file-admission semaphore, and the per-server render semaphore (a request with no originating job priority omits the field). The value is the worker-job priority of the job that produced the render, so it splits by both initiator (user vs. system) and job family (indexing vs. prerender-html):

- **`10` — `userInitiatedPriority`**. A user-initiated index visit: the `_reindex` endpoint, ad-hoc card publishes, manual UI-driven reindex actions.
- **`9` — `userInitiatedPrerenderHtmlPriority`**. The HTML render a user-initiated index pass spawns — one tier below the index visit so it stays off the indexing hot path. **Exception:** a render a publish is awaiting (published-realm readiness gates on it) is lifted to `10`, co-equal with indexing, so the prerender server admits it ahead of ordinary user renders.
- **`1` — `systemInitiatedPriority`**. A system-initiated index visit: scheduled full-reindex sweeps, `_full-reindex` runs, the worker's continuous reindex queue. The default worker-job priority for any code path that doesn't explicitly opt in.
- **`0` — `systemInitiatedPrerenderHtmlPriority`**. The HTML render a system-initiated index pass spawns — the background floor only the all-priority worker pool takes.

The two job families land on different diagnostics tables: an index-visit row on `boxel_index.diagnostics` carries 10 or 1; the prerender-html render it spawns, on `prerendered_html.diagnostics`, carries 9 or 0 — one notch below its initiator — except a publish-awaited render, which carries 10. So `priority=10` can show up on either table: an index visit, or a publish's HTML render.

Higher priority dequeues first; FIFO is preserved within a priority bucket. There is **no preemption** — an in-flight lower-priority render runs to completion. The next free slot goes to the highest-priority queued waiter.

Why this matters for triage:

1. **Reading a stuck render**: a user-initiated render (10 on an index visit or a publish-awaited render, 9 on an ordinary user render) is a UX-facing request. If it's stuck on `waits.tabQueueMs` or `waits.semaphoreMs`, that's the saturation event priority routing was designed to mitigate. A system-initiated render (1 or 0) stuck on the same wait is background work — operationally less urgent and often expected during a deliberate reindex burst.

2. **Distinguishing capacity issues from priority misrouting**: a user-priority row that waited >1s in `tabQueueMs` while the affinity's `prerender-queue-snapshot` shows it queued behind same-or-higher-priority work is a **capacity** problem — the user-priority workload exceeded the fleet. The same row queued behind strictly lower-priority (background) work, with manager-side priority routing live in the build, is a **routing** failure — the manager picked the wrong server, or the file render the row was queued behind isn't releasing. These need different fixes.

3. **Confirming priority routing actually fired**: if a known-user `_reindex` shows up in `diagnostics` with a system-tier priority (1 or 0), the producer-side threading (job → IndexRunner → `prerenderVisit`) regressed somewhere. Most-likely place is a new task type that didn't pick up `jobInfo.priority`.

4. **Sharpening the deadlock fingerprint**: `affinitySnapshot.sameAffinityActivity[*].priority` lets you tell a self-referential prerender deadlock apart from priority-driven queuing. Same-priority queued module sub-render on a stuck same-priority file render → deadlock. Higher-priority queued sibling → priority routing working as intended.

The priority value lives on the `diagnostics.priority` field and on every `sameAffinityActivity` entry. The periodic `prerender-queue-snapshot` log line carries per-affinity priority breakdowns. See [Classify in one pass](#classify-in-one-pass) and the field-by-field section below for the exact triage rules.

## Mode A — a render timed out

Pull the diagnostic JSON for the erroring row — from the channel the failure happened on. An index-visit failure (search-doc build, serialization) errors the `boxel_index` row; an html-render failure in the `prerender_html` job errors the `prerendered_html` row. When you don't know which, check both — an instance's effective error is the union:

```sql
SELECT 'index'  AS channel, diagnostics, error_doc IS NOT NULL AS errored
FROM boxel_index
WHERE url = '<errored-card-url>' AND type = 'instance'
UNION ALL
SELECT 'render' AS channel, diagnostics, error_doc IS NOT NULL AS errored
FROM prerendered_html
WHERE url = '<errored-card-url>' AND type = 'instance';
```

(Or read `error_doc.diagnostics` from the JSON:API error response — same shape.)

Walk the fields per [Classify in one pass](#classify-in-one-pass). The _first_ positive signal wins; stop there. On the render channel, `renderFormatsMs` additionally names which format's render ate the time.

## Mode B — an incremental reindex was slow

Every `Batch.invalidate(urls)` call mints a UUID stashed into `diagnostics.invalidationId` for every row written during that fan-out. If a `.gts` edit invalidates 8 rows (one file + seven card instances), all eight carry the same `invalidationId` — so you can look at the whole reindex as a group.

**Step 1 — find the invalidation you care about.** If you don't already have the ID, discover recent big ones:

```sql
-- Biggest fan-outs in the realm, most recent first
SELECT
  diagnostics->>'invalidationId' AS id,
  count(*)                              AS rows_touched,
  to_timestamp(
    max((diagnostics->>'indexedAt')::bigint) / 1000
  )                                     AS last_indexed_at,
  sum((diagnostics->>'renderElapsedMs')::int)
                                        AS total_render_ms,
  max((diagnostics->>'renderElapsedMs')::int)
                                        AS slowest_ms
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND diagnostics->>'invalidationId' IS NOT NULL
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
  diagnostics->>'renderStage'                  AS stage,
  (diagnostics->>'renderElapsedMs')::int       AS render_ms,
  (diagnostics->>'launchMs')::int              AS launch_ms,
  diagnostics->'waits'                         AS waits,
  jsonb_array_length(
    COALESCE(diagnostics->'queryLoadsInFlight', '[]'::jsonb)
  )                                                   AS queries_stuck,
  jsonb_array_length(
    COALESCE(diagnostics->'inFlightModuleImports', '[]'::jsonb)
  )                                                   AS modules_stuck,
  to_timestamp((diagnostics->>'indexedAt')::bigint / 1000)
                                                      AS indexed_at
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND diagnostics->>'invalidationId' = '<uuid>'
ORDER BY render_ms DESC NULLS LAST;
```

**Step 3 — classify each slow row.** For the top offenders, pull the full `diagnostics` and apply the [Classify in one pass](#classify-in-one-pass) table to each. Common patterns:

- One row dominates (e.g. a dashboard card) and the rest are cheap. The big row is the real target — investigate its `queryLoadsInFlight` / `recentModuleEvaluations` / `cardDocLoadsInFlight`.
- All rows share a large `launchMs`. Capacity contention during the reindex, not the cards' fault.
- The first row in the batch (min `indexedAt`) has a large `renderElapsedMs` but the rest are cheap — this is the cold-loader tax paid by whichever card was rendered first after `clearCache: true` fired. Expected on any executable invalidation; only worth chasing if the cold cost is disproportionate to the dep closure.
- The `deps` / `types` columns on the same rows tell you _why_ each row was invalidated — useful for discovering unintentionally-heavy transitive deps (e.g. a dashboard re-renders because one of its metrics modules has a runtime reference to the changed module).

**Other useful queries:**

```sql
-- Slowest single renders in the realm, regardless of error state
SELECT
  url,
  to_timestamp((diagnostics->>'indexedAt')::bigint / 1000) AS indexed_at,
  (diagnostics->>'renderElapsedMs')::int                   AS render_ms,
  diagnostics->>'renderStage'                              AS stage,
  diagnostics->>'invalidationId'                           AS group,
  has_error
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
ORDER BY render_ms DESC NULLS LAST
LIMIT 20;

-- p95 render time by realm
SELECT
  realm_url,
  avg((diagnostics->>'renderElapsedMs')::int) AS avg_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY (diagnostics->>'renderElapsedMs')::int
  )                                                   AS p95_ms,
  count(*)                                            AS rows
FROM boxel_index
WHERE diagnostics->>'renderElapsedMs' IS NOT NULL
GROUP BY 1
ORDER BY p95_ms DESC NULLS LAST
LIMIT 20;

-- Rows where the render.meta computed-field traversal dominates the
-- render budget. `computedCalls` + the host-side `searchDocMs` /
-- `serializeMs` are emitted by the host route per row. Use these to
-- find aggregate-style cards that are eating their render budget on
-- compute work rather than data loads or template stalls.
SELECT
  url,
  to_timestamp((diagnostics->>'indexedAt')::bigint / 1000) AS indexed_at,
  (diagnostics->>'computedCalls')::int                     AS calls,
  (diagnostics->>'computedCacheHits')::int                 AS cache_hits,
  (diagnostics->>'serializeMs')::numeric                   AS serialize_ms,
  (diagnostics->>'searchDocMs')::numeric                   AS search_doc_ms,
  (diagnostics->>'searchDocSettleMs')::numeric             AS settle_ms,
  (diagnostics->>'renderElapsedMs')::int                   AS render_ms
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND diagnostics->>'computedCalls' IS NOT NULL
ORDER BY (diagnostics->>'computedCalls')::int DESC NULLS LAST
LIMIT 20;
```

For any row this surfaces, [Mode J](#mode-j--a-search-doc-was-slow-to-build-per-field--per-link-attribution) drills inside its search-doc cost — which field, which link load.

## Mode C — a worker job is stuck or got rejected

Mode A and Mode B both assume `boxel_index` has up-to-date `diagnostics` for the rows you're investigating. That assumption breaks when an indexing job is _in progress_ or got rejected mid-flight: with one exception (next paragraph), nothing has been committed to `boxel_index` yet (the indexer writes to a staging table and only swaps on success — see [Reading partial progress from `boxel_index_working`](#5-reading-partial-progress-from-boxel_index_working) below), so the diagnostics column there is stale or null for the affected rows.

**The exception — a batch-level setup-phase failure.** An `incremental-index` job that throws during its setup phase (the invalidation fan-out, dependency ordering, or file-meta prefetch — everything before the per-URL visit loop) still rejects, but a recovery pass first commits a `has_error = TRUE` error row for every URL the job was handed with an `update` operation (`delete` operations are left untouched so a failed delete is never half-applied; see `IndexRunner.#recordSetupPhaseError` in `packages/runtime-common/index-runner.ts`). The signature that distinguishes this from per-row render failures:

- N error rows sharing **one identical `error_doc.message`** and one `job_id`, at one generation — matching the rejected job's `result` error and its `args.changes` URL set.
- The error docs carry **no visit diagnostics** (no render or index visit ever ran for these URLs) — a render failure's error doc carries the visit's timing blocks.
- `realm_meta` at that generation is a carry-forward of the prior generation's summary, not a recompute, so type counts do not move.
- An incremental invalidation event is broadcast for the attempted URLs even though the job rejected, so subscribers re-fetch and see the error state.

Recovery for the errored URLs is any later write touching them (error rows are excluded from job resume and invalidate like any other row — a re-push replaces them with clean content) or the next full reindex.

For everything else in this mode the diagnostic stance flips from "what timed out" (Mode A) or "what was slow" (Mode B) to **"what hasn't happened yet"**. You're reconstructing the work the job _would have done_ from three sources together:

1. **`boxel_index_working`** — the staging table the indexer writes to as it makes progress. On success its rows for the touched URLs are copied into `boxel_index` (`Batch.applyBatchUpdates` in `packages/runtime-common/index-writer.ts`). On failure (worker crash, job timeout, manual cancel) the working rows are left behind, which is exactly the bisection signal you want: any row in `boxel_index_working` that is _not yet_ in `boxel_index` (or has a higher `realm_version`) was already processed by the stuck job.
2. **EFS file mtimes** — reachable via the `aws-access` skill's "Browsing the EFS filesystem" path (the `boxel-claude-fs-readonly-<env>` Fargate task). Combined with `boxel_index.last_modified` (the indexer's view of when each file was last processed) this lets you reconstruct what _would_ have been invalidated by a from-scratch run, _before_ any `boxel_index_working` rows existed.
3. **Worker logs** in CloudWatch (`ecs-boxel-worker-<env>`) — confirms the job's start, the file it was on at the freeze point, and any partial completion lines.

### 1. Recognising the situation

You're in Mode C territory if any of these hold:

- The worker log shows a `starting from-scratch indexing` or `starting from incremental indexing` line for the realm but no matching `completed from scratch indexing` / `completed incremental indexing` line in the same `[job: <id>.<rid>]` group (the job-identity prefix is `[job: <jobId>.<reservationId>]`; see `jobIdentity` in `packages/runtime-common/utils.ts`).
- `boxel_index` rows for the realm look stale (`last_modified` predates the file's EFS mtime, or `diagnostics->>'indexedAt'` is older than you'd expect for the last reindex you triggered).
- The job-id appears as `unfulfilled` in `jobs` and has at least one row in `job_reservations` whose `completed_at IS NULL` (in-flight). A `rejected` row in `jobs` with no `completed_at` on its newest reservation means the worker bailed but the worker-finalize transaction may not have run cleanly.
- A subsequent reindex was enqueued and re-reserved the same concurrency group (`indexing:<realm-url>`) — check `job_reservations.created_at` for the same `job_id`.

Job/reservation health (read-only):

```sql
-- Find recent unfinished or rejected indexing jobs for a realm.
SELECT
  j.id                                                AS job_id,
  j.job_type,
  j.status,
  j.created_at,
  j.finished_at,
  j.args->>'realmURL'                                 AS realm_url,
  j.timeout                                           AS timeout_sec,
  j.concurrency_group
FROM jobs j
WHERE j.args->>'realmURL' = '<realm-url>'
  AND j.job_type IN ('from-scratch-index', 'incremental-index', 'copy-index')
ORDER BY j.created_at DESC
LIMIT 20;

-- Reservations for one job. completed_at IS NULL with locked_until in the
-- future = a worker is currently holding it. completed_at IS NULL with
-- locked_until in the past = the reservation expired and the row is
-- eligible to be claimed by another worker (i.e. the job will be retried).
SELECT
  id, job_id, worker_id, created_at, locked_until, completed_at,
  locked_until < NOW() AS expired
FROM job_reservations
WHERE job_id = <job-id>
ORDER BY created_at DESC;
```

(See `packages/runtime-common/realm-index-updater.ts::publishFullIndex` and `update`, `packages/runtime-common/jobs/reindex-realm.ts`, and `packages/postgres/pg-queue.ts` for how these tables are populated and what `unfulfilled` / `resolved` / `rejected` mean. The full-reindex path (`enqueueReindexRealmJob` with `clearLastModified: true`) intentionally nulls `boxel_index.last_modified` _before_ enqueuing — relevant to step 3 below.)

### 2. Distinguishing from-scratch vs incremental

Look at the worker log's start line for the job. Both come from `index-runner.ts` at debug level on the `index-runner` logger:

- From-scratch: `[job: <jobId>.<rid>] starting from scratch indexing` (line 156). The wrapping task layer (`tasks/indexer.ts` line 252) also logs `[job: …] starting from-scratch indexing for job: <stringified-args>` on the `worker` logger; this is the line that contains the full args payload (realmURL, realmUsername).
- Incremental: `[job: <jobId>.<rid>] starting from incremental indexing for <comma-separated-urls>` (line 273). The matching `worker`-logger line is `[job: …] starting incremental indexing for job: <stringified-args>` — its `changes` array is the seed set you'll need in step 4.

Both lines are at `debug`. If the worker's `LOG_LEVELS` is `*=info` (the default — see `packages/realm-server/setup-logger.ts`), neither will be in CloudWatch. Check which loggers are on before you try to grep — see [step 7](#7-cross-referencing-with-worker-logs).

The next steps differ by mode:

- From-scratch: the seed isn't in the job args; you have to reconstruct it from EFS mtimes vs `boxel_index.last_modified` (step 3).
- Incremental: the seed is the `changes` array in the job's args (step 4).

### 3. Reconstructing the invalidation graph for a from-scratch job

The from-scratch path lives in `IndexRunner.fromScratch` (`packages/runtime-common/index-runner.ts`). It:

1. Reads every existing row's `(url, type, last_modified, has_error)` from `boxel_index` — this is `Batch.getModifiedTimes` in `index-writer.ts` (line 212):

   ```sql
   SELECT i.url, i.type, i.last_modified, i.has_error
   FROM boxel_index AS i
   WHERE i.realm_url = '<realm-url>';
   ```

2. Walks the realm's filesystem via the `_mtimes` endpoint (`Realm.realmMtimes` in `realm.ts` line 4307) — for the deployed environments you reproduce this walk by browsing EFS via the fs-explorer task in `aws-access`. The endpoint walks `realmsRootPath` recursively, calls `lastModified()` per file, and returns `{ <fileURL>: <epoch-seconds> }`. Skips anything matched by `.gitignore` or the realm's hard-coded ignore list (`.git`, `.template-lintrc.js`).

3. Builds the seed set in `discoverInvalidations` (`packages/runtime-common/index-runner/discover-invalidations.ts`). A file is in the seed if **any** of:
   - it's not in the index (`!indexEntry`),
   - the index row has `has_error = TRUE` (re-try error rows on every from-scratch),
   - `last_modified IS NULL` in the index (full-reindex with `clearLastModified` zeroed it — that's why `_full-reindex` is destined to invalidate everything),
   - the filesystem mtime differs from the index's `last_modified` (file was edited since last successful index).

   Plus: any URL in `boxel_index` that is **not** present on disk is added as a deletion ("tombstone") seed. From the code (lines 64-90):

   ```ts
   for (let [mtimeUrl, lastModified] of Object.entries(filesystemMtimes)) {
     let indexEntry = indexMtimes.get(mtimeUrl);
     if (
       !indexEntry ||
       indexEntry.hasError ||
       indexEntry.lastModified == null ||
       lastModified !== indexEntry.lastModified
     ) {
       invalidationList.push(mtimeUrl);
     }
   }
   let deletedUrls = [...indexMtimes.keys()].filter(
     (indexedUrl) => !filesystemMtimes[indexedUrl],
   );
   invalidationList.push(...deletedUrls);
   ```

   Reproduce that comparison by hand. To find rows in the index that _would have_ been seeded:

   ```sql
   -- "Stale" rows in boxel_index — anything where the indexer's view of
   -- last_modified is missing, errored, or older than what's on disk is
   -- a from-scratch seed candidate. (Compare against the fs-explorer
   -- mtime listing for the realm; the EFS endpoint reports seconds, the
   -- DB stores seconds in `last_modified`.)
   SELECT
     i.url,
     i.type,
     i.has_error,
     i.last_modified,
     to_timestamp(i.last_modified::bigint) AS index_seen_at
   FROM boxel_index AS i
   WHERE i.realm_url = '<realm-url>'
     AND (
       i.has_error = TRUE
       OR i.last_modified IS NULL
     )
   ORDER BY i.has_error DESC, i.last_modified ASC NULLS FIRST;
   ```

   Then take the EFS listing for the same realm (recursively via the fs-explorer Caddy autoindex — `packages/runtime-common/realm.ts` walks every file under the realm root, skipping `.git` / ignored paths) and join it against `boxel_index.last_modified`. The set of files where filesystem mtime differs from `last_modified` (or the file isn't in `boxel_index` at all) is the from-scratch seed.

4. Once the seed is known, the runner immediately calls `Batch.invalidate(seed)` to grow the seed by consumer fan-out (step 5). The visit loop then iterates over the resulting invalidation list.

If the worker froze before any seed-driven visit ran (no rows in `boxel_index_working` for this batch — see step 6), it's stuck either in the mtime-walk on the realm-server side (slow EFS / many files) or in `Batch.invalidate`'s consumer fan-out. The CloudWatch line that proves we got past mtime-collection is `[job: …] discovering invalidations in dir <realm-url>` — emitted on both `index-runner` and `index-perf` from `discoverInvalidations.ts` line 34/37. Absence of that line on a `*=debug` worker means we're still in the fetch.

### 4. Reconstructing the invalidation graph for an incremental job

The incremental path (`IndexRunner.incremental`) skips the mtime walk entirely. The seed is the `changes` array in the job args, available verbatim in:

- The `jobs.args` JSONB row for `job_type = 'incremental-index'`:

  ```sql
  SELECT id, args->'changes' AS changes
  FROM jobs
  WHERE id = <job-id>;
  ```

- The worker's `starting incremental indexing for job: …` line (worker logger, debug level), which stringifies the entire `args`.
- `IndexRunner.incremental`'s own line (index-runner logger, debug level): `starting from incremental indexing for <comma-separated-urls>` — gives just the URLs, not operations.

Each entry is `{ url: string, operation: 'update' | 'delete' }`. The runner converts that to `URL` objects, calls `Batch.invalidate(urls)` once, and proceeds to visit. Skip directly to the consumer fan-out (step 5) using these URLs as the seed.

### 5. Computing consumers (the fan-out)

The fan-out is **iterative**, not a single recursive CTE. `Batch.invalidate(urls)` (`packages/runtime-common/index-writer.ts` line 826) drives the loop:

1. For each seed URL, collect concrete-URL matches across `boxel_index_working` (current batch) and `boxel_index` (production) — `urlsMatchingSeed` (lines 776-819).
2. For each matched URL, call `calculateInvalidations(alias)` (line 1066) which finds rows that reference the alias in their `deps` jsonb array, then recurses into those rows' aliases. Recursion is bounded by a `visited` set per `invalidate()` call — there are no fixed iteration counts, the walk continues until `visited` saturates.
3. The single SQL building block is `itemsThatReference(resolvedPath)` (line 978), which on Postgres uses jsonb containment. **Where to read from depends on the question**: at runtime the indexer queries `boxel_index_working` so mid-batch tombstones and rewrites are visible to subsequent fan-out iterations. For _post-mortem_ reconstruction of a stuck job, prefer `boxel_index` (committed state) — that gives you the state the runner _started_ with, before its own writes confused the picture. If the job partially advanced, probe both tables side-by-side to see what was already redrawn vs. what was still untouched.

   ```sql
   -- One iteration of consumer fan-out, against the committed state
   -- (post-mortem flavour). Returns rows whose deps array contains the
   -- seed URL. Loop in your head: feed each result's file_alias (or url,
   -- per the invalidationTraversalAlias rule) back in as the next
   -- iteration's seed.
   SELECT i.url, i.file_alias, i.type
   FROM boxel_index AS i
   WHERE i.deps @> '["<seed-url>"]'::jsonb
     AND i.realm_url = '<realm-url>'
   LIMIT 1000;

   -- Same iteration against the live in-batch view (matches what the
   -- runner is actually walking right now). For a stuck job, run BOTH
   -- and diff the URL sets — the difference is what the batch has
   -- already tombstoned or rewritten.
   SELECT i.url, i.file_alias, i.type
   FROM boxel_index_working AS i
   WHERE i.deps @> '["<seed-url>"]'::jsonb
     AND i.realm_url = '<realm-url>'
   LIMIT 1000;
   ```

   When the seed has a `@cardstack/...` "registered prefix" form (catalog modules, etc.), the runtime also probes the unresolved form — `@>` against `["<unresolved-prefix>/..."]`. Reproduce by-hand only if your seed URL is one of those (look for `unresolveCardReference` in `card-reference-resolver.ts`).

4. The `invalidationTraversalAlias` rule (line 1095) decides what gets fed into the _next_ iteration:
   - For `type = 'instance'` rows: the row's own `url` (the `.json` URL).
   - For executable file rows (`.gts` / `.ts` / `.js` / `.gjs`) with a `file_alias`: the `file_alias` (path with extension trimmed). Executable consumers see the _aliased_ URL in `deps`, not the source file with extension.
   - Otherwise (non-executable file rows): the row's `url`.

5. After the loop converges (no new URLs added to `visited`), `tombstoneEntries(invalidations)` (line 684) inserts a `is_deleted = true` row for every invalidated URL into `boxel_index_working` with `realm_version = <next-version>`, stamped with the batch's current `invalidationId`. **This is the first DB-side write of the batch.** If the worker died before this, `boxel_index_working` will not yet contain partial-progress rows for the new realm version (step 6 will be empty).

To reconstruct the consumer set against the live DB, run the iteration manually:

```sql
-- Iteration 1: direct consumers of one seed URL.
SELECT i.url, i.file_alias, i.type
FROM boxel_index AS i
WHERE i.realm_url = '<realm-url>'
  AND i.deps @> '["<seed-url>"]'::jsonb;

-- Iteration N: feed each previous iteration's traversal alias (per the
-- invalidationTraversalAlias rule above) back into the same query.
-- Stop when the union of unique URLs stops growing.
```

For a quick approximation against a stuck job — a single SQL pass that covers most realms (no transitive recursion, but catches one hop):

```sql
-- All rows in boxel_index that depend on any URL in a seed set.
-- Use this to estimate the size of the fan-out one hop deep.
WITH seeds(url) AS (VALUES
  ('<seed-url-1>'),
  ('<seed-url-2>')
)
SELECT DISTINCT i.url, i.type, i.file_alias
FROM boxel_index AS i, seeds
WHERE i.realm_url = '<realm-url>'
  AND i.deps @> jsonb_build_array(seeds.url);
```

Two-hop fan-out: rerun with the first hop's `(url, file_alias, type)` plugged in via `invalidationTraversalAlias` (instance → use `url`; executable file → use `file_alias`; non-executable file → use `url`). In practice the runtime walk converges in 2-4 hops for typical realms; if you're still discovering new URLs after 5-6 hops, you've hit a tightly-cycled module graph and reconstruction by hand isn't going to be cheap.

### 6. Reading partial progress from `boxel_index_working`

`boxel_index_working` carries the batch's in-progress writes, keyed by `(url, realm_url)`. The indexer writes here continuously via `Batch.updateEntry` (line 310). On `Batch.done()` (line 476), rows are copied into `boxel_index` with the new `realm_version` and the working table is **left in place** — it's not truncated (each invalidation is keyed by realm version inside the table). For a stuck job, the rows already written carry the same `invalidationId` and bracket the freeze point.

```sql
-- Partial progress for a stuck batch: rows the in-progress job has
-- already written, ordered by indexedAt so the bottom row is the file
-- that was being worked on when things froze.
--
-- The diagnostic projection mirrors Mode B's fan-out query — use
-- diagnostics->>'renderStage' / 'currentlyEvaluatingModule' /
-- 'recentModuleEvaluations[0].url' to identify the specific module the
-- worker stalled on.
SELECT
  url,
  type,
  has_error,
  realm_version,
  to_timestamp((diagnostics->>'indexedAt')::bigint / 1000)
                                                       AS indexed_at,
  diagnostics->>'invalidationId'                AS invalidation_id,
  diagnostics->>'renderStage'                   AS render_stage,
  diagnostics->>'currentlyEvaluatingModule'     AS evaluating_module,
  diagnostics->'recentModuleEvaluations'->0->>'url'
                                                       AS slowest_module,
  jsonb_array_length(
    COALESCE(diagnostics->'inFlightModuleImports', '[]'::jsonb)
  )                                                    AS modules_in_flight,
  jsonb_array_length(
    COALESCE(diagnostics->'queryLoadsInFlight', '[]'::jsonb)
  )                                                    AS queries_in_flight
FROM boxel_index_working
WHERE realm_url = '<realm-url>'
  AND diagnostics->>'invalidationId' = '<invalidation-id>'
ORDER BY (diagnostics->>'indexedAt')::bigint ASC;
```

If you don't already have an `invalidationId`, find the most recent batch's ID against the working table (the last `updateEntry` for the realm wins):

```sql
SELECT
  diagnostics->>'invalidationId'                AS invalidation_id,
  realm_version,
  count(*)                                             AS rows_written,
  to_timestamp(
    min((diagnostics->>'indexedAt')::bigint) / 1000
  )                                                    AS first_write,
  to_timestamp(
    max((diagnostics->>'indexedAt')::bigint) / 1000
  )                                                    AS last_write
FROM boxel_index_working
WHERE realm_url = '<realm-url>'
  AND diagnostics->>'invalidationId' IS NOT NULL
GROUP BY 1, 2
ORDER BY last_write DESC
LIMIT 10;
```

The bottom row of the per-`invalidationId` query (max `indexedAt`) is **the most recently completed file**; the file the worker stalled on is most likely the _next_ one in the planned visit order (which is sorted in `index-runner.ts::sortInvalidations` — `.json` files visited after their non-`.json` counterparts; otherwise lexical by href). Combine three signals to pin it down:

1. The bottom row's `url` is the last-completed file.
2. The worker log's last `begin fused visit of file <url>` line for the job (visit-file.ts line 108, `index-runner` logger, debug level) names the file the visit _started_ on. If there's no matching `completed fused visit of file <url>` line, that's where the worker froze.
3. The bottom row's `currentlyEvaluatingModule` / `recentModuleEvaluations[0].url` / `inFlightModuleImports[]` say _which_ module inside that visit was the stall point — same field semantics as Mode A.

To read which row would have been visited next from the working table (rows already invalidated but not yet written-with-content — these are the tombstones inserted by `Batch.invalidate`):

```sql
-- Tombstones the batch inserted but hasn't yet rewritten with content.
-- Filtered to the batch's realm_version so older tombstones don't leak
-- in. Sort lexically (close to the actual visit order — see
-- sortInvalidations).
SELECT url, type, file_alias, is_deleted
FROM boxel_index_working
WHERE realm_url = '<realm-url>'
  AND realm_version = <realm-version>
  AND is_deleted = TRUE
ORDER BY url ASC;
```

If `boxel_index_working` has **zero rows** for this batch's `invalidationId`, the worker died before any DB write — see [step 9](#9-what-this-mode-cant-tell-you).

### 7. Cross-referencing with worker logs

The worker logs to `ecs-boxel-worker-<env>` (see the `aws-access` skill's CloudWatch table). The relevant logger names:

| Logger                | Defined at                                                                                  | Lines you care about                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker`              | `packages/runtime-common/worker.ts:80`, `packages/realm-server/worker.ts:22`                | `starting from-scratch indexing for job: <args>` and `starting incremental indexing for job: <args>` (debug). Includes the full job args — use this to recover the seed for incrementals.                                                                                                                                                                                                                                  |
| `realm-index-updater` | `packages/runtime-common/realm-index-updater.ts:29`                                         | `Realm <url> is starting indexing` (info), `Realm <url> has completed indexing in <s>s: <stats>` (info). Always on at `*=info`; coarse but covers job lifecycle.                                                                                                                                                                                                                                                           |
| `index-runner`        | `packages/runtime-common/index-runner.ts:48`                                                | `starting from scratch indexing` / `starting from incremental indexing for <urls>` (debug), `discovering invalidations in dir <url>` (debug), `begin fused visit of file <url>` / `completed fused visit of file <url>` per file (debug, both in `visit-file.ts`), `completed from scratch indexing in <ms>ms` / `completed incremental indexing for <urls> in <ms>ms` (debug). **This is the per-file progress channel.** |
| `index-perf`          | `packages/runtime-common/index-runner.ts:50`, `packages/runtime-common/index-writer.ts:173` | Per-stage perf timings (debug): `time to get file system mtimes <ms>`, `time to invalidate <url> <ms>`, `completed getting index mtimes in <ms>`, `completed invalidations in <ms>`, `completed index visit in <ms>`, `completed index finalization in <ms>`, `inserted invalidated rows for <urls> in <ms>`, `time to determine items that reference <path> <ms>`. Useful to confirm _which_ phase a stuck job is in.     |

`LOG_LEVELS` is read once at process start in `packages/realm-server/setup-logger.ts:4`:

```ts
(globalThis as any)._logDefinitions = makeLogDefinitions(
  process.env.LOG_LEVELS || '*=info',
);
```

Default is `*=info`, which means **none of the per-file or per-phase indexing lines appear** in CloudWatch. To get bisection-grade detail for a worker investigation, set:

```
LOG_LEVELS=*=info,index-runner=debug,index-perf=debug,worker=debug
```

In the deployed environments this is an environment variable on the worker ECS task definition; the task reads it from the same place `setup-logger.ts` reads any other env var. The operator paths to update it:

- **Staging / production**: `LOG_LEVELS` is held in AWS SSM Parameter Store at `/<env>/boxel/LOG_LEVELS` (e.g. `/staging/boxel/LOG_LEVELS`, `/production/boxel/LOG_LEVELS`). The worker ECS task definition references it via `valueFrom`, so the value is injected as the container's `LOG_LEVELS` env var at task start. To adjust levels:
  1. Update the SSM parameter value (AWS Console → Systems Manager → Parameter Store, or `aws ssm put-parameter --name /<env>/boxel/LOG_LEVELS --value '<new-levels>' --overwrite` if you have write access — Claude does not).
  2. Force a new deployment of `boxel-worker-<env>` from the ECS console (Services → boxel-worker-<env> → Update → "Force new deployment"). The new task picks up the updated SSM value at boot.
  3. The realm-server task reads `LOG_LEVELS` for _its own_ logging; in deployed envs the worker is a separate task and only its `LOG_LEVELS` matters for indexing-job logs. If you also want indexing logs that the realm-server emits during invalidation discovery (e.g. for jobs the realm-server queues directly), redeploy `boxel-realm-server-<env>` too.

  Levels apply to subsequently-launched worker processes; a job already in flight keeps the levels it was launched with. So for triage of a _future_ job, update SSM and redeploy first, then trigger the reindex.

- **Locally**: prepend the env var, e.g. `LOG_LEVELS='*=info,index-runner=debug,index-perf=debug' pnpm start-all` — same as the `prerenderer-reproduce=debug` pattern in the [Reproducing a render interactively](#reproducing-a-render-interactively) section.

Sample CloudWatch greps, using `cw` from the `aws-access` skill (substitute `claude-staging` / `claude-prod` and the matching log group):

```sh
# All log lines for a specific job (job id + reservation id make the
# group key). Run AFTER you have job_id from the jobs query in step 1.
cw --profile claude-staging --region us-east-1 tail -b 2h \
  -g '[job: 4271.' \
  ecs-boxel-worker-staging

# Lifecycle lines only (always-on at info).
cw --profile claude-staging --region us-east-1 tail -b 2h \
  -g 'Realm http://realms.example.com/<realm>/' \
  ecs-boxel-worker-staging

# Per-file progress (only useful if index-runner=debug is on).
cw --profile claude-staging --region us-east-1 tail -b 2h \
  -g 'fused visit of file' \
  ecs-boxel-worker-staging

# Phase boundaries (only useful if index-perf=debug is on).
cw --profile claude-staging --region us-east-1 tail -b 2h \
  -g 'completed invalidations\|completed index visit\|completed index finalization' \
  ecs-boxel-worker-staging
```

### 8. Putting it together — confidence levels

A short rubric for the most common shapes:

- **High confidence the stall is at file X**: the bottom row of `boxel_index_working` (max `indexedAt` for the batch's `invalidationId`) is X **AND** the worker's last `begin fused visit of file X` line has no matching `completed fused visit of file X` line **AND** the bottom row's `recentModuleEvaluations[0].url` (or `currentlyEvaluatingModule` / `inFlightModuleImports[0]`) is a module under X. Treat the row's `diagnostics` as a Mode A capture and walk the [Classify in one pass](#classify-in-one-pass) table.
- **Medium confidence**: only two of the three signals agree. Most often the worker log is the dropout — debug-level logging wasn't on. Promote `index-runner` to debug and trigger a follow-up reindex to validate.
- **Low confidence — the runner stalled before any per-file work**: `boxel_index_working` has no rows for this batch's `invalidationId` (no row stamped with the batch UUID, no `is_deleted = TRUE` tombstones at the batch's `realm_version`). The worker is still in **invalidation discovery** — either the mtime walk (no `discovering invalidations in dir` line yet) or the consumer fan-out (the `discovering` line is there but no per-file visit-start lines). Look at the worker's `index-perf` `time to get file system mtimes` / `time to invalidate` lines — if those are missing too, you're stuck in the realm-server fetch (`reader.mtimes()` → `_mtimes` HTTP call) or in `Batch.invalidate`'s own jsonb-containment SQL (`itemsThatReference`). Then go look at what _should_ have been in the seed but wasn't — cross-check the EFS file listing against the realm's `boxel_index.last_modified` per step 3.
- **Confirm a "rejected" job actually failed cleanly**: `jobs.status = 'rejected'` should pair with the matching reservation's `completed_at IS NOT NULL`. If `completed_at IS NULL`, the worker bailed before its finalize transaction (see `pg-queue.ts` lines 619-696); the reservation's `locked_until` will eventually expire and another worker can claim it.

  The actual error is in **`jobs.result`** (jsonb). When the worker's `await job.run(...)` throws, `pg-queue.ts:627-628` does `result = serializableError(err); newStatus = 'rejected';` and the finalize UPDATE writes both into the row. Read it directly:

  ```sql
  SELECT id, job_type, status, finished_at,
         args->>'realmURL' AS realm_url,
         result->>'message' AS error_message,
         result->>'name'    AS error_class,
         result->'stack'    AS stack_trace
  FROM jobs
  WHERE id = <job_id>;
  ```

  `result` is the same shape `serializableError` produces: `{ message, name, stack, ... }`. For triage, `error_message` + `error_class` is usually enough; `stack_trace` is there when you need to find the throw site. Sentry has the same payload (and more breadcrumbs) but you don't need to leave the DB to get the rejection reason.

### 9. What this mode can't tell you

- If the worker died _before_ any DB write — crashed during `discoverInvalidations`, OOM-killed during the mtime walk, or threw inside `Batch.invalidate`'s own SQL — `boxel_index_working` will have no rows for this batch's `invalidationId`. The `Batch` object mints the `invalidationId` in its constructor, but it only lands on disk when the first `updateEntry` or `tombstoneEntries` call runs. Until then the only diagnostic signals are the worker log and the EFS state. Mode C cannot reconstruct _which_ file the worker was processing in that case — you need either `index-runner=debug` log output or a Sentry trace.
- The `diagnostics` for partial-progress rows is the **per-render** capture for that row's prerender call. It won't tell you why the _next_ render froze. If the bottom-row's diagnostic is clean (low `renderElapsedMs`, no in-flight loads), the stall is between renders — usually `Batch.invalidate` recursion against a tightly-cycled module graph, or DB contention on the `boxel_index_working` upsert. The `index-perf` `time to determine items that reference …` lines are the only fingerprints of that loop.
- A `boxel_index` row's `diagnostics` reflects the **last successful** indexing pass, not the in-flight one. Don't confuse a stale `boxel_index` `indexedAt` with the stuck job — always cross-reference against the matching `boxel_index_working` row (same `(url, realm_url)`) before drawing conclusions.

## Mode D — a module render was slow or hung

Module renders (`prerenderModule`, used by `getDefinition` to convert filter JSON into SQL on `_federated-search`, plus everywhere else a card definition is needed without a card render) go through the same prerender pipeline as card renders, but they land in the `modules` table — not `boxel_index`. The `diagnostics` JSONB column on `modules` carries the same `RenderTimeoutDiagnostics`-with-`requestId` shape, so the field-by-field reading and the [Classify in one pass](#classify-in-one-pass) table apply unchanged. Only the lookup queries differ.

**When to use this mode:** a card render hung waiting on `getDefinition` (Mode A captured `cardDocLoadsInFlight = 0`, `queryLoadsInFlight = 0`, but the realm-server's reply to `_federated-search` itself was slow — and if the stall was on a query-field search rather than a definition lookup, i.e. `queryLoadsInFlight > 0`, use [Mode G](#mode-g--an-in-render-_search-was-slow-server-side-search-timing) instead); an investigation needs to attribute time across both card renders and the module renders they triggered; or you want to find the slowest module renders fleet-wide. Same payload shape, queryable via SQL.

**Step 1 — slowest module renders in a realm.**

```sql
SELECT m.url,
       (m.diagnostics->>'renderElapsedMs')::int AS render_ms,
       m.diagnostics->>'renderStage'            AS stage,
       m.diagnostics->>'requestId'              AS request_id,
       to_timestamp(m.created_at::bigint / 1000)       AS created_at,
       m.error_doc IS NOT NULL                         AS has_error
FROM modules m
WHERE m.resolved_realm_url = '<realm-url>'
  AND m.diagnostics IS NOT NULL
ORDER BY render_ms DESC NULLS LAST
LIMIT 20;
```

**Step 2 — find module renders correlated with a known time window.** Useful when a card render timed out at wall-clock T and you want to know whether a slow module render was happening at the same moment.

```sql
SELECT m.url,
       (m.diagnostics->>'renderElapsedMs')::int AS render_ms,
       m.diagnostics->>'requestId'              AS request_id,
       to_timestamp(m.created_at::bigint / 1000)       AS created_at
FROM modules m
WHERE m.resolved_realm_url = '<realm-url>'
  AND (m.diagnostics->>'renderElapsedMs')::int > 5000
  AND m.created_at BETWEEN <window_start_ms> AND <window_end_ms>
ORDER BY render_ms DESC;
```

`window_start_ms` and `window_end_ms` are epoch milliseconds bracketing the suspect period (e.g. the 90s before and including the hung card render's `indexedAt`).

**Step 3 — join card hang to its triggering module render via `requestId`.** When the realm-server's `getDefinition` round-trip is in scope of a single card render, the `requestId` propagates from card → manager → module-extract round-trip, so both rows carry the same value.

```sql
-- Full diagnostic picture for one requestId — card + module(s) that
-- the same investigation should walk together.
SELECT 'card'   AS kind, url, jsonb_pretty(diagnostics) AS diagnostics
FROM boxel_index
WHERE diagnostics->>'requestId' = '<request-id>'
UNION ALL
SELECT 'module' AS kind, url, jsonb_pretty(diagnostics) AS diagnostics
FROM modules
WHERE diagnostics->>'requestId' = '<request-id>';
```

(In practice the card-side `requestId` is the original outer call. Internal sub-prerenders fired by `CachingDefinitionLookup` typically mint their own `requestId` per `_prerender-module` call, so the time-window join in step 2 is usually the one that catches them. The `requestId` join here works for the rarer in-line case.)

**Step 4 — classify the module render with the same rubric.** Once you have a slow module's `diagnostics`, walk it through the [Classify in one pass](#classify-in-one-pass) table the same way you would a card render. The interpretation is identical: `waiting-stability + queryLoadsInFlight=N` is a data stall on a `_search` (rare for module renders but possible for query-field driven module-extract paths), `model:start + inFlightModuleImports>0` is the loader stall, etc. The only field that's not present on module rows is `invalidationId` (modules don't go through `Batch.invalidate`), so any Mode B-style cross-row grouping has to use `requestId` or `created_at` windows instead.

### What Mode D can't tell you

- **No partial-progress equivalent.** `modules` has no working-table sibling; the row only lands on `persistModuleCacheEntry` after the prerender returns. If a `prerenderModule` call hangs forever and the worker is killed, no row is written and Mode D has nothing to query. Cross-reference against the prerender server logs for `requestId=…` directly, same as a hung card render before the host's withTimeout fires.
- **No invalidationId, so no Mode B fan-out.** Module renders are independent units; they don't belong to a "batch" that you can group by. If you need to attribute a slow `getDefinition` storm across many concurrent searches, you're stuck doing it via `created_at` time windows + the `#inFlight` dedupe behavior in `CachingDefinitionLookup` — i.e. one slow row may have been the bottleneck for many in-flight callers, but the `modules` table doesn't record those waiters.

## Mode E — enumerate cards with broken links

Unlike Modes A–D, this isn't a perf investigation: it's a realm-health / content-integrity query. A card whose `linksTo` / `linksToMany` target is unreachable (deleted, 404, upstream 5xx, network failure) **still indexes as a clean `type='instance'`** — the broken slot renders the placeholder template and the broken reference is preserved on the wire as `relationships.<field>.links.self`, identical to a not-yet-loaded link. So `has_error` is `false` and `error_doc` is `null`; nothing in the row's _status_ tells you the link is broken.

What records it is `diagnostics.brokenLinks` — an array the host's `render.meta` route builds by running `getBrokenLinks(instance)` on the settled instance and attaching the findings to the diagnostics block. Each finding is the minimal queryable summary:

```jsonc
"brokenLinks": [
  { "fieldName": "author", "reference": "https://realm.example/people/ringo", "kind": "not-found" },
  { "fieldName": "pets",   "reference": "https://realm.example/pets/missing", "kind": "error" }
]
```

- `fieldName` — the declared `linksTo` / `linksToMany` field holding the broken reference. A `linksToMany` field with one broken element produces one finding for that element; present siblings produce none.
- `reference` — the broken target reference, as captured from relationship state.
- `kind` — `'not-found'` for an HTTP 404 (the canonical "target was deleted" case), `'error'` for any other upstream failure (5xx, network, fetch error).
- `errorDoc` is **not** persisted here (it's large) — read it at runtime via `getRelationship(card, fieldName)` or see it inline in the rendered placeholder. The broken target is also carried in the row's `deps`, so if the target later reappears the card is invalidated and re-rendered, clearing the finding.

```sql
-- List every card in a realm with at least one broken link, one row per
-- broken slot. `jsonb_array_elements` fans the array out so you get the
-- field + reference + kind per finding.
SELECT
  i.url,
  bl->>'fieldName' AS field_name,
  bl->>'reference' AS broken_reference,
  bl->>'kind'      AS kind
FROM boxel_index i
CROSS JOIN LATERAL jsonb_array_elements(i.diagnostics->'brokenLinks') AS bl
WHERE i.realm_url = 'https://localhost:4201/user/your-realm/'
  AND i.type = 'instance'
  AND jsonb_typeof(i.diagnostics->'brokenLinks') = 'array'
ORDER BY i.url, field_name;

-- Just the count of affected cards (cheap realm-health gauge).
SELECT count(*) AS cards_with_broken_links
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND type = 'instance'
  AND jsonb_typeof(diagnostics->'brokenLinks') = 'array';

-- Find every card pointing at one specific broken target (e.g. to gauge
-- the blast radius before deleting / after un-deleting a card).
SELECT i.url, bl->>'fieldName' AS field_name, bl->>'kind' AS kind
FROM boxel_index i
CROSS JOIN LATERAL jsonb_array_elements(i.diagnostics->'brokenLinks') AS bl
WHERE bl->>'reference' = 'https://realm.example/people/ringo';
```

Caveats:

- **Older rows predate the scan.** A row last indexed before this capability shipped has no `brokenLinks` key even if its links are broken — it'll only appear after the next reindex. Don't read "absent" as "no broken links" for stale rows; check `indexedAt` if in doubt.
- **`boxel_index_working` carries it too**, so you can watch broken-link findings accrue mid-reindex the same way as the timing fields (see [Reading partial progress](#5-reading-partial-progress-from-boxel_index_working)).
- This is the cheap enumeration path the rendered-HTML / `getRelationship` runtime surfaces were too expensive for — querying the column avoids parsing HTML or re-running `getBrokenLinks` per read.

## Mode F — module pre-warm and definition-cache hit/miss

Use this when you're asking _"is the module pre-warm actually populating the definition cache, and are the indexer / prerender reads hitting it — or silently re-computing?"_ This is about **cache effectiveness**, not render timing.

### What pre-warm is

A from-scratch (and incremental) index runs a **pre-warm phase** before the visit phase: `IndexRunner.preWarmModulesTable` walks the realm's modules and calls `definitionLookup.populateDefinitionCacheEntry(...)`, which prerenders each module's definitions and persists them to the `modules` table. The intent is that the subsequent **visit phase** (indexing instances) and **on-demand reads** (the realm-server serving `getDefinition` to prerender tabs) then find those rows already cached instead of re-prerendering them.

The original failure this guards against: a worker pre-warm that ran with a self-resolved _null_ cache context wrote nothing (or wrote under a key nobody reads), so pre-warm was a silent no-op. The diagnostic below tells you definitively whether that's happening.

### The cache key

The `modules` table row is keyed on **`(resolved_realm_url, cache_scope, auth_user_id)`**. The two derivations that MUST agree:

- **Write** (`persistDefinitionCacheEntry`): stores `auth_user_id = cacheScope === 'public' ? '' : userId`.
- **Read** (`buildLookupContext`): looks up with `cacheUserId = isPublic ? '' : prerenderUserId`.

So the key differs by realm visibility:

- **Public realm** → `cache_scope='public'`, `auth_user_id=''` (empty). The realm owner / render identity is **not** part of the key.
- **Private realm** → `cache_scope='realm-auth'`, `auth_user_id=@<owner>:<matrix-domain>`.

If write and read ever derive `auth_user_id` differently for the same module, pre-warm writes a row no reader probes → permanent miss. The hit/miss log is how you catch that.

### Enabling the hit/miss log channel

Category: **`definition-cache-key=debug`** (and `definition-lookup=debug` for the pre-warm warnings/skips). Locally:

```sh
LOG_LEVELS='*=info,definition-cache-key=debug' mise run dev-all
```

Deployed: set `LOG_LEVELS` in the worker's SSM param and redeploy (same mechanics as [Mode C step 7](#7-cross-referencing-with-worker-logs)). It applies to subsequently-launched workers.

Three events are emitted (all via the framework `logger`, so the lines carry **no `[category]` prefix** — grep the message text, not the word `definition-cache-key`):

| Line                                                      | Where                              | Meaning                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WRITE module=<u> scope=<s> user=<id\|(empty)> realm=<r>` | `persistDefinitionCacheEntry`      | A definition was persisted. The `user=` shown is the **normalized stored key** (public → `(empty)`), not the render identity.                                                                                                                                                       |
| `HIT module=<u> scope=<s> user=<…> realm=<r> alias=<a>`   | `readFromDatabaseCache`            | A DB read found the row. Always a real hit (logged at the read choke point, covers worker + realm-server).                                                                                                                                                                          |
| `MISS source=pre-warm\|on-demand module=<u> …`            | `loadDefinitionCacheEntryUncached` | A lookup **exhausted the cache** (primary URL + every alias/extension candidate) and committed to a prerender. Logged **once per logical lookup** — not per alias probe. `source=pre-warm` is the pre-warm phase's own cold probe; `source=on-demand` is a visit-phase / live read. |

> Two logging facts that will mislead you if you don't know them:
>
> 1. **Category overrides only take effect because `setup-logger.ts` calls `reapplyLogLevels()`** after installing `_logDefinitions`. Module-scope `logger()` calls (like this one) are evaluated during the barrel import _before_ `_logDefinitions` exists, so without the re-apply they stay stuck at loglevel's default and `definition-cache-key=debug` silently no-ops. If you add a new module-scope category and it won't emit, this is why.
> 2. A bare `readFromDatabaseCache` returning no rows is **not** a real miss — it's one probe (the reader tries `foo`, `foo.ts`, `foo.js`, `foo.gts`, `foo.gjs`). Counting those as misses inflates the number ~5×. The `MISS source=…` line is the de-duplicated, real signal; trust it over raw DB-read counts.

### The healthy shape

For a cold from-scratch of a single realm, healthy looks like:

- `MISS source=pre-warm` ≈ one per module being warmed. **These are expected** — they _are_ the warming (probe cold → prerender → `WRITE`).
- `MISS source=on-demand` = **0**.
- Realm-server on-demand reads = all HIT, **0 miss**, after the pre-warm phase.

i.e. **misses occur only during the pre-warm phase.** Anything else is a bug.

### The unhealthy shape (what you're hunting)

- **`MISS source=on-demand` > 0 for canonical modules** (the `.gts`/`.ts` form, not an alias probe), or persistent realm-server misses for a module pre-warm already `WRITE`-d → the write key ≠ the read key. Compare the `user=`/`scope=` on the `WRITE` line vs the `MISS`/read line for the same module. The usual culprit is a divergence between `persistDefinitionCacheEntry`'s `auth_user_id` normalization and `buildLookupContext`'s `cacheUserId` (e.g. one resolving the owner where the other uses empty). Public realms are the sensitive case — both paths must collapse the user to `''`.
- **No `WRITE` lines at all during pre-warm** → pre-warm is skipping (context-resolve failure → `definition-lookup` warn line, empty user, browser-test env, or empty candidate set). Check `definition-lookup=debug`.

### Verification protocol (isolated, repeatable)

```sh
# 1. Pick a CLEAN realm (0 error rows). Confirm public vs private from the cache:
#    public realms have cache_scope='public' rows.
SELECT regexp_replace(resolved_realm_url,'^https?://[^/]+/','') realm, cache_scope, count(*)
FROM modules GROUP BY 1,2 ORDER BY 1,2;

# 2. Force a cold pre-warm: delete the realm's module rows.
DELETE FROM modules WHERE resolved_realm_url LIKE '%/<realm-path>/';

# 3. Mark the log offset, trigger a single-realm reindex (see "Triggering a reindex"):
OFF=$(wc -l < /tmp/stack.log)
curl -sk -X POST "https://localhost:4201/_grafana-reindex?realm=<realm-path>" \
  -H "Authorization: Bearer $GRAFANA_SECRET"

# 4. After it settles, split HIT/MISS by process and source:
tail -n +$((OFF+1)) /tmp/stack.log | grep -a '<realm-path>' \
  | grep -aoE 'HIT |MISS source=pre-warm|MISS source=on-demand|WRITE ' | sort | uniq -c
# and the realm-server's on-demand misses specifically:
tail -n +$((OFF+1)) /tmp/stack.log | grep -a 'services:realm-server' | grep -a '<realm-path>' \
  | grep -acE 'MISS source=on-demand'   # expect 0
```

Run it once on a **private** realm and once on a **public** realm — the public case is where a key-derivation divergence hides. Reference numbers from a healthy run (a private 234-file realm): worker `MISS source=pre-warm`=159, `MISS source=on-demand`=0, realm-server on-demand misses=0; pre-warm phase ~8.5s for 86 modules (~99 ms/module), serial.

### Pre-warm concurrency

Pre-warm is **serial by default** (`INDEXER_PREWARM_CONCURRENCY=1`). It's opt-in tunable — a bounded worker pool over `populateDefinitionCacheEntry`. On a cold / shared prerender pool, raising it can be _slower_ (tab materialization cost vs warm-tab reuse), so measure the pre-warm-phase wall-clock (the `modules.created_at` min→max window for the realm) before and after rather than assuming parallel wins. Align the ceiling with the prerender affinity tab budget (`PRERENDER_AFFINITY_TAB_MAX`); beyond that you just queue inside the prerender server.

### What Mode F can't tell you

Pre-warm only populates module **definitions**. A realm whose card-authored modules fail to _evaluate_ (e.g. a circular-dependency TDZ in a bundled module — `Cannot access 'X' before initialization`) will still fail the **visit phase** instance renders regardless of a clean pre-warm; those show up as `boxel_index` error rows, not cache misses. Mode F confirms the cache is keyed and populated correctly; it says nothing about whether the modules themselves render.

## Mode G — an in-render `_search` was slow (server-side search timing)

**When to use this mode.** Mode A classified a timed-out (or slow-but-succeeded) card render as a **data stall on a `_search`**: `renderStage=waiting-stability`, `cardDocLoadsInFlight=0`, and a `queryLoadsInFlight` entry whose `ageMs` is most of the render's wall-clock. The card is blocked waiting for the realm-server to answer a query-backed `linksTo` / `linksToMany` search (e.g. a `policies` getter). The `boxel_index.diagnostics` blob is the **client's** view — it tells you the host waited N ms on query Q, but nothing about where the realm-server spent that time. The decisive tell: if `pg_stat_activity` shows no SQL running longer than ~1s while the host waited tens of seconds, the wait is realm-server _delivery_, not query execution — and that's invisible without this mode. Mode G is the server-side complement that localizes it. (Also the right mode for "a slow `_federated-search` whose SQL is fast" in general, even outside a timeout.)

**The correlation id.** The prerendered host stamps `x-boxel-logging-correlation-id` on each `_federated-search` fetch it issues — prerender-gated, so live SPA / external traffic never stamps it and never emits these lines. The realm-server reads it back out and keys two lines on `corr=<id>`:

- `realm:search-timing` — the request→response stage breakdown.
- `realm:requests` `-->` — the total round-trip `dur=` (includes body read + send, i.e. the outer bound).

It is **not** persisted in `boxel_index.diagnostics` (that's the client side). So bridge a stuck card to its server lines by **job + time window + the query** in `queryLoadsInFlight[].query`, then use `corr=` to tie the server's own lines together once you've found the request.

**The lines.**

```
corr=<id> job=<jobId> handler=Nms parse=… resolveRealms=… sql=… stringify=… coalescedWait=… | results=…    (realm:search-timing)
--> QUERY <accept> <url>: 200 [job: <jobId>] corr=<id> dur=Nms                                                                                            (realm:requests)
eventLoopLagMs(mean/p99/max)=…/…/… inFlightSearch=… heapMB=…                                                                                              (realm:health)
```

The `|`-section is the **sequential wall-clock timeline** (these sum to ≈ `handler`).

**Note — a prerender search skips `loadLinks`.** These lines emit only for prerender `_federated-search` (the correlation id is prerender-gated), and a prerender search skips the relationship-assembly pass: the host re-resolves every result from card+source and reads only `data[].id`, so the realm-server returns each result's pristine row (id + attributes + any static-link relationships) + page meta and does not run `populateQueryFields`. The line therefore carries **no `loadLinks` stage and no `busyMs(parallel-sum)` section** (no `populate` / `cacheRead` / `cacheWrite` / `cacheHit` / `cacheMiss`) — those are the per-result umbrella assembly + per-instance wire-format cache, which do not run on this path. The dominant cost on a prerender search is `sql` (or `stringify` for a fat result set, or queue-wait — see branch 4).

Wall-clock timeline stages:

- `parse` — request body → Query parse.
- `resolveRealms` — federated realm resolution / lazy-mount.
- `sql` — the `IndexQueryEngine.searchCards` query (the actual SQL). For a prerender search this is essentially the whole `handler`.
- `stringify` — `JSON.stringify` of the response wire-format (for a prerender search, the pristine result rows + page meta, with no query-field umbrellas or `included[]`).
- `coalescedWait` — this request coalesced onto an already-in-flight identical search (in-flight dedup) and waited for it; the real sql work is on the **leader's** line, not this one.
- `handler=` — handler entry → response assembled (≈ the sum of the wall-clock stages).

**Reading it — the decision tree.**

1. **`sql=` is the bulk of `handler`** → a genuinely slow query. Confirm with `pg_stat_activity` / `EXPLAIN`. Fast SQL but large `sql=` means lock / connection-pool wait inside the query call. (For a prerender search this is the typical shape — the post-SQL assembly doesn't run on that path, so `sql` carries most of the handler.)
2. **`stringify` dominates** → serializing a large federated response. Look at `results=` for a fat result set.
3. **`dur` (realm:requests) ≫ `handler` (realm:search-timing)** → the time is NOT inside the handler. It was spent **queued before the handler ran** (or sending). This is the saturation fingerprint: cross-reference `realm:health` near the same timestamp — if `eventLoopLagMs` spiked into the hundreds/thousands with `inFlightSearch` high, the single-threaded realm-server's event loop was starved, so the request sat unserviced even though, once it ran, the handler was fast. That is the CS-10820 saturation class seen from the server side.
4. **`coalescedWait` dominates** → this follower waited on another in-flight identical search. Find the leader (same job + query, overlapping time); its line carries the real breakdown.

**Getting the logs.** These emit from the **realm-server** process (`handle-search` → `searchRealms`). Reach them with the `tail-logs` skill (Loki, realm-server family) or, for staging/prod CloudWatch, the `aws-access` skill:

```sh
# CloudWatch (staging), via an aws-access session.
# All search-timing lines for the run (corr ids + stage breakdowns):
aws --profile claude-staging logs filter-log-events \
  --log-group-name ecs-boxel-realm-server-staging \
  --filter-pattern 'handler=' --start-time <epoch-ms> \
  --query 'events[*].message' --output text

# Event-loop saturation windows during the same run:
aws --profile claude-staging logs filter-log-events \
  --log-group-name ecs-boxel-realm-server-staging \
  --filter-pattern 'eventLoopLagMs' --start-time <epoch-ms> \
  --query 'events[*].message' --output text
```

The boxel logger does **not** print the namespace, so the on-disk line is the bare `corr=… handler=…` / `eventLoopLagMs=…` text — grep the _content_ (`corr=`, `handler=`, `eventLoopLagMs`, `dur=`), not a `realm:search-timing` prefix. `LOG_LEVELS` unset resolves to `*=info`, so these emit by default.

### What Mode G can't tell you

- It only fires for **prerender / indexer** traffic — the correlation id is prerender-gated. A slow `_search` from a live SPA or external API caller emits nothing, by design, to keep normal traffic silent.
- The correlation id isn't in `boxel_index.diagnostics`, so there's no SQL join from a stuck card row to its server line; bridge by job + time + query as above.
- `realm:health` is sampled and emitted only during saturation windows (lag over threshold OR a search in flight). A quiet period legitimately produces no line — silence means "not saturated," not "no data."

## Mode H — capturing full CPU profiles / traces / heap snapshots

When the summary signals (Mode A's `cpuTopFrames`, Mode D) name a hot or looping function but you need the full picture — the complete call tree, a JS-vs-GC-vs-layout breakdown, or a heap-growth story — capture the heavyweight artifacts. They're far too big for a log line, so they stream to a dedicated S3 bucket instead.

### Two tiers — pick by what you need

| Tier                              | What                                                                            | Where it lands                              | Captures the hard wedge?                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1 (always on for targeted realms) | Top-N self-time **summary**                                                     | `prerenderer` log: `affinity CPU profile …` | No — `Profiler.stop` needs the renderer thread                                                                    |
| 2 — `.cpuprofile`                 | Full V8 CPU profile (whole call tree)                                           | S3 `…/<ts>.cpuprofile`                      | No — same `Profiler.stop` limit                                                                                   |
| 2 — trace (`.trace.json`)         | CDP/Perfetto trace, **streamed** — separates JS / GC / compile / layout / paint | S3 `…/<ts>.trace.json`                      | **Yes** — buffered on browser threads, drained out-of-band; the one capture that survives a fully-pegged renderer |
| 2 — heap (`.heapprofile`)         | Cumulative allocation-sampling profile, flushed per render                      | S3 `…/<ts>.heapprofile`                     | No — `getSamplingProfile` needs the renderer thread                                                               |

Rule of thumb: a render that **completes but is heavy** → `.cpuprofile` (+ heap for allocation growth). A render that **fully wedges** (no `cpuTopFrames`, `scriptBusy=<unknown>`) → the **trace**, which is the only thing that comes back. If the trace returns idle (no hot frame), the wedge isn't CPU-spinning — pivot to "what is it blocked on" (Mode A's `pendingFetches`).

### The knobs (SSM parameters)

All live at `/<env>/boxel/<NAME>` (Systems Manager → Parameter Store). The bucket itself (`PRERENDER_ARTIFACTS_BUCKET`) and the key prefix (`PRERENDER_ARTIFACTS_ENV`) are wired by Terraform — don't set them by hand.

| Parameter                             | Values                                                                             | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRERENDER_PROFILE_AFFINITY`          | comma-separated affinity keys, e.g. `realm:https://realms.cardstack.com/team/foo/` | **Required to target.** Only renders whose affinity key exactly matches are profiled at all (Tier 1 + Tier 2). Empty / `off` → everything inert.                                                                                                                                                                                                                                                                                                                                                            |
| `PRERENDER_PROFILE_CPUPROFILE`        | `true` / `false`                                                                   | Persist the full `.cpuprofile` for targeted renders.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PRERENDER_PROFILE_TRACE`             | `true` / `false`                                                                   | Capture the streaming trace for targeted renders.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `PRERENDER_PROFILE_HEAP`              | `true` / `false`                                                                   | Capture the heap allocation-sampling profile for targeted renders.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PRERENDER_PROFILE_MAX_SESSION_BYTES` | positive integer, or `0` for the default                                           | Soft per-process byte budget across all artifacts. `0`/unset → 5 GiB. Once spent, the task declines further uploads (in-flight ones finish, so blobs are never truncated).                                                                                                                                                                                                                                                                                                                                  |
| `PRERENDER_V8_PROF`                   | `true` / `false`                                                                   | Arm V8's `--prof` kernel-`SIGPROF` CPU sampler at Chrome launch — **renderer-wide, NOT affinity-gated**. The capture that survives a hard CPU peg that starves the CDP captures above (kernel preemption needs no thread cooperation). On a render timeout the raw log is streamed to the artifacts bucket as a `v8log` (symbolized offline with `node --prof-process`); the timeout line reports the upload. See **Mode I**. Needs a prerender-server task **restart** (not just redeploy) to take effect. |

The mode flags are Terraform-seeded sentinels (default `false` / `0`); `PRERENDER_PROFILE_AFFINITY` is operator-managed and must already exist. The affinity key is `realm:` + the realm's canonical URL **with trailing slash** — the same value Mode A/B logs print as `affinity=…`.

> **The container reads these at task start.** ECS injects SSM values when a task launches, so a change only takes effect on a fresh task. After editing the parameters, force a new deployment of the prerender service so tasks restart with the new env:
>
> ```
> aws ecs update-service --cluster <env> --service boxel-prerender-server-<env> --force-new-deployment
> ```

### Running a capture session

1. **Target the realm.** Set `PRERENDER_PROFILE_AFFINITY` to its affinity key and turn on the mode flag(s) you need (start with `PRERENDER_PROFILE_TRACE` for a wedge, `PRERENDER_PROFILE_CPUPROFILE` for a heavy-but-completing render).
2. **Restart the service** (`--force-new-deployment` above) so the tasks pick up the values.
3. **Generate renders.** Trigger a reindex of the targeted realm (see _Triggering a reindex_ below) — the indexer's per-card visits are what produce artifacts. Confirm captures are happening in the `prerenderer` log: `artifact-sink uploaded <kind> key=… bytes=… sessionBytes=…/…`.
4. **Pull the artifacts** (below).
5. **Turn it off.** Set the mode flags back to `false` (and clear `PRERENDER_PROFILE_AFFINITY` if done), then force one more deployment. Leftover artifacts auto-expire after 14 days regardless.

### Pulling the artifacts

The `boxel-claude-readonly` role has `s3:GetObject` + `s3:ListBucket` on `boxel-prerender-artifacts-*`, so use the `aws-access` skill's session (`mise run claude-aws`) and plain S3:

```
aws s3 ls --recursive s3://boxel-prerender-artifacts-<env>/<env>/<realm-segment>/
aws s3 cp s3://boxel-prerender-artifacts-<env>/<key> ./local-name
```

The key schema is `env/realm/jobId/card/step/<timestamp>-<seq>.<suffix>` — every segment sanitized (protocol/host stripped, unsafe characters collapsed to `-`). So one job's artifacts share a `…/<realm>/<jobId>/` prefix, and one render's three artifacts share everything up to the suffix. `jobId` is `no-job` for on-demand (non-indexer) renders.

### Reading each artifact

- **`.cpuprofile`** — Chrome DevTools (Performance panel → _Load profile…_) or [speedscope](https://www.speedscope.app/). Self-time flame graph of the whole render; the summary's top frames are just the peak of this.
- **`.trace.json`** — [Perfetto UI](https://ui.perfetto.dev/) or Chrome DevTools Performance → _Load profile…_. Separate tracks for JS execution, V8 GC, compile, and layout/paint — this is how you tell a JS spin (`v8.execute` saturated) from GC thrash (`v8.gc` saturated) when the summary couldn't say.
- **`.heapprofile`** — Chrome DevTools Memory → _Allocation sampling_ → _Load profile…_. Each upload is the cumulative profile **at that render**, so download two from different points in the session and compare to see which call sites kept allocating.

### What Mode H can't tell you

- The `.cpuprofile` and `.heapprofile` need the renderer thread to serialize, so a **fully-wedged** render produces neither — only the streaming trace comes back. That's by design (Tier 1's summary has the same limit); the trace is the wedge tool.
- Browser-wide tracing is **single-flight** — only one trace runs at a time across the whole pool. Concurrent targeted renders skip their trace (logged at `debug`), so don't expect a trace for _every_ render under load; constrain concurrency or accept the gaps. The summary and the cpuprofile/heap captures are per-render and unaffected.
- Captured artifacts are anonymized only at the key level (host stripped). The blobs themselves contain card URLs and code paths — treat them as you would any prerender diagnostic.
- If the renderer is so pegged that even `Debugger.enable` / `Profiler.enable` time out, **all of Mode H is starved** — the cpuprofile, heap, _and_ the trace's sampler setup all need the renderer to service a CDP message. Read that case from the timeout-path `pausedStack` / `--prof` signals instead — **Mode I**.

## Mode I — a render is wedged in a synchronous CPU peg (reading the renderer from outside)

**When to use this mode.** Mode A classified a render as a hard CPU peg (`mainThreadResponsive=false`, `scriptBusy≈1`), or a from-scratch index rejected mid-run on a card that never wrote a row (Mode C), and Mode H's heavyweight captures came back empty / `(idle)`. The renderer's main thread is spinning in a synchronous JS (or native) loop — the worst case for inspection, because a fully-pegged thread can't service the CDP protocol message that _arms_ a debugger or profiler (`Debugger.enable` / `Profiler.enable` time out), so the CDP captures are starved. Two timeout-path signals read it anyway, because neither needs the pegged thread to cooperate. They ride on the same render-timeout log line as `cpuTopFrames`, in the **prerender-server** log.

A healthy render finishes well under 30s; the render-level timeout (`RENDER_TIMEOUT_MS`, default 60s) fires before the request-level abort (render + 60s overhead), so these are captured and logged before the worker gives up on the visit. (If a wedge ever rejects with no timeout line at all, the diagnostic block itself was starved — that is itself the `<debugger-enable-timeout>` signal below.)

### `pausedStack` — a one-shot debugger pause (always on, can't mask)

```
pausedStack: [depth=N] fn @ url:line:col  <-  caller  <-  …      jsHeapUsedMB=…
```

A single CDP `Debugger.pause` on the timeout path. V8 honors the pause at the next interrupt check (a loop back-edge or call), so it lands _inside_ a synchronous loop without the loop yielding — the same mechanism as the DevTools "pause" button on a hung `while(true)` page. It adds **zero overhead until the one pause**, so unlike a continuous sampler it can't perturb (mask) a timing-sensitive wedge. Three outcomes:

- **A frame list** → the function the loop is in (`fn @ url:line`) and the call chain out to the render driver. `depth` is the live JS stack depth: a huge depth is runaway recursion; a small depth is a tight loop. A bare scriptId for `url` (no path) means the frame is in eval'd / dynamically-built code.
- **`<pause-timeout>`** → the pause was requested but no back-edge honored it in budget. Most likely a long **non-yielding native call** (a catastrophic regex, a native sort) — no JS back-edge to interrupt. Pivot to `--prof`.
- **`<debugger-enable-timeout>`** → the thread is so pegged it couldn't even service `Debugger.enable`. The hardest peg; CDP can't read it at all. Pivot to `--prof`.

### V8 `--prof` log → S3 artifact (gated; the only capture that survives a hard peg)

When `pausedStack` is starved, the kernel-signal sampler is the capture that still works. `--prof` (knob: `PRERENDER_V8_PROF`, Mode H table) arms V8's `SIGPROF`-driven sampler at Chrome **launch**: the kernel timer preempts the pegged thread mid-instruction on a schedule it can't refuse — no protocol message, no back-edge, no cooperation — and a **separate thread** writes the samples to a file. So it records the spinning frame even when CDP is dead, and never needs the thread to serialize at `stop` (the failure mode of the CDP `Profiler`). Renderer-wide, not affinity-gated.

It is **not** symbolized in-container — the log accumulates every render on the isolate since launch (tens of MB), and `node --prof-process` on that blows the render-timeout budget (that's why an in-container summary kept coming back empty). Instead, on the timeout the prerender server **streams the raw log to the prerender S3 artifacts bucket** as a `v8log` artifact, keyed `env/realm/jobId/card/step/<ts>.v8log` — so the wedging task's log is self-identifying (no shelling into the N prerender tasks to find it). Once the upload is durable the server **deletes the local log** (the wedged page is evicted, so its isolate writes no more), keeping these tens-of-MB files from piling up on the container disk. The timeout log line reports the outcome:

- `v8ProfLog: uploaded … (NMB) to artifact bucket (local log removed) …` — success; fetch the artifact (below). If several renderer isolates were active this run the line instead reads `(largest of N this-run logs, runner-up …MB — kept …; re-symbolize another with the helper's --key)` — the largest is a heuristic for the pegged isolate, so if its frames don't look wedged, `--list` the candidates and `--key` a different one.
- `v8ProfLog: <v8 --prof log not persisted …; kept local …>` — sink disabled / budget spent / upload failed, so the local copy is **retained** (not destroyed for a capture you can't fetch).
- `v8ProfLog: <no v8 --prof log from this run; seen: …>` — armed but no log written (e.g. the browser didn't relaunch after the flag flip).

Arm it:

1. Set SSM `/<env>/boxel/PRERENDER_V8_PROF` = `true`.
2. **Restart** the prerender-server tasks — the renderer must relaunch to pick up the `--js-flags=--prof` launch flag (a value flip alone, or a redeploy reusing the running browser, won't arm it): `aws ecs update-service --cluster <env> --service boxel-prerender-server-<env> --force-new-deployment`.
3. Re-run the index. On a wedge, grep the prerender-server log for `v8ProfLog: uploaded` — and pull the artifact (next section).
4. Set it back to `false` + restart when done — it samples **every** render while on.

> **Expect a multi-minute lag between the job rejecting and the `.v8log` landing in S3.** The worker rejects the indexing job at the shorter **request-abort** timeout (`client-aborted after 120000ms` in the manager log), but the `v8log` only uploads when the prerender-server's longer **render-level** timeout (`RENDER_TIMEOUT_MS`) fires — the renderer keeps pegging after the worker gives up — plus the S3 PUT. Observed gap on staging: job rejected at `20:02:33`, `v8ProfLog: uploaded` + artifact in S3 at `20:07:52` (~5 min later). So don't read "job rejected, no artifact yet" as a failed capture — poll the bucket (`symbolize-prerender-wedge.sh … --list`, or `s3api list-objects-v2`) for a few minutes before concluding the capture didn't happen.

**Symbolize offline.** With an aws-access session for the env (`boxel-claude-readonly` has `s3:GetObject`/`ListBucket` on `boxel-prerender-artifacts-*`), the helper fetches the newest matching `.v8log` and runs `node --prof-process` for you:

```sh
packages/realm-server/scripts/symbolize-prerender-wedge.sh --env staging --realm bxl-dependency-order-test
# --key <exact-s3-key> for a specific artifact; --list to just enumerate candidates; --top N for deeper sections
```

It self-documents why this is offline rather than in-container. Under the hood it's just:

```sh
aws s3api list-objects-v2 --bucket boxel-prerender-artifacts-<env> --prefix <env>/ ...   # newest .v8log for the realm
aws s3 cp s3://boxel-prerender-artifacts-<env>/<key> /tmp/wedge.v8log
node --prof-process /tmp/wedge.v8log \
  | sed -n '/\[Summary\]/,+14p; /\[JavaScript\]/,+30p; /\[Bottom up (heavy) profile\]/,+50p'
```

The log self-contains its `code-creation` records, so `--prof-process` names the JS frames from the file alone — no binaries or source maps. Native/Chrome frames stay opaque (that'd need Chrome debug symbols); the JS layer is what names the wedge. The peg dominates the cumulative log (a 60s spin at 1 kHz is ~60k ticks; every other render on the tab is sub-second), so the top self-time frame — and the heaviest `[Bottom up]` path — is the wedge.

**Masking note.** `--prof` samples continuously, but for a _synchronous_ peg that doesn't matter: a sync loop's control flow doesn't depend on timing, so sampling records _where_ it spins without changing _that_ it spins. The heavier CDP profiler / trace masking that's bitten before is the risk for _timing-sensitive async_ work — so confirm `mainThreadResponsive=false` before reaching for it.

### Reading it

- **Frame / top sample** → the function to fix. Follow the chain: a card computed inside a Glimmer `revalidate → rerender → evaluate` chain is a render-invalidation storm (a computed that dirties tracked state during render → re-render → re-evaluate → …), not a data or serialize cost — and not something the field-getter ceiling or a serialize cycle-guard will catch.
- **`jsHeapUsedMB`** (on the `pausedStack` line) → flat across the peg is a tight compute / recursion loop; climbing is a combinatorial re-build of shared subtrees (breadth).

### Getting the logs

```sh
aws --profile claude-<env> logs filter-log-events \
  --log-group-name ecs-boxel-prerender-server-<env> \
  --filter-pattern '"<realm-or-card>" "timed out after"' --start-time <epoch-ms> \
  --query 'events[*].message' --output text
```

Lines are FireLens-wrapped (`{"log":"…"}`); pull `.log`. Strip everything after ` DOM:` — the `pausedStack:` / `v8ProfLog:` / discriminators are all before it. The `v8ProfLog:` line carries the S3 key of the uploaded `--prof` log; fetch + symbolize it per the previous section.

### What this mode can't tell you

- If `pausedStack` is starved AND `--prof` shows the time in opaque native frames with no JS attribution, the peg is inside a native builtin — the frame names it, but the _why_ needs reading that builtin's inputs (e.g. a pathological regex / string).
- It's a CPU-peg mode. A render that's idle-waiting (`mainThreadResponsive=true`, `cpuTopFrames (idle)`, a long-pending fetch) is a **data stall** — Mode A's `pendingFetches` / Mode G, not this.

## Mode J — a search doc was slow to build (per-field / per-link attribution)

The index visit's cost is dominated by search-doc assembly. The host produces the doc by walking the card repeatedly until the store's load state is quiescent — the first walk that fires no lazy getter loads is the one whose doc persists — and the diagnostics split the cost along that seam, each side with per-item detail:

1. **The discarded walks and their load drains** (`searchDocSettleMs`, `searchDocSettlePasses`) — the passes re-run because a computed's read of a not-yet-loaded link fired a lazy load the walk couldn't consume. This is where getter-driven link targets load; `searchDocSettlePasses` counts the discarded walks, so a card that settles on its first walk reads `0`. The generator's own `searchable`-route loads are awaited inside whichever walk reaches them (a route's hops resolve within one pass), and every performed load lands in `searchDocLinkLoads` (`{ path, target, ms }`, dotted `linksTo`/`linksToMany` field path + loaded URL). A card's independent routes and plural-field slots load **concurrently**, so the entries overlap in time — read each `ms` as that load's own span, not as a summable slice.
2. **The doc-producing walk** (`searchDocMs`) — the stable walk over the card's fields. It never waits on getter-fired loads (those mark a walk unstable), but it can include targeted `searchable`-route loads it consumed inline — a first-walk-stable card performs all its route loads here, each itemized in `searchDocLinkLoads`. Because those loads overlap each other and sibling evaluation, treat a load-entry-bearing `searchDocMs` as an upper bound on evaluation time — don't subtract the entries out. The per-field breakdown is `searchDocFieldsMs`, keyed by dotted field path with **inclusive** times (a parent includes its children — and a field's own link loads — so the keys read as a drill-down to the slow leaf).

Both detail blocks are bounded — the slowest 20 entries at ≥ 1 ms — so a typical ~1 ms search doc persists neither, and their absence on a slow row is itself a signal (see step 3). Within one indexing job, loaded wire documents are cached job-scoped in the render tab, so a target shared by many cards costs a real load only on the first owner that reaches it — later owners' entries are near-zero and floor-pruned.

**Step 1 — find the rows whose search-doc build dominates.**

```sql
SELECT
  url,
  (diagnostics->>'searchDocSettleMs')::numeric   AS settle_ms,
  (diagnostics->>'searchDocSettlePasses')::int   AS passes,
  (diagnostics->>'searchDocMs')::numeric         AS search_doc_ms,
  (diagnostics->>'serializeMs')::numeric         AS serialize_ms,
  (diagnostics->>'renderElapsedMs')::int         AS render_ms
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND diagnostics->>'searchDocSettleMs' IS NOT NULL
ORDER BY (diagnostics->>'searchDocSettleMs')::numeric
       + (diagnostics->>'searchDocMs')::numeric DESC NULLS LAST
LIMIT 20;
```

`settle_ms + search_doc_ms` ≈ the row's search-doc production cost. Which of the two dominates picks the next step: settle-dominated → step 2 (loads), searchDoc-dominated → step 3 (fields) — but check `searchDocLinkLoads` either way: a searchDoc-dominated row with matching load entries was loading inside the doc-producing walk (a first-walk-stable card's route loads land there), and step 2's load reading applies to it, not step 3's evaluation reading.

**Step 2 — settle-dominated: which link loads were slow.**

```sql
-- Fan out the per-load entries for one row, slowest first.
SELECT
  ll->>'path'           AS field_path,
  ll->>'target'         AS target_url,
  (ll->>'ms')::numeric  AS ms
FROM boxel_index i
CROSS JOIN LATERAL jsonb_array_elements(i.diagnostics->'searchDocLinkLoads') AS ll
WHERE i.url = '<card-url>' AND i.type = 'instance'
ORDER BY ms DESC;

-- Or realm-wide: which TARGETS are slow to load across many owners'
-- search docs (one slow shared card taxes every card that makes it
-- searchable).
SELECT
  ll->>'target'                 AS target_url,
  count(*)                      AS owners,
  max((ll->>'ms')::numeric)     AS worst_ms,
  avg((ll->>'ms')::numeric)     AS avg_ms
FROM boxel_index i
CROSS JOIN LATERAL jsonb_array_elements(i.diagnostics->'searchDocLinkLoads') AS ll
WHERE i.realm_url = 'https://localhost:4201/user/your-realm/'
GROUP BY 1
ORDER BY worst_ms DESC
LIMIT 20;
```

Read the shape: one very slow entry = one slow target (a cross-realm link? a target whose own realm is slow? — Mode G if the load is a `_search`-backed path, the target realm's own logs otherwise); many moderate entries under one `path` = a wide `linksToMany` route fanning out — its slots load concurrently, so the wall cost is nearer the worst entry than the sum, but each load is still work for the serving realm (is that `searchable` depth actually needed?). An entry with an **empty `path`** is a load a field getter fired — a computed reading a link — so the fix target is the computed that reads that URL, not a `searchable` annotation. A high `passes` count means computed-over-link depth: each discarded walk is one wave of getter-fired loads a computed needed before it could produce a value (`searchable`-route hops resolve inside a single walk and don't add passes).

**Step 3 — searchDoc-dominated: which fields were expensive to evaluate.**

```sql
-- Hot fields for one row, slowest first. Keys are dotted paths from the
-- indexed card's root; a parent's time includes its children's, so read
-- the deepest hot key as the culprit and its ancestors as the route to it.
SELECT key AS field_path, value::numeric AS ms
FROM boxel_index i
CROSS JOIN LATERAL jsonb_each_text(i.diagnostics->'searchDocFieldsMs')
WHERE i.url = '<card-url>' AND i.type = 'instance'
ORDER BY value::numeric DESC;
```

Cross-check against `searchDocLinkLoads`: a hot field path **with** a matching load entry was waiting on the load (fix the load); a hot field path **without** one was expensive to compute — a `computeVia` doing real work per read (correlate with `computedCalls`, and see the computed-field-hot-path row in [Classify in one pass](#classify-in-one-pass)).

A large `searchDocMs` with **no** `searchDocFieldsMs` entries means no single field crossed the 1 ms floor — death by a thousand cheap fields (very wide cards, big containsMany arrays) rather than one hot path. That's a card-shape problem, not a single-field bug.

### What Mode J can't tell you

- **Nothing below the field grain.** A hot leaf field's time is one number; profiling inside its `computeVia` is Mode H territory.
- **A row can predate the instrumentation.** A row whose producing host build didn't emit these fields carries none of them; absence means "not measured", not "fast". Check `indexedAt` against when the realm was last reindexed.
- **The bounded lists drop the tail.** Entries below the floor (or beyond the slowest 20) aren't persisted; the aggregates (`searchDocSettleMs`, `searchDocMs`) still carry the total, so the un-itemized remainder is the difference.

## Mode K — the index job's between-visit wall (non-render overhead)

**When to use this mode.** The other modes attribute time _inside_ a file visit — the server render (`totalElapsedMs`) and the search-doc build. But an index job's wall is more than the sum of its visits: it also runs invalidation discovery, dependency ordering, module pre-warm, the per-row client-side overhead the indexer pays around each render, the row writes, and the final swap — all **serial** with the visits, because the job runs one thing at a time. On a benchmark from-scratch, that between-visit slice was ~24% of the wall (Σ visit `totalElapsedMs` accounted for the other 76%). Use this mode when the job wall is much larger than the visit sum and you need to know _which_ non-render phase ate the difference — e.g. deciding whether pipelining the row writes behind the next visit is worth it, or whether discovery / swap dominate instead.

This mode reads **two** sources that together reconstruct the whole wall:

- **`jobs.result.phaseTimings`** — the once-per-job phases. Not attributable to a row, so they live on the job result.
- **`boxel_index.diagnostics.indexVisitClientMs`** — the per-row client overhead the indexer paid around that row's render (`read` before it, `renderRpc` transport, `bookkeeping` after). Summed across the job's rows, this is the per-visit share of the wall that isn't server render and isn't the row write.

### The decomposition identity

For one index job:

```
totalMs  ≈  setupMs + mtimesMs + discoverMs + orderMs + preWarmMs + visitLoopMs + swapMs   (job phases)

visitLoopMs  ≈  Σ totalElapsedMs        (server render — the well-instrumented 76%; per VISIT)
              + Σ read + Σ renderRpc    (indexVisitClientMs, per VISIT)
              + Σ bookkeeping           (indexVisitClientMs, per ROW)
              + writeMs                 (aggregate row writes — the I/O the tab doesn't need)
```

The `≈` covers small un-bucketed residue (loop control, progress events, resumed-row skips). `setupMs` is `createBatch` (generation bump + resumable-row scan); `mtimesMs` / `preWarmMs` are from-scratch-only (incremental omits both). `writeMs` is aggregate on the job, **not** per row — a row can't time its own INSERT, so per-row `indexVisitClientMs` stops at `bookkeeping` (the pre-write window) and the writes roll up here.

**Per-VISIT vs per-ROW — the sum has to respect this.** A card-instance `.json` produces **two** rows (`type='instance'` + `type='file'`) from one visit, and they **share** the visit's blob: the same `totalElapsedMs`, `read`, and `renderRpc` land on both. So those three are per-VISIT — sum them over **one row per URL** (filter to `type='file'`, which exists exactly once per visited file) or you double-count every card `.json`. `bookkeeping` is the exception: the card indexer and the file indexer each stamp their **own** value (card dependency resolution vs file-row construction — distinct work in the same visit), so `bookkeeping` is per-ROW and is summed across **all** rows. Step 2's query does both.

`swapMs` is the `batch.done()` transaction (realm-meta update + working→main promotion + obsolete-row prune), and `discoverMs` is the pre-loop invalidation fan-out; both are serial bookends around the visit loop, so they're the _irreducible_ part — the pipelining lever (overlap the write of row N with the visit of N+1, batch row writes) attacks `writeMs` and `bookkeeping`, not these.

### Step 1 — pull the job's phase breakdown

```sql
SELECT id,
       job_type,
       status,
       extract(epoch FROM (finished_at - started_at)) * 1000 AS wall_ms,
       result->>'generation'      AS generation,
       result->'phaseTimings'     AS phase_timings
FROM jobs
WHERE concurrency_group = 'indexing:<realm-url>'   -- e.g. indexing:https://app.example/team/realm/
  AND status = 'resolved'
ORDER BY id DESC
LIMIT 5;
```

`phase_timings` is `{ totalMs, setupMs, mtimesMs, discoverMs, orderMs, preWarmMs, visitLoopMs, writeMs, swapMs }` (ms). Read it against `wall_ms`: `totalMs` should land close to the job's wall; the gap between `visitLoopMs` and the visit render sum (step 2) is the per-visit client overhead + `writeMs`.

### Step 2 — sum the per-row halves for the same job

Correlate rows to the job by the generation it committed (every from-scratch row is stamped with it; an incremental stamps the rows it revisited). The per-VISIT fields (`totalElapsedMs`, `read`, `renderRpc`) are summed over `type='file'` — one row per visited file, so a card `.json`'s shared blob is counted once, not twice — while `bookkeeping` sums over **all** rows (see the per-visit-vs-per-row note above):

```sql
SELECT count(*) FILTER (WHERE type = 'file')                                         AS visits,
       round(sum((diagnostics->>'totalElapsedMs')::numeric)
             FILTER (WHERE type = 'file'))                                           AS server_render_ms,
       round(sum((diagnostics->'indexVisitClientMs'->>'read')::numeric)
             FILTER (WHERE type = 'file'))                                           AS read_ms,
       round(sum((diagnostics->'indexVisitClientMs'->>'renderRpc')::numeric)
             FILTER (WHERE type = 'file'))                                           AS render_rpc_ms,
       round(sum((diagnostics->'indexVisitClientMs'->>'bookkeeping')::numeric))      AS bookkeeping_ms
FROM boxel_index
WHERE realm_url = '<realm-url>'
  AND generation = <generation-from-step-1>;
```

Now `visitLoopMs` (step 1) ≈ `server_render_ms` + `read_ms` + `render_rpc_ms` + `bookkeeping_ms` + `writeMs`. Whatever bucket is largest after `server_render_ms` is where the between-visit wall went — and whether it's worth pipelining.

### Step 3 — find the rows whose overhead dominates

The aggregates say _how much_; this says _which rows_ (a card whose `bookkeeping` is an outlier is doing heavy dependency resolution — many `deps`, a deep relationship fan-out):

```sql
SELECT url,
       (diagnostics->'indexVisitClientMs'->>'bookkeeping')::numeric AS bookkeeping_ms,
       (diagnostics->'indexVisitClientMs'->>'read')::numeric        AS read_ms,
       (diagnostics->'indexVisitClientMs'->>'renderRpc')::numeric   AS render_rpc_ms,
       (diagnostics->>'totalElapsedMs')::numeric                    AS server_render_ms,
       array_length(deps, 1)                                        AS dep_count
FROM boxel_index
WHERE realm_url = '<realm-url>'
  AND generation = <generation>
  AND type = 'instance'
ORDER BY bookkeeping_ms DESC NULLS LAST
LIMIT 20;
```

### Reading each bucket

- **`read`** — file read + the file-metadata lookups (`ensureFileCreatedAt`, content hash/size). Usually small; a large `read` fleet-wide points at slow EFS / reader, not the render.
- **`renderRpc`** — the client-observed prerender round-trip minus the server's own `totalElapsedMs`: serialization + the wire hop to the prerender server + any wait the server doesn't count. Large `renderRpc` with small server render means the transport/queue is the cost, not the render. ~0 on the fused / in-browser path (no wire hop).
- **`bookkeeping`** — dependency resolution + index-entry construction between the render finishing and the write. The per-row cost that varies with a card's dependency shape; the top of step 3 names the heavy cards.
- **`writeMs`** (job-level) — the Σ of the working-table upserts. This is I/O the render tab doesn't need, so it's the leading pipelining candidate (overlap it with the next visit).
- **`setupMs`** (job-level) — `createBatch`: the generation bump and the resumable working-row scan, before any visit. Normally small; large `setupMs` is a retry job re-scanning a big working table, or DB slowness.
- **`discoverMs` / `swapMs`** (job-level) — the serial bookends. `discoverMs` runs before the first visit, `swapMs` after the last, so neither can overlap a visit; they're the floor the pipelining can't remove.

### What Mode K can't tell you

- **Per-row write time.** Rolled into the job's `writeMs` only — a row can't stamp its own INSERT duration. If you need to know whether one row's write was pathological, that's not captured; the aggregate is.
- **Resumed rows carry no `indexVisitClientMs`.** A row a prior attempt already wrote and this attempt promoted without re-visiting keeps its old diagnostics (no fresh overhead) — so step 2's sums undercount on a resumed job. `phaseTimings` still covers the whole job wall.
- **A job predating the instrumentation** has no `phaseTimings` on its result and no `indexVisitClientMs` on its rows; absence means "not measured", not "zero". Reindex to populate.
- **Inflated `renderRpc` on the fused path.** The in-browser / SQLite prerenderer runs in-process with no server-observed `totalElapsedMs` to subtract, so `renderRpc` there absorbs the whole in-process render wall rather than just transport. Only trust `renderRpc` as "transport" on the split (real prerender-server) path.

## Mode L — the index visit's per-route floor (meta / icon / file-extract)

**When to use this mode.** A card whose search doc is trivial to build — `searchDocMs` and `searchDocSettleMs` both near zero — still costs a fixed per-visit amount. That floor is the route machinery around the work: the transitions into each render route, the instantiation, the per-visit request plumbing. Mode J attributes the _search-doc_ cost inside `render.meta`; this mode sits one level up and attributes the _whole index visit's_ `renderElapsedMs` across its route steps, so a floor that Mode J shows as "not the search doc" gets a name instead of an inference. Use it when a realm's trivial-card types cost far more per visit than their search docs justify, and you need to know which route step (and how much residual plumbing) carries the floor.

The index visit runs at most three route steps, and `indexRoutesMs` records each one's wall-clock, split by the card indexing and the FileDef file indexing (the index-half sibling of the render channel's `renderFormatsMs`):

- **`card.meta`** — the `render.meta` route: instantiate the card, run computeds, build the search doc, and resolve `types` / `displayNames` / `deps`. The types chain is a prototype-chain walk inside this route, not a step of its own — its cost is inside this number. On a card-instance index visit this is the **fused** transition: it also performs the file row's extract, whose share is itemized as `diagnostics.fileExtractMs`. `serializeMs` / `searchDocMs` / `searchDocSettleMs` break the _doc build_ out of it (Mode J); the remainder of `card.meta` net of `fileExtractMs` is the route's own transition + settle.
- **`card.icon`** — the `render.icon` route. Present only when the icon route actually ran; **absent when the per-type icon memo served the icon**, since a memo hit renders nothing and costs ~0 this visit. So across one job's cards of a given type, expect `card.icon` on the first card of the type and none on the rest.
- **`file.fileExtract`** — a standalone `render.file-extract` route transition: the file's resource, types, and deps. Present on non-card files (they have no card side to fuse into), on the fallback extract a card render error triggers, and on a prerender-html visit that self-resolves its file resource. **Absent on a card-instance visit's happy path** — there the extract runs inside the fused `card.meta` transition and shows up as `fileExtractMs` instead.
- **`file.icon`** — the file's `render.icon` route, same memo behavior as `card.icon`.

`meta` and `icon` are the card's routes; `fileExtract` and `icon` are the file's. A card-instance `.json` produces both a `card` block and a `file` block from the same visit: the instance row's payload and the file row's extract both come out of the one fused `card.meta` transition, while `file.icon` still records when the file icon renders.

**The residual is the plumbing.** `indexRoutesMs`'s numbers sum to less than `renderElapsedMs`; the gap is the inter-route machinery (route transitions, instantiation, settle handoffs) — the part of the floor that isn't a route step. On a trivial card that residual, plus `card.meta` net of its (near-zero) doc build, _is_ the floor.

**Step 1 — find rows where the floor dominates (cheap search doc, non-trivial visit).**

```sql
SELECT
  url,
  (diagnostics->>'renderElapsedMs')::int          AS render_ms,
  (diagnostics->>'searchDocMs')::numeric          AS search_doc_ms,
  (diagnostics->>'searchDocSettleMs')::numeric    AS settle_ms,
  (diagnostics->'indexRoutesMs'->'card'->>'meta')::int AS meta_ms,
  (diagnostics->'indexRoutesMs'->'card'->>'icon')::int AS icon_ms
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND type = 'instance'
  AND diagnostics->'indexRoutesMs' IS NOT NULL
  -- cheap doc, but the visit still cost something
  AND COALESCE((diagnostics->>'searchDocMs')::numeric, 0)
    + COALESCE((diagnostics->>'searchDocSettleMs')::numeric, 0) < 5
ORDER BY render_ms DESC NULLS LAST
LIMIT 20;
```

A row here with a large `render_ms`, a near-zero doc cost, and a `meta_ms` that's a fraction of `render_ms` is a floor-bound row: most of its time is `meta`'s route transition + settle plus the un-itemized plumbing residual, not doc work.

**Step 2 — read one row's route split, both sides.**

```sql
SELECT
  diagnostics->'indexRoutesMs'->'card' AS card_routes,   -- {"meta":…, "icon":…}
  diagnostics->'indexRoutesMs'->'file' AS file_routes,   -- {"icon":…} on a card row (extract fused into meta); {"fileExtract":…, "icon":…} where a standalone extract ran
  (diagnostics->>'renderElapsedMs')::int AS render_ms
FROM boxel_index
WHERE url = '<card-url>' AND type = 'instance';
```

`render_ms − (Σ card_routes + Σ file_routes)` is this visit's plumbing residual. A `card` with no `icon` key is a memo hit (the type's icon was rendered on an earlier card in the job).

**Step 3 — attribute the floor across a type (which route carries it).**

```sql
-- Mean per-route cost across a realm's rows, so you can see whether the
-- floor is meta-heavy, icon-heavy (first-of-type only), or mostly the
-- un-itemized plumbing residual.
SELECT
  count(*)                                                          AS rows,
  round(avg((diagnostics->'indexRoutesMs'->'card'->>'meta')::numeric))       AS avg_meta_ms,
  round(avg((diagnostics->'indexRoutesMs'->'card'->>'icon')::numeric))       AS avg_icon_ms_when_rendered,
  count(diagnostics->'indexRoutesMs'->'card'->'icon')              AS icon_renders,
  round(avg((diagnostics->>'renderElapsedMs')::numeric))           AS avg_render_ms,
  round(avg((diagnostics->>'renderElapsedMs')::numeric
    - COALESCE((diagnostics->'indexRoutesMs'->'card'->>'meta')::numeric, 0)
    - COALESCE((diagnostics->'indexRoutesMs'->'card'->>'icon')::numeric, 0))) AS avg_residual_ms
FROM boxel_index
WHERE realm_url = 'https://localhost:4201/user/your-realm/'
  AND type = 'instance'
  AND diagnostics->'indexRoutesMs'->'card' IS NOT NULL;
```

`icon_renders` well below `rows` confirms the memo is doing its job (most cards reuse a type's icon). A large `avg_residual_ms` says the floor is inter-route plumbing rather than any single route's own work — the lever there is collapsing the visit's route transitions, not speeding up a route.

### What Mode L can't tell you

- **The plumbing residual isn't itemized.** `renderElapsedMs − Σ indexRoutesMs` is one number; it lumps every transition and settle handoff together. Which specific transition dominates it isn't captured per row.
- **A memo-hit icon reads as absent, not zero.** An absent `icon` key means either the per-type memo served it (the common case) or the icon route genuinely didn't run; the row alone doesn't distinguish them. The `card icon memo hit` debug log line does.
- **Inside `meta` stops at the doc build.** `card.meta` minus (`searchDocMs` + `searchDocSettleMs` + `serializeMs`) is "the meta route's own transition + settle", but that remainder isn't broken down further — profiling inside it is Mode H territory.
- **The fused (SQLite in-browser) path carries a combined blob.** A fused single-visit pass records the index routes on the same `boxel_index.diagnostics` as the render formats; the split-pipeline separation of index-vs-render doesn't apply there.

## Field-by-field reading

`diagnostics` carries `RenderTimeoutDiagnostics` (defined in `packages/runtime-common/index.ts`) plus `invalidationId` / `indexedAt` / `requestId`. Every render-side field is optional — absent means the hook wasn't available in that build or the page died before the capture could read it.

```jsonc
{
  "requestId": "b14e…",          // single ID across client/manager/prerender-server
  "invalidationId": "a3e1…",     // single ID across every row written by the same Batch.invalidate()
  "indexedAt": 1776964391615,    // wall-clock ms when IndexWriter.updateEntry ran
  "priority": 10,                // worker-job priority that produced this render. Index
                                 // visits carry 10 (userInitiatedPriority) or 1
                                 // (systemInitiatedPriority); the prerender-html render
                                 // they spawn carries 9 or 0 — one tier below its
                                 // initiator — except a publish-awaited render, lifted to
                                 // 10. Read in post-mortems alongside `tabQueueMs` to tell
                                 // whether priority routing put a high-priority render at
                                 // the head of the queue. May be absent on older rows that
                                 // predate the threading.
  "tabReused": false,            // did this render land on a warm same-affinity tab (true)
                                 // or a freshly spawned / commandeered tab (false)?
                                 // Triage signal: a slow render with `tabReused: false`
                                 // is the cold-start tax — look at `tabStartupMs` and the
                                 // `prerender-queue-snapshot` for that affinity. With
                                 // `tabReused: true` it's a real render-side stall, walk
                                 // [Classify in one pass](#classify-in-one-pass) instead.
  "launchMs": 18720,             // waiting-in-page-pool time (server-side)
  "waits": {
    "semaphoreMs": 18500,        //   └ of that, waiting on the global render semaphore
    "admissionMs": 0,            //   └ waiting on the per-affinity file-admission cap (= affinity tab max − 1)
    "tabQueueMs": 200,           //   └ waiting behind a same-affinity tab already rendering
    "tabStartupMs": 20           //   └ warming a fresh tab / standby. Per-caller — only non-zero when
                                 //     `#selectEntryForAffinity` itself awaited `#ensureStandbyPool`
                                 //     because warm-tab / orphan / commandeer / cross-affinity paths
                                 //     all missed. A `tabReused: true` row should have `tabStartupMs ≈ 0`;
                                 //     a non-trivial value on a reused-tab row is a regression and
                                 //     means the dedup'd `#ensuringStandbys` promise is leaking through
                                 //     to callers that didn't need a fresh standby (the CS-11139 shape).
  },
  "renderElapsedMs": 71280,      // time inside withTimeout()
  "totalElapsedMs": 90000,       // launch + render (matches the timeout on errored rows)
  "indexRoutesMs": {             // per-route wall-clock of the index-visit route
                                 // steps — the index-half sibling of the render
                                 // channel's renderFormatsMs. A `card` block and a
                                 // `file` block, one number per route step the visit
                                 // ran, so the per-visit floor decomposes into
                                 // measured buckets. `icon` is absent when the
                                 // per-type icon memo served the icon (0-cost this
                                 // visit); a whole block is absent on a visit that
                                 // ran no route on that side. See Mode L.
    "card": { "meta": 210, "icon": 34 },
    "file": { "fileExtract": 47, "icon": 31 }
  },
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
      { "url": "…/customer.gts", "kind": "module", "queue": "module", "state": "running", "ageMs": 68000, "priority": 0 },
      { "url": "…/order.gts",    "kind": "module", "queue": "module", "state": "running", "ageMs": 66500, "priority": 10 }
    ]
    // Each `sameAffinityActivity` entry carries the worker-job
    // `priority` of the call that produced it. On a stuck-render
    // post-mortem this disambiguates two regression shapes that look
    // identical without priority:
    //   • Same-priority pending entries on a `waiting-stability` stall →
    //     classic self-referential prerender deadlock (the row in
    //     "Classify in one pass" below).
    //   • Higher-priority pending entries → priority routing is working
    //     as intended, this render is queued behind legitimately-
    //     prioritized work. Investigate the queued entry, not the queue
    //     mechanism.
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
  "blockedTimerSummary": "Timers blocked during prerender: …",
  "computedCalls": 187,          // distinct `computeVia` invocations during this row's
                                 // render.meta traversal (serializeCard + searchDoc combined).
                                 // Host-emitted; pass-scoped memo elides repeated reads of
                                 // the same `(instance, fieldName)` so this number reflects
                                 // distinct compute work, not total field-access pressure.
                                 // Absent on rows produced by host builds before CS-11208.
  "computedCacheHits": 374,      // repeated reads of the same `(instance, fieldName)`
                                 // that hit the pass-scoped memo. `computedCalls +
                                 // computedCacheHits` is the total computed-read pressure
                                 // of the render.meta pass; the ratio tells you how much
                                 // duplicate work the memo elided. A high `cacheHits`
                                 // count relative to `calls` is normal for cards that
                                 // serialize + searchDoc the same field (every contains /
                                 // contains-many / links-to field does this).
  "serializeMs": 42.1,           // host-side wall-clock of `serializeCard(instance, {
                                 // includeComputeds: true })` for this card.
  "searchDocMs": 18.3,           // host-side wall-clock of the walk that produced this
                                 // row's search doc — the first walk against a stable
                                 // load generation. Never waits on getter-fired loads
                                 // (those mark a walk unstable), but can include
                                 // targeted searchable-route loads it consumed inline,
                                 // each itemized in `searchDocLinkLoads` — those
                                 // entries overlap, so read a load-bearing value as an
                                 // upper bound on evaluation time. Sum with
                                 // `serializeMs` to get the host's contribution to
                                 // `renderElapsedMs`. Pairs with `computedCalls` so you
                                 // can normalize: a card with `computedCalls=500,
                                 // searchDocMs=80` is ~6 calls/ms — a sign of a hot
                                 // compute that may be worth a dependency-aware skip.
  "searchDocSettleMs": 812.4,    // host-side wall-clock spent BEFORE the doc-producing
                                 // walk: the discarded walk passes and the drains of
                                 // the lazy loads they fired. This is where the card's
                                 // getter-driven link targets load; targeted route
                                 // loads land in whichever walk reaches them first,
                                 // including the doc-producing one. Attributed per
                                 // target by `searchDocLinkLoads`. Near-zero when the
                                 // first walk settled.
  "searchDocSettlePasses": 3,    // walk passes discarded before one ran against a
                                 // stable load generation. Each discarded pass is one
                                 // wave of loads a computed's link read fired (the
                                 // generator's own searchable-route loads resolve
                                 // inside a single pass), so a high count = a deep
                                 // computed-over-link chain. 0 = the first walk
                                 // settled. Capped at 20 (a warning is logged at the
                                 // cap).
  "searchDocFieldsMs": {         // per-field inclusive evaluation timings from the timed
                                 // searchDoc walk, keyed by dotted field path from the
                                 // indexed card's root. A parent's time includes its
                                 // children's, so the drill-down to the slow leaf reads
                                 // straight off the keys. Bounded: slowest 20 fields at
                                 // >= 1 ms; a typical ~1 ms search doc records nothing.
                                 // A large `searchDocMs` with NO entries = death by a
                                 // thousand cheap fields, not one hot path.
    "policies": 14.2,
    "policies.premiumTotal": 13.8
  },
  "searchDocLinkLoads": [        // slowest link-target loads performed while producing
                                 // this row's search doc, across every walk pass.
                                 // `path` = the dotted linksTo / linksToMany field
                                 // path; `target` = the loaded URL (a linksToMany
                                 // records one entry per slot, same path, different
                                 // target). A load fired through a field getter — a
                                 // computed reading a link — carries an empty path:
                                 // the target and cost are attributed, the owning
                                 // field isn't nameable there. A card's independent
                                 // routes and plural slots load concurrently, so
                                 // entries overlap in time and don't sum to wall-
                                 // clock. Same bounding as `searchDocFieldsMs`.
                                 // Separates "linked instance slow to load" (an entry
                                 // here) from "field expensive to compute" (a hot
                                 // `searchDocFieldsMs` path with no matching load
                                 // entry).
    { "path": "author", "target": "https://realm.example/Author/1", "ms": 640.1 },
    { "path": "", "target": "https://realm.example/Publisher/2", "ms": 210.4 }
  ]
}
```

### How the time fields relate

All ms values are server-observed walltime.

- `launchMs` + `renderElapsedMs` ≈ `totalElapsedMs`. A small mismatch (< 100 ms) is capture overhead; a large mismatch means the render-runner retried with `clearCache: true` (you're looking at the final attempt's timings).
- `waits.semaphoreMs` + `waits.tabQueueMs` + `waits.tabStartupMs` ≤ `launchMs`. `launchMs` is measured around the full `PagePool.getPage` call; the three sub-waits cover the three awaits (semaphore acquire, affinity-entry selection, standby warmup) but not the synchronous bookkeeping between them (affinity reassignment, LRU touch, standby top-up kickoff). For a healthy fleet the residual is < 5 ms; a large residual is unusual and worth inspecting `PagePool` directly.
- `renderElapsedMs` is wall time _inside_ `withTimeout()` — includes host fetches, store settle, and the actual render pass. It hits the configured `RENDER_TIMEOUT_MS` on a timeout.
- `indexRoutesMs.{card,file}.*` sum to **less** than `renderElapsedMs`: each is one index-visit route step's wall-clock, and the gap between their sum and `renderElapsedMs` is the inter-route plumbing (route transitions, instantiation, settle handoffs) — the part of the per-visit floor that isn't a route step. A route step's own transition + settle is inside its number, so `meta` on a near-zero-search-doc card is mostly route machinery, not the doc build (`searchDocMs` / `searchDocSettleMs` break the doc build out of the `meta` number). An `icon` leg served by the per-type memo contributes nothing this visit and isn't recorded.
- `stageAgeMs` is host-observed — it's computed as `Date.now() - stageSetAt` at the moment the post-timeout capture ran, so there can be a small read-delay offset vs. `renderElapsedMs`. For triage, `stageAgeMs` represents "how long the render has been stuck in its current stage".
- `recentModuleEvaluations[*].ms` are per-module evaluation times measured inside `Loader.evaluate()` via `performance.now()`; they're wall time for the synchronous body of the module (Glimmer compile + top-level init). Sum them to estimate the sync-compile budget eaten by module evaluation on this page.
- `queryLoadsInFlight[*].ageMs` is the wall time since that specific search/query-field load started — i.e. how long it's been hanging.
- `recentQueryLoads[*].ms` is the wall time a completed query-field/search load ultimately took. The store keeps a bounded top-N so even queries that resolved just before the timer fired stay visible. Compare with `renderElapsedMs` to see which fraction of the render budget went to query work.
- `cardDocLoadsInFlight[*].ageMs` / `fileMetaDocLoadsInFlight[*].ageMs` mirror the query version for linked-field (card doc) / file-meta loads. One URL with a very large `ageMs` = one slow linksTo target; many URLs with small `ageMs` = fan-out.
- `recentCardDocLoads[*].ms` / `recentFileMetaLoads[*].ms` are the completed-load histories; same usage as `recentQueryLoads`.
- `computedCalls` + `computedCacheHits` together represent total compute pressure on the render.meta pass. The split tells you how much duplicate work the pass-scoped memo absorbed — a 1:0 ratio means every field was read once, a 1:5 ratio means the cards re-read each computed five extra times (typical for cards where many sibling fields share a computed input). `searchDocMs` + `serializeMs` are the host's contribution to `renderElapsedMs`; comparing `computedCalls / (searchDocMs + serializeMs)` across cards finds the slow-per-call computes that are worth profiling.
- `searchDocSettleMs` is disjoint from `searchDocMs`: the discarded walk passes and their load drains come first; the doc-producing walk then runs. So "producing this row's search doc" cost ≈ `searchDocSettleMs + searchDocMs`, and a slow row splits: settle-dominated → getter-fired loading (read `searchDocLinkLoads` for which target), searchDoc-dominated → evaluation (read `searchDocFieldsMs` for which field) **or** targeted route loads the doc-producing walk consumed inline — a `searchDocLinkLoads` entry matching a hot field path settles which. The retained `searchDocFieldsMs` entries are inclusive-time dotted paths — the top-level entries (no dot) sum to ≈ `searchDocMs` on a hot-path card; the deeper keys under a hot top-level key are the drill-down, not additional cost.

Keep the field names in lock-step with the type in `packages/runtime-common/index.ts`.

### Classify in one pass

Walk the fields top-down. The _first_ positive signal wins; stop there.

| Signal                                                                                                                                                                                                                                                | Category                                                                     | What to look at next                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waits.semaphoreMs` ≈ `totalElapsedMs`                                                                                                                                                                                                                | **Launch stall (capacity)**                                                  | Fleet-wide: `prerender-queue-snapshot` lines on every prerender server around that timestamp. Is `totalPending` piled up? Add capacity, don't touch host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `waits.admissionMs` ≈ `totalElapsedMs` (and semaphoreMs small)                                                                                                                                                                                        | **Per-affinity admission stall**                                             | This realm hit its own file-admission cap — the server had capacity but wasn't letting this realm use it. The signal means ≥ cap concurrent file renders on one affinity. Default cap = `affinityTabMax − 1` (4 on the standard 5-tab deployment), so a single realm fanning out to ≥ 4 concurrent renders (typical catalog-sized reindex) already produces this. Grep the queue-snapshot log for `admission=pending=N/cap=N` on the same affinity to confirm waiters were piling up. If the cap looks too tight for the workload and cross-realm fairness isn't the concern, `PRERENDER_AFFINITY_FILE_CONCURRENCY` is the knob (see the tuning-knobs section).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `waits.tabQueueMs` ≈ `totalElapsedMs` (and semaphoreMs / admissionMs small)                                                                                                                                                                           | **Same-affinity contention**                                                 | Same realm's batch is serialized on one tab. Check whether `PRERENDER_AFFINITY_TAB_MAX` is 1 for this fleet, or whether a rogue user request is sharing the tab (see CS-10873 for the cancel-on-abort follow-up).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `launchMs` small **and** `renderStage` is `null`/`model:start`                                                                                                                                                                                        | **Very early render stall**                                                  | Transition hadn't yet rendered anything. Usually means the route threw before setting a real stage. Look at `capturedDom` (`<data-prerender-error>` is common) and console errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `renderStage` ∈ `buildModel:fetching-source` / `buildModel:deriving-type` / `buildModel:hydrating`                                                                                                                                                    | **Backend stall during model build**                                         | Usually a slow realm server or cross-realm fetch. Check realm-server logs for the same requestId; check the fetch target from `capturedDom` / `cardDocsInFlight`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `inFlightModuleImports.length > 0`                                                                                                                                                                                                                    | **Loader stall**                                                             | Each URL is a `.gts` / `.ts` we'd already started a `fetchModule(...)` for. Confirm the realm serves those URLs and that there's no import cycle. Often resolves with `clearCache: true` on retry (already in place) — if that's failing check for 500s on the module URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `queryLoadsInFlight.length > 0` with `fieldName` set                                                                                                                                                                                                  | **Query-field stall**                                                        | This is the CS-10820 field-driven hot path. Look at the `query`/`realms` fields — is the search hitting a remote realm server that's slow? Check `_federated-search` latency for that realm on the realm-server side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `cardDocsInFlight.length > 0` or `fileMetaDocsInFlight.length > 0` (no query fields)                                                                                                                                                                  | **Data stall**                                                               | Usually linksTo targets that the template pulled on. Prefer `cardDocLoadsInFlight[*].ageMs` / `fileMetaDocLoadsInFlight[*].ageMs` — they tell you which individual URL is the slow one vs. a fan-out. If it's a card from a different realm, that realm may be slow or misconfigured. Also check `recentCardDocLoads` for loads that completed just before the timer fired but still dominated the budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `renderStage` = `waiting-stability` **AND** `queryLoadsInFlight` has a `search-resource:*` entry **AND** `affinitySnapshot.sameAffinityActivity` contains `{ queue: 'module', state: 'queued' }` entries **on the same affinity as the stuck render** | **Self-referential prerender deadlock — admission invariant broken**         | A search that can't resolve a `_cardType` filter without a card definition causes `CachingDefinitionLookup` to fire a same-affinity `prerenderModule` to extract it. The queue-split + admission cap in PagePool is supposed to reserve at least one tab per affinity for `module` / `command` work precisely to prevent this sub-prerender from queuing behind the render that needs it. **Seeing this fingerprint means the invariant didn't hold**: check `PRERENDER_AFFINITY_TAB_MAX >= 2` (PagePool logs a warning at startup if not), verify the admission semaphore is acquired on `'file'` calls (`PagePool.#acquireFileAdmission`), and confirm `disposeAffinity` isn't dropping the admission semaphore mid-flight. The `priority` field on each `sameAffinityActivity` entry sharpens triage: a stuck `priority=10` file render with a queued `priority=10` module sibling on the same affinity is the actual deadlock signature; a `priority=10` file render queued behind `priority>=10` module work that's running on a different tab is just legitimate priority routing — investigate the queued module entry, not the queue mechanism. |
| `tabReused: false` AND `tabStartupMs` ≈ `launchMs`                                                                                                                                                                                                    | **Cold-start tax**                                                           | This render paid for spawning a fresh tab + warming a BrowserContext rather than reusing an existing same-affinity tab. Common causes: first request on the affinity after a deploy / restart; affinity was evicted by LRU pressure; `disposeAffinity` ran for an unrelated reason. Look at `prerender-queue-snapshot` from the same minute — if many other affinities are also fresh-tab-spawning, the LRU cap (`PRERENDER_SHARED_CONTEXT_CAP`) may be too tight relative to the active affinity count. May be absent on older rows that predate the field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `renderStage` = `waiting-stability` with empty in-flight arrays                                                                                                                                                                                       | **Render stall**                                                             | Nothing is loading but settlement never finishes. Classic Glimmer tracking loop — template is invalidating itself. `capturedDom` usually shows the partially-rendered component. `blockedTimerSummary` will list swallowed timers that may hint at a scheduling loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `currentlyEvaluatingModule` non-null, or `stageAgeMs` large with empty in-flight arrays                                                                                                                                                               | **Synchronous browser stall (typically Glimmer compile during module eval)** | `recentModuleEvaluations` shows the worst offenders. A single URL with `ms > 5000` usually means "this module has a giant template that takes forever to compile". Many small entries (say 50+ at 100–500 ms each) summing into the stall budget mean card fan-out where each dependent card contributes a compile. Split the module, lazy-load the template, or reduce the component fan-out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `blockedTimerSummary` populated                                                                                                                                                                                                                       | **Supplementary**                                                            | Tells you which timer-driven code is fighting the render. Not a root cause on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `computedCalls` large (e.g. > 1000) AND `searchDocMs + serializeMs` ≈ `renderElapsedMs`                                                                                                                                                               | **Computed-field hot path**                                                  | The render.meta traversal itself is the bottleneck, not data loads or browser stalls. Look at `computedCalls / (searchDocMs + serializeMs)` — > ~5 calls/ms is fast, < ~1 call/ms means a few slow `computeVia` functions dominate. `searchDocFieldsMs` names the field: its dotted-path keys rank the walk's hot paths, so instead of inspecting the card class blind you start at the top entry (see [Mode J](#mode-j--a-search-doc-was-slow-to-build-per-field--per-link-attribution)). Consider hoisting an aggregate computed's scan into a shared rollup or adding `computeDeps` so the field can be skipped when its inputs don't change. The pass-scoped memo already eliminates duplicate reads in one traversal (visible in `computedCacheHits`); further wins require structural changes to the card.                                                                                                                                                                                                                                                                                                                                        |
| `searchDocSettleMs` large (≫ `searchDocMs`)                                                                                                                                                                                                           | **Search-doc link-load stall**                                               | The index visit spent its time loading the card's link targets, not evaluating fields. `searchDocLinkLoads` names the slow target(s) per dotted field path — one very slow entry is one slow linksTo target (is its realm slow? cross-realm?); many moderate entries are a fan-out (a wide `linksToMany` route — its slots load concurrently, so wall cost tracks the worst entry, but each load is still work for the serving realm). A high `searchDocSettlePasses` alongside means a deep computed-over-link chain: each discarded walk is one wave of getter-fired loads. See [Mode J](#mode-j--a-search-doc-was-slow-to-build-per-field--per-link-attribution).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Special cases

- **`launchMs` is tiny AND `renderElapsedMs` ≈ `totalElapsedMs` but `renderStage` is `null`** — the host's stage hook didn't install. Either the render.ts deactivate ran before the capture, or you're on an older host build. Look at `capturedDom` for the last prerender status.
- **`totalElapsedMs` substantially less than the configured `RENDER_TIMEOUT_MS`** — the outer request aborted, not the inner render timeout. That's a client/manager timeout (remote-prerenderer's abort message includes the elapsed). The stall is still meaningful but the budget isn't the render-timeout budget.
- **`queryLoadsInFlight` but no `fieldName`** — this is an ad-hoc `store.search()` call, not a query field. The `source` string carries the SearchResource's `source` tag (`seed` / `search` / `live-refresh`) to help.
- **`launchMs + renderElapsedMs ≠ totalElapsedMs`** — possible under retry, since render-runner re-enters with `clearCache: true` on known error signatures. Treat each attempt as its own story; the final stored attempt wins.

### Render binding desync errors

A row with `error_doc.title === 'Render binding desync'` (status 500, `evict: true`) is the render route's desync detector saying: the model reached the `ready` state but Glimmer's binding for the prerender container never updated. No JS-level error fired during the render, yet the render clearly didn't complete. This is specifically **not** a timeout — the page returned fast because the detector caught the mismatch early. The page IS evicted: Glimmer's binding failing to advance is exactly the signal that the runloop stopped working mid-render, so the half-rendered state can't be reused.

**What it means.** The card's template threw during render and the Ember runloop caught the exception in a way that no observable JS event fired:

- `window.error`: not fired
- `window.unhandledrejection`: not fired
- `RSVP.on('error')`: not fired
- `console.error`: not called from JS

Chrome's DevTools console surfaces the throw as `Uncaught (in promise) ...`, but that comes from Chrome's internal Promise-rejection tracker — it doesn't route through any JS-callable signal. So the normal render-route handlers can't see it, and the only deterministic signal left is the DOM desync: `model.status === 'ready'` in the route while `[data-prerender-status] === 'loading'` in the document.

**How to debug.** The detector captures very little on its own — just the stage it was in when it gave up. The real lead is in `error_doc.additionalErrors`: every `console.error` that fired on the page (including the browser-internal "Uncaught (in promise) ..." log) is recorded with its CDP-reported stack frames. Walk those stacks top-down to find the originating getter / helper / computed. Typical causes:

- A helper reference that resolved to `null`/`undefined`, causing `getInternalHelperManager` to throw on `Object.keys(null)` / `Reflect.ownKeys(undefined)`.
- A `@field` getter that accesses `undefined.property` because an upstream link didn't materialize.
- A template-level `{{#if (someHelper ...)}}` where `someHelper` was renamed or removed.

**False-positive profile.** The detector has four gates that all have to hold simultaneously: `isReady=true`, `model.status='ready'`, DOM attribute === `loading` specifically, and the state persists across a backoff-poll grace window (a microtask drain followed by macrotask hops at 50ms → 200 → 500 → 1000 → 2000, re-checking after each — total ~3.75s of cumulative slack so Backburner's flush has real wallclock time to land even under heavy parallel CI load). The fast path exits at the first hop; only renders that stay desynced through the full series are declared failures. In-flight loads are filtered upstream by `#waitForRenderLoadStability` — by the time the detector runs the loader is quiescent. The one residual scenario is a card whose template runs a multi-second _synchronous_ getter that starves the microtask queue beyond the full grace budget; when the getter finishes, the microtask queue drains, the binding flips to `ready`, and on the next hop the detector exits cleanly. So in practice false-positives require Backburner, Glimmer, and the entire JS thread to all be blocked for >3.75s — a state the route can't be in while logically `ready`.

**Mitigation if you suspect a false-positive.** Two runtime knobs are exposed via `globalThis`: `__boxelDomDesyncMicrotaskYields` (default 5 microtask yields per hop) and `__boxelDomDesyncSettleHopsMs` (default `[50, 200, 500, 1000, 2000]` — the macrotask backoff series). Stretch either if a specific card family legitimately needs more flush time. The detector module (`packages/host/app/utils/render-desync-detector.ts`) has the full chart and explains why it deliberately avoids `requestAnimationFrame` (RAF + Ember autotrack has a long tail of subtle breakages — microtask + macrotask yields align with how Backburner sequences its own flushes).

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
prerender-queue-snapshot totalTabs=5 totalPending=7 affinities=3 | realm:acme(tabs=2, pending=5, max=5, busy=file:1/module:1/command:0, priorities=tab:10:1,0:3|adm:0:1) realm:lib(tabs=2, pending=2, max=1, busy=file:1/module:0/command:0, priorities=tab:0:2) user:u-123(tabs=1, pending=0, max=0)
```

Each affinity with queued waiters gets a `priorities=` segment (skipped when no waiters are queued, even if a render is in flight, to keep the log compact). Format: `<source>:<priority>:<count>` pairs, comma-separated within a source, sources separated by `|`. `tab:` is the per-tab queue's _queued_ waiters; `adm:` is the per-affinity file-admission semaphore's _queued_ waiters. Priorities listed highest-first, matching dequeue order — so `tab:10:1,0:3` means "1 priority-10 waiter at the head of the queue, 3 priority-0 waiters behind it."

The `pending=` count on the same line includes the in-flight render holding the tab (legacy `pendingCount = held + queued` semantics), but `priorities=` counts queued waiters only. So `pending=4` with `priorities=tab:10:1,0:2` is consistent: 1 in-flight render + 1 priority-10 waiter + 2 priority-0 waiters = 4. Don't expect the priority counts to sum to `pending`.

Read with `priority` on the per-render `diagnostics`: a priority-10 row stuck on `waits.tabQueueMs` while the snapshot for its affinity shows `priorities=tab:10:N` is the smoking gun for an over-saturated user-priority workload (capacity issue, not priority misrouting). A priority-10 row stuck behind `priorities=tab:0:N` (with manager-side priority routing live in the build) is a priority-routing failure — manager picked the wrong server, or the file render the row was queued behind isn't releasing. Investigate the manager log for `requestId=…` to see where the manager-side scoring went.

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
2. **Does one row dominate total `render_ms`?** If yes, it's the real target. Read its `diagnostics` and apply Mode A's rubric to it.
3. **Are `launch_ms` and `waits.semaphoreMs` large across all rows?** If yes, capacity contention during the reindex, not the cards' fault.
4. **Is only the first-indexed row (min `indexedAt`) slow and the rest fast?** That's the cold-loader tax paid by the first render after a `.gts` invalidation (`clearCache: true` fired once for the batch). Expected on any executable invalidation — only worth chasing if the cold cost is disproportionate to the module graph.
5. **Is the sum of `render_ms` wildly larger than the card count × a reasonable per-card budget?** Look for `queryLoadsInFlight` / `recentQueryLoads` entries that repeat across rows — that's a query-field that multiple dependents all wait on.
6. **Is the fan-out bigger than you expected?** The `types` and `deps` columns on the same rows tell you _why_ each row was invalidated — useful for discovering unintentionally-heavy transitive deps (e.g. a dashboard re-renders because one of its metrics modules has a runtime reference to the changed module).

## When the diagnostics disagree with each other

The host-side hooks are best-effort and the page may die mid-capture. Trust this precedence:

1. `renderStage` — set synchronously by the host.
2. `inFlightModuleImports` — read from the loader which is still alive even after the timeout.
3. `cardDocsInFlight` / `fileMetaDocsInFlight` / `queryLoadsInFlight` — read from the store; can go stale if the store reset between timeout fire and capture.
4. `docsInFlight` number — legacy, only use if none of the above are present.

If `renderStage` says `buildModel:fetching-source` but `cardDocsInFlight` is empty, trust `renderStage` — the store clears its in-flight map once a load resolves, including failed loads, but the stage isn't touched until the next stage sets it.

## Reproducing a render interactively

Sometimes the written diagnostics aren't enough — you want to replay the exact render the indexer saw in a real browser (Chrome MCP, Puppeteer, or your own tab) to step through it, watch network, edit source and reload, etc.

There are two paths, depending on what you have access to:

- **Path A — direct token mint via `mise run claude-prerender-token`** (preferred for staging/prod when you have the realm secret seed). Skip the Matrix login and reindex steps; the script mints the same shape of token the indexer mints, then you drive Chrome MCP straight at the `/render` route. Works for any card on a server you have the seed for, without changing server config or triggering a reindex.
- **Path B — the `prerenderer-reproduce` log channel** (local dev, or when you need the indexer's exact historical session). Turn on a debug log level on the realm server, trigger a reindex, and copy the URL + session value verbatim from the log line.

Path A is faster, doesn't require server config changes, and works against staging/prod without touching the running fleet. Path B captures the indexer's exact multi-realm session at a point in time — the right choice when you suspect cross-realm fetch auth or want to replay a render that already happened. The "Visiting a render page" / Chrome MCP / `__boxelRenderDiagnostics()` recipe below is shared between the two paths.

### Path A — direct token mint (the common case)

The user runs `mise run claude-prerender-token <realm-url> [<seed>]`. The script (`packages/realm-server/scripts/claude-prerender-token.ts`, executed via `node` from inside `packages/realm-server`) mints a `boxel-session` JWT the same way the indexer does — same claims, same HS256/1d, same `JSON.stringify({ <realmUrl>: <jwt> })` map shape that lands in `localStorage['boxel-session']`. Faithful CLI port of `buildCreatePrerenderAuth` (`packages/realm-server/prerender/auth.ts`).

**The CLI is intentionally minimal: just `<realm-url>` and an optional `<seed>` positional.** If `<seed>` is omitted the script reads from `process.stdin` — interactively that's a masked TTY paste prompt (each char echoes as `*`, paste-friendly, no shell history); piped/redirected stdin is read in full and trimmed. Optional flags: `--user <matrix-id>` (required only for system realms), `--permissions <list>`, `--output <path>`, `--no-output`. That's it. The token is realm-scoped, not card-scoped — Claude builds the `/render` URL itself for whichever card it's investigating.

#### Hard rule: Claude never sees the seed

- Do NOT ask the user for the seed.
- Do NOT propose pasting the seed into the conversation, into a file Claude can read, or via any other channel.
- Do NOT call `aws ssm get-parameter` against `REALM_SECRET_SEED` — Claude's `boxel-claude-readonly` role rejects it anyway, but don't try.

The user fetches the seed however they like (SSM, dev-env, prompt) and runs the script in their own shell. Claude consumes only the artifact below.

Why: the seed mints arbitrary user-impersonating tokens with arbitrary permissions. A 1-day JWT for one user is a bounded leak; the seed is unbounded.

#### The artifact Claude reads

`/tmp/claude-prerender.json` (chmod 600), written by the script:

```json
{
  "mintedAt": "<iso>",
  "expiresAt": "<iso>", // 1d from mintedAt
  "user": "@ctse:stack.cards",
  "realmUrl": "https://realms-staging.stack.cards/ctse/concrete-mockingbird/",
  "jwt": "eyJ...",
  "session": "{\"<realmUrl>\":\"eyJ...\"}"
}
```

The host URL isn't in the artifact — Claude derives it from the realm URL when building the `/render` URL (recipe below). Matrix isn't involved in this flow at all; the realm-server's `checkPermission` just verifies the HS256 signature against the seed and looks up the user's row in `realm_user_permissions`.

Before using it, Claude must check:

- `expiresAt` is in the future
- `mintedAt` is recent enough that this is for the _current_ investigation (not a leftover artifact)
- `realmUrl` matches the realm of the card you're rendering — different realm = ask for re-mint

If any check fails, ask the user to re-run. Do not reuse stale artifacts.

#### Building the `/render` URL (Claude's responsibility)

Once Claude has the artifact, it constructs the URL the prerender uses, mirroring `packages/realm-server/prerender/render-runner.ts:832`:

```
<hostUrl>/render/<encodeURIComponent(cardUrl)>/<nonce>/<encodeURIComponent(JSON.stringify(options))>/html/<format>/0
```

Slot-by-slot:

- **`<hostUrl>`** — derive from the artifact's `realmUrl` host. The boxel-host-app URL (NOT matrix — matrix isn't involved in this flow). Recognised patterns, mirroring the deployed-env Caddy config + local dev / env-mode Traefik labels in `mise-tasks/lib/env-vars.sh`:

  | Realm host                              | Host-app URL                                            |
  | --------------------------------------- | ------------------------------------------------------- |
  | `realms-staging.stack.cards`            | `https://boxel-host-staging.stack.cards`                |
  | `realms.stack.cards`                    | `https://boxel-host.stack.cards`                        |
  | `realm-server.<slug>.localhost`         | `http://host.<slug>.localhost` (BOXEL_ENVIRONMENT mode) |
  | `localhost` or `*.localhost` (standard) | `https://localhost:4200`                                |

  If the realm host doesn't match any of these patterns, ask the user — don't guess. Constrain `realms-` matching to `*.stack.cards` so any future deployment using a `realms-` prefix on a different domain isn't silently mapped to a wrong (and possibly non-existent) host.

- **`<encodeURIComponent(cardUrl)>`** — the card's full file URL **including `.json`** (the indexer renders against the .json file, not the bare card-id). `https://realms-staging.stack.cards/ctse/concrete-mockingbird/Environment/demo.json` → `https%3A%2F%2Frealms-staging.stack.cards%2Fctse%2Fconcrete-mockingbird%2FEnvironment%2Fdemo.json`. Omitting `.json` lands you on the host's login page because the route doesn't match.
- **`<nonce>`** — any string. The indexer uses a monotonic counter; for manual replays `1` is fine.
- **`<encodeURIComponent(JSON.stringify(options))>`** — the render-route options object, JSON-encoded then URL-encoded. The shape lives in `packages/runtime-common/render-route-options.ts`. Common values:
  - `{"cardRender":true}` → `%7B%22cardRender%22%3Atrue%7D` (the indexer's card-render pass — what you want for a card desync repro)
  - `{}` → `%7B%7D` (no special pass)
  - `{"cardRender":true,"clearCache":true}` (drops the loader cache before the render — helpful when stale modules might be the cause)
- **`<format>`** — `isolated` (matches the indexer for card-render), `embedded`, `fitted`, or `atom`. Default to `isolated`.
- **`/0`** — recursion-depth segment. Always `0` for card render.

All six dynamic segments must be present and correctly encoded. If any is missing or malformed, the route doesn't match and the host falls through to its login page — easy to diagnose because you'll see a login form instead of a prerender container.

Worked example for the demo card:

```
https://boxel-host-staging.stack.cards/render/https%3A%2F%2Frealms-staging.stack.cards%2Fctse%2Fconcrete-mockingbird%2FEnvironment%2Fdemo.json/1/%7B%22cardRender%22%3Atrue%7D/html/isolated/0
```

#### Chrome MCP recipe (Path A specific — order matters)

`localStorage['boxel-session']` must be set BEFORE navigating to `/render`. The render route reads it on initial load; if the session isn't there yet, the auth resolves as anonymous and the route 401s before any of the diagnostic surface is reachable.

```
1. mcp__chrome-devtools__new_page → <hostUrl>/   (lands on the login page or homepage —
                                                  doesn't matter, we just need a same-origin
                                                  document to set localStorage on)
2. mcp__chrome-devtools__evaluate_script → localStorage.setItem('boxel-session', <session-from-artifact>)
                                           where <session-from-artifact> is the artifact's
                                           `session` field verbatim — a JSON-stringified map,
                                           NOT a bare JWT.
3. mcp__chrome-devtools__navigate_page → <render-url built above>
4. mcp__chrome-devtools__evaluate_script → document.querySelector('[data-prerender]')?.dataset.prerenderStatus
                                           polls 'loading' → 'ready' / 'error' / 'unusable'.
5. Once stable, evaluate __boxelRenderDiagnostics?.() to grab the live diagnostic blob,
   and inspect the console / DOM for the unminified throw.
```

If step 4 returns `null` (no `[data-prerender]` element at all) and the body shows a JSON `instance-error`, the request reached the host but failed auth — usually one of:

- The `permissions` array in the JWT doesn't match the user's DB row exactly (see "How auth actually clears" below — re-mint with `--permissions` matching the DB).
- The card URL in the render URL is missing `.json`.
- localStorage wasn't set before navigation (set it, then reload — don't expect the host to pick it up mid-request).

#### How auth actually clears the realm-server

The realm-server's `checkPermission` (`packages/runtime-common/realm.ts:2249`) does two things in order:

1. **Verify the JWT signature** against `REALM_SECRET_SEED`. Anyone with the seed can mint a valid signature — that's the diagnostic gate.
2. **Look up the token's `user` claim in the realm's permission table** via `RealmPermissionChecker.for(username)` (`packages/runtime-common/realm-permission-checker.ts`).
3. **Compare the JWT's `permissions` array against the DB's permissions array, sorted, byte-for-byte equal** (`packages/runtime-common/realm.ts:2306-2316`). This is the gotcha. The check is `JSON.stringify(token.permissions.sort()) === JSON.stringify(userPermissions.sort())`. So a JWT claiming `['read','realm-owner']` for a user whose DB row is `read=t,write=t,realm_owner=t` (which translates to `['read','write','realm-owner']`) is rejected with `PermissionMismatch` (401). Sub-set isn't enough; the arrays must be equal.

Practical implications:

- The `user` claim has to be a real Matrix ID — a made-up user passes signature verification but fails the lookup → 401. The script's default derivation (`realms-staging.stack.cards/ctse/realm/` → `@ctse:stack.cards`) hits the realm owner's row.
- The `permissions` claim has to mirror the DB exactly. The script defaults to `['read','write','realm-owner']` because that's the standard realm-owner shape, but if the user has a non-default permission set on this realm (read-only collaborator, write-without-owner, etc.) you'll hit `PermissionMismatch`. The fix is `--permissions <list>` matching the DB row.
- For system realms (`/catalog/`, `/experiments/`), the script errors and asks for `--user @realm_server:<matrix-domain>` (the realm-server bot — `REALM_SERVER_MATRIX_USERNAME=realm_server` in `packages/realm-server/scripts/start-staging.sh`/`start-production.sh`).

When the `instance-error` body says `User permissions in the JWT payload do not match the server's permissions`, it's specifically this check failing. Query the DB to see what the row actually is:

```sql
SELECT username, read, write, realm_owner
FROM realm_user_permissions
WHERE realm_url = '<realm-url>' AND username = '<user-from-artifact>';
```

Then re-mint with `--permissions read,write,realm-owner` (or whatever the columns are). Booleans translate one-to-one to array entries; column `realm_owner` becomes `realm-owner` (note the dash).

For local dev: matrix `server_name` is `localhost` (`packages/matrix/support/synapse/dev/homeserver.yaml:1`), so user IDs are `@<username>:localhost`. Two local-dev modes are supported:

- **Standard mode** (no `BOXEL_ENVIRONMENT` set) — realm at `https://localhost:4201/...`, host-app at `https://localhost:4200`.
- **Environment mode** (`BOXEL_ENVIRONMENT=<name>` set) — realm at `http://realm-server.<slug>.localhost/...`, host-app at `http://host.<slug>.localhost` (Traefik routing per `mise-tasks/lib/env-vars.sh`).

Both modes share `@<user>:localhost` for the matrix-domain part of user IDs. The host-app URL Claude needs to build the `/render` URL is derived from the realm URL per the table in the URL recipe section above. If you've configured a non-default matrix `server_name`, pass `--user` to the script explicitly.

**Public realms (`'*': ['read']` in the permissions table) don't need a JWT.** Published realms always get this set (`packages/realm-server/handlers/handle-publish-realm.ts:326`). If you're rendering a published card, no token is needed — though minting still works, the request just doesn't depend on it.

#### Cross-realm linksTo (when the simple flow isn't enough)

The default session map has only the target realm. If the card pulls private cross-realm `linksTo`, the host's loader will 401 those fetches.

For now this isn't auto-handled; if you hit a cross-realm 401, the user can extend the session map themselves by minting tokens for the additional realms (same secret signs them all) and merging the maps. The DB has the answer for which realms a user owns — query `realm_user_permissions` excluding published realms:

```sql
SELECT rup.realm_url
FROM realm_user_permissions rup
LEFT JOIN published_realms pr ON pr.published_realm_url = rup.realm_url
WHERE rup.username = '@ctse:stack.cards'
  AND rup.read = TRUE
  AND pr.published_realm_url IS NULL
ORDER BY rup.realm_url;
```

This matches the indexer's `fetchUserPermissions` (`packages/runtime-common/db-queries/realm-permission-queries.ts:127`) → `buildCreatePrerenderAuth` chain. Auto-discovery is a follow-up — for now, ask the user if cross-realm support is needed for a specific repro.

#### When this is the right path

- A specific card is failing in indexing on staging/prod and you want unminified Chrome stack frames + a `__boxelRenderDiagnostics()` snapshot.
- You're iterating on a card template locally and want to skip the reindex step entirely.
- You want to compare a render under different `RenderRouteOptions` (e.g. with vs without `clearCache`).

When this is **not** the right path:

- You need the indexer's exact session at the moment of a _historical_ render (cross-realm auth that's since changed, etc.) — use Path B.
- You're triaging a stall during the indexer's own pass and want diagnostics on the _real_ indexer's tab — Path A reproduces in a fresh tab; the indexer's tab is its own thing.

### Path B — the `prerenderer-reproduce` log channel

`packages/realm-server/prerender/render-runner.ts` defines a dedicated logger `prerenderer-reproduce` that emits a line **per card render** with a ready-to-use URL and the exact `boxel-session` value the indexer used (a JSON-stringified map from realm URL to realm-scoped JWT):

```
manually visit prerendered url <card-id> at: <boxel-host>/render/<encoded-card-id>/<nonce>/<encoded-options>/html/isolated/0 with boxel-session = {"https://localhost:4201/user/my-realm/":"eyJ…","https://cardstack.com/base/":"eyJ…", …}
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

   The response carries a map of `{ <realm-url>: <realm-JWT> }`. **That** is the token you pass on `Authorization` when calling the reindex endpoint in the next section. It's _not_ the token the prerender tab uses — that one comes from the `prerenderer-reproduce` log.

Three different JWTs float around in this area, so always be explicit about which one you mean:

| Token                                                        | Who mints it                                                                                                                                 | Used for                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Realm-server-level JWT                                       | `/_realm-auth` top-level, signed by server secret seed                                                                                       | Server admin endpoints (publish, etc.); _not_ accepted by card endpoints             |
| Realm-scoped JWT (this section)                              | Same `/_realm-auth` call, one per realm in the response map                                                                                  | Authenticating as a user to a specific realm — including `POST <realm>_full-reindex` |
| Indexer `boxel-session` value (from `prerenderer-reproduce`) | Minted internally by the indexer — a JSON-stringified `{ <realmUrl>: <realm-scoped-JWT> }` map, one entry per realm the indexer has auth for | Pasted verbatim into `localStorage['boxel-session']` on the prerender tab            |

Mix them up and you get 401s with no obvious reason.

### Visiting a render page

The render URL format is what the indexer uses and what `prerenderer-reproduce` logs:

```
<boxel-host>/render/<encoded-card-id>/<nonce>/<encoded-options>/html/isolated/0
```

- `<boxel-host>` — `HOST_URL` / whichever host the realm server points its prerender at (usually `https://localhost:4200` locally).
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
curl -X POST -H "Authorization: Bearer $GRAFANA_SECRET" \
  "$REALM_SERVER/_grafana-reindex?realm=<realm-path-without-leading-or-trailing-slash>"

# Full server (enqueues one full-reindex job covering every realm on this server)
curl -X POST -H "Authorization: Bearer $GRAFANA_SECRET" "$REALM_SERVER/_grafana-full-reindex"
```

`POST` with `Authorization: Bearer <secret>`. Clears module caches before enqueuing. Use when you don't have a user account on the realm but do have access to the server's grafana secret.

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
  "https://localhost:4201/user/<realm>/_full-reindex"

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

If `GRAFANA_SECRET` is configured on your server, you can skip the user-JWT step and use `curl -k -X POST -H "Authorization: Bearer $GRAFANA_SECRET" https://localhost:4201/_grafana-full-reindex` instead (no MIME gotcha on the grafana endpoints). In dev the per-realm JWT path is almost always easier.

## Prerender capacity tuning knobs

Three env vars control the per-prerender-server shape. They're resolved once at `PagePool` construction; changes require a process restart.

| Env var                               | Default                                                                                                 | What it controls                                                                                                                                                                                                                                | When to change it                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRERENDER_PAGE_POOL_MIN` / `_MAX`    | unset → fixed pool of `options.maxPages` (5)                                                            | Dynamic-pool envelope. The pool boots at MIN, expands up to MAX under saturation, contracts back to MIN after sustained idle. The live capacity is what the server reports to the manager on each heartbeat, which drives warm-vacancy routing. | Fleet capacity. Raise MAX when `waits.semaphoreMs` dominates `launchMs` across rows from all realms (server-wide saturation); lower MAX if you need to reduce memory footprint and you can confirm from snapshots that pending rarely approaches `totalTabs`. Setting MIN === MAX disables expansion/contraction. |
| `PRERENDER_AFFINITY_TAB_MAX`          | `5` (clamped to the effective pool max: `PRERENDER_PAGE_POOL_MAX` when set, otherwise fixed `maxPages`) | Max tabs a single affinity (realm or user) can simultaneously hold from the pool.                                                                                                                                                               | Rarely. Must be ≥ 2 for the self-referential prerender deadlock to be prevented — PagePool logs a warning at startup when it isn't. Lower only if you want to force multi-realm fairness at the tab-routing level.                                                                                                |
| `PRERENDER_AFFINITY_FILE_CONCURRENCY` | unset → `max(1, PRERENDER_AFFINITY_TAB_MAX − 1)` (the deadlock-safety ceiling)                          | Cap on concurrent `file` renders within a single affinity. Module and command calls bypass admission; they're never capped by this knob.                                                                                                        | Cross-realm fairness. When one realm's fan-out (e.g. a catalog reindex) is stealing render budget from every other realm, lower this below the ceiling to reserve tabs for other affinities. The effective cap is always `min(env, ceiling)` so this can't accidentally break the deadlock-safety invariant.      |

**Default invariant**: when `PRERENDER_AFFINITY_FILE_CONCURRENCY` is unset, the effective file-admission cap equals the deadlock-safety ceiling — same behavior as before the knob existed. Changing the knob is an explicit operator decision driven by `admissionMs` telemetry; don't adjust it without data.

When the cap is active and below the ceiling, PagePool logs one info line at construction:

```
file-queue admission: cap=2 (affinityTabMax=5, deadlock-safety ceiling=4)
```

Grep for `file-queue admission: cap=` in prerender-server logs to confirm the effective value in a running fleet.

## Extending the diagnostics

If you find you want a signal that isn't here, add it to `RenderTimeoutDiagnostics` in `packages/runtime-common/index.ts` (optional field), populate it in `packages/realm-server/prerender/utils.ts` (the `withTimeout` capture block) by evaluating a new globalThis hook on the page, and expose that hook from `packages/host/app/routes/render.ts::__boxelRenderDiagnostics`. The Prerenderer decorator lifts it onto `response.meta.diagnostics` and the indexer persists it into `diagnostics` unchanged.

Remember to also surface it on the error log line in `withTimeout` so operators see it without opening the JSON.
