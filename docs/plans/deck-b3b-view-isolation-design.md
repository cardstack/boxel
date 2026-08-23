# Deck B3b design: view isolation through Boxel runtime

B3a made a branch head name one immutable index-generation manifest. B3b makes
that same hash the namespace for every derived or cached artifact. The public
realm URL and RRI stay stable; the exact view is carried separately.

This document is an execution map, not a second protocol. The protocol object
remains `boxel-realm-view-context-v1`, and its immutable manifest hash is the
view identity.

## One identity everywhere

```text
branch ref
   │
   └── indexGenerationHash
            │
            ├── source request: X-Boxel-Realm-View
            ├── browser fetch cache key
            ├── Loader lifetime
            ├── indexing concurrency group
            ├── SQL index namespace
            ├── prerender job + artifact namespace
            ├── event/activity subject
            └── test-selection baseline
```

A branch name is useful navigation, but it is not a safe execution identity:
it can move during a render, job, or test run. Those operations resolve a
branch once and carry the resulting `indexGenerationHash` to completion.

## Storage decision

Do not encode a view into `realm_url`. The URL is a public resource identity,
and code throughout Boxel parses and displays it as such. Instead, add an
explicit `realm_view` column whose values are:

- `live` for a non-Deck realm and the ordinary live lane;
- one 64-character `indexGenerationHash` for an exact Deck view.

The default is not support for an older Deck dialect. It is the intentional
mode boundary required for realms that do not advertise Deck at all.

Every table whose rows can differ by source view must include `realm_view` in
its key and predicates:

- `boxel_index` and `boxel_index_working`;
- `prerendered_html` and `prerendered_html_working`;
- `realm_generations` and `realm_meta`;
- `realm_file_meta`;
- `module_transpile_cache`;
- media/prerender artifact ledgers where source generation alone is
  insufficient.

The Postgres migration and generated SQLite schema land together. Existing
rows become `live`; there is no guessed conversion into a Deck view.

## Execution slices

### B3b.1 — exact source and cache identity

Implemented in the first B3b commit:

- shared `RealmViewContext` validation in runtime-common;
- `X-Boxel-Realm-View: <indexGenerationHash>` transport;
- exact CAS file and `_mtimes` serving at the ordinary realm URL;
- read-only, fail-closed handling for a selected view;
- immutable response validators and `Vary` metadata;
- browser fetch-cache partitioning by view;
- Loader request stamping retained across Loader clones;
- distinct indexing concurrency groups for live and every exact view.

The proof creates two accepted source generations, dirties the live directory,
and reads both old trees plus their inventory from the same URL without seeing
the live bytes.

### B3b.2 — SQL index generations

The storage half is implemented in the second B3b checkpoint:

1. `realm_view` is part of the Postgres and generated SQLite composite keys
   for index rows, rendered rows, generations, realm summaries, and file
   metadata.
2. `IndexWriter.createBatch`, `Batch`, `IndexQueryEngine`, and
   `RealmIndexQueryEngine` accept one normalized view namespace internally.
3. Every write, resume, invalidation walk, working-table promotion, summary,
   generation counter, and read predicate in those layers is view-qualified.
4. Public card/module URLs remain unchanged in documents and dependency
   edges.
5. Copying can name a source view independently from its destination view, so
   cloning an index never silently copies `live` when an exact source was
   intended.

The focused proof writes different documents for the same URL into `live` and
one 64-character view, reads each through a separately qualified query engine,
and verifies that they own independent generation counters.

The job-connected half remains in B3b.3: attach a completed SQL generation to
the immutable manifest and never let a branch ref name a partially indexed
view.

Proof: index `main` and one hidden PretUI view with the same RRIs but different
Status/DatePicker implementations, then query them concurrently and compare
the distinct HTML and search documents.

### B3b.3 — jobs and prerender

Every indexing and prerender payload carries the exact view hash. Queue
coalescing, concurrency groups, resumable working rows, Loader epochs, page
affinity, cancellation, and artifact keys all include it. A job must reject if
its manifest disappears or does not match the requested realm RRI.

The worker adds the exact-view header only to reads within the source realm.
Imports locked to exact package Versions keep using their Version URLs and
ordinary immutable caching.

Proof: simultaneous main/hidden-branch indexing cannot join one queue job,
resume one another's working rows, share a warm prerender Loader, or swap one
another's production rows.

### B3b.4 — events and activity

Realm file/index events gain an optional exact view identity. `live` events
retain today's shape for non-Deck realms; Deck branch events require the view
hash and branch display name. Subscribers invalidate only stores, Loader
graphs, and activity streams whose selected exact view matches.

Branch movement is a separate event: it announces that a mutable branch ref
now selects a new exact view. It does not masquerade as N file events in
another view.

Proof: a hidden branch write creates visible branch activity but causes no
main card refresh, Loader reset, or search subscription rerun.

### B3b.5 — Host, test selection, and view switching

The Host owns one coherent Loader/store/search subscription set per selected
view. Switching a branch resolves its ref, installs a new exact context, and
replaces the Loader; it never mutates the resolver underneath an evaluated
module graph. Mixed-realm stacks may carry different exact views per realm.

Test discovery, dependency selection, and result caching use the same exact
view. A test run records the view hash it started from, so a branch moving
during the run cannot change its source set or attach results to the new head.

Proof: open main and a hidden PretUI branch side by side, run the same targeted
component test in both, and retain both results with correct provenance.

## Fail-closed rules

1. Invalid or missing exact-view objects return an error; they never fall
   through to live source or index rows.
2. Unsupported exact-view methods return 405; they never mutate the live
   realm.
3. A cache or queue key without a view means `live`, not “whichever branch is
   current.”
4. A mutable branch name is resolved before work begins and is absent from
   low-level cache/index keys.
5. A branch ref advances only after source, lock, History, immutable manifest,
   and its completed derived index agree.

## B4 boundary

B3b may use hidden branch fixtures, but it does not add user-facing branch
creation or switching. B4 can expose those operations only after the final
isolation proof shows that a hidden PretUI write cannot leak into `main`.
