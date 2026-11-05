---
status: proposed
date: 2026-10-02
retroactive: true
recorded: 2026-11-05
scope:
  - packages/host/app/lib/realm-runner/**
  - packages/host/app/tools/**
  - packages/runtime-common/realm-runner-script.ts
  - packages/ai-bot/lib/script-syntax-check.ts
  - packages/ai-bot/lib/bot-tools/**
---

# 020. Do the assistant's workspace work in one sandboxed script

The AI assistant reads and changes a workspace by writing one JavaScript
script, which the Realm Runner runs in an isolated sandbox. The script reaches
the workspace only through `realm.*` and `room.*` calls that the runner checks
and does with the user's permissions. This ADR keeps the assistant on that one
tool, and states the sandbox, permission, confirmation and limit rules that any
runner must keep, in the browser today or on a server later.

## 1. Decision

### 1.1. One script tool

A new assistant capability that reads or changes a workspace MUST be a
`realm.*` call in the Realm Runner. It MUST NOT be a new named tool that the
model calls. A tool that ai-bot runs itself (`packages/ai-bot/lib/bot-tools/`)
MAY stay a named tool.

### 1.2. Sandbox

A script MUST run in an isolated JavaScript sandbox. The sandbox MUST have a
memory limit, a stack limit and an interrupt at its deadline. A script MUST NOT
run in the JavaScript context of the host app or of a server process.

### 1.3. One way out

A script MUST reach anything outside the sandbox only through the `realm.*` and
`room.*` calls that the runner answers.

### 1.4. The user's permissions

Each call MUST act with the permissions of the user who started the run. The
realm makes the permission decision. Each call method MUST have an entry in
`REQUIRES_WRITE`.

### 1.5. Confirmation

A call that cannot be undone, spends the user's credit or brings content from
outside MUST be in `CLICK_REQUIRED_CALLS`. A run whose code names such a call
MUST wait for the user's click before it starts. The runner MUST refuse such a
call when the script does not name it.

### 1.6. Limits

Each call that costs time, money or memory MUST have a limit per run. The time
a run waits on a person (`realm.ask`) and the time to start the sandbox MUST
NOT count against the script's time limit.

### 1.7. One script format

Each component that parses or runs a script MUST wrap it and describe its
errors with `packages/runtime-common/realm-runner-script.ts`.

## 2. Rationale

Before the runner, the assistant changed code in an invented search/replace
format that it wrote in prose. Models were not trained on that format, and its
output was often malformed. Models prefer to make a tool call and write code,
and the model evals improved significantly after the change (#6235).

One script also replaces a sequence of tool calls. Loops and other basic
constructs let the model search, read, change and check in one call, instead of
one LLM turn for each step (#6235; Matic Jurglic, 2026-11-05). One tool
definition costs fewer tokens than many tool schemas. It also keeps the
provider's prompt cache valid: tool definitions come before all message
history, so a changed definition bills the whole conversation again at full
input price (`packages/host/app/services/matrix-service.ts`; Matic Jurglic,
2026-11-05).

The script is code from a model, so it is untrusted. The sandbox has no
network, no DOM and no access to the host app. The host checks and does each
call (#6235). Today the sandbox is QuickJS, compiled to WebAssembly, in a Web
Worker in the host. QuickJS is a choice of this implementation, not a rule.

A tool that ai-bot runs itself does not need the browser, so it does not cost a
round trip to the host. That is why §1.1 lets such tools stay named.

The runner may move to the realm server later. The rules in §1.2–§1.7 apply to
a runner in either place, so a server runner follows this ADR (Matic Jurglic,
2026-11-05).

## 3. Considered options

- **One script in a sandbox.** Chosen, for the reasons in §2.
- **The search/replace format in prose.** Rejected: models wrote it badly
  (#6235).
- **A sequence of named tool calls.** Rejected: one LLM turn for each step, and
  more tool schemas in the prompt (#6235).
- **A per-card patch tool in each message.** Rejected: its definition changes
  when the open card changes, so each change bills the conversation again
  (`packages/host/app/services/matrix-service.ts`).

## 4. Sources

- #6235: the first runner, its reasons and the format it replaced.
- #6630: a run in a workspace the user can only read.
- #6629, #6632, #6748: room actions and card calls added as `realm.*` and
  `room.*` calls instead of named tools.
- 886bc0648d: sandbox start time is not charged to the script.
- `packages/host/app/services/matrix-service.ts`: why messages carry no
  per-card patch tool.
- Matic Jurglic, 2026-11-05: the reasons for one tool (round trips, tokens,
  prompt caching), the exception for ai-bot tools, and a later server runner.

## 5. Remediation

Known gaps are listed in [remediation/020.md](remediation/020.md).
