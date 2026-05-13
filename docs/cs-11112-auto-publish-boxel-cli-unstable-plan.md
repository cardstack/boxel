# CS-11112 — Auto-publish boxel-cli unstable per merge

Linear: https://linear.app/cardstack/issue/CS-11112

## Goals

1. PRs touching `packages/boxel-cli/**` never block on plugin regen / version-bump bookkeeping.
2. Every merge to `main` that touches a surface ships `@cardstack/boxel-cli@<v>-unstable.<n>` to npm under dist-tag `unstable` (Ember canary pattern).
3. Version bump level is decided automatically from the merged PR's title using conventional-commit prefixes.
4. Stable releases stay deliberate: `manual-boxel-cli-publish.yml` is repurposed to promote latest unstable to `latest`.

## Assumptions

- Repo merges PRs as **merge-commits** (verified). The PR title is fetched via `gh api repos/.../commits/<sha>/pulls` on the merge SHA.
- PR title format is enforced by `amannn/action-semantic-pull-request@v5`, path-scoped to `packages/boxel-cli/**`. Other packages are unaffected.
- `boxel-cli-v0.1.4` tag exists (verified) — gives `git rev-list --count <tag>..HEAD` a valid starting point.

## Surfaces

- **npm package** (`packages/boxel-cli/package.json`) — bumps if PR diff touches `src/**`, `api.ts`, `scripts/build.ts`, or `package.json` (excluding pure version-only edits, to break the bot's feedback loop).
- **plugin** (`packages/boxel-cli/plugin/.claude-plugin/plugin.json`) — bumps if PR diff or post-regen working tree touches `plugin/**`, `scripts/build-plugin.ts`, or `scripts/build-skills.ts`.

A PR touching both bumps both.

## Bump table

| Prefix | npm | plugin |
|---|---|---|
| `feat!:` / `fix!:` / body `BREAKING CHANGE:` | major | major |
| `feat:` | minor | minor |
| `fix:` / `perf:` / `refactor:` | patch | patch |
| `chore:` / `docs:` / `test:` / `build:` / `ci:` / `style:` | none | none |

⚠️ Caveat: bumping `BOXEL_SKILLS_VERSION` in `scripts/build-skills.ts` regenerates `plugin/skills/...` content. The new content reaches users only if the PR title is `fix(skills):` / `feat(skills):` (not `chore:`). Documented in `plugin/README.md` and `AGENTS.md`.

## Files

| File | Change |
|---|---|
| `packages/boxel-cli/scripts/compute-release.ts` | New. Pure function + I/O wrapper. Emits JSON. |
| `packages/boxel-cli/tests/scripts/compute-release.test.ts` | New. vitest covering bump classification, surface gating, prerelease base escalation, feedback-loop guard. |
| `.github/workflows/boxel-cli-pr-title.yml` | New. PR-title check, path-scoped. |
| `.github/workflows/boxel-cli-on-main.yml` | New. Regen + compute + bump + commit + tag + publish. Concurrency-serialized. |
| `.github/workflows/manual-boxel-cli-publish.yml` | Repurposed as "promote unstable → stable". Inputs simplified. |
| `.github/workflows/ci-lint.yaml` | Delete lines 128–224 (four boxel-cli verification gates). Plain `pnpm run lint` stays. |
| `packages/boxel-cli/plugin/README.md` | Rewrite Versioning + Releasing sections. |
| `AGENTS.md` | Add "boxel-cli commit prefixes" subsection under PR Instructions. |
| `packages/boxel-cli/package.json` | Seed bump `0.1.4` → `0.1.5-unstable.0`. |

## Test plan

- `pnpm test:unit` in `packages/boxel-cli` covers `compute-release` logic.
- Dry run: `PR_TITLE='feat: test' pnpm exec ts-node --transpileOnly scripts/compute-release.ts` from `packages/boxel-cli/` prints valid JSON.
- Post-merge verification on the live workflow:
  - First merge after this lands → on-main workflow runs against this very PR's title (`feat:`).
  - Confirms npm publishes `@cardstack/boxel-cli@0.2.0-unstable.0` (minor on 0.1.5 base from seed).
  - Confirms plugin.json bumped (regen produced no diff but `plugin/README.md` and `scripts/build-skills.ts` are touched).

See top-level plan in `~/.claude/plans/let-s-work-on-cs-11112-floofy-hippo.md` for the full design rationale and decision log.
