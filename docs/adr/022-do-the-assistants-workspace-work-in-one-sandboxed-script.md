---
status: proposed
date: 2026-11-09
scope:
  - packages/host/app/lib/realm-runner/**
  - packages/host/app/tools/**
  - packages/runtime-common/realm-runner-script.ts
  - packages/ai-bot/lib/script-syntax-check.ts
  - packages/ai-bot/lib/bot-tools/**
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

Models write code well, and they prefer a tool call with code to a text format
they were not trained on. The Realm Runner came from such a format: the
assistant once wrote code changes in an invented search/replace format in
prose, and its output was often malformed. The model evals improved
significantly with the runner (#6235).

One script also replaces a sequence of tool calls. Loops and other basic
constructs let the model search, read, change and check in one call, instead of
one LLM turn for each step (#6235). One tool
definition costs fewer tokens than many tool schemas. It also keeps the
provider's prompt cache valid: tool definitions come before all message
history, so a changed definition bills the whole conversation again at full
input price (`packages/host/app/services/matrix-service.ts`).

The script is code from a model, so it is untrusted. The model reads web
pages, cards and files that other people wrote, and that text can tell it to
write a harmful script (prompt injection). In the host page, such a script
could read the user's realm tokens and Matrix session, call any realm with
them, send data out, or change the app. A loop or a large allocation could
freeze the user's tab, or slow a server for other users. The sandbox removes
all of this. The script can only ask the runner to do a call, and the runner
decides (#6235). Today the sandbox is QuickJS, compiled to WebAssembly, in a Web
Worker in the host. QuickJS is a choice of this implementation, not a rule.

A tool that ai-bot runs itself does not need the browser, so it does not cost a
round trip to the host. That is why §1.1 lets such tools stay named.

The runner may move to the realm server later. The rules in §1.2–§1.7 apply to
a runner in either place, so a server runner follows this ADR.

## 3. Considered options

- **One script in a sandbox.** Chosen, for the reasons in §2.
- **A sequence of named tool calls.** Rejected: one LLM turn for each step, and
  more tool schemas in the prompt (#6235).
- **A per-card patch tool in each message.** Rejected: its definition changes
  when the open card changes, so each change bills the conversation again
  (`packages/host/app/services/matrix-service.ts`).

## 4. Sources

- #6235: the first runner and its reasons.
- #6630: a run in a workspace the user can only read.
- #6629, #6632, #6748: room actions and card calls added as `realm.*` and
  `room.*` calls instead of named tools.
- 886bc0648d: sandbox start time is not charged to the script.
- `packages/host/app/services/matrix-service.ts`: why messages carry no
  per-card patch tool.

## 5. Remediation

Known gaps are listed in [remediation/022.md](remediation/022.md).
