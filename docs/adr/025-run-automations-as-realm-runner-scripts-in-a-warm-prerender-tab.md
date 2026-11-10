---
status: proposed
date: 2026-11-10
scope:
  - packages/host/app/lib/realm-runner/**
  - packages/host/app/tools/run-realm-code.ts
  - packages/host/app/tools/*automation*
  - packages/host/app/routes/command-runner.ts
  - packages/realm-server/prerender/page-pool.ts
  - packages/realm-server/prerender/prerenderer.ts
  - packages/runtime-common/tasks/run-command.ts
  - packages/runtime-common/run-command-request.ts
---

# 025. Run automations as Realm Runner scripts in a warm prerender tab

An automation runs code that a customer or the AI assistant wrote, with
nobody watching. It runs that code as a Realm Runner script, in QuickJS,
inside a prerender tab that is already open. Chrome keeps the script out of
our Node processes and their secrets. QuickJS limits it to the `realm`
object. ADR 022 sets the rules for the assistant's interactive runs. This ADR
sets where an automation's script runs, what an automation may run, and how
its surface of `realm` methods is kept narrow.

## 1. Decision

### 1.1. A script runs in QuickJS in a prerender tab

An automation's script MUST run in QuickJS, in a tab of the host app on the
prerender server. It MUST NOT run in a Node process of the realm server, the
worker or the prerender server, in any form (`node:vm`, `isolated-vm`, a
worker thread). The sandbox rules of ADR 022 §1.2 and §1.3 apply to it, with
one change: a run's writes don't act at once, but land together after the
script finishes (§1.4).

A script MUST reach anything outside QuickJS only through the methods of the
automation surface (§1.4). Its `console` methods MUST be surface methods that
write to the run's log. It MUST NOT get `fetch`, a DOM, `import`, or a
token.

### 1.2. Runs share warm tabs

A run MUST run as a QuickJS worker in a prerender tab that is already open.
A run MUST NOT start a tab or hold a tab for itself. A tab MUST serve runs of
only one realm and one identity at a time. Each run MUST get its own QuickJS
worker (ADR 022 §1.2). The number of runs that one tab and one server
take at a time SHOULD come from measured capacity.

### 1.3. An automation runs only a script

An automation MUST run only a Realm Runner script. It MUST NOT run a host
command, whoever names it: an author, a card, a realm, a request or the
platform. A platform job MUST run as a system cron, not as an automation.

### 1.4. The automation surface is an allowlist

Automation runs MUST use the automation surface: a list of `realm` methods
separate from the interactive surface's, with the same engine and method
names. A method that is not on the list MUST be refused. A method on the list
MUST NOT change the realm before the script finishes. The run's writes MUST
be held back and land together after it finishes, or not at all. A method on
the list MUST NOT reach the network other than through a `callApi` operation
or a `resolve` model call, and MUST NOT touch the UI or a chat room. A test MUST pin the list, so that a method added to it, or moved
between the two surfaces, fails the test until the test changes in review.

### 1.5. No method waits for a click

The automation surface MUST NOT include a method in `CLICK_REQUIRED_CALLS`
(ADR 022 §1.5), because a run has no person to click. In place of the
click, an automation MUST declare caps on its runs' calls, writes and time,
and a run MUST stop when it reaches one.

## 2. Rationale

The concern with user code is authority. Code in one of our Node processes
can read that process's environment, files and network position, and with
them the secrets the server holds: the key that decrypts stored credentials,
the realm secret seed, and database credentials. A `vm` context is not a
security boundary (ADR 015 §3).

Two walls that already exist keep a script away from them. The prerender
server runs the host app in headless Chrome tabs, in a task apart from the
realm server's secrets, and Realm Runner already runs inside the host app.
The prerenderer launches Chrome with its sandbox off, a gap listed under
ADR 020 §1.2. While that gap is open, this wall is the task's separation from
the realm server, not Chrome's renderer sandbox. Inside
the tab, QuickJS gives the script the `realm` object and nothing else, and
every call leaves the sandbox through one host function that checks it.

The tab itself is not a safe place for arbitrary code. It has no egress
controls: no request interception, no proxy and no `connect-src`. A
`run-command` job also mints prerender auth for every realm its `runAs` user
can reach (`prepareRunCommand`), because a card can link across realms. A
host command would run with that network and that reach, whoever chose it.
QuickJS confines a script to the `realm` object, and nothing confines a host
command, so an automation runs only scripts. Platform jobs that need host
code, such as the OpenRouter model sync and the daily credit grant, are
system crons (`packages/realm-server/lib/cron-scheduler.ts`), which run no
code that a customer wrote. Each method on the surface widens what a script
can reach, so the list is pinned by a test, and each change to it is
reviewed.

A tab is expensive. Each one holds about 836 MB, so an 8 GB prerender task
holds about five (`docs/aws-operations.md`). A QuickJS worker costs
megabytes. A run
that started its own tab would spend most of its cost on start-up, and a
burst of due automations would exhaust the pool. `run-command`'s queue
spreads a burst over warm tabs instead.
Runs share a tab only with runs of the same realm and identity, because the
modules a run's cards load run as page code in the tab, and can reach
whatever the tab holds for any run in it.

The assistant already writes Realm Runner scripts, so a description of an
automation produces code that the platform already runs. The script is an
ordinary file in the realm, which people can read, diff and edit.

## 3. Considered options

- **A Realm Runner script in QuickJS, in a warm prerender tab (chosen).**
- **Run scripts in Node (`node:vm`, `isolated-vm`, worker threads).** These
  put user code in a process that holds our secrets. `node:vm` is no
  boundary, and the others put the script in the same process and task as
  the secrets, with only the engine's isolation around it.
- **A new sandbox service.** It would need its own isolation, deployment,
  capacity and auth, to get what Chrome and QuickJS already give.
- **Arbitrary host commands.** The tab has no egress controls and holds
  auth for other realms, so an author's command could send anything anywhere.
- **A reviewed list of platform commands.** A listed command still runs
  outside QuickJS, in a tab with no egress controls and with auth for every
  realm its `runAs` user can reach. Review limits which commands run, not
  what each one can do, and every addition widens what an automation can do.
  The platform jobs such a list would serve already run as system crons.
- **One tab per run.** Start-up would cost more than most runs, and a
  server holds only about five tabs.

## 4. Remediation

Known gaps are listed in [remediation/025.md](remediation/025.md).
