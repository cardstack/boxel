# `boxel-cli` agent plugin

Agent skills for working with Boxel realms via [`@cardstack/boxel-cli`](https://www.npmjs.com/package/@cardstack/boxel-cli). Packaged for both Claude Code (`.claude-plugin/`) and OpenAI Codex (`.codex-plugin/`); the two manifests share the same `skills/` directory.

The card-building skills (`boxel`, `boxel-design`, `catalog-reuse`, …) live in [`cardstack/boxel-skills`](https://github.com/cardstack/boxel-skills), which this repo's marketplace lists as a second plugin, `boxel-skills`, at a pinned release tag. `boxel-cli` declares it as a dependency, so Claude Code installs both together.

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

### Claude Code

```text
/plugin marketplace add cardstack/boxel
/plugin install boxel-cli
```

Installing `boxel-cli` also installs its dependency, `boxel-skills`.

For internal development, from a checkout of `cardstack/boxel`, load both plugins. A local `boxel-skills` copy satisfies the dependency; without one (or an installed `boxel-skills`), Claude Code refuses to load `boxel-cli`:

```bash
claude --plugin-dir packages/boxel-cli/plugin --plugin-dir /path/to/boxel-skills
```

`pnpm --filter @cardstack/boxel-cli fetch:skills` clones the pinned release into `packages/boxel-cli/.boxel-skills-cache/<tag>/` if you'd rather not keep a boxel-skills checkout.

`/reload-plugins` picks up local edits without restarting Claude Code.

### OpenAI Codex

Codex discovers the plugin through the marketplace manifest at
`.agents/plugins/marketplace.json` in the repo root:

```text
/plugin marketplace add cardstack/boxel
/plugin install boxel-cli@cardstack-boxel
/plugin install boxel-skills@cardstack-boxel
```

Codex has no plugin dependencies, so install `boxel-skills` yourself — without
it you get the CLI skills but none of the card-building ones.

In Codex the skills are namespaced by plugin (`boxel-cli:<name>`,
`boxel-skills:<name>`) — invoke one with the `$` prefix (`$boxel`,
`$realm-sync`, …), or let Codex pick it up by description match. The
`/boxel-cli:<name>` form in the tables below is Claude Code's.

Without installing the plugin, a checkout also works directly: Codex reads
skills from `~/.agents/skills` (or a project's `.agents/skills`), expecting
`<name>/SKILL.md` one level down. Copy each skill in — Codex does not follow
symlinked skill directories:

```bash
mkdir -p ~/.agents/skills
cp -R /path/to/boxel/packages/boxel-cli/plugin/skills/*/ ~/.agents/skills/
cp -R /path/to/boxel-skills/skills/*/ ~/.agents/skills/
```

## What you get

Skills appear under each plugin's namespace — `/boxel-cli:<name>` and
`/boxel-skills:<name>`, which is how Claude Code invokes them. Two surfaces:

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

Authored in [`cardstack/boxel-skills`](https://github.com/cardstack/boxel-skills) and installed as the `boxel-skills` plugin (`/boxel-skills:<name>`). Its [`index.md`](https://github.com/cardstack/boxel-skills/blob/main/index.md) lists every skill. The release users get is the `ref` of the `boxel-skills` entry in the repo-root `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`; move both together to ship a newer release.

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
- **`plugin.json`** bumps if the PR touched `plugin/` or `scripts/build-plugin.ts`, **or if the on-`main` regen step produced a diff in `plugin/skills/`** (e.g. a new CLI command added in `src/` triggers a synopsis regen, which counts as a plugin-surface change).

| Change                                                              | `package.json` | `plugin.json`                       |
| ------------------------------------------------------------------- | -------------- | ----------------------------------- |
| New / changed CLI command (e.g. `feat:` in `src/commands/`)         | bump (minor)   | bump (synopsis regenerates → minor) |
| Plugin README or prose (`fix:` in `plugin/README.md`)               | —              | bump (patch)                        |
| CLI bug fix without Commander surface change (`fix:` in `src/lib/`) | bump (patch)   | —                                   |
| `chore:` / `docs:` housekeeping                                     | —              | —                                   |

Moving the `boxel-skills` pin touches only the repo-root marketplace files, so it bumps neither version: Claude Code keys the `boxel-skills` plugin on the pinned commit, and Codex on the `version` in boxel-skills' own `.codex-plugin/plugin.json`.

## Releasing

### Unstable channel (automated, every merge)

Every merge to `main` that touches `packages/boxel-cli/**` triggers the `unstable` job in `.github/workflows/boxel-cli-publish.yml`:

1. Regenerates the command synopses in `plugin/skills/` from the current Commander tree.
2. Reads the merged PR's title via `gh api repos/.../commits/<sha>/pulls`.
3. Classifies the bump level and decides per-surface bumps.
4. Writes new versions into `package.json` and/or `plugin.json`.
5. Commits `chore(release): boxel-cli npm=<v> plugin=<v> [skip ci]` back to `main` and tags `boxel-cli-v<npmVer>` if npm bumped.
6. If npm bumped, publishes `@cardstack/boxel-cli@<base>-unstable.<n>` under npm dist-tag `unstable` (Ember canary pattern). `<n>` is one past the highest `<base>-unstable.<n>` already on npm, so it never collides with a published version.

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
