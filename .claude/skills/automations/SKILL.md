---
name: automations
description: >-
  Developer guide to the automations system — realm admins' Realm Runner scripts
  that run on cron, one-time or webhook triggers. Covers how trigger timing is
  computed (cron in a time zone, daylight saving, `once`, `until` and `count`,
  per-trigger cursors and run counts, make-up runs after an outage, next run,
  *done*, runs left) in `runtime-common/automation-schedule.ts`. Also covers the
  `automations` table (the automation row): one row per switched-on automation
  holding its payer, state (active, paused with a reason, waiting for credits,
  done), caps snapshot, per-trigger run counts and next run, and the functions
  in `packages/runtime-common/automations.ts` that switch an automation on,
  pause, resume and remove it, pause it when a card edit raises a cap or turns
  on `batchedAI`, and pause it when its payer loses direct write. Also covers
  the card's index hook, which recomputes the row's next run and *done* when
  the card is indexed and removes the row when the card is deleted or stops
  being an automation, and archiving a realm, which pauses its automations.
  Use when calling or changing those functions, adding a column to
  `automations`, changing the indexer tasks or the realm archive handler, or
  diagnosing why an automation is paused, has no next run, isn't running, or
  lost its row.
  Also covers how an automation's runs are tracked on the server — the
  `automation_runs` table (the run row), its states (pending, running, complete,
  error, canceled), which queue attempt owns a run, how a commit is claimed and
  recorded so a run commits at most once, and what a retried job does with a run
  whose commit already happened. Use when working on the automations table, the
  tick, reconcile, the automation card's view, the switch-on estimate, or
  anything that asks when an automation runs next; or when changing or calling
  `packages/runtime-common/automation-runs.ts`, writing the run-command task or
  the `Realm.handleAutomation` checks that read the run row, adding a column to
  `automation_runs`, or diagnosing a run that is stuck, errored with
  `commit-interrupted`, or committed twice. Also covers how an automation run
  reaches a worker — the automation priority tier (`automationInitiatedPriority
  = 5` in runtime-common's queue.ts), the automation worker lane
  (`--automationCount` on the worker manager, `WORKER_AUTOMATION_PRIORITY_COUNT`
  in the start scripts and the dev stack), which lanes claim a run and which
  never do, and how the tier meets the prerender server's high-priority tab
  tier. Use when enqueueing the job that runs an automation (from its schedule,
  reconcile, an automation's webhook trigger, a batch follow-up, Preview or Run
  now), when a run waits in the queue longer than expected, when sizing or
  adding the automation lane in a deployment, or when changing the priority
  tiers, `lib/worker-lanes.ts` or `worker-manager.ts`.
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

## The automation card and its declaration

### The card

`Automation` is a catalog system card, like the policy cards: its only source is boxel-catalog's `automation/automation.gts`, it is in the catalog test subset (`packages/catalog/test-subset.json`), and boxel code names it by the catalog code ref `automationRef` in `packages/runtime-common/automation-declaration.ts`. Nothing about it goes in `packages/base`. Changing it is a boxel-catalog PR plus a boxel PR that pins it (the `catalog-test-subset` and `catalog-pairing` skills). Its `Spec` and a linked example (`automation/Automation/weekly-card-count`, with `automation/scripts/weekly-card-count.js`) sit beside it in the catalog; they are catalog content, not subset entries.

The server reads the card from the index as data and never runs its module, so every field it reads is a stored value, never a computed:

| Field                  | Type                                | Notes                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script`               | `linksTo(FileDef)`                  | the Realm Runner script, in the card's realm                                                                                                                                                                                                                                                             |
| `triggers`             | `containsMany(AutomationTrigger)`   | `kind` (`cron` / `once` / `webhook`), `label`, then the fields for that kind (below)                                                                                                                                                                                                                     |
| `operations`           | `containsMany(AutomationOperation)` | `targetType` (code ref) and `operation`: the `callApi` operations a run may call                                                                                                                                                                                                                         |
| `caps`                 | `contains(AutomationCaps)`          | per run `callApiCalls`, `responseBytes`, `resolveCalls`, `writes`, `seconds` (≤ 1200); per day `dailyCredits` and per month `monthlyCredits` (daily ≤ monthly when both are set). Every run limit is required; for credits, one of the two is enough, and an empty one doesn't limit spending. 0 forbids |
| `params`               | `containsMany(AutomationParam)`     | `name` / `value` strings handed to the script at the start of each run, which reads them as `realm.current.automation.params`                                                                                                                                                                            |
| `batchedAI`            | `BooleanField`                      | off unless `true`                                                                                                                                                                                                                                                                                        |
| `batchDeadlineMinutes` | `NumberField`                       | with `batchedAI` on, minutes a batch may take before its requests go again at the normal price; 1–1440, 60 when unset                                                                                                                                                                                    |

A trigger's fields by kind: `cron` reads `expression`, `timeZone`, optional `count`, and optional `untilDate` with optional `untilTime` (absent: 23:59, the end of that day) in `timeZone`; `once` reads `date`, `time` and `timeZone`; `webhook` reads `webhookPath`, one of the realm's incoming webhooks. Dates are `DateField` (`yyyy-MM-dd`); times are `StringField`s holding a wall-clock `HH:MM`.

Every view is built from Pret UI, which subset files may import, and speaks plainly: "workspace", "outside services", "AI requests" and "saves", never realm, `callApi` or `resolve`.

- **Isolated**: `PanelSection`s. The script shows read-only in a `CodeView` (from `fields/code/code.gts`, the catalog `CodeField`'s read face over Pret UI's `CodeBlock`). Each trigger is an `Item` row: an icon for its kind (a lightning bolt for a webhook), its label, its schedule in words with the raw expression as a `Token`, and the times, days or months it names as bulleted lists. Limits are two bordered `Descriptions` grids, _Each run_ and _Each month_, with a line under each value saying what it counts. Outside calls are `Item` rows, params a `KeyValue` list, and each empty group an `EmptyState`. Run milestones aren't a field: the script declares its steps as it runs with `realm.plan(steps)` and reports each with `realm.activity({...})`. The card's _Run milestones_ section is an `EmptyState` saying the steps the script reports will show there. A `Callout` says who runs it and who pays.
- **Edit**: `FormSection`s of `Field`s. The script is edited in place in a `CodeEdit` (the `CodeField`'s edit face over Pret UI's `CodeEditor`) and saved to its file with the host's `write-text-file` tool. It reloads when the file changes elsewhere, unless it holds unsaved edits. A trigger's form shows only its kind's fields: a `SegmentedControl` for the kind, a `Combobox` of IANA zones, `DatePicker`, `TimeInput` and `NumberInput` controls, and the schedule's reading under its expression.
- **Cron in words**: `describeCron(expression)` in `automation/describe-cron.ts` returns `{ summary, groups }`. A short summary ("Weekdays at 9:00 AM", "3 times a day") plus a labelled group for every list of times, days or months, so several values are listed rather than joined into a long sentence. It returns undefined for shapes it can't put plainly, and the view falls back to the expression alone. It is display only; validity and firing times are `automation-schedule.ts`'s.

The card declares `update`, `delete`, `transform` and `appendContainsMany` `nonGrantable`, as `RealmPolicy` does, so only the realm's direct writers edit an automation.

### The declaration reader

`readAutomationDeclaration(entry, { automationTypeKey, virtualNetwork? })` in `packages/runtime-common/automation-declaration.ts` turns an index row (`url`, `realmURL`, `types`, `instance`; `IndexedInstanceSource` has this shape, and `IndexedInstance` maps onto it with `canonicalURL` as `url`) into an `AutomationDeclaration`, or returns every problem it finds. It never throws for anything the card says.

- **Type.** The row's adoption chain (`types`) must include `automationTypeKey`, which is `internalKeyFor(automationRef, undefined, virtualNetwork)`: the catalog type or any type that descends from it. A local class that is merely named `Automation` is refused (`not-an-automation`).
- **Triggers** come out in `automation-schedule.ts`'s `AutomationTrigger` shape, plus `timeZone` on `once` and `webhookPath` on `webhook`, so they go straight into `computeAutomationSchedule`. `until` and `at` are UTC unix seconds, converted from the card's local date and time with `zonedDateTimeToUnixSeconds`.
- **Relative refs** (the script link, an operation's `targetType.module` starting with `./` or `../`) are joined to the card's id with `resolveRRIReference`, so they keep its form: a prefix-form id (`@cardstack/catalog/automations/a`) gives prefix-form refs. The script must be inside `realmURL`, which `RealmPaths.inRealm` decides. When the script's form can differ from `realmURL`'s, pass the `virtualNetwork`; without it a prefix-form script isn't found in a realm known by its URL. A `$REALM/` link resolves to the realm root only from a prefix-form id; from a URL-form id it is refused.

Each problem has a `code`, a `path` into the card (`triggers.0.expression`, `caps.seconds`, `script`) and a message for a person. Codes: `not-an-automation`, `not-indexed`, `missing-script`, `script-outside-realm`, `invalid-trigger-kind`, `missing-label`, `duplicate-label`, `invalid-cron`, `cron-too-frequent`, `missing-time-zone`, `invalid-time-zone`, `invalid-date-time`, `invalid-count`, `missing-webhook-path`, `invalid-operation`, `missing-cap`, `missing-credit-cap`, `invalid-cap`, `seconds-cap-too-high`, `daily-credits-above-monthly`, `invalid-param`, `invalid-batch-deadline`.

### The 5-minute minimum

A cron trigger may fire at most once every `MIN_CRON_INTERVAL_MINUTES` (5). `cronFrequencyError(expression, timeZone?)` decides it from the parsed sets rather than by sampling fire times: it takes every minute of the day the hour and minute sets name, finds the closest two distinct ones, and compares the last time of a day with the first of the next only when two consecutive days can both match (a scan of one 400-year Gregorian cycle when a day field is restricted, kept per parsed schedule). `*/5 * * * *` and `3,58 * * * *` pass; `* * * * *`, `*/2 * * * *`, `0,3 * * * *` and `58,1 0,23 * * *` are refused, while `58,1 0,23 * * MON` passes, since Monday is never followed by Monday.

With a time zone it also applies each of the zone's offset changes (found once per zone from 2020 to 2060, then cached, each with the local day it falls on) the way `computeAutomationSchedule` fires them, since a change can bring two times closer. A change applies only when the schedule fires on its day, or on the next day when its window crosses midnight: New York springs forward on a Sunday, so `1,58 2,4 * * MON` passes there and `1,58 2,4 * * SUN` is refused.

- a **wall-clock** expression's time that the clocks skip fires as far past the change as it was into the gap: in New York `1,58 2,4 * * *` fires the skipped 02:58 at 03:58, 3 minutes before 04:01, so it's refused there and passes in UTC. Two times that land on the same instant fire once, which isn't a gap. A window that crosses midnight moves a time into the next day: in Nuuk `1,58 1,23 * * *` fires the skipped 23:58 at 00:58, 3 minutes before 01:01.
- an expression that **follows elapsed time** (`followsElapsedTime`) doesn't fire the wall times the clocks skip, so the times either side of the gap are its length closer than on the wall clock: in London `0,58 */2 * * *` fires 00:58 GMT and then 02:00 BST, 2 minutes later, so it's refused there and passes in UTC.
- an expression that **follows elapsed time** fires repeated wall times twice: in Berlin `1,58 */2 * * *` fires 02:58 and then the repeated 02:01 3 minutes later.

The reader passes the trigger's time zone whenever it's valid.

## The automation row

Every switched-on automation has one row in `automations`, keyed by the card's canonical identifier (`automation_id`). The card is the definition; the row is who pays and where the automation is (ADR 028 §1.3). A card with no row is not switched on, and nothing runs it. The functions that change the row are in `packages/runtime-common/automations.ts`, imported as `@cardstack/runtime-common/automations` (it isn't re-exported from the package index, which would pull the declaration reader into every package that imports the index). The table is server-only and excluded from the SQLite schema dump.

### What a row holds

| Column                                                                   | Holds                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_id`, `realm`                                                 | The automation card and its realm, as canonical identifiers (ADR 002), the same spellings `automation_runs` uses                                                                                                                            |
| `payer`                                                                  | The Matrix user id of the direct writer who switched it on or last resumed it. Only switch-on and resume set it                                                                                                                             |
| `state`, `pause_reason`, `paused_by`                                     | `active`, `paused`, `waiting-for-credits` or `done`. A paused row has a reason, and no other row does; `paused_by` names the person, when a person paused it                                                                                |
| `caps_snapshot`                                                          | JSON: every cap in `AUTOMATION_CAP_NAMES` as the card set it, plus `batchedAI`, when the payer switched it on or resumed it                                                                                                                 |
| `trigger_runs`                                                           | JSON keyed by trigger label: `{ runs, lastSlot?, since?, timing?, live? }`, the `runState` `computeAutomationSchedule` reads (see _The cursor_), plus each trigger's `timing` and whether it was `live` when the row last followed the card |
| `scheduled_since`                                                        | When it was switched on or last resumed: the schedule's `since`. Slots at or before it never run                                                                                                                                            |
| `next_run`                                                               | The earliest next run across unspent cron and one-time triggers; null when none is left. The `automations_due_idx` partial index serves the tick's search over active and waiting-for-credits rows                                          |
| `last_enqueued_at`, `last_started_at`, `last_finished_at`, `last_result` | The most recent run: when it was enqueued, started and finished, and whether it ended `complete`, `error` or `canceled`                                                                                                                     |
| `switched_on_at`, `updated_at`                                           | When the row was made and last changed                                                                                                                                                                                                      |

### States and who changes them

| Reason a row is `paused` | Set by                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `requested`              | `pauseAutomation`: a direct writer paused it                                                                              |
| `caps-raised`            | `checkAutomationCaps`: the card, as indexed, sets a cap above the snapshot, or leaves unset a credit cap the snapshot set |
| `batched-ai-enabled`     | `checkAutomationCaps`: the card turned on `batchedAI` and the snapshot had it off                                         |
| `payer-lost-access`      | `checkAutomationPayer`: the payer is no longer a direct writer of the realm                                               |
| `realm-archived`         | `pauseRealmAutomations`: the realm was archived (`handlers/handle-archive-realm.ts`)                                      |

- **`switchOnAutomation`** makes the row for a direct writer, who becomes the payer, snapshots the caps the declaration sets, and starts the schedule now. A row whose triggers are all spent starts `done`. A second switch-on is refused (`already-switched-on`).
- **`pauseAutomation`**, **`resumeAutomation`** and **`removeAutomation`** are for a direct writer of the row's own realm. Resume works from any pause reason, makes its caller the payer, takes a new snapshot from the card as it is now, and restarts the schedule at the resume, so slots that passed while paused don't run; each trigger keeps its count. Remove deletes the row and leaves the card and script. Deleting the realm (`removeRealmDatabaseArtifacts`) deletes its rows too, so a realm later made at the same URL starts with none on. Archiving the realm pauses every automation in it that isn't paused already, with `realm-archived`, and cancels their pending runs, before the realm is marked archived (a failure in between leaves the realm visible with its automations stopped, and a retry archives it); restoring the realm leaves them paused until a direct writer resumes each one.
- **`checkAutomationCaps`** and **`checkAutomationPayer`** pause without a person. A row already paused keeps its reason, since a resume takes a new snapshot whatever paused it. A cap the snapshot doesn't limit (an unset credit cap, or a cap added to the card type after the snapshot) is never "raised"; `capsRaisedAbove` is the comparison.
- The tick, the card's index hook and the run task own `next_run`, `trigger_runs`, `waiting-for-credits`, `done` and the `last_*` columns once the row exists. The lifecycle functions set the next run and `done` only where they start a schedule. Whatever writes `trigger_runs` keeps each entry's `timing`.

### When the row is recomputed: the card's index hook

`syncAutomationsAfterIndex` (`packages/runtime-common/automation-index-hook.ts`) runs in the worker's `from-scratch-index` and `incremental-index` tasks (`tasks/indexer.ts`) once the pass has committed, so it reads the committed index. A from-scratch pass syncs every automation in the realm; an incremental pass syncs those whose card file it visited or deleted. For each, `syncAutomationWithCard` in `automations.ts` reads the card's index row (`IndexQueryEngine.getInstanceSource`) and, in one transaction holding the automation's row:

| The card as indexed                                                                                                                      | The row                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No live instance (deleted)                                                                                                               | Removed, pending run canceled with `error_reason` `card-deleted`                                                                                             |
| Doesn't adopt from the catalog `Automation` type                                                                                         | Removed, pending run canceled with `not-an-automation`                                                                                                       |
| Failed to index (or carries only an earlier visit, `failureWithheld`), or doesn't read as a declaration (an invalid cron, a missing cap) | Unchanged: the next index that reads it recomputes                                                                                                           |
| Row is paused                                                                                                                            | Unchanged, whatever paused it: a resume restarts the schedule                                                                                                |
| Raises a cap or turns on `batchedAI` (`capsRaisedAbove`)                                                                                 | Paused with `caps-raised` or `batched-ai-enabled`                                                                                                            |
| Anything else                                                                                                                            | `next_run` recomputed from the triggers and `trigger_runs` with `now`; _done_ when every trigger is spent, active again when a _done_ one has a trigger left |

Run counts are keyed by label, so editing the card keeps them. Each trigger's `timing` (kind, expression, time zone, `at`, `until`; not `count`) and `live` (on the card and unspent) are recorded at switch-on, resume and every sync. A trigger starts afresh, with `since` = now, when its timing changed, its label is new, or it wasn't live last time: re-added after being removed, or a spent trigger given a higher `count` or a later `until`. So a slot that passed before the edit, or while the trigger was gone or spent, never comes due as a make-up run; the count carries on.

`syncAutomationWithCard` takes a `readCard` callback and reads the card only once it holds the automation's row lock. Two incremental passes over one card can overlap (different writers' lanes); reading under the lock means the later sync never reads an older card than the earlier one, so the row ends on the newest card.

The hook only logs a failure (`failed to sync automations with their cards`); the index pass still succeeds, and the next pass over the card syncs again. A row stuck on an old schedule after an edit is worth checking against that log line and the card's index row (`has_error`, `types`).

Every direct-writer check is `isDirectWriterLocked`, asked inside the change's transaction against the served URL `virtualNetwork.toURL(realm)` resolves the realm to, since permission rows are keyed by served URLs. A wildcard (`*`, `users`) row, a bot account and a policy grant never make a direct writer. A refusal returns `{ ok: false, reason }` (`not-a-direct-writer`, `missing`, `outside-realm`, `other-card`, `already-switched-on`, `not-paused`, `not-pausable`) rather than throwing.

The row's `realm` is what every later check asks about, so switch-on refuses a realm that doesn't contain the automation (`outside-realm`, decided by `RealmPaths.inRealm`), and switch-on and resume refuse a declaration read from another card (`other-card`). Each change locks the person's permission row before the automation's row, in that order everywhere, so two changes never wait on each other; code that touches both, such as a realm's archive or delete, takes them in the same order.

**Pausing and removing cancel the automation's pending run** in the same transaction, so nothing it queued starts. A running run carries on. A run that a person's pause or remove canceled names them in `canceled_by`; one that `checkAutomationCaps` or `checkAutomationPayer` canceled has no `canceled_by` and carries the pause reason in `error_reason`.

### Inspecting an automation

```sql
SELECT state, pause_reason, paused_by, payer, next_run, scheduled_since,
       trigger_runs, caps_snapshot, last_result, last_finished_at
  FROM automations
 WHERE automation_id = '<automation card id>';
```

- No row: it isn't switched on, or was removed: by a person, by deleting the realm, or by the index hook when the card was deleted or stopped adopting from `Automation` (a run canceled with `card-deleted` or `not-an-automation` says which). Nothing runs it.
- `paused` with `realm-archived`: the realm was archived. Restoring it doesn't resume the automation; a direct writer does.
- `paused` with `caps-raised` or `batched-ai-enabled`: compare `caps_snapshot` with the card's `caps` and `batchedAI`. A direct writer resumes it to agree to the new caps and pay for them.
- `paused` with `payer-lost-access`: the payer's own permission row no longer grants write. Another direct writer resumes it and becomes the payer.
- `active` with a null `next_run`: only webhook triggers, or none left that the schedule can place.
- A run canceled with no `canceled_by`: an automatic pause canceled it; its `error_reason` names which.

## The run row

Every run has one row in `automation_runs`, and that row is the source of
truth for where the run is. Its contract with the code around it: the worker
must start each attempt through the row and do what the start says, the realm
server must check every run-token call against the row (ADR 026 §1.3), and a
cancel works by changing it. The functions that change it are in
`packages/runtime-common/automation-runs.ts`, exported from
`@cardstack/runtime-common`.

### What a row holds

| Column                                                                         | Holds                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_id`, `realm`                                                       | The automation card and its realm, as canonical identifiers (ADR 002), never served URLs                                                                                                           |
| `trigger`, `slot`                                                              | The trigger's label and the slot it fired for: the scheduled instant, a webhook delivery's id, a batch's id, or a click's id                                                                       |
| `acts_as`                                                                      | The Matrix user id of the person the run acts as (ADR 026 §1.1)                                                                                                                                    |
| `attempt`                                                                      | The queue attempt that owns the run: the job's reservation id, which grows with each reservation                                                                                                   |
| `script_id`, `script_hash`                                                     | The script file the run read, as an identifier, and the hash of the text it ran                                                                                                                    |
| `state`                                                                        | `pending`, `running`, `complete`, `error` or `canceled`                                                                                                                                            |
| `error_reason`, `error_message`                                                | For an error: a code (such as `script-error`, `timed-out`, `commit-interrupted`) and its detail. A run canceled by a pause no person asked for carries that pause's reason (such as `caps-raised`) |
| `canceled_by`                                                                  | Who canceled the run, when a person did; null when an automatic pause canceled it                                                                                                                  |
| `call_api_calls`, `call_api_response_bytes`, `resolve_calls`, `writes`         | The metered counts, which the realm server must add to where it does the work, never taking them from the tab                                                                                      |
| `created_at`, `started_at`, `commit_started_at`, `committed_at`, `finished_at` | When the run was enqueued, first started (a retry keeps it), claimed its commit, had its commit land, and ended                                                                                    |

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
- **`cancelPendingAutomationRuns(querier, automationId, by)`** cancels every pending run of an automation inside the caller's transaction, as pausing and removing it do. It leaves a running run to finish.
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

## The queue tier and worker lane

### The automation tier

A queued job's priority is a claim floor, not an ordering. A worker claims only jobs at or above its floor, oldest first among those. The tiers, from the comment block in `packages/runtime-common/queue.ts`:

| priority | constant                               | job                                |
| -------- | -------------------------------------- | ---------------------------------- |
| 10       | `userInitiatedPriority`                | user indexing (+ any user job)     |
| 9        | `userInitiatedPrerenderHtmlPriority`   | user prerender-html                |
| 5        | `automationInitiatedPriority`          | the job that runs an automation    |
| 1        | `systemInitiatedPriority`              | system indexing (+ any system job) |
| 0        | `systemInitiatedPrerenderHtmlPriority` | system prerender-html              |

The run-command job that runs an automation goes at `automationInitiatedPriority`, whatever started the run: its schedule, reconcile, one of its webhook triggers, a batch follow-up, Preview, or Run now. Import the constant from `@cardstack/runtime-common`. Don't write the number. The constant's importers are the complete list of what enqueues at the tier: when a run seems to wait at the wrong priority, `git grep -n automationInitiatedPriority -- packages` shows which entry points enqueue at it and which do not. A webhook command that is not an automation (`handlers/handle-webhook-receiver.ts`) is ordinary user work and enqueues at `userInitiatedPriority`.

The tier is for that job alone. Never enqueue index or prerender-html work at it. The indexing a run's writes cause takes whatever tier the realm's write path gives it. Two helpers place anything below 9 in the system tier: `isUserInitiatedTier` in `pg-queue.ts` decides how a writer lane waits on its family's exclusive jobs, and `prerenderHtmlPriority` in `jobs/prerender-html.ts` picks an index pass's HTML render tier. So an index pass at 5 would wait behind a system-tier full reindex in its family, and its HTML renders would drop to 0. The run-command job itself is outside both: it runs in its realm's `command:` concurrency group, which belongs to no lane family.

The tier sits above the system tiers so a run due at a set time is not queued behind a system backlog such as a full reindex. It sits below the user tiers so a run never takes a high-priority worker held for someone who is waiting.

### The lanes

The worker manager starts one worker per count in each lane. The list lives in `packages/realm-server/lib/worker-lanes.ts` (`workerSpecs`):

| lane          | option                | start-script variable              | floor | claims                                      |
| ------------- | --------------------- | ---------------------------------- | ----- | ------------------------------------------- |
| user-index    | `--userIndexCount`    | (none)                             | 10    | user-tier indexing job types only           |
| high-priority | `--highPriorityCount` | `WORKER_HIGH_PRIORITY_COUNT`       | 9     | all user-initiated work                     |
| automation    | `--automationCount`   | `WORKER_AUTOMATION_PRIORITY_COUNT` | 5     | automation runs and all user-initiated work |
| all-priority  | `--allPriorityCount`  | `WORKER_ALL_PRIORITY_COUNT`        | 0     | everything                                  |

The automation lane defaults to 0 workers. With it at 0 an automation run is claimed only by the all-priority lane, in FIFO order with the system work there, so a deployment without the lane still runs every automation, just not ahead of a system backlog. When no run is due the automation lane's workers take user-initiated jobs. They never take system-tier work.

The tests that pin these claims are the `queue - automation lane`, `queue - automation runs without an automation lane` and `queue - automation lane and system-tier work` modules in `packages/realm-server/tests/queue-test.ts`, and `tests/worker-lanes-test.ts` for the lane list itself.

### Sizing the lane

- **Worker task memory.** The worker manager divides its task's memory across every worker it starts, automation workers included (`workerHeapLimitMb` in `lib/worker-heap-limit.ts`). Each automation worker added shrinks every other worker's heap in that task.
- **Prerender tabs.** An automation run is a run-command job, which runs its command in a prerender tab at its job priority. Each worker that can claim a run is one more tab the prerender servers may have to hold at once. See the `prerender-sizing` skill before raising the count.

### The prerender high-priority tier

The prerender server's page pool reserves headroom past `PRERENDER_PAGE_POOL_MAX`, up to `PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX`, for renders whose priority is at least `PRERENDER_HIGH_PRIORITY_THRESHOLD`. An automation run does not count as high priority there: the headroom is for a user who is waiting. That holds only while the threshold is above 5, so set it to `userInitiatedPrerenderHtmlPriority` (9). A threshold of 5 or less admits automation runs to the reserved headroom.
