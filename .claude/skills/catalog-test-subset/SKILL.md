---
name: catalog-test-subset
description: How boxel-repo tests (host and realm-server) use card definitions that live in the catalog realm (the separate cardstack/boxel-catalog repo) through the catalog test subset — a manifest at `packages/catalog/test-subset.json` that pins a boxel-catalog revision and names the system-level definitions the platform tests against, which the test stacks serve as the real `/catalog/` realm. The subset includes the operation-permission policy definitions `RealmPolicy`, `PolicyRule` and `OperationGrant` (`realm-policy/realm-policy.gts`) and `PolicyPredicateField` (`fields/policy-predicate/policy-predicate.gts`), whose only source is boxel-catalog — not `packages/base`, not `packages/catalog/test-subset/`, not `packages/catalog/contents/`. Covers finding where a subset definition's source lives; changing one (the paired boxel + boxel-catalog branches, co-developing against boxel's tests, pinning, merge order, `--bump`); moving the pin for local tests, for a commit you push, and for merge; deciding whether a new definition belongs in the catalog, `packages/base`, or neither; adding it to the subset; when to run the sync so tests never assert against stale or edited definitions; the guards that keep the pin, the manifest and the served files in sync; and referencing the definitions from host and realm-server tests. Use when asked to add, change, fix, restyle or rename any definition the manifest lists (including the policy cards and field above), when a spec or ticket places a card/field definition "in the catalog realm" that platform code or tests depend on, when adding to or bumping `packages/catalog/test-subset.json`, when setting `CATALOG_TEST_SUBSET_SOURCE`, when a test or the sync fails with "catalog test subset … is stale", "does not serve the catalog test subset", "serves an edited copy", "was edited after the sync wrote it", "main has changed … since", "waiting on cardstack/boxel-catalog#… to merge", "is not a commit in cardstack/boxel-catalog", "the catalog clone … has its own copy", or "holds a copy of a catalog test subset definition".
---

# Catalog test subset

Catalog content lives in `cardstack/boxel-catalog`. The deployed catalog realm serves that repo's `main`. Boxel's own test stacks don't clone the catalog. They serve a **pinned subset** of it as the catalog realm, and tests reach those definitions through `@cardstack/catalog/`, just as card code does in a deployment.

The subset is declared in `packages/catalog/test-subset.json`:

```json
{
  "repository": "cardstack/boxel-catalog",
  "revision": "<40-char boxel-catalog sha whose subset files match catalog main>",
  "files": [{ "path": "realm-policy/realm-policy.gts", "reason": "…" }],
  "tests": {
    "host": ["<ember test --filter>"],
    "realmServer": ["<TEST_FILES entry>"]
  }
}
```

`packages/catalog/scripts/sync-test-subset.ts` (`pnpm --dir packages/catalog catalog:test-subset`) materializes it.

## Where a subset definition's source lives

A definition whose file the manifest lists has exactly one source: that path in `cardstack/boxel-catalog`. Every change to it, however small (a template tweak, a comment, a new field), is a boxel-catalog commit, which boxel then pins.

Three places in this repo look like that source and are not. Editing any of them changes nothing that CI or a deployment runs:

| Looks like the source                 | What it actually is                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/base/<name>.gts`            | Nothing. The definition isn't in base, and platform code and tests reference the catalog copy (`@cardstack/catalog/…`, e.g. `realmPolicyRef` in `runtime-common/card-operations/policy.ts`). A copy added here is a second definition that drifts from the deployed one. Base's `lint:no-catalog-subset-copies`, part of CI Lint, fails when a file in `packages/base` has a subset file's name or declares a class a subset file exports. |
| `packages/catalog/test-subset/<path>` | Generated and gitignored. The sync writes it from the pin, and CI re-fetches it from the pin. The sync refuses to run over a copy edited after it was written. The test guards fail when the realm serves an edited copy.                                                                                                                                                                                                                  |
| `packages/catalog/contents/<path>`    | The dev stack's clone of catalog `main`. `catalog:update` pulls over it. The test guards report its copy as divergent from the pin. It is a boxel-catalog checkout, so a commit there on a branch is a real catalog change, but it's easier to work from a separate boxel-catalog checkout (below).                                                                                                                                        |

When a task says "change `RealmPolicy`" (or any other subset definition), the deliverable is a boxel-catalog PR plus a boxel PR that pins it. Follow the procedure below.

## Where does a definition belong?

- **`packages/base`**: the platform's own card/field primitives, which every realm is built from (`CardDef`, `StringField`, `CodeRefField`, Spec, Skill, …).
- **The catalog, and in the subset**: a _system-level_ definition that the spec places in the catalog realm and that platform code or platform tests depend on. For example `RealmPolicy` / `PolicyRule` / `OperationGrant`, which the operation-permission checks read.
- **A field that only a subset card uses goes with that card.** `PolicyPredicateField` exists only for `OperationGrant.where`, so it lives in the catalog at `fields/policy-predicate/` and is in the subset, not in base with the general field types. Its serializer is platform code and stays in `runtime-common/serializers/policy-predicate.ts`.
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

## Moving the pin

What the pin may point at depends on what it is for. This repo's `PreToolUse` hook (`.claude/hooks/require-skill.mjs`) refuses an edit to `packages/catalog/test-subset.json`, and any shell command that names it, the sync (`catalog:test-subset`, `sync-test-subset`), or `CATALOG_TEST_SUBSET_SOURCE`, until the session or subagent making the call has loaded this skill.

**For local tests.** Nothing has to be merged or pushed.

- **Serve a catalog checkout, and leave the pin alone.** `CATALOG_TEST_SUBSET_SOURCE=<dir> pnpm --dir packages/catalog catalog:test-subset` copies the subset files from `<dir>`, on any branch and with uncommitted edits. The marker records `source=local`, and the test helpers accept it with a warning. This is the right mode while the catalog change is still moving. It works on a stack that serves only the subset; for a stack that serves the full clone, see step 2 below. The manifest doesn't change, and `test-subset/` is gitignored, so there is nothing to commit. Every session on the machine shares the stack's `/catalog/`, so announce the swap to peers before you run it and again once you've restored the pin (the `agent-peer-collaboration` skill). To restore the pin, re-run the sync without the variable.
- **Pin a commit that is on GitHub.** Set `revision` to any pushed boxel-catalog commit, run the sync, and rebuild the host dist before running host tests, because the host build reads the manifest.

**For a commit you push.** Every test stack and CI job fetches the pinned files from GitHub, so the pin must be a commit there:

- catalog `main` (`--bump` pins its HEAD), when the boxel change uses the definitions as `main` has them;
- or the head of the catalog PR this boxel PR depends on, when its tests need that change (step 3 below). Re-pin each time the catalog PR gets new commits;
- or the head of the catalog PR this boxel PR merges before, when the boxel change breaks the catalog and that PR fixes it (the `catalog-pairing` skill's _The pin covers the whole catalog_).

The pin covers more than the subset. Production deploys a boxel commit with the whole catalog at the revision it pins, so boxel's Lint Catalog lints the whole catalog at the pin against every change, and fails on any error the change adds there, including errors in files that aren't in the subset.

Never commit a pin that exists only in a local catalog checkout (the check fails with "is not a commit in cardstack/boxel-catalog"), and never commit a pin you haven't run the manifest's `tests` consumers against.

**For merge.** Every subset file at the pin must match catalog `main` byte for byte. `--check-pin` enforces this on every boxel PR that changes the manifest. The one exception is a pin at the head of the catalog PR this boxel PR says `Merges before:`, while that PR is approved and neither side is stacked. That catalog PR merges right after the boxel PR, and the pin then matches `main`. After a squash or rebase merge the pinned head isn't on `main`, so the lockstep deploy deploys the PR's merge commit instead.

- `waiting on cardstack/boxel-catalog#<N> to merge`: the pin is a commit in an open catalog PR. Merge that PR first, then re-run the check. A pin from a catalog PR passes this check once the PR merges, whether as a merge commit, a squash or a rebase. A boxel PR that declares `Merges after:` that catalog PR still has to re-pin with `--bump` (below).
- "main has changed … since": catalog `main` has a newer version of a subset file. Re-pin with `--bump`, run the sync, and re-run the consumers. If the message names a boxel PR that already pins a matching revision, merging boxel `main` after it lands works too.

## Changing a subset definition, or adding one

The order matters, because the deployed catalog is boxel-catalog `main`, not the pin.

**Platform code the definition depends on goes first.** A serializer, a `runtime-common` type or export, or a base module the definition imports must already be on boxel `main` before the catalog PR merges. The deployed catalog runs against the deployed platform, and the catalog repo's own lint and tests check out boxel `main`. Land that platform code in its own boxel PR, keep the definition out of `packages/base`, and until it merges, expect the catalog PR's lint to fail on the missing export.

1. **Make two branches with the same name**: one in boxel and one in a boxel-catalog checkout. Use a separate checkout of `cardstack/boxel-catalog`, e.g. a worktree of your local clone, rather than `packages/catalog/contents`, which `catalog:update` pulls over. Declare the pair in both descriptions as well, as the `catalog-pairing` skill describes.
2. **Edit the definition in the boxel-catalog checkout, and test it against boxel's tests before pinning.** Start the stack, or re-run the sync against a running one, with `CATALOG_TEST_SUBSET_SOURCE=<dir>`. `<dir>` is the catalog checkout, either relative to the boxel repo root or absolute. The sync then copies the files from that checkout instead of fetching the pin, and the helpers accept it with a warning. Re-run the sync after each edit. The running realm picks the files up without a restart. Run the manifest's `tests` consumers, plus any test the change affects.

   Do this on a stack that serves only the subset (`CATALOG_SOURCE=test-subset`, which `mise run test-services:realm-server` sets). A stack serving the full catalog clone (`pnpm start:all`, `mise run dev`) keeps serving the clone's own copy of any file the clone already has, so a separate checkout's edit never reaches it. The helpers fail with the path when that happens. To co-develop on that stack instead, make the change in `packages/catalog/contents` on a branch, and serve it with `CATALOG_TEST_SUBSET_SOURCE=packages/catalog/contents`.

3. **Push the boxel branch, with its manifest entry, before you push the boxel-catalog branch or open its PR.** boxel-catalog's `Boxel Test Subset` workflow decides which files to test from the manifest on the same-named boxel branch, looked up at the moment it runs. If that branch isn't on GitHub yet, the workflow falls back to boxel `main`. That manifest doesn't list a file you are adding, so the check passes without running a single test. A changed file fails loudly against boxel `main` instead of passing, but the tests it ran still weren't yours. If the catalog workflow ran before the boxel branch existed, re-run it once the branch is pushed. Then open the boxel-catalog PR, set the manifest's `revision` to its head sha (a commit on a pushed branch fetches fine), and push the boxel branch again. Re-pin whenever you push to the catalog PR. Pin before you open or merge the boxel PR.
4. **Validate the catalog PR against boxel.** boxel-catalog's `Boxel Test Subset` workflow runs the manifest's `tests` consumers whenever a PR touches a subset path. It runs them against the boxel branch of the same name when one exists, otherwise against boxel `main`, so matching branch names are how a catalog change and the boxel change that depends on it are tested together before either merges. A manual run takes any `boxel_ref`. The catalog workflow only decides whether to run and which boxel ref to use. The tests run in boxel's reusable `.github/workflows/catalog-test-subset-consumers.yml`, which the catalog calls at boxel `main`, so a CI setup change belongs in boxel, not in the catalog. The workflow's steps, and those of the `test-web-assets.yaml` it calls, come from boxel `main`. What the steps run comes from the chosen ref: its mise tasks, composite actions, manifest and tests, and the source the host dist is built from. So a paired boxel branch's edit to one of those steps reaches catalog runs only once it merges; the branch's own boxel PR run is what tests it. And if the catalog run fails on a task or argument the paired branch doesn't have, the branch is behind `main`: merge `main` into it. While the pin is a catalog PR commit, boxel's `Catalog Test Subset` check fails with `waiting on cardstack/boxel-catalog#<N> to merge`. That is expected until the catalog merges.
5. **Merge the catalog PR first.** Then re-pin the boxel PR onto catalog `main` with `pnpm --dir packages/catalog catalog:test-subset --bump`, run the sync, re-run the consumers, and push. Production deploys the catalog at the revision the deployed boxel pins, so the pin has to contain the catalog PR's merge commit, not only its head: Lint Catalog fails a boxel PR that declares `Merges after:` a catalog PR until that has merged and the pin contains its merge commit. If catalog `main` moves again before the boxel PR merges and `Catalog Test Subset` fails with "main has changed … since", bump again. Then merge the boxel PR.

A catalog change to a subset file reaches deployments as soon as the catalog merges, but it reaches boxel's tests only when the pin is bumped. So it must stay compatible with boxel `main`. Bump the pin in the same boxel PR as any platform or test change that depends on the new definition. A catalog change that merges with no boxel PR paired with it still needs a follow-up boxel PR that only runs `--bump`, so boxel keeps testing what deployments serve. Until that lands, the next boxel PR that touches the manifest fails `--check-pin` and has to bump.

**Adding a definition** follows the same steps. Author it in boxel-catalog, and add a manifest `files` entry with a `reason`, plus entries for any catalog files it imports. Then register every test that uses it (see _Using the definitions in tests_).

## What keeps the pin, the manifest and the served files in sync

| Check                                   | Where it runs                                                                                                                                               | What it catches                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--check-pin`                           | boxel's `Catalog Test Subset` workflow, on every PR; it checks the pin only when the PR changes the manifest, the sync script, `pairing.ts` or the workflow | a subset file at the pin that differs from catalog `main`: a pin still waiting on its catalog PR (unless it is the head of the approved catalog PR this change merges before), a pin main has moved past, or a commit that isn't on GitHub                                                |
| Lint Catalog, at the pin                | boxel's `Lint Catalog` workflow, on every PR and push to `main`                                                                                             | a boxel change that adds a lint or type error anywhere in the catalog at the pinned revision, subset or not                                                                                                                                                                               |
| closure check                           | every sync, and the same workflow                                                                                                                           | a subset file importing something a subset-only stack can't serve                                                                                                                                                                                                                         |
| per-file hashes in the marker           | every sync (including each stack start)                                                                                                                     | a `packages/catalog/test-subset/` file edited after the sync wrote it                                                                                                                                                                                                                     |
| `setupCatalogTestSubset(hooks)`         | every host and realm-server test module that uses the subset                                                                                                | a served subset at a different revision or file list than the manifest (or the host build); a clone copy that differs from the pin, or from the local checkout the sync read; a served file edited in place (skipped, with a warning, on a stack whose sync predates the per-file hashes) |
| `catalog-test-subset-consumers-test.ts` | realm-server CI                                                                                                                                             | a test using the subset that the manifest's `tests` doesn't list, or a listed entry that matches no such test                                                                                                                                                                             |
| `lint:no-catalog-subset-copies`         | CI Lint, as part of `pnpm lint` in `packages/base`                                                                                                          | a file in `packages/base` with a subset file's name, or declaring a class a subset file exports (the class half needs the pinned files; when they can't be fetched it warns and checks file names only)                                                                                   |
| `Boxel Test Subset`                     | boxel-catalog, on PRs and pushes to `main` that touch a subset file                                                                                         | a catalog change that breaks boxel's tests, on the same-named boxel branch or boxel `main`                                                                                                                                                                                                |
| `Catalog Test Subset Consumers`         | boxel, on PRs and pushes to `main` touching that workflow, the manifest, the sync, the subset test helpers, or the CI boot path                             | a boxel change that would break the run boxel-catalog calls, tested against the pinned revision                                                                                                                                                                                           |

Each of these fails with a message naming the fix. Don't work around a failure by editing a generated copy or the marker (`catalog-test-subset.txt`) by hand.

## Running the sync, so tests never see stale definitions

The test helpers fail every test in a module when the served subset doesn't match the manifest, or when a served file differs from what the sync wrote. The error names the fix. Run the sync:

- after bumping or changing the manifest;
- after pulling `main` or switching branches when the manifest changed;
- after editing a subset file in a local catalog checkout you serve with `CATALOG_TEST_SUBSET_SOURCE`;
- whenever a test fails with "catalog test subset … is stale" or "does not serve the catalog test subset".

The host test build reads the manifest when it is built, so after a manifest change also rebuild the host dist before running host tests. When the guard can't tell which side is stale, its message names both fixes.

Starting a stack runs it automatically, and nothing else is needed after it. The realm's compiled-module cache survives restarts, but a realm serves a cached compile only while it was compiled from the file's current content, so the first request after the sync rewrote a file compiles the file again, whether or not the realm ran a boot index. Re-running the sync against a running stack is enough too, because the realm picks up the files without a restart.

| Stack                                                                         | Serves as `/catalog/`                  | Sync to run                                       |
| ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `mise run test-services:realm-server`, host CI (`CATALOG_SOURCE=test-subset`) | `packages/catalog/test-subset/` only   | `pnpm --dir packages/catalog catalog:test-subset` |
| `pnpm start:all` / `mise run dev` (default)                                   | the full clone, merged with the subset | `… catalog:test-subset --into-clone`              |

**Merging into the clone.** Subset files the clone lacks are added to it; they are git-excluded, and `catalog:update` removes them before pulling. Where the clone has its own copy, that copy is served and never overwritten. If it differs from the pin, the helpers fail with the paths. To fix it, bump the pin, reset those files in the clone, or test against the clone on purpose with `CATALOG_TEST_SUBSET_SOURCE=packages/catalog/contents`.

**An edited generated copy.** If the sync reports a file "was edited after the sync wrote it", or a test reports the realm "serves an edited copy", someone changed the generated copy rather than the catalog. Move the change to a boxel-catalog checkout and serve it with `CATALOG_TEST_SUBSET_SOURCE` (step 2 above). Or discard the edit: delete `packages/catalog/test-subset` and re-run the sync.

## Using the definitions in tests

- **Reference by prefix:** `adoptsFrom: { module: rri('@cardstack/catalog/realm-policy/realm-policy'), name: 'RealmPolicy' }`. Never use a hard-coded `https://localhost:4201/catalog/…` URL.
- **Host:** call `setupCatalogTestSubset(hooks)` from `packages/host/tests/helpers/catalog-test-subset.ts` in the module. Don't `import type` from `@cardstack/catalog/…`, because glint doesn't see catalog sources. Describe the shape the test needs locally, over `CardDef` / `FieldDef`, e.g. `type RealmPolicy = CardDef & { rules: PolicyRule[] }` — a type alias, never a `class` of the same name.
- **Realm-server:** call `setupCatalogTestSubset(hooks)` from `tests/helpers/catalog-test-subset.ts`. `createVirtualNetwork()` maps `@cardstack/catalog/` to `localCatalogRealm`, so the test side and the prerender host fold catalog module keys identically.
- **Register the test** under the manifest's `tests`: the host `--filter` string (a module-name match) or the realm-server `TEST_FILES` entry. The catalog CI runs exactly these when a catalog PR touches the subset. `catalog-test-subset-consumers-test.ts` fails when a test that calls `setupCatalogTestSubset` is not listed, or when a listed entry matches no such test.

**Why not stub a catalog realm inside a test?** A realm-server test's cards are rendered by the prerender host, which resolves `@cardstack/catalog/` from its own baked config. Nothing from a test's virtual network reaches it. Only a realm the stack really serves at that URL is visible to both processes, just as with base.
