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

Two parallel skill paths exist, one per factory run mode:

- **SDK orchestrator** (`pnpm factory:go`): the loader at
  `src/factory-skill-loader.ts` reads from
  **`.agents/skills-orchestrator/`** first. Those skills describe the
  factory-MCP-tool surface (`signal_done`, `get_card_schema`,
  `run_lint`, …) that `ToolUseFactoryAgent` actually provides at
  runtime.
- **Interactive Claude Code** (paste the prompt from
  `docs/runbook.md`): Claude Code reads
  **`.agents/skills/`** via the `.claude/skills` symlink. Those
  skills describe the `boxel` CLI surface and the agent-owned
  status lifecycle. The interactive flow has no orchestrator
  process; the agent drives the loop directly.

Fallback dir for both modes (skills that aren't software-factory
specific): `packages/boxel-cli/plugin/skills/` — synced from the
boxel-skills repo, which is the source of truth for every
non-factory skill (`boxel-development`, `boxel-file-structure`,
`boxel-workspace-cardinal-rules`, `ember-best-practices`,
`boxel-ui-component-discovery`, …); same directory the plugin
distributes to end users. The monorepo root `.agents/skills/` is
kept only as an override slot for local skill experiments.

The two software-factory skill sets diverged during CS-11149. They
stay separated until the SDK orchestrator is retired; at that
point the orchestrator code and `.agents/skills-orchestrator/` get deleted
together.

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
