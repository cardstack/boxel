# Testing the Software Factory Locally

This guide walks through running the software factory on your own
machine, two ways:

1. **Scripted** — the Node orchestrator (`pnpm factory:go`), which
   drives the loop itself using Claude's and opencode's SDKs.
2. **Umbrella skill** — an interactive Claude Code session that runs
   the whole loop by following `docs/runbook.md`; there is no
   orchestrator process, the agent drives every step.

Pick whichever you want to exercise — the prerequisites are shared.

## Prerequisites

### 1. Download the latest Boxel CLI

The factory and the interactive flow both shell out to the published
`@cardstack/boxel-cli`. Install (or upgrade) it globally:

```bash
pnpm i -g @cardstack/boxel-cli@latest
boxel --version
```

`boxel --help` should list `lint`, `parse`, `test`, `realm`, and
`profile` among the subcommands. If any are missing, you're on an old
build — re-run the install above.

### 2. Make sure a Boxel profile is selected

Auth comes from the **active** Boxel profile. List your profiles and
confirm one is marked active:

```bash
boxel profile list
```

If none is active (or the active one points at the wrong realm
server), add or switch to the right one:

```bash
# First time — interactive wizard (environment + credentials)
boxel profile add

# Already have profiles — switch the active one
boxel profile switch <profile-id>
```

Concrete example:

```bash
boxel profile switch localhost
```

### 3. Check out the boxel repo and navigate to the software factory

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel/packages/software-factory
```

If you already have the repo, just:

```bash
cd <path-to>/boxel/packages/software-factory
```

You also need a running realm server reachable at the URL you'll use.
For local work that's `mise run dev-all` from the monorepo root
(starts realm server, host app, icons server, Postgres, Synapse).

---

## Section 1 — Running the scripted software factory

This is the Node orchestrator. It owns the loop: it picks the next
unblocked issue, hands it to the agent (Claude's Agent SDK by default,
opencode for the OpenRouter backend), runs the validation pipeline,
and repeats. You run one command and watch it go.

**Generic command:**

```bash
pnpm factory:go \
  --brief-url <BRIEF_URL> \
  --target-realm <TARGET_REALM_URL> \
  --enable-boxel-ui-discovery \
  --debug
```

- `--brief-url` — the source brief card describing what to build.
- `--target-realm` — the realm the factory creates and writes to
  (trailing slash, URL form).
- `--enable-boxel-ui-discovery` — let the agent discover and reuse
  existing boxel-ui components.
- `--debug` — verbose logs: LLM prompts, tool calls + results, and
  QUnit `console.log` output as tests run.

**Concrete example:**

```bash
pnpm factory:go \
  --brief-url https://localhost:4201/software-factory/Wiki/cookalong-recipe \
  --target-realm https://localhost:4201/user/cookalong-9708/ \
  --enable-boxel-ui-discovery \
  --debug
```

A successful run logs the seed issue, then each outer cycle as the
agent bootstraps the project and works through the implementation
issues, finishing with `outcome=all_issues_done`. See the README's
["What to expect on the command line"](../README.md) section for the
full log shape and the resulting target-realm artifact tree.

---

## Section 2 — Running the factory using the umbrella skill (`runbook.md`)

Here there is **no** orchestrator process. You open an interactive
Claude Code session from `packages/software-factory/` (so the
`.claude/skills` symlink is discovered) and give it one instruction;
the agent follows `docs/runbook.md` end-to-end — bootstrap, per-issue
implementation, validators, and project completion — in a single loop.

Open the agent and paste the instruction.

**Generic prompt:**

```
Run the software factory per docs/runbook.md.
Brief: <BRIEF_URL>
Target realm: <TARGET_REALM_URL>
```

**Concrete example:**

```
Run the software factory per docs/runbook.md.
Brief: https://localhost:4201/software-factory/Wiki/cookalong-recipe
Target realm: https://localhost:4201/user/cookalong-d4f1-1/
```

> Always include "per docs/runbook.md". Without it, the agent falls
> back to the SDK-orchestrator path described in this package's
> `CLAUDE.md` instead of driving the loop itself.

For the full breakdown of every step the agent performs, what it
invokes, and the expected output, see [docs/runbook.md](./runbook.md).
