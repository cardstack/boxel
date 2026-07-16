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

_Copied from [`cardstack/boxel-skills@v0.0.28`](https://github.com/cardstack/boxel-skills/tree/v0.0.28) by_ `pnpm build:skills`. _Edit upstream, not here._

| Skill                                | Use it for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/boxel-cli:boxel`                   | Use whenever creating, reading, or editing Boxel cards (.gts files), card instances (.json), fields, templates, queries, or anything in a Boxel realm. Required for any Boxel coding work — covers CardDef, FieldDef, contains/linksTo, templates, formats, queries, and core patterns. Companion skills - boxel-design (visual decisions), boxel-ui-guidelines (template UI), source-code-editing (SEARCH/REPLACE), boxel-environment (running the Boxel app).                                                                                                   |
| `/boxel-cli:boxel-create-edit-cards` | Use when choosing the right Boxel host command combination to create new cards or edit existing instances from the AI assistant.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/boxel-cli:boxel-design`            | Use when designing or styling a Boxel card — choosing colors, typography, theme variables, layout, or visual treatment. Activates for any visual decisions on a card.                                                                                                                                                                                                                                                                                                                                                                                             |
| `/boxel-cli:boxel-environment`       | Use when running, navigating, or orchestrating tasks inside the live Boxel application — switching between Code Mode and Interact Mode, calling host commands (search-cards, switch-submode, show-card, patch-fields, apply-markdown-edit, reindex, etc.), or any operation that drives the Boxel UI. Activates for Boxel-app runtime work, not for writing card definitions (see boxel for that).                                                                                                                                                                |
| `/boxel-cli:boxel-file-def`          | Use when adding or working with file-typed fields (FileDef, ImageDef, MarkdownDef, PngDef, CsvFileDef). Activates when a card needs to reference an image, document, or other file asset.                                                                                                                                                                                                                                                                                                                                                                         |
| `/boxel-cli:boxel-flavored-markdown` | Use when authoring or editing Boxel Flavored Markdown (BFM) content — content fields rendered as rich markdown with :card/::card directives, mermaid diagrams, etc.                                                                                                                                                                                                                                                                                                                                                                                               |
| `/boxel-cli:boxel-markdown-format`   | Use when authoring a `markdown` template (static markdown format) on a CardDef or FieldDef — defaults, markdownEscape, and markdown helpers.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/boxel-cli:boxel-patterns`          | Use when the user names an outcome ("show a chart", "let users pick a color", "build a dashboard", "summarize comments", "embed AI image generation", "lay out a moodboard") and you need a working code example to start from. This skill is the bridge between user intent and the existing patterns in Boxel realms. Index your search by what the user wants to DO, not by which CardDef/FieldDef class to extend. Activates when the user asks "do we have a pattern for…", "how is X typically done", or names a feature outcome that isn't in core syntax. |
| `/boxel-cli:boxel-theme-development` | Develop Boxel Theme, StructuredTheme, StyleReference, DetailedStyleReference, and BrandGuide cards. Use when creating, converting, auditing, or patching theme/style/brand-guide artifacts; importing or exporting Google DESIGN.md design-system briefs; choosing Boxel Brand Guide vs custom brand styling; or working with logo/mark usage, functional palettes, typography, and theme tokens.                                                                                                                                                                 |
| `/boxel-cli:boxel-ui-guidelines`     | Use when writing or editing Boxel templates that render UI: applying theme tokens, choosing between @fields and @model, using boxel-ui components (Button, Pill, Avatar, BoxelSelect), or fixing layout/overflow issues.                                                                                                                                                                                                                                                                                                                                          |
| `/boxel-cli:catalog-listing`         | Use when installing, browsing, remixing, updating, or submitting catalog listings (Apps, Cards, Fields, Skills, Themes) from a Boxel catalog realm. Includes the submission workflow that creates a SubmissionWorkflowCard and GitHub PR.                                                                                                                                                                                                                                                                                                                         |
| `/boxel-cli:source-code-editing`     | Use when editing existing .gts or .json files via SEARCH/REPLACE blocks. Defines exact block format, matching rules, and recovery from failed matches. Required before issuing any code edit.                                                                                                                                                                                                                                                                                                                                                                     |

| Command                                | Use it for                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/boxel-cli:boxel-add-field`           | Add or change schema fields, computed fields, or relationships on an existing CardDef/FieldDef.                                                                                                                                             |
| `/boxel-cli:boxel-add-file-field`      | Add a file-backed field (image, document, CSV, markdown) using FileDef/ImageDef/MarkdownDef/CsvFileDef.                                                                                                                                     |
| `/boxel-cli:boxel-build-from-pattern`  | Start from an existing ready pattern — list patterns by outcome, or adapt a chosen one to the user's domain.                                                                                                                                |
| `/boxel-cli:boxel-create-card`         | Create a new CardDef, FieldDef, or small card family with all required formats.                                                                                                                                                             |
| `/boxel-cli:boxel-create-instance`     | Create a new JSON card instance or update an existing one.                                                                                                                                                                                  |
| `/boxel-cli:boxel-debug-runtime`       | Diagnose runtime, indexing, command, or mode issues in the live Boxel app.                                                                                                                                                                  |
| `/boxel-cli:boxel-design-card`         | Improve a card's visual design — colors, typography, mood, asset direction, theme tokens.                                                                                                                                                   |
| `/boxel-cli:boxel-develop-theme`       | Create, convert, audit, or patch a Boxel Theme, Style Reference, Detailed Style Reference, or Brand Guide.                                                                                                                                  |
| `/boxel-cli:boxel-edit-template`       | Change isolated, embedded, fitted, edit, atom, or markdown templates on a CardDef or FieldDef.                                                                                                                                              |
| `/boxel-cli:boxel-install-listing`     | Use, install, remix, or update a catalog listing.                                                                                                                                                                                           |
| `/boxel-cli:boxel-migrate-schema`      | Find existing card instances after a schema change and update them in batches.                                                                                                                                                              |
| `/boxel-cli:boxel-preview-card`        | Preview a card, module, or format in the live Boxel app.                                                                                                                                                                                    |
| `/boxel-cli:boxel-search-cards`        | Find cards in the live Boxel app or in a realm by type, title, or query filter.                                                                                                                                                             |
| `/boxel-cli:boxel-submit-listing`      | Submit a catalog listing through the workflow-card PR flow.                                                                                                                                                                                 |
| `/boxel-cli:boxel-sync-workspace`      | Pull, push, sync, watch, status, history, milestone, and search realms via boxel-cli. Manage workspace state including .boxel-sync.json manifest and checkpoints in .boxel-history.                                                         |
| `/boxel-cli:distill-from-boxel-skills` | Backport an improvement (or a batch of improvements) from the upstream cardstack/boxel-skills repo into this workspace's skill tree. Use when a recent PR or commit upstream documents a gotcha, pattern, or rule we should mirror locally. |
| `/boxel-cli:distill-learnings`         | Consolidate accumulated learnings from .claude/learnings/ into the right skill tree files, then archive consumed entries.                                                                                                                   |

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
