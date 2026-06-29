# `searchable` migration codemod (CS-11723)

Reverse-engineers `searchable` field annotations from the live search docs in
`boxel_index` so they **reproduce today's link depth**, strips the deprecated
`isUsed` option, and annotates every realm. The annotations are inert until the
cutover (CS-11724) — the old store-driven generation ignores `searchable` — so
this lands and runs safely on its own.

## How it works

The derivation is the exact inverse of the searchable-driven generator
(`packages/base/searchable.ts`) and is **schema-free**: it reads only the stored
search-doc JSON. In a search doc a relationship that was pulled in is stored as
`{ id, ...fields }` and one that wasn't is `{ id }`; a contained value is a
nested object/array with no `id`. That's enough to recover the routes.

Pipeline:

1. **derive** (`derive.ts`, `derive-stream.ts`) — stream `boxel_index` instance
   rows, group by card def (`types[0]`), and union the observed routes per def.
2. **hoist + prune** (`class-graph.ts`) — parse the realm's source to resolve the
   class hierarchy and field target types. A route the DB attributed to a leaf
   def is hoisted to the class that actually declares the head field; a route
   crossing a **polymorphic** field (`linksTo(CardDef)` etc., which can't be
   queried) or a non-declared field (subtype bloat) is pruned. A route whose
   target type isn't in the loaded source is kept in full (parity-safe) and
   flagged for review.
3. **rewrite** (`transform.ts`) — add/merge the `searchable` option and strip
   `isUsed` on `.gts`/`.ts` field declarations, preserving formatting and
   `<template>` blocks. Query-backed relationships are never annotated.
4. **apply** — `apply-local.ts` edits repo-backed realm source (dry-run + diff by
   default); the deployed crawl `boxel file write`s only the changed modules of
   hosted/user realms and republishes published realms.

### `isUsed` is kept until the cutover

By default the codemod **adds `searchable` only** and leaves `isUsed` in place.
The old store-driven generation (still authoritative until CS-11724) honors
`isUsed` to force non-rendered links into the search doc; stripping it now would
shallow those links on the reindex this codemod triggers, while the new
`searchable` annotation stays inert under old gen. So `isUsed` removal is
deferred to the cutover — pass `--strip-isused` then (CS-11724 strips `isUsed`
across all realms in the same change that makes `searchable` authoritative).

## Usage

Derive (DB read stays in `psql` as `claude_readonly_user`; node never connects):

```sh
# <tunnel psql emitting NDJSON> | node derive-stream.ts <out.json>
psql ... -c "SELECT json_build_object('def', types->>0, 'realm', realm_url, 'doc', search_doc)::text
             FROM boxel_index WHERE type='instance' AND is_deleted IS NOT TRUE AND types->>0 IS NOT NULL" \
  | NODE_NO_WARNINGS=1 node scripts/codemod/searchable/derive-stream.ts staging.derivation.json
```

Apply to a repo-backed realm (dry-run, then `--write`):

```sh
NODE_NO_WARNINGS=1 node scripts/codemod/searchable/apply-local.ts \
  --realm-root ../experiments-realm \
  --realm-url https://realms-staging.stack.cards/experiments/ \
  --realm-url https://app.boxel.ai/experiments/ \
  --derivation staging.derivation.json --derivation prod.derivation.json [--write]
```

Pass each environment's realm URL + derivation so depth unions across staging
and prod (a shared def's maximal observed depth).

## Tests

Pure logic, no DB/stack — Node's built-in runner:

```sh
NODE_NO_WARNINGS=1 node --test scripts/codemod/searchable/*.test.ts
```
