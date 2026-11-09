---
status: proposed
date: 2026-10-02
retroactive: true
recorded: 2026-11-09
scope:
  - packages/host/app/lib/realm-runner/**
  - packages/host/app/tools/**
  - packages/runtime-common/realm-runner-script.ts
  - packages/ai-bot/lib/script-syntax-check.ts
  - packages/ai-bot/lib/bot-tools/**
  - packages/host/app/services/matrix-service.ts
---

# 022. Do the assistant's workspace work in one sandboxed script

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

A script MUST run in a sandbox that holds no network access, no DOM, no
storage, no credentials and no objects of the host app or the server. Each run
MUST get a new sandbox, and no state from one run goes into the next. The
sandbox MUST NOT run on the thread that serves the user interface or other
requests. It MUST have a memory limit, a stack limit and an interrupt at its
deadline. The runner MUST be able to stop the sandbox from outside, when the
user stops the run or when the sandbox stops answering.

### 1.3. What goes in and out of a run

```
           in: script, workspace URL, time limit
                         │
   ┌─────────────────────▼──────────────────────┐
   │ sandbox                                    │
   │   script ── call: method + JSON args ──────┼──► runner checks it,
   │          ◄─ answer: JSON or error message ─┼─── does it as the user
   └─────────────────────┬──────────────────────┘
                         │
          out: one JSON value or an error,
               and a report of what the calls changed
```

**In.** A run MUST get only the script, the URL of its workspace and its time
limit. It MUST NOT get the conversation, the user's credentials or any state
from an earlier run.

**During the run.** A script MUST reach anything outside the sandbox only
through the `realm.*` and `room.*` calls that the runner answers. A call MUST
carry only a method name and arguments as JSON, and its answer MUST be only
JSON or an error message. The runner MUST treat each call and each argument
from the sandbox as untrusted, and check it before it does the call.

**Out.** The script MUST give back only one JSON value or an error. A run
MUST change things outside the sandbox only through its calls. The result
that the model gets MUST say what the calls changed, also when the run failed,
so that the model knows the state of the workspace before it tries again.

A call that changes a file, a workspace, the index or a card through an
operation acts at once, and stays done when the run fails later. Card updates
(`realm.cards.update`), room changes and UI actions MUST wait until the script
has finished without an error. A failed run MUST make none of them.

### 1.4. The user's permissions

Each call MUST act with the permissions of the user who started the run. The
realm makes the permission decision. Each call method MUST have an entry in
`REQUIRES_WRITE`.

### 1.5. Confirmation

A call that cannot be undone, spends the user's credit, changes the state of a
whole workspace for a long time, or saves content from an outside URL into the
workspace MUST be in `CLICK_REQUIRED_CALLS`. A run whose code names such a call
MUST wait for the user's click before it starts. The runner MUST refuse such a
call when the script does not name it.

Two kinds of calls are not in this rule. A call that only reads outside content
into the sandbox (`realm.web.search`, `realm.web.read`, `realm.resolve`) needs
no click, and §1.6 limits it. An operation that a card type declares
(`realm.operations.*`) needs no click. The realm allows it when its policy
grants the operation (§1.4).

### 1.6. Limits

Each call that costs time, money or memory MUST have a limit per run. The time
a run waits on a person (`realm.ask`) and the time to start the sandbox MUST
NOT count against the script's time limit.

### 1.7. One script format

Each component that parses or runs a script MUST wrap it and describe its
errors with `packages/runtime-common/realm-runner-script.ts`.

## 2. Rationale

Models prefer to make a tool call and write code to a text format they were not
trained on. The Realm Runner came from such a format: the assistant once wrote
code changes in an invented search/replace format in prose, and its output was
often malformed. The model evals improved significantly with the runner
(#6235).

A script can hold loops and other basic constructs, so the model can do a task
in one call instead of a sequence of tool calls (#6235). A tool definition that
changes bills the whole conversation again at full input price, because tool
definitions come before all message history
(`packages/host/app/services/matrix-service.ts`).

The runner trusts nothing that comes from the sandbox: the script sees only
`realm` and `room`, and the host does each call and its checks
(`packages/host/app/lib/realm-runner/worker.ts`). The sandbox has no access to
the network, the DOM or the host app, and it has memory and time limits
(#6235). Today it is QuickJS, compiled to WebAssembly, in a Web Worker in the
host (#6235). QuickJS is a choice of this implementation, not a rule.

A call that only reads outside content needs no click, but each one is a paid
request, so it has a limit per run
(`packages/host/app/tools/run-realm-code.ts`).

The runner may move to the realm server later. The rules in §1.2–§1.7 apply to
a runner in either place, so a server runner follows this ADR.

## 3. Considered options

- **One script in a sandbox.** Chosen, for the reasons in §2.
- **An invented search/replace format in prose.** Rejected: models were not
  trained on it, and its output was often malformed (#6235).
- **A sequence of named tool calls.** Rejected: a script with loops can do
  the same task in one call (#6235).
- **A per-card patch tool in each message.** Rejected: its definition changes
  when the open card changes, so each change bills the conversation again
  (`packages/host/app/services/matrix-service.ts`).

## 4. Open questions

These reasons are likely, but no source states them. Ask Matic Jurglic.

- Did prompt injection decide the sandbox? The model reads web pages, cards
  and files that other people wrote. In the host page, a harmful script could
  read the user's realm tokens and Matrix session, send data out, or freeze
  the tab.
- Is the token cost of many tool schemas, compared to one tool definition, a
  reason to prefer one script?
- Do tools that ai-bot runs itself stay named because they need no round trip
  to the browser?
- Why do card operations (`realm.operations.*`) need no click, when they
  cannot be undone? Is the realm's policy decision the reason?

## 5. Sources

- #6235: the first runner and its reasons.
- #6630: a run in a workspace the user can only read.
- #6629, #6632, #6748: room actions and card calls added as `realm.*` and
  `room.*` calls instead of named tools.
- 886bc0648d: sandbox start time is not charged to the script.
- `packages/host/app/services/matrix-service.ts`: why messages carry no
  per-card patch tool.
- `packages/host/app/lib/realm-runner/worker.ts`: the sandbox trusts nothing
  in the script.
- `packages/host/app/tools/run-realm-code.ts`: which calls need a click, and
  why outside reads have limits instead.

## 6. Remediation

Known gaps are listed in [remediation/022.md](remediation/022.md).
