# CS-10110 Plan: Add search/query support for file-meta entries

## Goals

- Enable search/index queries to return `file-meta` entries.
- Define the query shape (filter/type) and result document shape for file-meta collections.
- Keep behavior consistent with existing card search and index APIs.

## Assumptions / Open Questions

- The realm index already contains `file-meta` documents (or can expose them) alongside card entries.
- Use the existing Query type (filters, sort, page) and add a discriminator for file-meta via `filter.type` CodeRef.
- Default behavior should remain unchanged (no type filter => CardDef instances).
- UI and host store will consume file-meta results via the same search endpoint as cards.
  - Proposed type ref: `{ module: ${baseRealm.url}file-api, name: 'FileDef' }`.

## Plan

1. Inspect realm index/query engine to understand how search results are assembled today for cards.
2. Add support for querying file-meta entries in `runtime-common` search pipeline.
   - Use `filter.type` to switch from `instance` to `file` index rows.
   - Keep default (no type filter) as `instance` (CardDef).
3. Define/validate a collection document shape for file-meta search responses.
4. Add focused tests for file-meta search responses and filtering in both suites:
   - Host: `packages/host/tests/unit/index-query-engine-test.ts` and `packages/host/tests/integration/realm-querying-test.gts`
   - Realm-server: `packages/realm-server/tests/realm-endpoints/search-test.ts`
5. Ensure existing card search behavior is unchanged.

## Target files

- `packages/runtime-common/index-query-engine.ts`
- `packages/runtime-common/realm-index-query-engine.ts`
- `packages/runtime-common/query.ts` (if query discriminator needs updating)
- `packages/runtime-common/document.ts` (if new collection document shape needed)
- Tests under `packages/host/tests/unit/` or `packages/host/tests/integration/`
- Tests under `packages/realm-server/tests/realm-endpoints/`

## Testing notes

- Add a focused test that issues a search query for file-meta and asserts returned results and document shape.
- Run `pnpm lint` in `packages/host` or `packages/realm-server` depending on where tests land.
