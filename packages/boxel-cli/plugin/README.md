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

The plugin's `version` is independent of `@cardstack/boxel-cli`'s npm version. The plugin only describes the CLI; it does not bundle it. See `docs/cs-10900-claude-plugin-for-boxel-cli-plan.md` in the monorepo root for the release model.
