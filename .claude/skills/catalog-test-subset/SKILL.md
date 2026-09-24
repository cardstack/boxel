---
name: catalog-test-subset
description: How boxel-repo tests (host and realm-server) use card definitions that live in the catalog realm (the separate cardstack/boxel-catalog repo) through the catalog test subset — a manifest at `packages/catalog/test-subset.json` that pins a boxel-catalog revision and names the system-level definitions the platform tests against, which the test stacks serve as the real `/catalog/` realm. Covers deciding whether a new definition belongs in the catalog, `packages/base`, or neither; authoring it in boxel-catalog; adding it to the subset; pinning and bumping the revision in the right order; when to run the sync so tests never assert against stale definitions; and referencing the definitions from host and realm-server tests. Use when a spec or ticket places a card/field definition "in the catalog realm" that platform code or tests depend on, when adding to or bumping `packages/catalog/test-subset.json`, when a test fails with "catalog test subset … is stale" / "does not serve the catalog test subset", or when changing a catalog definition that is in the subset.
---

# Catalog test subset

Catalog content lives in `cardstack/boxel-catalog`. The deployed catalog realm serves that repo's `main`. `packages/catalog/contents` in this repo is only a gitignored dev clone of it. Boxel's own test stacks don't clone the catalog. They serve a **pinned subset** of it as the catalog realm, and tests reach those definitions through `@cardstack/catalog/`, just as card code does in a deployment.

The subset is declared in `packages/catalog/test-subset.json`:

```json
{
  "repository": "cardstack/boxel-catalog",
  "revision": "<40-char sha on boxel-catalog main>",
  "files": [{ "path": "realm-policy/realm-policy.gts", "reason": "…" }],
  "tests": {
    "host": ["<ember test --filter>"],
    "realmServer": ["<TEST_FILES entry>"]
  }
}
```

`packages/catalog/scripts/sync-test-subset.ts` (`pnpm --dir packages/catalog catalog:test-subset`) materializes it.

## Where does a definition belong?

- **`packages/base`**: the platform's own card/field primitives, which every realm is built from (`CardDef`, `StringField`, `CodeRefField`, Spec, Skill, …).
- **The catalog, and in the subset**: a _system-level_ definition that the spec places in the catalog realm and that platform code or platform tests depend on. For example `RealmPolicy` / `PolicyRule` / `OperationGrant` / `PolicyPredicateField`, which the operation-permission checks read.
- **The catalog, not in the subset**: userland cards (apps, listings, demos, themes, fields made for a particular listing). Boxel tests never load these. The subset exists only for definitions whose behaviour the platform is tested against, so keep it small. Every manifest entry carries a `reason` saying which platform behaviour needs it. A reviewer who can't tell from the reason why the platform needs the file should reject the entry.

Don't copy a catalog definition into this repo, whether as a base module, a test fixture string or a `test-realm-cards` file. Two copies drift. The subset is how a boxel test sees the catalog's one copy.

## Authoring the definition in boxel-catalog

- Follow the catalog's conventions:
  - base imports use the `https://cardstack.com/base/<module>` form;
  - sibling catalog definitions are imported with `@cardstack/catalog/<path>`;
  - fields live at `fields/<name>/<name>.gts`.
- **Only import what a subset-only stack can serve.** Every import must be one of:
  - another subset file;
  - a base module;
  - `@cardstack/boxel-ui/*` or `@cardstack/boxel-icons/*`;
  - a module the host shims (`packages/host/app/lib/externals.ts`).

  The sync's closure check fails otherwise. Adding a file to the subset means adding its catalog imports too.

- Serializers and other platform code the definition relies on stay in this repo (e.g. `runtime-common/serializers/`). The definition refers to them by key.
- `*.test.gts` files are never subset entries.

## Adding a definition, or changing one in the subset

The order matters, because the deployed catalog is boxel-catalog `main`, not the pin.

**Platform code the definition depends on goes first.** A serializer, a `runtime-common` type or export, or a base module the definition imports must already be on boxel `main` before the catalog PR merges. The deployed catalog runs against the deployed platform, and the catalog repo's own lint and tests check out boxel `main`. Land that platform code in its own boxel PR, keep the definition out of `packages/base`, and until it merges, expect the catalog PR's lint to fail on the missing export.

1. **Open the boxel-catalog PR first, on a branch with the same name as the boxel branch.**
2. **In the boxel PR**, add or keep the manifest entry and set `revision` to the catalog PR's head sha (a commit on a pushed branch fetches fine). Re-pin whenever you push to the catalog PR.
3. **Validate the catalog PR against boxel.** boxel-catalog's `Boxel Test Subset` workflow runs the manifest's `tests` consumers whenever a PR touches a subset path. It runs them against the boxel branch of the same name when one exists, otherwise against boxel `main`, so matching branch names are how a catalog change and the boxel change that depends on it are tested together before either merges. A manual run takes any `boxel_ref`.
4. **Merge the catalog PR first.** Then re-pin the boxel PR to a commit on catalog `main` with `pnpm --dir packages/catalog catalog:test-subset --bump`, and merge it. The `Catalog Test Subset` workflow fails any boxel PR whose pin is not on catalog `main`.

A catalog change to a subset file reaches deployments as soon as the catalog merges, but it reaches boxel's tests only when the pin is bumped. So it must stay compatible with boxel `main`. Bump the pin in the same boxel PR as any platform or test change that depends on the new definition.

## Running the sync, so tests never see stale definitions

The test helpers fail every test in a module when the served subset doesn't match the manifest. The error names the fix. Run the sync:

- after bumping or changing the manifest;
- after pulling `main` or switching branches when the manifest changed;
- after editing a subset file in a local catalog checkout (see co-developing below);
- whenever a test fails with "catalog test subset … is stale" or "does not serve the catalog test subset".

The host test build reads the manifest when it is built, so after a manifest change also rebuild the host dist before running host tests. When the guard can't tell which side is stale, its message names both fixes.

Starting a stack runs it automatically. Re-running it against a running stack is enough, because the realm picks up the files without a restart.

| Stack                                                                         | Serves as `/catalog/`                  | Sync to run                                       |
| ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `mise run test-services:realm-server`, host CI (`CATALOG_SOURCE=test-subset`) | `packages/catalog/test-subset/` only   | `pnpm --dir packages/catalog catalog:test-subset` |
| `pnpm start:all` / `mise run dev` (default)                                   | the full clone, merged with the subset | `… catalog:test-subset --into-clone`              |

**Merging into the clone.** Subset files the clone lacks are added to it; they are git-excluded, and `catalog:update` removes them before pulling. Where the clone has its own copy, that copy is served and never overwritten. If it differs from the pin, the helpers fail with the paths. To fix it, bump the pin, reset those files in the clone, or test against the clone on purpose (below).

**Co-developing a catalog change.** Start the stack, or re-run the sync, with `CATALOG_TEST_SUBSET_SOURCE=<dir>`, where `<dir>` is a catalog checkout relative to the repo root, e.g. `packages/catalog/contents`. The files are then read from that checkout instead of the pin. The helpers accept this with a warning. Pin before you open or merge the boxel PR.

## Using the definitions in tests

- **Reference by prefix:** `adoptsFrom: { module: rri('@cardstack/catalog/realm-policy/realm-policy'), name: 'RealmPolicy' }`. Never use a hard-coded `https://localhost:4201/catalog/…` URL.
- **Host:** call `setupCatalogTestSubset(hooks)` from `packages/host/tests/helpers/catalog-test-subset.ts` in the module. Don't `import type` from `@cardstack/catalog/…`, because glint doesn't see catalog sources. Describe the shape the test needs locally, over `CardDef` / `FieldDef`.
- **Realm-server:** call `setupCatalogTestSubset(hooks)` from `tests/helpers/catalog-test-subset.ts`. `createVirtualNetwork()` maps `@cardstack/catalog/` to `localCatalogRealm`, so the test side and the prerender host fold catalog module keys identically.
- **Register the test** under the manifest's `tests`: the host `--filter` string (a module-name match) or the realm-server `TEST_FILES` entry. The catalog CI runs exactly these when a catalog PR touches the subset. `catalog-test-subset-consumers-test.ts` fails when a test that calls `setupCatalogTestSubset` is not listed, or when a listed entry matches no such test.

**Why not stub a catalog realm inside a test?** A realm-server test's cards are rendered by the prerender host, which resolves `@cardstack/catalog/` from its own baked config. Nothing from a test's virtual network reaches it. Only a realm the stack really serves at that URL is visible to both processes, just as with base.
