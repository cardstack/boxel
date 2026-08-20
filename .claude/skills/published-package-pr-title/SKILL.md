---
name: published-package-pr-title
allowed-tools: Read, Grep, Bash
description: Decide whether a PR title needs a conventional-commit prefix. PRs touching packages/boxel-cli/** or packages/bxl/** require one (feat/fix/perf/refactor/chore/docs/test/build/ci/style) because it drives that package's npm publish version bump; PRs touching neither get a plain descriptive title with no prefix. Use before opening or retitling any PR.
---

# Published-Package PR Title

A conventional-commit prefix on a PR title is **only** meaningful for changes to a package this repo publishes to npm: `packages/boxel-cli/**` and `packages/bxl/**`. There it's a binding contract that drives the version bump. Anywhere else it's noise — use a plain descriptive title.

## The rule

- **PR touches `packages/boxel-cli/` or `packages/bxl/`** → title MUST start with an allowed prefix followed by `:` (e.g. `feat: add --watch flag to sync`).
- **PR touches neither** → no prefix. Write a plain descriptive title (e.g. `Add evergreen-comments skill`, not `docs: add evergreen-comments skill`).

One title serves both packages. A PR touching both takes a single prefix, and each package's bump is decided from it independently.

## Allowed prefixes and their bump level

The prefix determines the version bump applied post-merge:

| Prefix                                                                                                        | Version bump |
| ------------------------------------------------------------------------------------------------------------- | ------------ |
| any type with a `!` (e.g. `feat!:`, `fix!:`, `feat(cli)!:`) **or** a `BREAKING CHANGE:` footer in the PR body | **major**    |
| `feat:`                                                                                                       | minor        |
| `fix:`, `perf:`, `refactor:`                                                                                  | patch        |
| `chore:`, `docs:`, `test:`, `build:`, `ci:`, `style:`                                                         | none         |

Pick the prefix from what the change actually does: diagnostics / test-only changes are `test:`, source-behavior bug fixes are `fix:`, new commands, flags, or library functions are `feat:`. A **breaking** change to a published surface takes a `!` after the type (or scope) — `feat!:`, `fix!:`, `feat(cli)!:` — or a `BREAKING CHANGE:` footer in the body, either of which forces a major bump regardless of the base type. An optional scope in parentheses (`feat(cli): …`) is permitted and does not affect the bump level on its own.

## Why it's scoped to those two packages

Each package owns its own prefix list and classifier, so they can diverge:

| Package                | Prefix list                                        | Classifier                                      | Pre-merge check                            | Post-merge publish      |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ | ----------------------- |
| `@cardstack/boxel-cli` | `packages/boxel-cli/scripts/release-prefixes.json` | `packages/boxel-cli/scripts/compute-release.ts` | `.github/workflows/boxel-cli-pr-title.yml` | `boxel-cli-publish.yml` |
| `@cardstack/bxl`       | `packages/bxl/scripts/release-prefixes.json`       | `packages/bxl/scripts/compute-release.ts`       | `.github/workflows/bxl-pr-title.yml`       | `bxl-publish.yml`       |

Each pre-merge check is **path-scoped** to its own package and does not run for other PRs. Each post-merge workflow reads the merged PR's title to compute that package's bump, then publishes.

Because each package's prefix list gates both ends, the title is a contract, not cosmetics. A PR that touches neither package never triggers any of these workflows, so a prefix on it carries no meaning and should be omitted.

## What a bumpable prefix does not guarantee

Both publish flows also ask whether the merge changed anything the tarball actually ships. A `fix:`-titled PR that only touches test suites, benchmarks, or CI config publishes nothing — deliberately, so a version number isn't burned on an artifact that didn't move. Check the package's `compute-release.ts` for the paths it counts.

## Self-check before opening or retitling a PR

1. Does the diff include any file under `packages/boxel-cli/` or `packages/bxl/`?
   - **Yes** → ensure the title starts with the prefix matching the change's bump level. If the change is **breaking**, add a `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` body footer so it cuts a major version.
   - **No** → ensure the title has no conventional-commit prefix; use plain prose.
