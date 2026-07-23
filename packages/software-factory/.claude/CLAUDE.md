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
- `--skills-dir <path>` — replace the on-demand skill library with this
  directory (bundled plugin skills are not read; workflow skills still
  front-load from the factory package). Fails fast if it yields no
  skills. Repeatable.

## Running tests

- `pnpm test:node` — QUnit node tests.
- `pnpm test:playwright` — Playwright e2e tests.
- `pnpm lint` — eslint + prettier + glint (`ember-tsc`).

## Skill loading

Two parallel skill paths exist, one per factory run mode:

- **SDK orchestrator** (`pnpm factory:go`): the loader at
  `src/factory-skill-loader.ts` searches exactly two directories —
  **`.agents/skills-orchestrator/`** (the factory workflow skills,
  which describe the factory-MCP-tool surface: `signal_done`,
  `get_card_schema`, `run_lint`, …) and
  **`packages/boxel-cli/plugin/skills/`** (the domain-skill library:
  skills bundled from `cardstack/boxel-skills` plus CLI-native skills
  like `boxel-api` / `boxel-command`). Only the workflow skill is
  front-loaded into the system prompt; every other skill appears as a
  one-line index entry and is fetched on demand via the `read_skill`
  factory tool. A small exclusion list in the loader keeps
  realm-lifecycle skills (`realm-sync`, `file-ops`, …) out of the
  index — the orchestrator owns workspace→realm sync.
- **Interactive Claude Code** (paste the prompt from
  `docs/runbook.md`): Claude Code reads
  **`.agents/skills/`** via the `.claude/skills` symlink. Those
  skills describe the `boxel` CLI surface and the agent-owned
  status lifecycle. The interactive flow has no orchestrator
  process; the agent drives the loop directly.

The two software-factory skill sets diverged during CS-11149 and stay
separated permanently — each run mode has its own tool surface, so
neither skill set can serve the other. Keep edits to workflow guidance
in sync across both when the change isn't surface-specific.

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
