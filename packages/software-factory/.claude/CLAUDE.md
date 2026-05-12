# CLAUDE.md — software-factory

This package implements the issue-driven factory loop. See
[README.md](../README.md) for architecture and
[AGENTS.md](../AGENTS.md) for the agent-facing summary.

## Running the factory

```sh
pnpm factory:go --brief-url <url> --target-realm <url>
```

- `--debug` — verbose logs.
- `--agent openrouter` — use the opencode-OpenRouter passthrough agent
  (routes via the realm-server's `/_openrouter/chat/completions` proxy).

## Running tests

- `pnpm test:node` — QUnit node tests.
- `pnpm test:playwright` — Playwright e2e tests.
- `pnpm lint` — eslint + prettier + glint (`ember-tsc`).

## Skill loading

The agent's instructions live in `.agents/skills/`. The factory loader
(`src/factory-skill-loader.ts`) walks three directories:

1. `packages/software-factory/.agents/skills/` — factory-specific skills
   (`software-factory-bootstrap`, `software-factory-operations`).
2. `packages/boxel-cli/plugin/skills/` — boxel-cli Claude Code plugin
   skills (`boxel-api`, `boxel-command`); same directory the plugin
   distributes to end users.
3. monorepo root `.agents/skills/` — general domain skills
   (`boxel-development`, `boxel-file-structure`, `ember-best-practices`).

`packages/software-factory/.claude/skills` is a symlink to
`.agents/skills/` so Claude Code and the factory loader read the same
files.

## Architectural principle

`boxel-cli` owns the entire Boxel API surface. The factory imports
`BoxelCLIClient` from `@cardstack/boxel-cli/api`; it never calls
`fetch()` against a realm directly. Auth, token refresh, and retries
are internal to boxel-cli.

## Key source files

- `src/factory-entrypoint.ts` — CLI entry; bootstraps target realm,
  creates seed issue, runs the loop.
- `src/issue-loop.ts` — inner/outer issue scheduling.
- `src/workspace-fs.ts` — local mirror of the target realm.
- `src/factory-agent/opencode.ts` — agent backend.
- `src/factory-tool-builder.ts` — factory tool registry passed to the
  agent (validators, `get_card_schema`, `signal_done`,
  `request_clarification`).
