# Tessar query materialization: DO NOT MERGE POC plan

Status: planning and environment preparation only. Implementation, synthetic-data
generation and benchmarks remain paused until the user asks to resume.

This is a draft experiment. Do not merge it, enable auto-merge or deploy its
runtime changes to production. Use **Tessar** as the codename in every new
monorepo-facing document, PR description, fixture family and benchmark artifact.
Keep real deployment names, account identifiers and realm URLs outside the
monorepo. Production records must never become fixtures or benchmark inputs.

## Goal

Use Boxel indexing to maintain shared dashboard lists and statistics. Readers
consume the materialized results instead of reconstructing the business-data
graph and repeating the computation. Source changes identify which saved views
need to be recomputed, including queries that previously returned no results.

Reuse Boxel's query language, `computeVia`, indexed JSON, dependency tracking and
indexing workers. The initial implementation maintains results through
incremental invalidation followed by recomputation. It does not implement
arithmetic delta maintenance of arbitrary JavaScript aggregates.

Success has two independent parts:

1. A clean indexed view can display supplied computed results without calling
   their getters or fetching their input graph again.
2. A relevant source change reliably refreshes that view, while unrelated writes
   and additional readers do not repeatedly execute its query and computation.

## Current checkpoint

- Main was updated to `e9a4b0a54a` on September 10, 2026.
- Work uses the isolated branch `codex/do-not-merge-query-materialization-poc`.
- The draft POC is [PR #6085](https://github.com/cardstack/boxel/pull/6085).
- A private staging fork contains 154 copied definition/support files, verified
  against their prepared hashes. All 29 card types used by the source dataset
  passed schema generation there.
- No production records were uploaded. The temporary source-data archive,
  prepared JSON copies, import inventory and temporary source authentication
  cache were removed. Only aggregate counts were retained for sizing.
- No runtime implementation, database migration, synthetic generator or measured
  performance result is included in this checkpoint.

The staging fork runs the staging deployment's runtime. It does **not** run this
monorepo branch merely because its GTS files are copied there. Develop and measure
the runtime changes on an isolated local stack from the worktree, including its
own database and indexing workers. A branch-specific hosted environment is a
later option; changing a shared staging backend is outside this plan.

Keep source-deployment writes out of the experiment. Before a synthetic UI trial,
replace any copied definition's deployment-specific defaults or external data
references with synthetic equivalents in the development environment.

## Scope and constraints

The first slice supports saved materialized summary cards, same-realm queries,
stable classroom/day parameters, and the typed equality, `in`, range and boolean
predicates needed by Tessar. Computations must derive from indexed inputs and
stable parameters. Keep draft state, current identity, date navigation, generation
progress and clock-based presentation local to each user. Store stable deadlines
as data rather than reindexing every minute.

Use a small acyclic feeder graph. Keep concrete dependencies on consumed input
cards and their transitive inputs. Query watches supplement those dependencies.
Do not globally enable query-only dependencies for all existing cards.

Defer cross-realm watches, full-text/ranking dependencies, arbitrary cyclic views,
field-level JavaScript read-set inference, a new aggregation engine, and a new
projected-query authoring API. Unsupported query shapes must be rejected for
materialization with a clear explanation or use a proven conservative fallback;
they must not silently lose invalidations.

## Revalidate current main before implementing

The earlier investigation used `730081f8b4`. The updated base has client behavior
that the implementation must preserve:

| Area | Confirmed behavior and consequence |
| --- | --- |
| `packages/base/field-support.ts` | Computed getters still invoke `computeVia` even when deserialization supplied a value. A pass-scoped compute memo is not a persisted snapshot. |
| `packages/host/app/routes/render/meta.ts` | Index serialization still uses `omitQueryFields: true` and excludes query-only runtime dependencies. |
| `packages/base/query-field-support.ts` | Eager query resolution, `eager: false`, newer-document seed handover and generation ordering already exist. Integrate with these paths. |
| `packages/host/app/resources/search.ts` | Seed ordering uses realm-specific generation floors. Ordinary live resources still refresh on realm events. Existing floors are not an exact materialization revision contract. |
| `packages/host/app/services/store.ts` | Selective search-entry inflation and scoped card searches exist. `addResourceFromSearchData` still adds a single-resource document; inspect compound-resource reuse before adding a cache. |
| `packages/runtime-common/realm-index-query-engine.ts` | GET/search assembly can populate query fields and expand links. Client snapshot support alone does not remove this server work. |
| `packages/runtime-common/index-writer.ts` | Working-index buffers, batch promotion and generation guards already exist. Integrate watch publication and invalidation with these mechanisms. |

Record the exact base commit, existing behavior and relevant feature flags in
each benchmark run. Recheck these paths if main is updated again.

## Synthetic data and baseline design

Generate new records from a fixed seed. Use fabricated names, narratives, IDs,
scores, statuses and dates. Do not anonymize production records or use them as
templates. Keep credentials and runtime deployment addresses out of output.

| Preset | Instance count, excluding realm/index configuration | Purpose |
| --- | ---: | --- |
| Smoke | Small explicit fixture | Human-auditable counts, membership and graph behavior |
| 1x | 1,255 | Approximate the current production-sized workload |
| 10x | 12,550 | Expose scaling costs |
| 100x | 125,500 | Stress the design on an isolated runtime |

Retain a representative mix of reference, schedule, roster, observation, report
and summary records. Match the intended topology and approximate payload sizes,
not merely the total record count. The exact production-shaped distribution can
remain local; committed manifests describe only synthetic data.

Vary these axes separately:

- **Realm size:** add unrelated classrooms/dates while holding one watched view's
  matching inputs and displayed rows constant.
- **Query cardinality:** increase matching inputs for one classroom/day while
  holding the displayed summary size constant where possible.
- **Graph cost:** vary link depth, fan-out, shared targets and record body size.
- **Readers and writes:** use 1, 10 and 50 readers, then relevant and unrelated
  writes, bursts, moves, deletes and changes to transitive dependencies.
- **Watch selectivity:** compare tightly scoped queries with broad/fallback
  predicates. Broad dependencies are expected to cause broader invalidation.

Implement a deterministic generator and run manifests, not a checked-in tree of
125,500 JSON files. Materialize large datasets on demand, with bounded generator
memory and resumable seeding. Keep generated data and raw benchmark output out of
Git. Confirm referential integrity and expected summary values before measuring.

Proposed monorepo locations: `scripts/tessar/` for generation/benchmark tooling,
small `tessar-*` GTS fixtures in the existing test fixture directories, and
`docs/tessar-*` for the plan and sanitized results. Use only locations needed by
the first experiment; avoid introducing a new package.

Record the current implementation against the same synthetic fixture and the
same runtime/database resources used for the candidate. Separate cold indexing,
cold client load, warm reads, and post-write refresh. A staging baseline on a
different runtime or machine is contextual evidence, not a controlled speedup.

## Contract to establish first

Use one explicit opt-in on a materialized summary definition. Keep query authors
on existing Boxel query definitions and ordinary `computeVia`. Source card types
should not need new annotations simply because a summary consumes them. Settle
the smallest declaration syntax in the contract spike before changing APIs.

An indexed response must identify its materialized fields and carry enough
provenance to establish:

- Which computed values and query memberships are complete and successful.
- The definition/query revision and source realm that produced them.
- The input/index revision observed by the computation and the published owner
  revision. Do not equate today's generation floor with an exact result revision.
- Whether a value is missing, unresolved, partial, errored or successfully empty.

Use existing JSON attributes and relationship IDs for the values themselves.
Add the smallest versioned metadata necessary; do not invent a second card wire
format. Successful `0`, `false`, `null` and empty arrays must survive round trips.

The mode applies to clean indexed views. Missing metadata follows existing
behavior. Unsaved cards, indexing and explicit live editing compute from their
inputs. Editing a snapshot-backed owner must explicitly leave snapshot mode or
use a local overlay; stale snapshot values must not masquerade as edited results.

## Step 1: read the indexed results without rebuilding their inputs

1. Capture supplied computed values in a snapshot structure separate from the
   authored/default data bucket. Mark only values with valid server provenance.
2. In indexed-view mode, have the computed getter read that snapshot. Propagate
   the mode through contained fields. Preserve ordinary computation elsewhere.
3. Keep complete query membership separately from hydrated member instances.
   Bypass eager query resolution and realm-wide live searches for an authoritative
   materialized field. Reuse existing query signatures and seed ordering.
4. Preserve already-returned raw resources in a bounded, revision-aware map where
   current main loses them. Hydrate on demand through the existing identity map.
   Passing the entire compound document into today's eager deserializer is not
   sufficient: it can still instantiate the graph.
5. Do not bulk-fetch seed URLs simply to recover already-known membership. The
   first UI uses serialized statistics and compact contained rows. Zero-hydration
   arbitrary iteration of a `linksToMany` array is not a prerequisite.
6. Refresh snapshot values when the owner is invalidated, with generation and
   definition checks. A local source write must refresh dependent summaries in
   that same client; self-originated write suppression protects the actual edit.
7. Add the corresponding server read path: return stored membership and computed
   values together, without rerunning query membership or recursively assembling
   its input graph. Preserve ordinary explicit source-card reads.

Initial tests may use supplied serialized fixtures to isolate client behavior.
This step is not ready for continuously refreshed views until step 2 works.

Primary files: `packages/base/card-api.gts`, `packages/base/field-support.ts`,
`packages/base/query-field-support.ts`, `packages/host/app/services/store.ts`,
`packages/host/app/resources/search.ts`,
`packages/runtime-common/realm-index-query-engine.ts`, and the relevant handlers
in `packages/runtime-common/realm.ts`.

Gate: rendering the supplied output executes zero materialized computed getters,
makes zero requests for its input dependencies, and does not run a query-field
search. Nested computeds, empty results, owner refresh, module replacement,
editing and legacy fallbacks work. Server GET does not repeat membership work.
Opening a source record is allowed to hydrate that record.

## Step 2: durable reverse-query invalidation

### Predicate semantics and candidate lookup

Keep the resolved Boxel query AST as the authority. Resolve `$this` parameters
during indexing and include the source scope/type plus query/definition revision.
For a predicate `Pq` and changed indexed document `d`:

```text
matches(d)        = { q in saved queries | Pq(d) }
affected(old,new) = matches(old) union matches(new)
matches(d)       is a subset of candidates(d)
```

An absent old/new version matches nothing. A content edit that matches both
versions still invalidates the summary: membership can stay the same while a
score, status or nested dependency changes a computed result.

Build a registry keyed by owner and field, with source scope, resolved query and
revision. Derive a companion routing-term table; use ordinary indexed columns
such as realm, source type, field path, typed value and watch ID. The first
extractor can select one mandatory equality anchor, expand `in` anchors, and
fall back to a broader bucket when no safe anchor exists. Include type ancestry.

Every boolean branch must be covered. Do not naively intersect term lists for
queries with different constrained fields, `OR`, or `NOT`. Candidate selection
may return extras but must never miss a matching query. Verify candidates against
the old/new documents using Boxel's existing semantics. Reuse or factor the
existing compiler rather than introduce an independently interpreted filter DSL.
Test nulls, plural paths, type inheritance and reference normalization: `eq` and
`in` currently have different rules.

For sorted/paginated queries, watch the unpaginated membership predicate. A row
outside the current page can enter it after an insert or sort-key edit. Initially
invalidate conservatively; result fingerprints can be a later optimization.

The algorithmic reference is [Elasticsearch Percolator](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-percolate-query).
Its implementation can inform extraction/fallback review, but no Elasticsearch
dependency is required. PostgreSQL indexes route candidates; they do not
automatically reverse-evaluate a JSON query AST.

### Registration, dependencies and publication

1. Register watches during owner indexing, independent of open clients. Capture
   successful empty queries and replace obsolete watches when parameters or
   definitions change. Delete watches when their owner is deleted.
2. Retain concrete dependencies on consumed result cards and their transitive
   inputs for opted-in computations. Keep ordinary cards' dependency behavior.
3. Capture old/new effective indexed rows before replacement or tombstoning.
   Include dependency-driven reindexes and indexing-error transitions, not just
   raw file writes. Avoid invalidating solely because unrelated HTML changed.
4. Select and verify candidate watches, then mark owners dirty durably. Deduplicate
   owners across a batch and coalesce bursts through the existing indexing queue.
   Process owners after the changed source rows are visible to their queries.
5. Publish computed values, membership and dependency/watch registrations as one
   consistent owner revision. Ordinary GETs must not mix that snapshot with a
   newly executed membership query.
6. Establish an input-watermark/retry protocol compatible with current working
   index buffers and batch promotion. A source change racing registration cannot
   disappear, and a worker finishing older work cannot clear newer dirty work.
   Do not hold a database transaction open across long asynchronous card renders.
7. Propagate changed feeder outputs to their parents, with cycle detection and
   an actionable failure mode. Full rebuilds need source-first scheduling or a
   convergence pass. Cover retries, restarts and definition/module replacement.
8. Keep pending work in durable storage. Notifications only wake workers. Maintain
   explicit error/freshness state when recomputation fails; do not publish partial
   results as a successful complete snapshot.

Primary files: `packages/runtime-common/index-writer.ts`,
`packages/runtime-common/index-query-engine.ts`,
`packages/runtime-common/index-runner.ts`,
`packages/runtime-common/index-runner/card-indexer.ts`,
`packages/runtime-common/index-runner/relationship-dependency-extractor.ts`,
`packages/runtime-common/dependency-tracker.ts`,
`packages/host/app/routes/render/meta.ts`, `packages/base/searchable.ts`, and the
query normalization/signature helpers. Add one focused runtime module for watch
registration/matching if that keeps responsibilities clear. Reuse existing queue
integration before adding a separate worker or scheduler.

Create migrations with `pnpm create <migration_name>` in `packages/postgres`,
then regenerate the SQLite schema with `pnpm make-schema`. Cover both adapters.

Gate: insert into an empty result, deletion, moves between groups/dates,
content-only changes, transitive changes, pagination, watch replacement and
definition changes refresh the correct owner. Unrelated scoped writes do not.
Race/restart tests show no lost invalidation. Feeder chains converge. One client's
write refreshes its own displayed dependent summary as well as other clients'.

## Tessar realm adaptation

Create a persisted day summary and only the feeder views that have independent
consumers. Query existing source card types and compute compact contained rows
and statistics. Reuse the existing schedule composition, coverage, report-version
and pipeline rules; move their shared deterministic parts out of component getters.

Display rows contain the labels, IDs, statuses, ordering values and counts the UI
actually needs. Preserve source IDs for drill-down/editing without embedding every
source card object. Keep user selection, unsaved overlays, timers and AI-generation
state local. Do not infer historical attendance from a current location field.

Provision summary instances through synthetic seeding/day setup so indexing
can precompute them before a user visits. Decide explicitly how an uncached day
is provisioned; do not write shared navigation state onto a singleton dashboard.

Retain truly ad hoc and AI-input queries where needed. Remove the broad read-time
loads serving the shared displayed lists/statistics. Verify no hidden component
getter or default eager query path reconstructs the same input graph.

Do this work in the isolated development realm. Commit only synthetic Tessar
fixtures and generic runtime changes to the monorepo.

## Milestones and reviewable increments

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| M0: baseline and contract | Revalidate main; small deterministic fixture/generator; define opt-in, metadata, modes and revisions | Baseline request/compute trace and known expected results |
| M1: snapshot consumption | Base/host/server read path from step 1 | Zero recomputation/input requests for supplied outputs, with legacy/editing regression checks |
| M2: reverse matcher | Registry schema and conservative routing/verification primitives | Predicate parity and no-missed-candidate cases, including empty, boolean and pagination cases |
| M3: index lifecycle | Register watches, retain dependencies, coalesce dirty owners and publish consistently | End-to-end change propagation plus race, restart and feeder convergence tests |
| M4: Tessar display views | Synthetic realm summaries, compact rows and dashboard consumption | Matching UI output; successful source edits/drill-down and local overlays |
| M5: scaling evidence | Controlled base/candidate runs across sizes and concurrency | Sanitized results with measured limits and remaining bottlenecks |

Keep these as distinct commits or small reviewable groups on the draft POC. M1
alone does not establish freshness. M2 alone does not establish durable view
maintenance. Do not present a primitive-only proof as the completed use case.

## Validation and measurements

Extend the nearest existing tests, with small synthetic GTS fixtures and explicit
expected results rather than tests that repeat the implementation:

- Host query-field acceptance, seed/refresh, membership-status and barrier tests.
- Host index-query-engine, index-writer and runtime-dependency-tracker tests.
- Realm-server skip-query-backed-expansion, live-search-cache, indexing and queue
  tests where the corresponding integration behavior is changed.
- Focused generator integrity checks: repeatable output, valid links and known
  summary values. Never commit a large generated dataset as test fixtures.

Use the pinned mise/Node/pnpm toolchain. Use Glint, never direct `tsc` or
`glint --declaration`. Run package lint before commits that change package code.
Run focused host/realm-server tests and capture complete host output to files.
Do not run the entire host suite locally. Run realm lint and render validation
for changed GTS, recording any pre-existing baseline separately.

For each benchmark, record commit, runtime/database configuration, seed, dataset
manifest, query shape/cardinality, graph shape, reader count and cache state.
Collect:

- Cold/warm dashboard latency and response bytes.
- Client requests, instantiated cards and computed-getter invocations.
- Server query counts, assembly work and relevant database query plans/timing.
- Initial indexing time, worker CPU/memory and queue backlog.
- Reverse candidates examined, watches matched and owners actually reindexed.
- Source-write-to-summary freshness and work performed during write bursts.

Use enough repeated observations to report distributions meaningfully; do not
label a single run p95. Hold displayed output size fixed in the unrelated-growth
case. Measure membership-ID serialization separately from source-graph expansion;
do not claim constant payload size when the returned list itself grows.

Hard correctness/performance-shape criteria are zero redundant computation and
input fetching on a snapshot read, no lost invalidations, and no reindex of an
unrelated scoped summary. Numerical latency, memory and throughput targets will
be set from M0 on the chosen runtime rather than invented now. Large matching
sets and broad watches can still require substantial indexing work; quantify it.

## Scope estimate and completion

Working estimate, subject to the M0 recheck: 1,600–2,700 monorepo implementation
lines plus 1,400–2,300 focused test lines. Realm adaptation is about 600–1,000
changed GTS lines, including moving existing logic. Synthetic generation and
benchmark tooling are a separate, not-yet-sized work item. These are estimates,
not a promised diff size or elapsed-time commitment.

Finish with a sanitized Tessar benchmark report, the tested contract, and a list
of remaining limitations. The PR remains draft and DO NOT MERGE even after its
tests pass. Production promotion and any shared-runtime deployment require a
separate decision. Until the user resumes implementation, this plan is the
stopping point.
