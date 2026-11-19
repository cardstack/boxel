---
status: proposed
date: 2026-11-10
scope:
  - packages/runtime-common/**/*automation*
  - packages/runtime-common/**/*automation*/**
  - packages/realm-server/**/*automation*
  - packages/realm-server/**/*automation*/**
  - packages/realm-server/lib/cron-scheduler.ts
  - packages/postgres/migrations/*automation*
  - packages/catalog/test-subset.json
---

# 028. Define an automation in a card, and keep its payer and status in a server row

An automation has two halves. Its definition is a card in the realm, which
people and the AI assistant read and edit like any other card. The person
who pays for it and its status are a row on the server, which writing the
card can't change. Each run is a queued job, and a coalescing
tick enqueues the runs that are due.

## 1. Decision

### 1.1. The definition is a card

An automation's definition MUST be an instance of the catalog's `Automation`
card type: its script, triggers, declared operations, caps, params and
`batchedAI`. The definition MUST NOT live in a non-card file or only in a
server table.

The `Automation` type MUST be a system card in the catalog realm, in the
catalog test subset, as `RealmPolicy` is. Server code MUST name it by a
catalog code ref, as `realmPolicyRef` names `RealmPolicy`.

The server MUST read the definition from the index, as data. It MUST NOT run
card code to learn what an automation says. It MUST accept only instances of the
catalog `Automation` type or of a type that descends from it. It MUST decide
that from the adoption chain the index records for the instance, as
`realmPolicyRef`'s key is matched in a policy card's chain.

### 1.2. Only administrators edit what an automation does

The `Automation` type MUST declare every operation that writes it
`nonGrantable` (ADR 024 §1.5), so that only the realm's direct writers can
edit a definition. A policy grant MUST NOT admit a write to the script file
that a switched-on automation names.

### 1.3. The payer and the status live in a server row

The payer, the status (active, paused with a reason, waiting for credits, or
done), the next run, each trigger's run count and the caps snapshot MUST be
kept in a server row, one per switched-on automation, and MUST NOT be card
fields. The payer MUST be set only by a direct writer's call to the route
that switches an automation on or resumes it, and that caller MUST become the
payer. A write to the card MUST NOT change the payer.

A card edit that raises a cap above the snapshot, turns on `batchedAI`, or
names an incoming webhook the snapshot doesn't (a webhook trigger pointed at
another webhook, or a new webhook trigger), MUST pause the automation. That pause MUST end only through a resume, which
makes its caller the payer and takes a new snapshot.

### 1.4. Triggers

An automation MUST hold a list of triggers. Each trigger MUST be `cron` (a
cron expression and a time zone, with an optional `until` and `count`),
`once` (a date, time and time zone), or `webhook` (one of the realm's
incoming webhooks). A realm's incoming webhooks MUST be the ones a direct
writer of the realm made: switching an automation on and resuming it MUST
refuse a webhook trigger that names any other. Each trigger MUST have a label, unique within its
automation. Times MUST be stored as UTC. A trigger's time zone MUST be used
only to compute its next run. A trigger's run count MUST be kept by its
label, so that other edits to the card don't reset it. A renamed label starts
a new count.

### 1.5. Runs are queued jobs, enqueued by a coalescing tick

Each run MUST be a `run-command` job with the `dedupeKey`
`automation:<id>:<trigger>:<slot>` and the `concurrencyGroup`
`automation:<id>`. The slot MUST be the scheduled instant for a cron or
one-time trigger, the delivery's id for a webhook, the batch's id for a
batched-AI follow-up run, and a new id per click for Preview and Run now. A
run's job args MUST depend only on the automation, the trigger and the slot.

A system cron MUST enqueue a tick job every minute. The tick MUST claim due
rows with `FOR UPDATE SKIP LOCKED`, and MUST hold a row's claim while it
enqueues the row's runs. It MUST advance the row's next run and each
trigger's run count in the claim's transaction, after the runs it advances
past are enqueued. A run's row and job are keyed by its automation, trigger
and slot, so a tick that stops before the advance leaves the slot due, and
the next tick finds the same run and the same job.

A reconcile pass MUST run at startup and periodically. It MUST enqueue a
make-up run for a trigger whose due time passed with nothing enqueued, or
whose run never finished with no live job left, and at most one make-up run
per trigger.

## 2. Rationale

The assistant writes, tests and changes automations, and people read them.
A card gives both the same tools they use for everything else in a realm:
editing, history, permissions, and a view that shows the schedule, the runs
left and the payer. A card is code as well as data, so the server reads only
the stored fields of the catalog type and never renders or runs it to learn
what it may spend.

`Automation` is a system-level card that platform code reads, as
`RealmPolicy` is, not a primitive that every realm is built from. So it lives
in the catalog beside the policy cards. The server needs only its code ref and
the stored fields its reader knows, and tests reach the catalog's one copy
through the test subset.

A run acts as its payer, who is an administrator. So whoever can change what
a run does acts with an administrator's authority. A policy grant can give
write access to many people, so a grant must not reach the definition or the
script, and only direct writers edit them. If the payer were a card field,
anyone who can write the card could make someone else pay. So the payer is
server state, set only by an administrator who switches the automation on
and so agrees to pay. The caps snapshot keeps a later edit from raising the
spend until an administrator resumes the automation and pays for it.

An incoming webhook belongs to the person who made it, and whoever holds its
signing secret can send deliveries at will. A webhook trigger that could name
anyone's webhook would let a person with no access to the realm start runs
its payer pays for. Direct writers already administer the realm and pay for
its automations, so a webhook one of them made is the realm's, and pointing a
trigger at a different webhook is the same kind of edit as a raised cap.

The status, next run and run counts are the platform's bookkeeping about an
automation, not data its script keeps between runs. A script's own state
lives in its realm.

A list of triggers covers what one cron expression can't, such as a daily
run plus an extra run on the 1st, or reacting to webhooks with a nightly
catch-up run. UTC storage with the time zone used only for the next run keeps
"daily at 05:30" right across daylight saving.

`run-command` already runs a host command in a prerender tab from a queue
job, with `runAs`, a `dedupeKey` and a `concurrencyGroup`. Every worker
manager fires every system cron, so the tick must coalesce. Holding a row's
claim while its runs are enqueued, and advancing its next run before the
claim is released, is what makes a duplicate tick find nothing due. The
queue publishes a job in a transaction of its own, and a worker must find a
run's row when it takes the job, so the run's row and job are written before
the advance rather than in its transaction; their keys make a repeat of them
harmless. The `dedupeKey` joins a duplicate
enqueue that arrives while the run is still queued or running, which
`run-command` does only for identical args. Two triggers that fire at the
same moment still start two runs, one after the other in the automation's
concurrency group. A script compares upstream data with its realm, so one
make-up run catches up on everything it missed.

## 3. Considered options

- **A card for the definition, a server row for the payer and status, runs
  as `run-command` jobs from a tick (chosen).**
- **A `.pipeline.json` file.** People and the assistant would edit JSON with
  no card view, no type and no validation on save.
- **The definition only in a server table.** It would need its own editor,
  history and permissions, and the assistant couldn't edit it like a card.
- **The payer as a card field.** Anyone who can write the card could make
  someone else pay.
- **The type in the base realm.** Base holds the card and field primitives
  that every realm is built from. `Automation` is a system card that platform
  code reads, like the policy cards, which live in the catalog.

## 4. Remediation

Known gaps are listed in [remediation/028.md](remediation/028.md).
