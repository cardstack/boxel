# `searchable` migration codemod

Reverse-engineers `searchable` field annotations from the stored search docs in
`boxel_index` so they reproduce the link depth those docs already carry, then
applies them to realm source. Adding `searchable` is a no-op for the
store-driven search-doc generator (which doesn't read the option), so the
annotations can be applied and shipped without changing any search doc or query
result; they take effect only once the searchable-driven generator is
authoritative.

## How it works

The derivation is the inverse of the searchable-driven generator
(`packages/base/searchable.ts`) and is **schema-free** — it reads only the
stored search-doc JSON. In a search doc a relationship that was pulled in is
stored as `{ id, …fields }` and one that wasn't is `{ id }`; a contained value
is a nested object/array with no `id`. That's enough to recover the routes,
without depending on the (sparse) deployed definition cache.

Pipeline:

1. **derive** (`derive.ts`, `derive-stream.ts`) — stream `boxel_index` instance
   rows, group by card def (`types[0]`), union the observed routes per def.
2. **hoist + prune** (`class-graph.ts`) — parse the realm's source to resolve the
   class hierarchy and field target types. A route the DB attributed to a leaf
   def is hoisted to the class that declares its head field; a route crossing a
   **polymorphic** field (`linksTo(CardDef)` etc., which can't be spelled in a
   query) or a non-declared field is pruned as unqueryable cruft; a route whose
   target type isn't in the loaded source is kept in full (parity-safe) and
   flagged.
3. **rewrite** (`transform.ts`) — add/merge the `searchable` option on
   `.gts`/`.ts` field declarations, preserving untouched code and `<template>`
   blocks. Query-backed relationships are never annotated. A card def with zero
   indexed instances has no observed depth, so its non-query-backed
   relationships default to `searchable: true` (depth-1) for resilience.
4. **apply** — `apply-local.ts` edits repo-backed realm source (dry-run + diff by
   default); `apply-deployed.ts` crawls deployed realms (pull → apply → report,
   or `boxel file write` the changed modules).

Defs are keyed by **export name** (matching `types[0]`/`adoptsFrom`): a
default-exported def is `<module>/default`. A field declared on a platform-root
type (`CardDef.cardInfo`) is left shallow — annotating it would deepen every
card's search doc.

### `isUsed`

By default the codemod **adds `searchable` only** and leaves `isUsed` in place:
the store-driven generator honors `isUsed` to force non-rendered links into the
doc, so removing it before the searchable-driven generator is authoritative
would shallow those links. Pass `--strip-isused` to remove `isUsed` (do this in
the same change that makes the searchable-driven generator authoritative).

## Usage

Derive (the DB read stays in `psql` as a read-only user; node never connects):

```sh
psql … -c "SELECT json_build_object('def', types->>0, 'realm', realm_url, 'doc', search_doc)::text
           FROM boxel_index WHERE type='instance' AND is_deleted IS NOT TRUE AND types->>0 IS NOT NULL" \
  | NODE_NO_WARNINGS=1 node scripts/codemod/searchable/derive-stream.ts derivation.json
```

Apply to a repo-backed realm (dry-run, then `--write`):

```sh
NODE_NO_WARNINGS=1 node scripts/codemod/searchable/apply-local.ts \
  --realm-root ../experiments-realm \
  --realm-url https://realms-staging.stack.cards/experiments/ \
  --realm-url https://app.boxel.ai/experiments/ \
  --derivation staging.derivation.json --derivation prod.derivation.json [--write]
```

Pass each environment's realm URL + derivation so depth unions across
environments (the maximal observed depth for a shared def). For the platform
realms whose defs use a `@cardstack/<realm>/` canonical key, pass that prefix as
a `--realm-url` too.

## Tests

Pure logic, no DB/stack:

```sh
pnpm --filter @cardstack/realm-server codemod:searchable:test
```
