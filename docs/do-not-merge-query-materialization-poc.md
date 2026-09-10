# DO NOT MERGE: query materialization POC

This branch prepares an isolated experiment for Classroom Central. It is not a
production change and must remain a draft. Do not merge it, enable auto-merge,
deploy it to production, or write experimental changes into the source realm.

## Environments and scope

- Base: `main` at `e9a4b0a54a`, fetched September 10, 2026.
- Branch: `codex/do-not-merge-query-materialization-poc`.
- Source deployment realm: `https://app.boxel.ai/tribecaprep/nucleus-lms/`.
- Development fork:
  `https://realms-staging.stack.cards/ctse/nucleus-lms-query-materialization-poc/`.
- The staging fork is private to its owner and contains definitions only, plus
  its default configuration. Do not copy production records into this fork.
- Realm source/data stay outside the monorepo. Do not commit student records,
  source archives, credentials, or local sync history here.

The latest instruction selects staging for active development. It supersedes the
earlier proposed development location under the production account. Nucleus LMS
remains a deployment realm for separately approved promotions and migrations.

Initial branch status: environment setup and implementation plan only. The
runtime feature and the realm summary definitions have not been implemented.

Paused at the user's request on September 10, 2026. No runtime implementation,
synthetic fixture generation, or benchmarks have started. Resume only when asked.

Fork preparation: 154 definition/support files have been copied and verified
against their prepared source hashes; all 29 card types used by the source
instances passed schema generation on staging. No production records were
uploaded. The temporary production archive, 1,257 prepared JSON files, import
inventory and temporary source authentication cache have been removed. Only
aggregate counts remain for sizing synthetic fixtures.

The benchmark data must be newly generated and deterministic, with fabricated
identities, narratives and relationships. Do not anonymize or reuse production
records. Initial planned sizes are 1,255 instances (approximately the current
production count, excluding realm/index configuration), 12,550 instances and
125,500 instances. These are planned fixture sizes, not generated datasets.
Preserve a representative mix of card types. Vary total realm size separately
from matching records per classroom/day and graph fan-out so the measurements
distinguish unrelated data growth from growth of an individual materialization.

## Intended outcome

Materialize the shared classroom/day lists and statistics during indexing. A
dashboard reader should consume those saved results without hydrating the input
graph to repeat the computation. Source changes should precisely identify which
saved summaries need recomputation, even when the previous query result was empty.

Keep the current Boxel query language and `computeVia`. The first experiment is
same-realm, with deterministic predicates needed by the classroom workload.
Queries run when an affected owner is reindexed; this is incremental invalidation
followed by recomputation, not arithmetic maintenance of arbitrary aggregates.

## Recheck against current main

The preceding investigation used `730081f8b4`. Main has advanced substantially.
Do not implement directly from its old line references or assume its complete
client behavior still applies.

Confirmed in the new base:

- `packages/base/field-support.ts` still invokes `computeVia` from a computed
  getter, including when deserialization supplied a value.
- `packages/host/app/routes/render/meta.ts` still serializes with
  `omitQueryFields: true` and excludes query-only runtime dependencies.
- `packages/base/query-field-support.ts` now supports eager query resolution,
  an `eager: false` opt-out, and newer-document seed handover with realm-specific
  generation ordering. Snapshot mode must integrate with these paths.
- `packages/host/app/services/store.ts` now exposes selective search-entry
  inflation and scoped card-initiated searches. Reassess compound-document reuse
  and live-search caching before adding another cache or hydration mechanism.

## Step 1: consume server materialization

1. Introduce a narrow opt-in for clean indexed instances that records which
   computed values and query memberships were successfully supplied. Include
   provenance, completeness, errors and revision information.
2. Let computed getters use those supplied values without invoking `computeVia`.
   Preserve successful zero, false, null and empty results. Apply the mode to
   nested contained values as well.
3. Retain resolved membership separately from hydrated member instances. Avoid
   rerunning the search or loading every member merely to recover known IDs.
4. Reuse returned raw resources for lazy hydration where current main does not
   already do so. Preserve canonical instance identity and bounded cache lifetime.
5. Refresh snapshots on owner invalidation. Keep editing, unsaved cards,
   indexing and source-file hydration on the appropriate live-computation path.
6. Ensure a local leaf write refreshes dependent summaries in that same client;
   self-originated invalidation suppression must only protect the actual edit.
7. Serve a materialized owner's stored query membership without dynamically
   replacing it at GET time or recursively assembling its input graph.

Acceptance: displaying supplied results makes zero input-dependency requests and
zero computed-getter calls. Opening an actual source record may hydrate it.

## Step 2: reverse query dependencies

Persist a watch for each opted-in owner/field during indexing. A watch contains
the resolved Boxel query, source scope/type, owner identity and definition
revision. Register empty results too. There is no new author-facing predicate
language and no Elasticsearch dependency.

For a document `d`, reverse matching is the set of saved queries whose filters
match `d`. For a source change, consider queries matching either the old or new
indexed document. A matching record's content change can affect a computation
without changing result membership.

1. Extract conservative routing terms into an indexed lookup table. Initially
   support mandatory equality or `in` terms, with broad fallback buckets when
   safe extraction is impossible. Candidate selection may over-select but must
   never miss a matching watch.
2. Verify candidates with the existing Boxel matching semantics. Reuse/factor the
   query compiler as appropriate; test nulls, plural paths, type inheritance,
   and the different reference-normalization rules of `eq` and `in`.
3. Capture old/new effective indexed rows for inserts, updates, deletions,
   dependency-driven changes, and transitions into or out of indexing errors.
4. Retain concrete dependencies on query results and transitive inputs actually
   consumed. Reverse watches supplement these edges by discovering new matches.
5. Queue affected owners after source data is visible. Coalesce bursts and
   persist pending work; notifications are wakeups, not the durable state.
6. Publish watch registration, membership and computed values consistently.
   Prevent registration/write races and an older worker clearing newer dirty
   work. Cover restart recovery, definition changes and deleted owners.
7. Propagate changed feeder outputs to their consumers, with cycle controls and
   full-rebuild convergence. Treat sorted/paginated queries conservatively:
   an unseen matching row can enter the returned page.

Use the standard PostgreSQL migration workflow and regenerate the SQLite schema.
Do not install a database extension or replace the existing indexing queue.

## Realm adaptation

Create a persisted classroom/day summary in the staging fork, with scoped query
fields and ordinary computed contained rows/statistics. Reuse the business rules
currently in `schema/classroom-day.gts`, including slot composition, coverage,
report versions and pipeline state.

Keep selected child/date navigation, drafts, unsaved records, generation progress,
and clock-based presentation local. Store stable deadlines and shared facts.
Load full source cards when an interaction needs them. Do not mistake current
student location for dated historical attendance.

Avoid introducing a projected-query API unless measurements show that the
remaining server indexing cost requires it. Compact display rows can use existing
contained fields and `computeVia`.

## Validation and stopping condition

- Record the fork's source fidelity and existing indexing/lint baseline before
  editing its definitions.
- Exercise empty-to-first-match, deletion, classroom/date moves, content-only
  updates, pagination changes, transitive inputs and query-parameter changes.
- Verify unrelated classroom writes do not refresh the summary and repeated
  relevant writes coalesce. Test feeder chains and concurrent registration/write.
- Measure cold dashboard load, network requests/bytes, client computation,
  source-write-to-summary freshness, and indexing work with multiple readers.
- Run focused host/realm-server tests, Glint where appropriate, and package lint.
  Capture full host test output. Do not run the entire host suite locally.
- Keep the PR draft and titled DO NOT MERGE, including after successful tests.
  Report results and limitations; production promotion is a separate decision.

Working estimate, subject to revalidation against this base: 1,600–2,700 monorepo
implementation lines, 1,400–2,300 focused test lines, and about 600–1,000 changed
realm GTS lines, including relocation of existing logic.
