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

Skills appear under the `/boxel-cli:` namespace.

| Skill | Use it for |
|---|---|
| `/boxel-cli:boxel-development` | Authoring `.gts` card definitions and `.json` instances. The high-level Boxel patterns guide. |
| `/boxel-cli:boxel-file-structure` | File and directory naming rules, `adoptsFrom` module paths, link relationship semantics. |
| `/boxel-cli:realm-sync` | `boxel realm sync/push/pull/create/list` — moving files between local disk and a realm. |
| `/boxel-cli:realm-history` | `boxel realm history/wait-for-ready/cancel-indexing` — inspecting and steering realm indexing. |
| `/boxel-cli:file-ops` | `boxel file read/write/list/delete/lint/touch` — single-file operations against a realm. |
| `/boxel-cli:search` | `boxel search` — federated search across realms. |
| `/boxel-cli:profile` | `boxel profile list/add/switch/remove/migrate` — managing realm-server credentials. |

## Versioning

The plugin's `version` is independent of `@cardstack/boxel-cli`'s npm version. The plugin only describes the CLI; it does not bundle it.

| Change | `package.json` `version` (npm CLI) | `plugin.json` `version` |
|---|---|---|
| New / changed CLI command | bump | bump (synopsis regenerates) |
| Plugin prose only | — | bump |
| CLI refactor / bug fix (no Commander change) | bump | — |

See [Releasing](#releasing) below for how a `plugin.json` bump actually reaches users.

## Releasing

The plugin is **git-distributed** through `.claude-plugin/marketplace.json` at the monorepo root — there is no separate npm publish step for the plugin. A release is simply: merge to `main` with a bumped `plugin.json` `version`.

### Steps

1. If you changed CLI commands, run `pnpm build:plugin` from `packages/boxel-cli/` to regenerate the `<!-- generated:commands -->` blocks in each `SKILL.md`.
2. Bump `packages/boxel-cli/plugin/.claude-plugin/plugin.json` `version` (semver — patch for prose, minor for new skills, major for breaking changes to skill names/contracts).
3. Open a PR. CI in `.github/workflows/ci-lint.yaml` will fail if the synopsis is stale (*synopsis freshness* check) or if the bump is missing when synopsis changed (*synopsis-bump coupling* check).
4. Merge to `main`. That's the publish — `cardstack/boxel`'s `.claude-plugin/marketplace.json` is the source of truth and Claude Code pulls from it directly.

### How users pick up the new version

- **Automatic:** Claude Code refreshes marketplaces on startup for public repos.
- **Manual:** `/plugin marketplace update && /plugin update` inside Claude Code.

The marketplace cache is keyed on `plugin.json` `version` — **forgetting the bump means no user sees the change**, even after merge. The CI coupling check exists to prevent exactly this.

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

### What a plugin release does *not* do

- It does **not** publish or update `@cardstack/boxel-cli` on npm. That ships separately via the `manual-boxel-cli-publish.yml` workflow.
- It does **not** require users to reinstall — `/plugin update` is in-place.
- It does **not** bundle the CLI. Users still need `npm install -g @cardstack/boxel-cli` (see [Prerequisites](#prerequisites)).
