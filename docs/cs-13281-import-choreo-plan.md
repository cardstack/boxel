# CS-13281: Import cardstack/choreo with its git history

Linear: [CS-13281](https://linear.app/cardstack/issue/CS-13281) · Project: Choreo Productionization (P-CS-515)

## Goal

Bring `cardstack/choreo` (at `e16e293`) into the monorepo with its history, so that `git log --follow` and blame work on every moved file. Strip the paths we decided not to import from **all** of history, so their blobs never enter the monorepo.

## What the rewrite does

A dry run on a scratch clone gives 487 commits (from 496; 9 touched only stripped paths) and a 30.4 MB pack (from 49.8 MB). The final tree matches the source exactly, apart from the moves and drops below.

**Stripped from all of history** (first `git filter-repo --invert-paths` pass):

| Path                                                               | Why                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `videos/`                                                          | Production projects; they stay in the archived repo                                              |
| `docs/media/`, `docs/gallery.png`                                  | README GIFs and screenshots; the READMEs will link to the hosted gallery                         |
| `.pnpm-store/`                                                     | An accidentally committed pnpm store                                                             |
| `test-app/public/towers.html`, `test-app/public/towers/scene.html` | Dead paths: about 12 historical 2–3 MB copies of the Towers model, now `asset/towers-model.html` |

**Kept and moved** (second pass, `--path` plus `--path-rename`):

| Source                                                                            | Monorepo                                                                                                                |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/glimmer-motion/`, `packages/choreo-player/`, `packages/choreo-gallery/` | same paths                                                                                                              |
| `packages/choreo-desk/` (removed upstream in the past)                            | same path, so only in history                                                                                           |
| `test-app/`                                                                       | `packages/choreo-test-app/`, **temporary** until the gallery-realm milestone deletes it                                 |
| `scripts/` (28 gallery and film tools)                                            | `packages/choreo-gallery/tools/` (no name clashes with the gallery's own `scripts/`)                                    |
| `docs/` (minus media)                                                             | `packages/choreo-gallery/docs/`, a holding location until CS-13305                                                      |
| `notes/`                                                                          | `packages/choreo-gallery/notes/`, a holding location until CS-13305                                                     |
| `.claude/skills/` (12 skills)                                                     | `packages/choreo-gallery/agent-skills/`, held outside `.claude/skills` so the stale paths don't go live before CS-13306 |
| root `README.md`, `AGENTS.md`                                                     | `packages/choreo-gallery/docs/source-repo/`                                                                             |
| root `LICENSE` (MIT)                                                              | `packages/glimmer-motion/LICENSE`, since glimmer-motion ships none of its own                                           |

**Not imported:** the source repo's `.github/` (CI is replaced in CS-13283), its root toolchain config (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, eslint/prettier/template-lint config, `.npmrc`, `.gitignore`; replaced in CS-13282), `.agents/` (a symlink to one of the skills), and `SECURITY.md` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`, which existed only briefly.

**Commit messages:** 58 messages contain `#N`. Once imported, GitHub would link those to _boxel_ PRs, so the rewrite changes them to `cardstack/choreo#N`.

## Steps

1. Take a fresh full clone of `cardstack/choreo` in the scratchpad and run the two `filter-repo` passes above.
2. In this worktree, on branch `cs-13281-import-choreo` from `origin/main`, fetch the rewritten history and merge it: `git merge --allow-unrelated-histories`. The merge message records the source SHA (`e16e293`) and the rewrite rules.
3. Verify:
   - `git log --follow` works on moved files, for example `packages/choreo-test-app/tests/integration/choreo/contract-test.gts`;
   - no stripped path appears anywhere in the branch's history;
   - the tree matches the dry run.

## PR scope: combine with CS-13282

The import alone isn't shippable. The new `packages/*` directories join the pnpm workspace immediately, so CI's `pnpm install --frozen-lockfile` fails until the lockfile and dependencies are aligned, and the lint jobs would pick up unconfigured files. So this PR also does **CS-13282** (toolchain alignment): mise versions, `catalog:` dependencies, the repo's lint configuration, and glint. The import merge stays a separate first commit.

**Package-name clash:** both `packages/boxel-ui/docs-app` and the imported app were named `test-app`. The PR renames boxel-ui's to `boxel-ui-docs-app` (its name appeared only inside the docs app: `package.json`, `modulePrefix`, the config loader, the test helper and `tsconfig.json` paths). The imported app keeps `test-app`, because renaming it would touch 148 files of `test-app/…` module imports in a package that CS-13302 deletes.

CS-13283 (running the imported tests in CI) follows as its own PR.

### What the toolchain alignment settled

- **Dependencies use `catalog:` where the catalog has the same major version as choreo's range,** and keep choreo's range otherwise (for example `three` 0.185, `marked` 18, `@ember/test-helpers` 4). Peer ranges, which npm consumers see, are unchanged.
- **Forced by the workspace's version-less patches:**
  - `ember-source` moves to the catalog's ~6.10 (from ~6.12); `patches/ember-source.patch` applies to every version;
  - `eslint-plugin-ember` moves to the catalog's 13 (from 12); `patches/ember-eslint-parser.patch` targets the parser that 13 uses.
- **Glint:** the pre-release `@glint/core` / environment packages become the catalog's `@glint/ember-tsc`. `lint:types` is `ember-tsc --noEmit` everywhere, choreo-player also builds with `ember-tsc`, and glimmer-motion's declarations come from `ember-tsc --declaration`. That needs `@embroider/addon-dev` 8, whose `declarations()` takes the command; version 7 always ran `glint --declaration`.
- **One Motion engine,** pinned to what the source repo's lockfile held: `motion` / `motion-dom` / `framer-motion` 13.1.1 and `motion-utils` 13.0.0, through the catalog. Workspace `overrides` keep `framer-motion` and its `motion-dom` from resolving past the pin. Unpinned, they resolved to 13.4.4, which broke the gallery's types and produced a second `motion-dom` copy.
- **`@glimmer/validator`** is a dev dependency of glimmer-motion (types only). It was undeclared and resolved through hoisting in the source repo; at runtime Ember provides it.
- **Lint configuration:** each package gets its own `eslint.config.mjs`, generated from the source repo's single root config and re-pathed per package. Each also gets `.prettierrc.cjs`, `.prettierignore` and `.gitignore` re-pathed from the root ones. The imported code passes them unchanged, apart from formatting drift from prettier 3.8.4, which is in its own commit.
- **Template lint is installed but not enforced yet.** The source repo's CI never ran it, and it reports 14 findings, some of them deliberate (inline styles and a `<style>` element in the film components). `ember-template-lint` and its config stay so the pre-commit autofix works. `lint:hbs` joins the `lint` script in CS-13320, which addresses the findings.
- **Paths:** gallery scripts, tools and the test app's `vite.config.mjs` assumed the source repo's layout (`<root>/test-app/…`). They now use `packages/choreo-test-app/…`. The hand-run tools under `packages/choreo-gallery/tools/` expect to run from the monorepo root.
- **CI:** `ci-lint.yaml` lints the four packages, building glimmer-motion, choreo-player and the gallery first where dependents type-check against their output.
- **Lockfile:** regenerated on top of `main`'s lockfile, so every existing workspace package resolves exactly the versions it did before; no name@version is removed. Choreo's own dependencies add 40 name@versions, including a newer embroider build stack (`@embroider/compat` 4.1.25, `core` 4.6.7, `vite` 1.7.13) that only `choreo-test-app` uses. Existing entries also gain a `(supports-color@8.1.1)` peer suffix and some extra peer variants, which is re-keying only.

## Merge method

**This PR must be merged with "Create a merge commit".** The repo also allows squash and rebase merges. Squashing would flatten the imported history into one commit. Rebasing would replay 487 commits onto main, or fail on the inner merge. The PR description will say so at the top.

## Decisions from review

1. **Author identity:** 405 of the source commits were authored under a local-machine identity. The rewrite applies a `--mailmap` that attributes them to the author's GitHub identity, which the other 67 already use, so they all link to one profile.
2. **`packages/choreo-desk`:** kept in history.

## Testing

- The history checks in step 3.
- `pnpm install`, `pnpm lint` in each imported package, and a build of glimmer-motion and choreo-player, as part of the CS-13282 work in the same PR.
- The imported QUnit suite runs locally before the PR opens. It goes into CI in CS-13283.

### Results

- History: no stripped path appears in the branch's history, `git log --follow` works across the moves, and blame on `packages/glimmer-motion/src/node.ts` attributes 981 lines to Chris Tse and 14 to Cursor Agent.
- `pnpm install` succeeds; `pnpm lint` passes in glimmer-motion, choreo-player, choreo-gallery, the test app, and the renamed `boxel-ui-docs-app`.
- glimmer-motion, choreo-player and choreo-gallery build.
- choreo-player unit tests: 10/10 pass.
- The imported QUnit suite on the monorepo toolchain (Ember 6.10, `ember-tsc`, Motion 13.1.1): **764 tests, 762 pass, 0 fail, 2 skipped.** The two skips are `skip(...)` calls in the source, in `tests/integration/motion/layout/layout-shared-test.gts`.
