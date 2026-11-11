---
name: automations
description: Developer guide to the automations system — realm admins' Realm Runner scripts that run on cron, one-time or webhook triggers. Covers how trigger timing is computed (cron in a time zone, daylight saving, `once`, `until` and `count`, per-trigger cursors and run counts, make-up runs after an outage, next run, *done*, runs left) in `runtime-common/automation-schedule.ts`. Also covers how an automation's runs are tracked on the server — the `automation_runs` table (the run row), its states (pending, running, complete, error, canceled), which queue attempt owns a run, how a commit is claimed and recorded so a run commits at most once, and what a retried job does with a run whose commit already happened. Use when working on the automations table, the tick, reconcile, the automation card's view, the switch-on estimate, or anything that asks when an automation runs next; or when changing or calling `packages/runtime-common/automation-runs.ts`, writing the run-command task or the `Realm.handleAutomation` checks that read the run row, adding a column to `automation_runs`, or diagnosing a run that is stuck, errored with `commit-interrupted`, or committed twice.
---

# Automations

An automation is a card in a realm that names a Realm Runner script, its triggers, and what the script may do. A direct writer switches it on and becomes its payer; the server keeps one row per switched-on automation with its payer, state, next run and per-trigger run counts. The card is the definition; the row is the state.

Each time an automation fires, the platform starts a **run**: a `run-command`
job that runs the script in a warm prerender tab, stages the script's writes,
and commits them as one batch. The decisions behind this are ADR 025 (where
the script runs), ADR 026 (the run token and `Realm.handleAutomation`),
ADR 027 (staged writes and the one batch) and ADR 028 (the card and the
server row).

## Trigger timing

`packages/runtime-common/automation-schedule.ts` answers, for an automation's triggers and its per-trigger run state, when it runs next and which triggers are spent. It is pure (no I/O, and it knows the time only through the `now` you pass) and depends only on `Intl`, so the realm server, the worker and the host (the card's view) share it.

### Units

Every instant in and out is **UTC unix seconds**. A trigger's time zone is used only to work out which instants its cron expression names. A card's `once` date, time and time zone become unix seconds through `zonedDateTimeToUnixSeconds('2026-11-09T15:00', 'America/Chicago')`; a cron trigger's `until` goes through the same function in the trigger's zone. Run slots stored as ISO text (the runs table's `slot`) convert with `Date.parse(slot) / 1000`.

### Triggers

| Kind      | Fields                                              | Spent when                                             |
| --------- | --------------------------------------------------- | ------------------------------------------------------ |
| `cron`    | `expression`, `timeZone`, optional `until`, `count` | `count` runs started, or its next time is past `until` |
| `once`    | `at`                                                | `at` is at or before the trigger's cursor              |
| `webhook` | —                                                   | never                                                  |

`until` is inclusive: a time exactly at `until` still fires. With both `until` and `count`, the trigger is spent at whichever comes first.

Every trigger has a **label**, unique within its automation (ADR 028). Run counts, `runState` and run `dedupeKey`s are keyed by it, so editing a trigger's expression, time zone or bounds keeps its count, and a renamed label starts a new one. The counts themselves live on the automation's server row, advanced in the tick's enqueue transaction (ADR 028 §1.5); the library only reads them.

### The cursor

`computeAutomationSchedule({ triggers, since, now, runState, includeRemainingRuns })` schedules each trigger strictly after its own **cursor**, the latest of:

- `since`: when the automation was switched on or resumed;
- `runState[label].lastSlot`: the last slot handled for the trigger, **whether it started a run or joined one already pending**. A skipped slot must still advance it, or every tick claims the same slot again;
- `runState[label].since`: when the trigger's timing (expression, time zone, `at`, `until`) last changed. Set it on an edit, so changing "daily at 09:00" to "daily at 08:00" at 08:30 doesn't fire at once for today's 08:00.

The cursor, not the current time, decides what is due, so a slot that came due but hasn't been enqueued yet stays due however late the next recompute happens. A `once` trigger is spent once its `at` is behind the cursor: it ran (its slot became `lastSlot`), or it was set before the automation was switched on or the trigger was edited. Editing a spent `once` to a later time re-arms it.

`runState[label].runs` counts runs the trigger **started**. A slot that joined a run already pending isn't counted.

### Make-up runs

Pass `now` from the tick and reconcile. When a cron trigger's next slot after its cursor is already at or before `now`, every slot that passed collapses into **one make-up run at the latest of them** (never past `until`), so an outage costs at most one late run per trigger (ADR 028 §1.5). The make-up run counts as one run against `count`. Without `now`, every slot after the cursor comes due in turn, which is right for the card's view and wrong for the tick.

### What it returns

- `nextRun`: the earliest next time across unspent `cron` and `once` triggers, or absent when none is left. At or before `now` means due now.
- `dueTriggers`: the label of every trigger that fires at `nextRun`. Two triggers at the same instant each start a run.
- `done`: every trigger is spent. An automation with a `webhook` trigger is never done, nor is one with a trigger in error; one with no triggers is.
- per trigger: `spent`, `nextRun`, `until`, and `error` when its expression or time zone is invalid (that trigger is skipped, the rest are scheduled).
- with `includeRemainingRuns`, `remainingRuns` for bounded triggers (`once`, or `cron` with `until` or `count`), the next run included: `count − runs`, or the times from the next run to `until`, whichever is smaller. It stops at `REMAINING_RUNS_LIMIT` (10,000) runs or 100 years ahead and then sets `remainingRunsAtLeast`. The card's view shows it as runs left, and the switch-on estimate adds it up; the index recompute and the tick leave it off, since counting scans up to `until`.

### Cron expressions

Five fields (minute, hour, day of month, month, day of week) with `*`, lists, ranges, steps (`*/15`, `1-30/5`, `10/20`), month and day names, `7` for Sunday (and Sunday ending a range counts as 7, so `FRI-SUN` works), and the macros `@hourly`, `@daily`/`@midnight`, `@weekly`, `@monthly`, `@yearly`/`@annually`. No seconds field, no `?`, `L`, `W` or `#`. When both day fields are restricted (neither starts with `*`) a day matches if **either** does, as in Vixie cron: `0 0 13 * FRI` is every Friday and every 13th. A day field starting with `*` is unrestricted even with a step, so `0 0 */31 2 1` means Feb 1 when it is a Monday. An expression that matches no day in a 400-year Gregorian cycle (`0 0 30 2 *`) is an error, because it never fires; any other expression fires within 400 years of any instant, though some only every few decades (`0 0 29 2 */7`, Feb 29 on a Sunday).

`parseCronExpression` throws `CronExpressionError`; `cronExpressionError` returns the message or `undefined`, for validators that report rather than throw. Both results, valid or not, are cached per expression. `isValidTimeZone` checks an IANA name; the runtime's ICU data decides which names exist, so the browser and Node can disagree, and `computeAutomationSchedule` reports such a trigger's `error` rather than throwing.

`nextCronTime`, `nextCronTimes`, `lastCronTime` and `countCronTimes` are the primitives underneath, for the estimate's frequency of unbounded triggers and anything else that needs raw times.

### Daylight saving

- **Wall-clock** expressions (neither the minute nor the hour field starts with `*`) name a time of day, so "daily at 05:30" stays at 05:30 local time all year. A time the clocks skip fires as far past the change as it was into the gap (02:30 in a 02:00→03:00 change fires at 03:30). A time that happens twice fires once, at the first.
- **Elapsed-time** expressions (the minute or the hour field starts with `*`, as Vixie cron splits them) follow elapsed time. Wall times inside a skipped hour don't happen; wall times in a repeated hour fire twice. An hourly trigger gets 23 runs on the spring-forward day and 25 on the fall-back day, and `*/15 1 * * *` fires 8 times on the fall-back day.

A gap can end at midnight (America/Nuuk springs forward from 23:00 straight to 00:00), so a skipped time late on one local day can land on the next. The scans look one day either side for that, and counting never counts one instant twice.

### Cost

Each call scans local days with one `Intl` offset lookup per matching day (about 14 µs each). `nextCronTime` stops at the first day with a time. Counting runs left is the expensive part, which is why it is opt-in and bounded: the worst case, a daily trigger whose `until` is more than 27 years out, stops at 10,000 runs after about 200 ms. Parsing an expression that matches rarely scans up to a 400-year cycle of days once, and the result is cached.

## The run row

Every run has one row in `automation_runs`, and that row is the source of
truth for where the run is. Its contract with the code around it: the worker
must start each attempt through the row and do what the start says, the realm
server must check every run-token call against the row (ADR 026 §1.3), and a
cancel works by changing it. The functions that change it are in
`packages/runtime-common/automation-runs.ts`, exported from
`@cardstack/runtime-common`.

### What a row holds

| Column                                                                         | Holds                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `automation_id`, `realm`                                                       | The automation card and its realm, as canonical identifiers (ADR 002), never served URLs                                     |
| `trigger`, `slot`                                                              | The trigger's label and the slot it fired for: the scheduled instant, a webhook delivery's id, a batch's id, or a click's id |
| `acts_as`                                                                      | The Matrix user id of the person the run acts as (ADR 026 §1.1)                                                              |
| `attempt`                                                                      | The queue attempt that owns the run: the job's reservation id, which grows with each reservation                             |
| `script_id`, `script_hash`                                                     | The script file the run read, as an identifier, and the hash of the text it ran                                              |
| `state`                                                                        | `pending`, `running`, `complete`, `error` or `canceled`                                                                      |
| `error_reason`, `error_message`                                                | For an error: a code (such as `script-error`, `timed-out`, `commit-interrupted`) and its detail                              |
| `canceled_by`                                                                  | Who canceled the run                                                                                                         |
| `call_api_calls`, `call_api_response_bytes`, `resolve_calls`, `writes`         | The metered counts, which the realm server must add to where it does the work, never taking them from the tab                |
| `created_at`, `started_at`, `commit_started_at`, `committed_at`, `finished_at` | When the run was enqueued, first started (a retry keeps it), claimed its commit, had its commit land, and ended              |

A run is unique by `(automation_id, trigger, slot)`, the same three its
`dedupeKey` names, so `createAutomationRun` called twice for one firing
returns the same row. The table is server-only and is excluded from the
SQLite schema dump (`packages/postgres/scripts/schema-dump.sh`).

### States

```
pending ──start──▶ running ──finish──▶ complete | error
   │                  │  └──abandon──▶ complete | error
   └─────cancel───────┴──▶ canceled   (only before the commit is claimed)
```

Each function is one conditional `UPDATE … WHERE … RETURNING`, so the check
and the change happen together and two racing processes can't both win. A
function that is refused returns `undefined` (or, for a start, a `kind` that
says why) rather than throwing.

- **`startAutomationRunAttempt(db, id, attempt)`** makes `attempt` the owner
  of a pending or running run and moves it to `running`. Taking a running run
  is how a retry takes over from an attempt that died or timed out. Only an
  attempt at least as new as the owner can take it, so the old attempt is
  refused at every later step, its own late start included. It returns what to
  do next:
  - `run`: run the script.
  - `committed`: an earlier attempt's commit landed. Finish the run as
    complete without running the script.
  - `commit-interrupted`: an earlier attempt claimed the commit but never
    recorded that it landed, so nobody knows whether the batch landed. Finish
    as an error with reason `commit-interrupted`, without running the script,
    because running it again could commit twice. The next scheduled run
    compares with the realm and catches up (ADR 027 §1.1). If the batch lands
    after all, recording it makes the run complete.
  - `superseded`: a newer attempt owns the run. Stop without touching it.
  - `over`: the run already finished or was canceled.
  - `missing`: no such run.
- **`recordAutomationRunScript`** records the script file and its hash. Owner
  only.
- **`claimAutomationRunCommit`** claims the run's one commit. It succeeds only
  while the run is running, owned by this attempt, and never claimed before.
  **Send the batch only after the claim returns the run**: claiming first is
  what makes a commit happen at most once (ADR 027 §1.4).
- **`recordAutomationRunCommitted`** records that the batch landed. It doesn't
  check the owner, because the batch landed whichever attempt sent it. A batch
  can land after its run finished as an error (a retry found the commit
  interrupted, or the reconcile pass abandoned the run). Recording it then
  moves the run to `complete` and clears the error, so a run whose commit
  landed never reads as an error.
- **`finishAutomationRun`** ends a running run as `complete` or `error`, owner
  only. A run that claimed its commit can't finish as complete until the
  commit is recorded as landed, and a run whose commit landed can't finish as
  an error. A Preview never claims a commit and finishes complete.
- **`abandonAutomationRun(db, id, reason)`** closes a pending or running run
  whose job is gone, whoever owned it: the queue gives up on a job after its
  last reservation, and no attempt is left to finish the run. This is for the
  reconcile pass (ADR 028 §1.5). A run whose commit landed finishes complete;
  any other finishes as an error with `reason`.
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
  case 'superseded':
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

- `running` with no live job: the attempt died. If the job has a reservation
  left, its next attempt takes the run over. If not, the run stays `running`
  until the reconcile pass closes it with `abandonAutomationRun`. `started_at`
  is the first attempt's start, so an old one alone says only that the run was
  retried.
- `commit_started_at` set and `committed_at` null on a finished run: the
  claiming attempt stopped between the claim and the landing. Check the
  realm's files for the batch's writes to see whether it landed.
- `complete` with `committed_at` later than `finished_at`: the batch landed
  after a retry or the reconcile pass had closed the run as an error, and
  recording the landing made it complete.

The row holds run state only. A run's log (its console lines and platform
calls) doesn't go on it.
