# CS-10900 — Add Claude Code Plugin for boxel-cli

[CS-10900](https://linear.app/cardstack/issue/CS-10900/add-claude-code-plugin-for-boxel-cli) — High priority, project *Incorporate Boxel CLI to Monorepo*.

## Goals

1. Package `packages/boxel-cli` with a first-class [Claude Code plugin](https://code.claude.com/docs/en/plugins).
2. Provide both an internal install flow (`claude --plugin-dir`) and an external one (marketplace via `cardstack/boxel`).
3. Keep skill content from drifting against the CLI command tree by partially generating the synopsis from Commander metadata.

## What we have today

- **Standalone repo** (`cardstack/boxel-cli`) — has rich `.claude/CLAUDE.md` + 8 markdown skill files but uses the legacy *standalone-config* shape, not the plugin shape. Lives outside the monorepo.
- **Monorepo `packages/boxel-cli`** — has stronger types and a programmatic API (`BoxelCLIClient`) but **no `.claude/` integration** today. Commands: `realm/{create,list,pull,push,sync,history,wait-for-ready,cancel-indexing}`, `file/{read,write,list,delete,lint,touch}`, top-level `search` / `run-command` / `read-transpiled` / `profile`.
- Already published as `@cardstack/boxel-cli` on npm (v0.0.1).

## Approach

### Layout

```
boxel/
├── .claude-plugin/
│   └── marketplace.json                       # repo-root marketplace catalog
└── packages/boxel-cli/
    ├── plugin/
    │   ├── .claude-plugin/plugin.json         # name "boxel-cli", version independent of CLI
    │   ├── README.md                          # install + npm prereq
    │   └── skills/
    │       ├── boxel-development/SKILL.md     # ported from standalone (.gts authoring)
    │       ├── boxel-file-structure/SKILL.md  # ported from standalone (file/dir rules)
    │       ├── realm-sync/SKILL.md
    │       ├── realm-history/SKILL.md
    │       ├── file-ops/SKILL.md              # incl. CS-10627 file touch
    │       ├── search/SKILL.md
    │       └── profile/SKILL.md
    └── scripts/
        └── build-plugin.ts                    # synopsis generator
```

### Installation flows

- **Internal** (Cardstack engineers): `claude --plugin-dir packages/boxel-cli/plugin`.
- **External** (everyone else): `/plugin marketplace add cardstack/boxel` then `/plugin install boxel-cli`. Prerequisite: `npm install -g @cardstack/boxel-cli` (Pattern A, external install — plugin documents the CLI but does not bundle it).

### Versioning

The plugin and the npm CLI live in the same repo but **version independently**:

| Change | `package.json.version` | `plugin.json.version` |
|---|---|---|
| New / changed CLI command (Commander tree differs) | bump | bump (synopsis regenerates) |
| Plugin prose / curated narrative only | — | bump |
| CLI refactor / bug fix (no Commander change) | bump | — |

Plugin updates ride the marketplace cache, keyed on `plugin.json.version`. Forgetting to bump means no user sees the change. Updates are pulled at Claude Code startup automatically (public repo, no auth needed) or manually via `/plugin marketplace update && /plugin update`.

### Generation strategy (hybrid)

`scripts/build-plugin.ts` walks the Commander tree (importing the program from `src/index.ts`), and for each skill regenerates a fenced `<!-- generated:commands:start -->...<!-- generated:commands:end -->` block in `SKILL.md` with each command's signature, args, options, and description. Curated narrative outside the block is hand-written.

### CI gates (added in `ci-lint.yaml`)

1. **Synopsis freshness** — `pnpm build:plugin && git diff --exit-code`. Fails if commands changed without regenerating skills.
2. **Synopsis-bump coupling** — if any `<!-- generated:commands -->` block is in the diff, `plugin/.claude-plugin/plugin.json` `version` must also be in the diff.

The existing `manual-boxel-cli-publish.yml` workflow continues to handle CLI npm releases. No separate "plugin publish" — the plugin is git-distributed via the marketplace.

## Skills explicitly NOT in v1

`/track`, `/watch`, `/restore`, `/repair`, `/setup`, `/sync` (the standalone-style skills). Their underlying commands (track/history/edit, share/gather, multi-realm config) don't exist in the monorepo CLI yet — these become future work for whichever ticket adds the underlying commands.

## Verification

1. `cd packages/boxel-cli && pnpm build:plugin` — clean diff against committed files (CI gate).
2. `claude --plugin-dir packages/boxel-cli/plugin` from monorepo root — `/help` lists `/boxel-cli:*` skills under the namespace.
3. Invoke each skill, confirm Claude routes to the matching `boxel ...` command end-to-end.
4. Edit a `SKILL.md`, run `/reload-plugins`, confirm change is live without restart.
5. Independent-version sanity: `pnpm version-bump:plugin` alone bumps `plugin.json` only; `pnpm version:patch` (existing) bumps `package.json` only.
6. From a clean checkout: `claude` then `/plugin marketplace add ./` from the repo path → `/plugin install boxel-cli` → smoke-test one skill.
