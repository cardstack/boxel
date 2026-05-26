# `boxel-cli` Claude Code plugin

Claude Code skills for working with Boxel realms via [`@cardstack/boxel-cli`](https://www.npmjs.com/package/@cardstack/boxel-cli).

## Prerequisites

Install the boxel CLI globally so the plugin's skills can shell out to it:

```bash
npm install -g @cardstack/boxel-cli
```

Verify:

```bash
boxel --version
```

The plugin documents commands in `@cardstack/boxel-cli >= 0.0.1`. Newer plugin versions may document commands that older CLI versions do not have — keep both reasonably fresh.

## Install

### External users (marketplace)

```text
/plugin marketplace add cardstack/boxel
/plugin install boxel-cli
```

### Internal / development (`--plugin-dir`)

From a checkout of `cardstack/boxel`:

```bash
claude --plugin-dir packages/boxel-cli/plugin
```

`/reload-plugins` picks up local edits without restarting Claude Code.

## What you get

Skills appear under the `/boxel-cli:` namespace. Two surfaces:

### CLI command skills

Hand-authored / generated from the Commander tree by `pnpm build:plugin`. These document the `boxel` CLI itself.

| Skill                             | Use it for                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/boxel-cli:boxel-file-structure` | File and directory naming rules, `adoptsFrom` module paths, link relationship semantics.             |
| `/boxel-cli:realm-sync`           | `boxel realm sync/watch/push/pull/create/remove/list` — moving files between local disk and a realm. |
| `/boxel-cli:realm-history`        | `boxel realm history/wait-for-ready/cancel-indexing` — inspecting and steering realm indexing.       |
| `/boxel-cli:file-ops`             | `boxel file read/write/list/delete/lint/touch` — single-file operations against a realm.             |
| `/boxel-cli:search`               | `boxel search` — federated search across realms.                                                     |
| `/boxel-cli:profile`              | `boxel profile list/add/switch/remove/migrate` — managing realm-server credentials.                  |

### Skills from `cardstack/boxel-skills`

Authored upstream in [`cardstack/boxel-skills`](https://github.com/cardstack/boxel-skills) and packaged here by `pnpm build:skills`. The table below is regenerated from the pinned tag — do not hand-edit between the markers.

<!-- BEGIN AUTO-GENERATED: boxel-skills (run `pnpm build:skills` to update) -->

_Generated from [`cardstack/boxel-skills@v0.0.22`](https://github.com/cardstack/boxel-skills/tree/v0.0.22) by_ `pnpm build:skills`. _Edit upstream, not here._

| Skill                            | Use it for                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/boxel-cli:boxel-design`        | Boxel UI design discovery. Use when designing or redesigning a Boxel app, choosing a visual direction, or pushing past default look-and-feel before generating code.                                                                                                                                                 |
| `/boxel-cli:boxel-development`   | Authoring Boxel cards. Use when creating or editing .gts card definitions, .json card instances, or answering questions about CardDef / FieldDef / templates / Boxel patterns. Covers the full .gts authoring surface — imports, fields, formats (isolated/embedded/fitted/atom/edit), styling, and common pitfalls. |
| `/boxel-cli:boxel-ui-guidelines` | Ensures boxel-ui components are used in templates and theming guidelines are followed                                                                                                                                                                                                                                |
| `/boxel-cli:catalog-listing`     | catalog-listing                                                                                                                                                                                                                                                                                                      |
| `/boxel-cli:dev-bfm-syntax`      | BFM reference: render surfaces, base syntax, :card/::card directives, mermaid, math ($...$ / $$...$$), alerts, footnotes, and code highlighting.                                                                                                                                                                     |
| `/boxel-cli:dev-file-def`        | How to use FileDef, ImageDef, MarkdownDef, and related types for file fields in Boxel cards                                                                                                                                                                                                                          |
| `/boxel-cli:dev-markdown-format` | Authoring `static markdown` templates: defaults, markdownEscape, markdown-helpers toolkit, delegation, and pitfalls.                                                                                                                                                                                                 |

<!-- END AUTO-GENERATED: boxel-skills -->

## Versioning

The plugin's `version` is independent of `@cardstack/boxel-cli`'s npm version. The plugin only describes the CLI; it does not bundle it.

Both `package.json` (the npm package) and `plugin.json` (this plugin) bump automatically on merge to `main`, driven by the PR title's conventional-commit prefix and which files the PR touched.

### Conventional-commit prefixes

PRs touching `packages/boxel-cli/**` must have a title that matches the conventional-commit grammar. The on-`main` workflow reads the merged PR's title and decides the bump level:

| Prefix                                                     | Bump level |
| ---------------------------------------------------------- | ---------- |
| `feat!:` / `fix!:` / body contains `BREAKING CHANGE:`      | major      |
| `feat:`                                                    | minor      |
| `fix:` / `perf:` / `refactor:`                             | patch      |
| `chore:` / `docs:` / `test:` / `build:` / `ci:` / `style:` | none       |

Scopes are allowed and ignored for bump-level purposes (`feat(profile): …` → minor).

### Surface scoping

Each version file only bumps if the PR touched its surface:

- **`package.json` (npm)** bumps if the PR touched `src/`, `api.ts`, `scripts/build.ts`, or `package.json`.
- **`plugin.json`** bumps if the PR touched `plugin/`, `scripts/build-plugin.ts`, or `scripts/build-skills.ts`, **or if the on-`main` regen step produced a diff in `plugin/skills/`** (e.g. a new CLI command added in `src/` triggers a synopsis regen, which counts as a plugin-surface change).

| Change                                                              | `package.json` | `plugin.json`                               |
| ------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| New / changed CLI command (e.g. `feat:` in `src/commands/`)         | bump (minor)   | bump (synopsis regenerates → minor)         |
| Plugin README or prose (`fix:` in `plugin/README.md`)               | —              | bump (patch)                                |
| CLI bug fix without Commander surface change (`fix:` in `src/lib/`) | bump (patch)   | —                                           |
| Upstream `cardstack/boxel-skills` update via `BOXEL_SKILLS_VERSION` | —              | bump (regen produces `plugin/skills/` diff) |
| `chore:` / `docs:` housekeeping                                     | —              | —                                           |

> ⚠️ **`BOXEL_SKILLS_VERSION` bumps must NOT use `chore:`.** Bumping the pinned upstream skills version regenerates every skill under `plugin/skills/` that is derived from `cardstack/boxel-skills` (see the auto-generated table above), but a `chore:` prefix says "no bump" — the new content would land on `main` without a `plugin.json` bump, so the marketplace cache (keyed on `plugin.json` `version`) wouldn't refresh for users. Use `fix(skills):` for routine refreshes or `feat(skills):` for content that adds capabilities.

## Releasing

### Unstable channel (automated, every merge)

Every merge to `main` that touches `packages/boxel-cli/**` triggers the `unstable` job in `.github/workflows/boxel-cli-publish.yml`:

1. Regenerates `plugin/skills/` from the current Commander tree and pinned boxel-skills tag.
2. Reads the merged PR's title via `gh api repos/.../commits/<sha>/pulls`.
3. Classifies the bump level and decides per-surface bumps.
4. Writes new versions into `package.json` and/or `plugin.json`.
5. Commits `chore(release): boxel-cli npm=<v> plugin=<v> [skip ci]` back to `main` and tags `boxel-cli-v<npmVer>` if npm bumped.
6. If npm bumped, publishes `@cardstack/boxel-cli@<base>-unstable.<n>` under npm dist-tag `unstable` (Ember canary pattern). `<n>` is `git rev-list --count <last-stable-tag>..HEAD`, so it's monotonic across reruns.

The plugin update reaches users on the next `/plugin marketplace update && /plugin update` (or automatic refresh on Claude Code startup). The marketplace cache is keyed on `plugin.json` `version` — **the auto-bump is what unlocks the update**.

Concurrent merges are serialized by a `concurrency` group on the workflow so two near-simultaneous merges don't compute the same `unstable.<n>`.

### Installing the unstable npm build

```bash
npm install -g @cardstack/boxel-cli@unstable
```

### Stable releases (manual promotion)

Stable releases are deliberate. From the GitHub Actions UI, run the **"boxel-cli publish"** workflow (`.github/workflows/boxel-cli-publish.yml`) with `confirm: promote` — that fires the `stable` job. It:

1. Strips `-unstable.<n>` from the current `package.json` version.
2. Commits, tags `boxel-cli-v<ver>`, pushes.
3. Publishes under npm dist-tag `latest`.
4. Creates a non-prerelease GitHub Release.

There is no separate stable bump for `plugin.json` — its version stream already advances every merge, so by the time you cut a stable npm, the plugin has been on its own steady cadence.

### Adding a new plugin to the marketplace

If a future ticket adds a second plugin under `packages/<other>/plugin`, append an entry to `.claude-plugin/marketplace.json` at the repo root:

```json
{
  "name": "<plugin-name>",
  "source": "./packages/<other>/plugin",
  "description": "..."
}
```

Each plugin's own `plugin.json` `version` drives its update lifecycle — the marketplace catalog itself does not need a version bump.
