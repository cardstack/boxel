# CS-14015: join identifiers without `new URL` in runtime-common

## Goal

Four runtime-common sites join an identifier against a base with
`new URL(x, base)`. A prefix-form specifier (`@cardstack/base/card-api`)
becomes a made-up in-realm URL, and a prefix-form base throws. Replace each
join with the RRI-aware helper that already exists for it.

## Changes

1. **Index writer error-doc deps** (`index-writer.ts`, `normalizeDependency`):
   `canonicalURL(dep, entryURL.href, virtualNetwork)` from
   `index-runner/dependency-url.ts`, then trim the executable extension. A
   prefix dependency keeps its prefix form, matching how `deps` are stored on
   index rows.
2. **Module-cache dependency keys**
   (`cache/module-cache-invalidation.ts`, `extractModuleDependencyKeys`): take
   the realm's `VirtualNetwork` instead of the realm URL string; skip bare
   specifiers that are not registered prefixes; resolve the rest with
   `virtualNetwork.resolveURL` and check membership with `paths.inRealm`. A
   realm's import of its own modules by prefix now yields the same key as a
   relative import. Caller updated in `realm.ts`.
3. **`maybeSerializeCodeRef`** (`serializers/code-ref.ts`): join with
   `resolveRRIReference(module, rri(base))`; drop the eslint-disable.
4. **`card-directory-name`** (`helpers/card-directory-name.ts`): read the last
   meaningful path segment with string operations after stripping the query
   and fragment; the module parameter is a `RealmResourceIdentifier`; both
   eslint-disables gone. `getCardDirectoryName` no longer needs `RealmPaths`,
   so its `paths` argument is dropped (callers in `card-operations/executors.ts`
   and `packages/base/realm-config.gts`).

## Tests

- `realm-server/tests/index-writer-error-deps-test.ts`: an error doc whose deps
  include `@cardstack/base/…`, a relative path, and a URL with query/fragment.
- `realm-server/tests/module-syntax-test.ts`: self-prefix import, foreign
  prefix import, and bare npm specifiers.
- `realm-server/tests/code-ref-serializer-test.ts`: `queryableValue` with
  prefix-form and URL-form card ids.
- `host/tests/unit/card-directory-name-test.ts`: prefix-form module and
  URL-form module with a query.
