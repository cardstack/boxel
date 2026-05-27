---
name: boxel-cli-pr-title
description: Decide whether a PR title needs a conventional-commit prefix. PRs touching packages/boxel-cli/** require one (feat/fix/perf/refactor/chore/docs/test/build/ci/style) because it drives the boxel-cli npm publish version bump; PRs that don't touch boxel-cli get a plain descriptive title with no prefix. Use before opening or retitling any PR.
---

# Boxel-CLI PR Title

A conventional-commit prefix on a PR title is **only** meaningful for changes to `packages/boxel-cli/**`. There it's a binding contract that drives the npm publish version bump. Anywhere else it's noise — use a plain descriptive title.

## The rule

- **PR touches `packages/boxel-cli/**`** → title MUST start with an allowed prefix followed by `:` (e.g. `feat: add --watch flag to sync`).
- **PR does NOT touch `packages/boxel-cli/**`** → no prefix. Write a plain descriptive title (e.g. `Add evergreen-comments skill`, not `docs: add evergreen-comments skill`).

## Allowed prefixes and their bump level

The prefix determines the `@cardstack/boxel-cli` version bump applied post-merge:

| Prefix | Version bump |
|--------|--------------|
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:` | patch |
| `chore:`, `docs:`, `test:`, `build:`, `ci:`, `style:` | none |

Pick the prefix from what the change actually does: diagnostics / test-only changes are `test:`, source-behavior bug fixes are `fix:`, new commands or flags are `feat:`.

## Why it's boxel-cli-only

`packages/boxel-cli/scripts/release-prefixes.json` is the single source of truth for the allowed prefixes and their bump levels. Two workflows read it:

- **Pre-merge:** `.github/workflows/boxel-cli-pr-title.yml` (`PR Title Check [boxel-cli]`) validates the title. It is **path-scoped** to `packages/boxel-cli/**` and does not run for other PRs.
- **Post-merge:** `boxel-cli-publish.yml` reads the merged PR's title to compute the version bump and publish the new version.

Because the same JSON file gates both, the title is a contract, not cosmetics — for boxel-cli. A PR that doesn't touch boxel-cli never triggers either workflow, so a prefix on it carries no meaning and should be omitted.

## Self-check before opening or retitling a PR

1. Does the diff include any file under `packages/boxel-cli/`?
   - **Yes** → ensure the title starts with the prefix matching the change's bump level.
   - **No** → ensure the title has no conventional-commit prefix; use plain prose.
