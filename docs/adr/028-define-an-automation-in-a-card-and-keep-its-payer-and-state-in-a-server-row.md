---
status: accepted
date: 2026-11-10
scope:
  - packages/base/automation*
  - packages/runtime-common/**/*automation*
  - packages/realm-server/**/*automation*
  - packages/realm-server/**/*automation*/**
  - packages/realm-server/lib/cron-scheduler.ts
  - packages/postgres/migrations/*automation*
---

# 028. Define an automation in a card, and keep its payer and state in a server row

An automation has two halves. Its definition is a card in the realm, which
people and the AI assistant read and edit like any other card. The person
who pays for it and the state it is in are a row on the server, which
writing the card can't change. Each run is a queued job, and a coalescing
tick enqueues the runs that are due.

## 1. Decision

### 1.1. The definition is a card

An automation's definition MUST be an instance of the base `Automation` card
type: its script, triggers, declared operations, caps, params, run milestones
and `batchedAI`. The definition MUST NOT live in a non-card file or only in a
server table.

The server MUST read the definition from the index, as data. It MUST NOT run
card code to learn what an automation says. It MUST accept only instances of
the base `Automation` type.

### 1.2. The payer and the state are server state

The payer, the state (active, paused with a reason, waiting for credits, or
done), the next run, each trigger's run count and the caps snapshot MUST be
kept in a server row, one per switched-on automation, and MUST NOT be card
fields. The payer MUST be set only by a direct writer's call to the route
that switches an automation on or resumes it, and that caller MUST become the
payer. A write to the card MUST NOT change the payer.

A card edit that raises a cap above the snapshot, or turns on `batchedAI`,
MUST pause the automation until its payer confirms.

### 1.3. Triggers

An automation MUST hold a list of triggers. Each trigger MUST be `cron` (a
cron expression and a time zone, with an optional `until` and `count`),
`once` (a date, time and time zone), or `webhook` (one of the realm's
incoming webhooks). Times MUST be stored as UTC. A trigger's time zone MUST be
used only to compute its next run. A trigger's run count MUST be kept by its
label, so that editing the card doesn't reset it.

### 1.4. Runs are queued jobs, enqueued by a coalescing tick

Each run MUST be a `run-command` job with the `dedupeKey`
`automation:<id>:<trigger>:<slot>` and the `concurrencyGroup`
`automation:<id>`. The slot MUST be the scheduled instant, the webhook
delivery's id, the batch's id, or the click.

A system cron MUST enqueue a tick job every minute. The tick MUST claim due
rows with `FOR UPDATE SKIP LOCKED` and enqueue their runs. A duplicate tick
MUST be harmless because of the `dedupeKey`. Reconcile MUST enqueue at most
one make-up run per missed due time.

## 2. Rationale

The assistant writes, tests and changes automations, and people read them.
A card gives both the same tools they use for everything else in a realm:
editing, history, permissions, and a view that shows the schedule, the runs
left and the payer. A card is code as well as data, so the server reads only
the stored fields of the base type and never renders or runs it to learn what
it may spend.

Anyone who can write the card can edit it, and a policy grant can let many
people write. If the payer were a card field, any of them could make someone
else pay. So the payer is server state, set only by an administrator who
switches the automation on and so agrees to pay. The caps snapshot keeps a
later edit from raising the spend without the payer's consent.

A list of triggers covers what one cron expression can't, such as a daily
run plus an extra run on the 1st, or reacting to webhooks with a nightly
catch-up run. UTC storage with the time zone used only for the next run keeps
"daily at 05:30" right across daylight saving.

`run-command` already runs a host command in a prerender tab from a queue
job, with `runAs`, a `dedupeKey` and a `concurrencyGroup`. Every worker
manager fires every system cron, so the tick must coalesce. The `dedupeKey`
per trigger and slot makes a duplicate tick join the same job, while two
triggers that fire at the same moment still start two runs, one after the
other in the automation's concurrency group.

## 3. Considered options

- **A card for the definition, a server row for the payer and state, runs
  as `run-command` jobs from a tick (chosen).**
- **A `.pipeline.json` file.** People and the assistant would edit JSON with
  no card view, no type and no validation on save.
- **The definition only in a server table.** It would need its own editor,
  history and permissions, and the assistant couldn't edit it like a card.
- **The payer as a card field.** Anyone who can write the card could make
  someone else pay.
