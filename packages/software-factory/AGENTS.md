# AGENTS.md — software-factory

This package implements the issue-driven factory loop. The factory takes a
brief, creates a project + issues in a target realm, and the agent works
each issue using native fs tools (`Read` / `Write` / `Edit` / `Glob` /
`Grep` / `Bash`) plus a handful of factory tools (validators + control
flow).

See [README.md](./README.md) for architecture. The agent's loaded
instructions live in two parallel directories:

- `.agents/skills-orchestrator/` — consumed by `pnpm factory:go` (the SDK
  orchestrator). Describes the factory-MCP tool surface.
- `.agents/skills/` — consumed by interactive Claude Code (via the
  `.claude/skills` symlink). Describes the `boxel` CLI surface and the
  agent-owned status lifecycle.

Both modes also fall back to `packages/boxel-cli/plugin/skills/` and
the monorepo-root `.agents/skills/` for shared domain skills.

## Commands

- `pnpm factory:go --brief-url <url> --target-realm <url>` — run the factory loop.
  - `--debug` for verbose logs.
  - `--agent openrouter` to use the opencode-OpenRouter passthrough agent.
- `pnpm test:node` — QUnit node tests.
- `pnpm test:playwright` — Playwright e2e tests.
- `pnpm lint` — eslint + prettier + glint (`ember-tsc`).

## Key files

- `src/factory-entrypoint.ts` — CLI entry; bootstraps the target realm,
  creates the seed issue, runs the loop.
- `src/issue-loop.ts` — inner/outer issue scheduling loop.
- `src/factory-skill-loader.ts` — resolves and loads skills from
  `packages/software-factory/.agents/skills-orchestrator/` (primary —
  consumed by `pnpm factory:go`), `packages/boxel-cli/plugin/skills/`
  (fallback), and monorepo root `.agents/skills/` (fallback). The
  interactive Claude Code path reads `.agents/skills/` directly via
  `.claude/skills`.
- `src/workspace-fs.ts` — local-filesystem mirror of the target realm;
  the agent reads/writes here, the orchestrator syncs.
- `src/factory-agent/opencode.ts` — agent backend (opencode in passthrough
  mode against the realm-server's `/_openrouter/chat/completions` proxy).

## Architectural boundaries

- **`boxel-cli` owns the entire Boxel API surface.** The factory imports
  `BoxelCLIClient` from `@cardstack/boxel-cli/api`; it never calls
  `fetch()` against a realm directly. Auth, token refresh, and retries
  are internal to boxel-cli.
- **Target-realm I/O is local.** The agent operates on the workspace
  mirror under `os.tmpdir()/boxel-factory-workspaces/<slug>/`. The
  orchestrator calls `client.sync()` between iterations.
- **Realm creation, pull, sync are orchestrator concerns.** The agent is
  explicitly told not to drive sync — `factory-entrypoint.ts` and
  `factory-issue-loop-wiring.ts` own those calls.
