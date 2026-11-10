---
name: automations
description: How an automation's runs are tracked on the server — the `automation_runs` table (the run row), its states (pending, running, complete, error, canceled), which queue attempt owns a run, how a commit is claimed and recorded so a run commits at most once, and what a retried job does with a run whose commit already happened. Use when changing or calling `packages/runtime-common/automation-runs.ts`, writing the run-command task or the `Realm.handleAutomation` checks that read the run row, adding a column to `automation_runs`, or diagnosing a run that is stuck, errored with `commit-interrupted`, or committed twice.
---

# Automations

An automation is a card in a realm that names a Realm Runner script and its
triggers. Each time it fires, the platform starts a **run**: a `run-command`
job that runs the script in a warm prerender tab, stages the script's writes,
and commits them as one batch. The decisions behind this are ADR 025 (where
the script runs), ADR 026 (the run token and `Realm.handleAutomation`),
ADR 027 (staged writes and the one batch) and ADR 028 (the card and the
server row).

## The run row

Every run has one row in `automation_runs`, and that row is the source of
truth for where the run is. The worker reads it to decide whether to run the
script, the realm server checks every run-token call against it, and a cancel
works by changing it. The functions that change it are in
`packages/runtime-common/automation-runs.ts`, exported from
`@cardstack/runtime-common`.

### What a row holds

| Column                                                                         | Holds                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `automation_id`, `realm`                                                       | The automation card and its realm, as canonical identifiers (ADR 002), never served URLs                                     |
| `trigger`, `slot`                                                              | The trigger's label and the slot it fired for: the scheduled instant, a webhook delivery's id, a batch's id, or a click's id |
| `acts_as`                                                                      | The Matrix user id of the person the run acts as (ADR 026 §1.1)                                                              |
| `attempt`                                                                      | The queue attempt that owns the run                                                                                          |
| `script_id`, `script_hash`                                                     | The script file the run read, as an identifier, and the hash of the text it ran                                              |
| `state`                                                                        | `pending`, `running`, `complete`, `error` or `canceled`                                                                      |
| `error_reason`, `error_message`                                                | For an error: a code (such as `script-error`, `timed-out`, `commit-interrupted`) and its detail                              |
| `canceled_by`                                                                  | Who canceled the run                                                                                                         |
| `call_api_calls`, `call_api_response_bytes`, `resolve_calls`, `writes`         | The metered counts, added to by the realm server where it does the work, never reported by the tab                           |
| `created_at`, `started_at`, `commit_started_at`, `committed_at`, `finished_at` | When the run was enqueued, first started, claimed its commit, had its commit land, and ended                                 |

A run is unique by `(automation_id, trigger, slot)`, the same three its
`dedupeKey` names, so `createAutomationRun` called twice for one firing
returns the same row. The table is server-only and is excluded from the
SQLite schema dump (`packages/postgres/scripts/schema-dump.sh`).

### States

```
pending ──start──▶ running ──finish──▶ complete | error
   │                  │
   └─────cancel───────┴──▶ canceled   (only before the commit is claimed)
```

Each function is one conditional `UPDATE … WHERE … RETURNING`, so the check
and the change happen together and two racing processes can't both win. A
function that is refused returns `undefined` (or, for a start, a `kind` that
says why) rather than throwing.

- **`startAutomationRunAttempt(db, id, attempt)`** makes `attempt` the owner
  of a pending or running run and moves it to `running`. Taking a running run
  is how a retry takes over from an attempt that died or timed out; the old
  attempt is refused at every later step. It returns what to do next:
  - `run`: run the script.
  - `committed`: an earlier attempt's commit landed. Finish the run as
    complete without running the script.
  - `commit-interrupted`: an earlier attempt claimed the commit but never
    recorded that it landed, so nobody knows whether the batch landed. Finish
    as an error with reason `commit-interrupted`, without running the script,
    because running it again could commit twice. The next scheduled run
    compares with the realm and catches up (ADR 027 §1.1).
  - `over`: the run already finished or was canceled.
  - `missing`: no such run.
- **`recordAutomationRunScript`** records the script file and its hash. Owner
  only.
- **`claimAutomationRunCommit`** claims the run's one commit. It succeeds only
  while the run is running, owned by this attempt, and never claimed before.
  **Send the batch only after the claim returns the run**: claiming first is
  what makes a commit happen at most once (ADR 027 §1.4).
- **`recordAutomationRunCommitted`** records that the batch landed. It doesn't
  check the owner, because the batch landed whichever attempt sent it.
- **`finishAutomationRun`** ends a running run as `complete` or `error`, owner
  only. A run that claimed its commit can't finish as complete until the
  commit is recorded as landed. A Preview never claims a commit and finishes
  complete.
- **`cancelAutomationRun`** cancels a pending or running run, and records who
  canceled it. It is refused once the commit is claimed, since the writes may
  already be landing. A canceled run can't be started, claim a commit or
  finish.
- **`addAutomationRunCounts`** adds to the metered counts in any state, since
  the work they count was done either way. A negative or fractional amount
  throws.

### An attempt, start to finish

```ts
let start = await startAutomationRunAttempt(db, runId, attempt);
switch (start.kind) {
  case 'committed':
    await finishAutomationRun(db, runId, attempt, { state: 'complete' });
    return;
  case 'commit-interrupted':
    await finishAutomationRun(db, runId, attempt, {
      state: 'error',
      reason: 'commit-interrupted',
    });
    return;
  case 'over':
  case 'missing':
    return;
}
// run the script, staging its writes …
if (await claimAutomationRunCommit(db, runId, attempt)) {
  // send the batch …
  await recordAutomationRunCommitted(db, runId);
  await finishAutomationRun(db, runId, attempt, { state: 'complete' });
}
```

A claim that returns `undefined` means a retry took the run over or someone
canceled it. Discard the staged writes and stop.

### Diagnosing a run

```sql
SELECT state, attempt, error_reason, error_message, canceled_by,
       started_at, commit_started_at, committed_at, finished_at
  FROM automation_runs
 WHERE automation_id = '<automation card id>'
 ORDER BY created_at DESC LIMIT 10;
```

- `running` with an old `started_at` and no live job: the attempt died. The
  next attempt of the job takes the run over.
- `commit_started_at` set and `committed_at` null on a finished run: the
  claiming attempt stopped between the claim and the landing. Check the
  realm's files for the batch's writes to see whether it landed.
- `committed_at` set on an `error` run: the batch landed after a retry
  had already finished the run as `commit-interrupted`.

The row holds run state only. A run's log (its console lines and platform
calls) doesn't go on it.
