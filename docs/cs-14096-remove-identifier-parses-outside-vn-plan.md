# CS-14096: remove the last identifier parses outside the VirtualNetwork

## Goal

ADR 002 §1.2: only the VirtualNetwork turns a realm identifier into a URL. Remove the
`no-url-from-realm-identifier` disables in `realm-server.ts` and `catalog.ts`
(`create-file-modal.gts` and `validate-realm.ts` are handled separately).

## Steps

1. **Test-realm origin (host).** Export `testRealmOrigin = 'http://test-realm'` from
   `packages/runtime-common/helpers/const.ts` beside `testRealmURL`, and use it in
   `RealmServerService.getRealmServersForRealms` and `normalizeRealmServerURL`
   (`packages/host/app/services/realm-server.ts`). Both parses and disables go.
2. **ListingPathResolver (runtime-common `catalog.ts`).**
   - Constructor takes `targetRealm: RealmIdentifier` and builds
     `new RealmPaths(targetRealm, virtualNetwork)` directly.
   - The install directory's `RealmPaths` is built from
     `targetRealmPath.directoryRRI(targetDirectoryName)`; no `new URL`.
   - `localFallback` strips a URL-form id's `scheme://authority` with a string
     operation instead of `new URL(id).pathname`.
   - `PlanBuilder` keeps its `realmUrl: string` parameter and brands it with `ri()`
     when it builds the resolver: boxel-catalog's `listing-install` and
     `collect-submission-files` commands pass a plain string, so narrowing the
     public parameter would need a paired catalog change for no behaviour change.
   - Host unit tests that construct `ListingPathResolver` pass `ri(...)`.

3. **FileDef code refs in prefix form (runtime-common `file-def-code-ref.ts`).**
   - `FILEDEF_CODE_REF_BY_EXTENSION` names base modules with `baseRRI(name)`
     instead of the `https://cardstack.com/base/` alias.
   - `resolveFileDefCodeRef(fileURL)` returns an absolute module (URL or
     `@`-prefix form) as written and joins a relative one against the file with
     `resolveRRIReference`. It no longer takes a virtual network; callers and the
     index-runner options that only carried one for it drop it.
   - `POLICY_FILE_DEF_CODE_REF_BY_EXTENSION` keeps the base-realm entries as they
     are instead of re-spelling alias URLs as prefixes.
   - Tests that pinned the alias form for a file ref (`capture-task-test`,
     `card-operations-dispatch-test`, `model-file-extract-test`,
     `prerender-file-extract-test`) use the prefix form;
     `filedef-export-shape-test` skips only the relative test entry.

## Existing index rows

Rows indexed with alias-form refs keep working, so no reindex is needed. The
writer canonicalizes deps (`unresolveURLs`, `normalizeDependencyForLookup`),
`types` come from `identifyCard` through `internalKeyFor`, definition lookup keys
on `internalKeyFor`, and `isFileDefCodeRef` compares `canonicalModuleKey`. The
module string is otherwise only a per-render option.

## Decision: the fallback stays a fallback

Reaching `localFallback` is the normal path for `listing-install`, which never
registers foreign realms through `addKnownRealmURL`; a spec or example from a realm
other than the listing's own lands there. Making it an error would break those
installs, so it stays and is covered by tests.

## Testing

- `packages/host/tests/unit/plan-install-test.ts`: existing listing-install plan
  tests, plus `local()` fallback tests for a prefix-form id and for a URL-form id
  with a percent-encoded path.
- Host: `Unit | FileDef subtype export shapes`, `Acceptance | model file-extract`,
  `Acceptance | prerender | file-extract`, and a couple of per-format file def
  acceptance modules.
- Realm-server: `capture-task-test`, `card-operations-dispatch-test`,
  `policy-file-def-test`.
- `pnpm lint` in `packages/host`, `packages/runtime-common` and
  `packages/realm-server`.
