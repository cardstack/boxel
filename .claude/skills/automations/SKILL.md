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
  `commit-interrupted`, or committed twice. Also covers the run token a run's
  calls carry (`run-token.ts`, `mintRunToken`, `verifyRunToken`), how
  `Realm.handleAutomation` admits a call against the run row, and how to trace
  a refused run-token call or a run's `key_uses`. Also covers the run
  overlay (`run-overlay.ts`, `run_overlay_files`): how a run's writes are
  staged, how its reads and listings read through them, the `writes` cap, and
  how to inspect a run's staged files; and the commit (`/_run-commit`), its
  checks and its failure modes. Also covers how an automation run
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
  Also covers the Realm Runner automation surface a run's script runs on —
  its method list and allowlist test (`surfaces.ts`), `realm.current.automation`,
  the time limit from the `seconds` cap, progress and console lines sent to a
  progress sink with secrets redacted, and `runAutomationScript`. Use when
  adding or moving a Realm Runner method, changing what an automation script
  can call, or diagnosing a method an automation run refused.
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

| Field                  | Type                                | Notes                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script`               | `linksTo(FileDef)`                  | the Realm Runner script, in the card's realm                                                                                                                                                                                                                                                                                                    |
| `triggers`             | `containsMany(AutomationTrigger)`   | `kind` (`cron` / `once` / `webhook`), `label`, then the fields for that kind (below)                                                                                                                                                                                                                                                            |
| `operations`           | `containsMany(AutomationOperation)` | `targetType` (code ref) and `operation`: the `callApi` operations a run may call                                                                                                                                                                                                                                                                |
| `caps`                 | `contains(AutomationCaps)`          | per run `callApiCalls`, `responseBytes`, `resolveCalls`, `aiCredits` (AI spending, in credits), `writes`, `seconds` (≤ 1200); per day `dailyCredits` and per month `monthlyCredits` (daily ≤ monthly when both are set). Every run limit is required; for credits, one of the two is enough, and an empty one doesn't limit spending. 0 forbids |
| `params`               | `containsMany(AutomationParam)`     | `name` / `value` strings handed to the script at the start of each run, which reads them as `realm.current.automation.params`                                                                                                                                                                                                                   |
| `batchedAI`            | `BooleanField`                      | off unless `true`                                                                                                                                                                                                                                                                                                                               |
| `batchDeadlineMinutes` | `NumberField`                       | with `batchedAI` on, minutes a batch may take before its requests go again at the normal price; 1–1440, 60 when unset                                                                                                                                                                                                                           |

A trigger's fields by kind: `cron` reads `expression`, `timeZone`, optional `count`, and optional `untilDate` with optional `untilTime` (absent: 23:59, the end of that day) in `timeZone`; `once` reads `date`, `time` and `timeZone`; `webhook` reads `webhookPath`, one of the realm's incoming webhooks. Dates are `DateField` (`yyyy-MM-dd`); times are `StringField`s holding a wall-clock `HH:MM`.

Every view is built from Pret UI, which subset files may import, and speaks plainly: "workspace", "outside services", "AI requests" and "saves", never realm, `callApi` or `resolve`.

- **Isolated**: `PanelSection`s. The script shows read-only in a `CodeView` (from `fields/code/code.gts`, the catalog `CodeField`'s read face over Pret UI's `CodeBlock`). Each trigger is an `Item` row: an icon for its kind (a lightning bolt for a webhook), its label, its schedule in words with the raw expression as a `Token`, and the times, days or months it names as bulleted lists. Limits are two bordered `Descriptions` grids, _Each run_ and _Each month_, with a line under each value saying what it counts. Outside calls are `Item` rows, params a `KeyValue` list, and each empty group an `EmptyState`. Run milestones aren't a field: the script declares its steps as it runs with `realm.plan(steps)` and reports each with `realm.activity({...})`. The card's _Run milestones_ section is an `EmptyState` saying the steps the script reports will show there. A `Callout` says who runs it and who pays.
- **Edit**: `FormSection`s of `Field`s. The script is edited in place in a `CodeEdit` (the `CodeField`'s edit face over Pret UI's `CodeEditor`) and saved to its file with the host's `write-text-file` tool. It reloads when the file changes elsewhere, unless it holds unsaved edits. A trigger's form shows only its kind's fields: a `SegmentedControl` for the kind, a `Combobox` of IANA zones, `DatePicker`, `TimeInput` and `NumberInput` controls, and the schedule's reading under its expression.
- **Cron in words**: `describeCron(expression)` in `automation/describe-cron.ts` returns `{ summary, groups }`. A short summary ("Weekdays at 9:00 AM", "3 times a day") plus a labelled group for every list of times, days or months, so several values are listed rather than joined into a long sentence. It returns undefined for shapes it can't put plainly, and the view falls back to the expression alone. It is display only; validity and firing times are `automation-schedule.ts`'s.

The card declares `update`, `delete`, `transform` and `appendContainsMany` `nonGrantable`, as `RealmPolicy` does, so only the realm's direct writers edit an automation.

### The card's view and the status route

The views read the card's own fields for everyone, and the server's row for a direct writer:

- **Everyone** who can read the card sees the triggers in words (`describeCron` for a schedule, plus each schedule's stop: a `count`, an `untilDate`, or both), the limits, the outside services and the params.
- **A direct writer** also sees the row: a state chip (Off, On, Paused, Waiting for credits, Done), a sentence on what the state means for the next run (one per pause reason), who pays, the next run and the last result, and under each trigger its runs so far, runs left, last possible run and next run. Isolated shows all of it in a _Status_ `PanelSection` and per-trigger `Descriptions`; embedded and fitted show only the state chip. Everyone else sees the _Who turns this automation on, and who pays_ `Callout` instead.

The views get the row from `GET <realm>/_automation-status?automation=<card URL>` (`Accept: application/json`), through the host's `authed-fetch` tool, so the realm token goes with it. The realm answers on its ACL (read), then `answerAutomationStatus` in `packages/runtime-common/automation-status.ts`:

- **403** unless the caller is a direct writer of the realm (`isDirectWriter`), asked of the session the realm vouches for (`#sessionPrincipal`): a reader, a writer by the `*` or `users` row, a policy grant, a revoked session, a session delegated to another realm, and a realm-authority or diagnostic session never see the row. An anonymous caller gets 401 from the ACL on a realm only signed-in users can read, and 403 from the route on one anyone can read.
- **400** when `automation` is missing, not a URL, or outside the realm.
- **200** with `{ data: { type: 'automation-status', id, attributes } }`. `attributes` is `{ switchedOn: false }` when no row exists. Otherwise it holds `state`, `pauseReason`, `payer`, `viewerIsPayer`, `nextRun`, `lastResult`, `lastFinishedAt` and `triggers`, one per trigger the card declares, in the card's order: `label`, `runs`, and for a bounded trigger `runsLeft` (with `runsLeftAtLeast` past `REMAINING_RUNS_LIMIT`) and `until`, plus `nextRun` and `spent`. Times are ISO strings.

`payer` is the payer's Matrix id only when the viewer is the payer or `shareARealmGrant` finds a realm whose permission rows name both (ADR 011 §1.2). Otherwise it is null, and the view reads "A person who shares no workspace with you". Each trigger's next run and whether the trigger is spent come from `computeAutomationSchedule` at the realm's clock (`now()` in `clock.ts`), as the tick computes them. Runs left are counted one trigger at a time over the indexed declaration, the row's `scheduled_since` and `trigger_runs`, with no `now`, so a slot that has passed but isn't enqueued yet still counts as left. Counting stops after `RUNS_LEFT_BUDGET_MS` (250 ms) per answer; a trigger past the budget reports no `runsLeft`. When the card no longer reads as a declaration, each trigger the row has counted reports `runs` alone. The response is `no-store`. The view fetches again when the card is re-indexed, not when the row changes.

The realm loads `automation-status.ts` with a dynamic `import()` on the route's first use, so the schedule code stays out of every bundle that imports the realm. An in-browser test realm has no `automations` table. Host tests mount a virtual-network handler that answers the route (`tests/acceptance/automation-view-test.gts`).

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

The hook only logs a failure; the index pass still succeeds, and the next pass over the card syncs again. Each automation syncs on its own, so one that fails (`failed to sync automation <id> with its card`) doesn't stop the rest of the realm's. A failure before any automation syncs logs `failed to sync automations with their cards in <realm>`. A row stuck on an old schedule after an edit is worth checking against that log line and the card's index row (`has_error`, `types`).

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
| `ai_credits_spent`, `ai_credits_reserved`, `ai_reservations`                   | Credits the run's finished AI requests cost, and the worst case of those in flight (see _The AI spending cap_)                                                                                     |
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

### The run token

Every call a run makes carries the run's token (ADR 026 §1.2), minted per
attempt by `mintRunToken` (`packages/realm-server/lib/run-token.ts`) once the
attempt has started the run. It names the run (`run.id`) and the attempt
(`run.attempt`), acts as the run's `acts_as` (`user`), and expires at the run's
time limit. It carries the automation's `writes` cap (`run.writesCap`),
which bounds the files the run stages. It admits read and write in the
automation's realm (`realm`) and
read in `run.readRealms`, the base and catalog realms its cards' modules load
from. It carries no permissions; every call is checked as `acts_as`. It is
signed under `runTokenSecret(seed)`, so no ordinary session verifier accepts it
(the `realm-auth` skill).

A realm hands any request carrying a run token to `Realm.handleAutomation`,
which refuses it unless:

- the token verifies and hasn't expired (`Token expired` once the time limit
  passes);
- this realm is the token's `realm`, or one of `run.readRealms` for a read
  (a write there is 403);
- `acts_as`'s sessions weren't revoked after the token was minted;
- `automationRunForCall` finds the run `running`, owned by the token's attempt,
  in the token's realm and acting as the token's user. A cancel, a pause that
  cancels the run, its finish, or a newer attempt taking it over refuses the
  next call with `The automation run is not running`.

An admitted call takes the ACL check as `acts_as` and sets
`requestContext.automationRun` (`{ runId, attempt, automationId, actsAs,
readOnly }`). A `callApi` in it is an automation call: a binding approved for
automations fills it, and its `key_uses` row carries `mode = 'automation'` and
the run's id in `run_id`. `handleAutomation` refuses a request without a run
token, so only a run token reaches automation mode.

A realm-server route that serves run tokens verifies one with
`verifyRunToken(token, seed)`, which answers `{ runId, attempt, actsAs, realm,
readRealms, writesCap, iat, exp }` or nothing, and then checks the run's row with
`automationRunForCall` itself.

Tracing a run-token call: every refusal logs on the realm's log as
`run-token call <method> <url> refused: <why>`, naming the run and attempt.
To see what a run's calls did with keys:

```sql
SELECT created_at, operation, outcome, code, status, host, count
  FROM key_uses WHERE run_id = '<run id>' ORDER BY created_at;
```

To read a token you have in hand, decode its payload (the middle segment,
base64url) without verifying it: `run.id` and `run.attempt` name the row to
check, and `exp` is when the run's time limit passes.

### The run overlay

A run's card+source writes, and their octet-stream spelling, don't reach the
realm while it runs (ADR 027 §1.2). They are the only writes a run makes: a
run-token write (any `PUT`, `PATCH`, `POST` or `DELETE`) to a route without
`takesRunWrites` is refused with 403 before the route runs, and logged as
`run-token call <method> <url> refused: … wrote through a route that doesn't
stage its writes`. So `fs.delete`, `cards.update`, `operations.*`, `_atomic`
and the card+json writes are refused for a run until they stage (see
`docs/adr/remediation/027.md`). Each one is staged in the run's **overlay**, `run_overlay_files` in Postgres, one row per
file keyed by run, attempt and realm-local path, with the bytes inline. The
functions are in `packages/runtime-common/run-overlay.ts`. Every realm-server
instance reads the same overlay, so a run's calls can land on any of them.

What goes through it, for a run-token call in the run's own realm
(`requestContext.automationRun`, not `readOnly`):

- **Writes** (`realm.fs.writeText`, `writeBytes`, and the writes behind
  `replace` and `copy`): a card+source `POST`, or its octet-stream spelling,
  is staged with `stageRunOverlayFile` instead of written. Any file may be
  staged, card instance or not. The realm's size limit for the file's kind
  applies (the card limit for a card document, the file limit otherwise,
  checked before the body is buffered), as do the realm's reserved paths. A
  run may not stage `realm.json`, a module (`.gts`, `.ts`, `.gjs`, `.js`), the
  realm's policy card, a RealmPolicy card or an automation card, whether the
  realm holds one at the path or the run's bytes would make one (403). Modules
  are refused because the module a card's class comes from decides whether
  it's a RealmPolicy or an automation, and the type check reads modules from
  the index, which never sees a staged one. A path can't be staged as both a file and
  a directory (409). The token's `run.writesCap` bounds how many files the
  attempt stages (403 `Writes cap reached`), and `RUN_OVERLAY_MAX_BYTES`
  (100 MiB) bounds their bytes together (413). Rewriting a staged
  path replaces it and doesn't count again. The run's row is locked for the
  check, so racing writes can't pass the cap, and a write after the run
  stopped running is refused.
- **Reads** (`realm.fs.readText`, `exists`): a card+source `GET` or `HEAD` of a
  path the attempt staged answers with the staged bytes; any other path reads
  the realm as usual.
- **Listings** (`realm.fs.list`): a directory listing adds the files the
  attempt staged under it, and the directories they make, beside the realm's
  own entries. A directory only staged files make is listed for the run.

No other caller sees a staged file. Staged files aren't indexed.

An overlay is per attempt. `startAutomationRunAttempt` drops what any other
attempt staged, in the transaction that makes the new attempt the owner, so a
retry starts from an empty overlay and a replaced attempt's writes never
reach its commit. A run whose commit was already claimed keeps its files,
since the claiming attempt may still be sending them. Every way a run ends
(`finishAutomationRun`, `cancelAutomationRun`, `abandonAutomationRun`)
discards its overlay in the transaction that ends it, as a statement of its
own after the update, so it also catches a file staged while the end waited
on the run's row lock. Deleting a run row deletes its overlay
(`ON DELETE CASCADE`).

The bound on a run's overlay is `writesCap` files, each within the realm's
limit for its kind, and `RUN_OVERLAY_MAX_BYTES` together. Binary content is
stored inline rather than as a reference, since the overlay lives only as
long as its run and stays within that byte bound. A row holds a file's bytes
and nothing else, so the overlay can't record a delete. A run's deletes are
refused rather than staged.

Inspecting what a run has staged:

```sql
SELECT attempt, path, size, updated_at
  FROM run_overlay_files WHERE run_id = '<run id>' ORDER BY attempt, path;
```

A finished run has no rows. Rows from more than one attempt would mean a
start that didn't drop its predecessors' files. To read a staged file's text:
`SELECT convert_from(content, 'UTF8') FROM run_overlay_files WHERE run_id = …
AND path = …`.

### Committing the overlay

When the script finishes, the run commits its overlay with a `POST` to the
realm's `/_run-commit` (`RUN_COMMIT_PATH` in `run-overlay.ts`), carrying the
run's token and no body (ADR 027 §1.4). `Realm.commitRunOverlay` refuses
anything but the run's own call in its own realm (403 `not-a-run`); the call
was admitted as the run's identity under their current permissions. It reads
the attempt's staged files and sends them as one `commitBatch` of `rawSource`
updates, one per file. Inside the batch's write lock, before anything is
staged, its precondition:

1. re-confirms that the identity is a **direct writer** of the realm
   (`isDirectWriter`), so a person who lost direct write but keeps a policy
   or wildcard grant can't write through it (403 `not-a-direct-writer`);
2. checks the files again: no more than `run.writesCap` (403 `writes-cap`);
   none at a reserved path, `realm.json`, the policy card, a RealmPolicy card
   or an automation card (403 `forbidden-path`); none where the realm holds a
   directory, or under a path it holds as a file (409 `path-clash`). Paths
   are realm-local, so every file is in the run's realm, and the batch has no
   `callApi` entry;
3. claims the commit with `claimRunOverlayCommit`, which locks the run row,
   checks the run is running under this attempt and has never claimed one,
   and checks the overlay still holds exactly the files read (409
   `overlay-changed` when a write was staged in between). Staging refuses a
   run whose commit is claimed.

The batch then writes every file or none for any entry it refuses, under one
index pass the commit doesn't wait for. A file whose text matches the stored
file's is left alone and enqueues no indexing. Once it lands, the commit
records it (`recordAutomationRunCommitted`), adds the files committed to the
run's `writes` count (an unchanged file included), discards the overlay, and
answers `200` with `data.attributes.files`.

Failure modes, and what the caller does:

| Answer                                                    | Claim                        | What happened                                                                    | Next                                                                                             |
| --------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 403 `not-a-direct-writer`, `writes-cap`, `forbidden-path` | none                         | the identity or the overlay breaks the run's limits                              | finish the run as an error                                                                       |
| 409 `path-clash`                                          | none                         | the realm holds a file or directory in the way                                   | finish as an error; the next run compares and catches up                                         |
| 409 `overlay-changed`                                     | none                         | a write was staged while the commit started                                      | commit again                                                                                     |
| a batch refusal of an entry (4xx)                         | released                     | nothing was written                                                              | finish as an error                                                                               |
| 409 `commit-refused`                                      | earlier, unrecorded, or none | this attempt's earlier commit hasn't landed, or the run isn't under this attempt | finish as an error, or stop when another attempt owns the run                                    |
| 401                                                       | none                         | the token's run isn't running, or the token expired                              | stop                                                                                             |
| 5xx from a failure while writing                          | kept, unrecorded             | some files may have landed                                                       | finish as an error; a retry finds `commit-interrupted`, and the next run compares and catches up |
| 200 again                                                 | recorded                     | the commit landed earlier (a repeat after a lost answer)                         | finish complete                                                                                  |

A Preview never commits: it finishes complete, and the finish discards its
overlay. A run with nothing staged commits an empty batch, which claims and
records the commit and writes nothing.

### The AI spending cap

A cap on `resolve` calls holds no price, since one AI request can cost a fraction of a cent or several dollars, so the card also caps what a run's AI may cost: `caps.aiCredits`, in credits (ADR 029 §1.5). It is required like every run limit; 0 forbids AI spending. The switch-on estimate counts it in full as the most one run's AI can cost (`runCostCeiling`, the `pricing` skill), and ADR 029 §1.5 has the minimum balance count it the same way.

Before the server sends an AI request for a run, `admitAutomationRunAIRequest` (`packages/realm-server/lib/automation-ai-spending.ts`) prices its worst case and reserves it on the run row:

- **The worst case** is `aiRequestCostCeiling(body, price)` in `packages/runtime-common/automation-ai-cost.ts`: one input token per byte of the request body (no tokenizer encodes text in fewer bytes than tokens), plus `TOOL_PROMPT_ALLOWANCE_TOKENS` (1,000) when the request has `tools` for the tool-use system prompt a provider adds outside the body, at the input price, the request's `max_completion_tokens` or `max_tokens` plus any `reasoning.max_tokens` (the model's context window when it sets none, and never more than that window) at the output price, plus the per-request price. The prices are the highest of the model's base rates and each tier in its `pricing.overrides` (synced onto its `OpenRouterModel` card) the request can reach: a prompt-length tier once the input bound passes its `minPromptTokens`, and a time-of-day tier always. A provider's own output limit isn't used, since OpenRouter can route to a provider with a higher one.
- **What it refuses rather than prices**: a body that names another model or lists fallback `models` (`model-mismatch`); web search (`:online`, `plugins`, `web_search_options`) any non-text content part, and audio or image output (`modalities` beyond `text`, or `audio`), which bill in ways the body's bytes and the completion rate don't bound (`unpriced-input`); and a request with no output limit to a model with no listed context window (`unbounded-output`).
- **Media goes through the author's own key.** Boxel's AI requests carry text only, and the refusal says so. An automation that sends or receives images, audio or files declares a `callApi` operation to the AI vendor with a `{{userKey}}` slot (the `call-api` skill). The vendor bills the key's owner directly, and the run's `callApiCalls` and `responseBytes` caps bound those calls in place of `aiCredits`.
- **The price** is the model's OpenRouter listing, read from its indexed `OpenRouterModel` card with `readOpenRouterModelPrice`. The prompt and completion prices are required; a missing one, or a variable price (`-1`, as `openrouter/auto` lists), can't be read, so that model can't be priced.
- **A batched request** reserves `BATCHED_AI_RESERVE_FACTOR` (2) times its worst case, once for the batch and once for its normal-price fallback (ADR 030 §1.4).
- **The reservation** is `reserveAutomationRunAICredits`, one conditional `UPDATE`: it holds the worst case in `ai_reservations` under a new reservation id and adds it to `ai_credits_reserved`, only while the run is running and `ai_credits_spent + ai_credits_reserved` plus the worst case stays within the cap. Otherwise the request is refused (`over-cap`), so requests in flight at once can't between them pass the cap.
- **Settling** is `settleAutomationRunAIRequest` with the admission's `reservationId`: it removes the reservation, releases its credits and adds the cost the AI provider reports. A request never sent settles at 0; one whose cost can't be learned settles at its reservation, the most it could have cost. It applies in any state, since the request was paid for whether or not the run is still going. A second settle of the same reservation finds nothing and changes nothing.

Raising `aiCredits` above the automation's caps snapshot pauses it like raising any other cap, since the snapshot holds every cap in `AUTOMATION_CAP_NAMES`.

```sql
SELECT state, ai_credits_spent, ai_credits_reserved, resolve_calls
  FROM automation_runs WHERE id = '<run id>';
```

A finished run with `ai_credits_reserved` above 0 has an admitted request that was never settled; `ai_reservations` names it and what it holds.

### Declared operations and the per-run caps

The realm server holds every run-token call to the automation's declaration, which it reads from the card's live index row with `readRunDeclaration` (`packages/runtime-common/automation-run-limits.ts`), never by running the card's code. A card that isn't indexed, failed to index, or doesn't read as an automation declares nothing, so its run may call no outside service and make no AI request.

- **Declared operations.** A run's `callApi` is refused (`operation-not-declared`, 403, nothing sent and nothing counted) unless the card's `operations` names that operation on the type it was resolved on. Both sides are compared as `internalKeyFor` spells them, so a prefix-form declaration matches a URL-form type. The check comes before any key is looked for.
- **Where each count is kept.** Each is added on the run row by the realm server where it does the work, never taken from the tab:

  | Cap             | Row column                | Counted                                                                   | Where                                                            |
  | --------------- | ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | `callApiCalls`  | `call_api_calls`          | one per `callApi`, just before it is sent, so a refused call never counts | `callApiOperation`, through the request's `CallApiRunMeter`      |
  | `responseBytes` | `call_api_response_bytes` | the bytes of each response actually read                                  | `sendCallApiRequest`, where `outboundFetch` caps the response    |
  | `resolveCalls`  | `resolve_calls`           | one per AI request the run forwards, just before it is sent               | `_request-forward`, through `admitRunForward`                    |
  | `aiCredits`     | `ai_credits_spent`        | the reservation, then the generation's cost (_The AI spending cap_)       | `_request-forward`, through `admitRunForward`                    |
  | `writes`        | `writes`                  | the files the run's commit writes                                         | the run overlay's commit; the cap rides the token as `writesCap` |
  | `seconds`       | —                         | the run token's expiry                                                    | `mintRunToken`                                                   |

- **A call past a cap** is refused (`run-cap-reached`, 403, `meta.cap` naming the cap) and ends the run with `endAutomationRunAtCap`: state `error`, `error_reason = 'hit-a-cap'`, and `error_message` naming the cap. The next call is refused as `The automation run is not running`. `countAutomationRunCall` checks and counts in one conditional `UPDATE`, owner attempt only, so two calls racing for a run's last call can't both make it.
- **Response bytes** are bounded by a byte budget: what is left of `responseBytes` when the call is admitted, passed to `outboundFetch` as `responseByteBudget` beside the path's own size cap. A response the budget refuses throws `OutboundResponseTooLargeError` with `byBudget`, which ends the run. Every byte read is counted, including those read before a stream fails for any other reason. Calls in flight at once each get the same remaining budget, so with n of them the run can read up to (n − 1) times that remainder past the cap; n is bounded by the `callApiCalls` cap, since each call counts against it when it is admitted. The next call after the cap is passed is refused.
- **The forwarding path.** A run token reaches `_request-forward` past the session check (the route lets a request carrying one through), and `admitRunForward` (`packages/realm-server/lib/run-token-forward.ts`) checks it: the token verifies, its person's sessions weren't revoked, and the run is running and owned by the token's attempt. Only an unstreamed chat completion to OpenRouter is forwarded for a run, since a `resolve` is the only request a run sends there. The model's price is read from its indexed `OpenRouterModel` card (`openRouterModelPrice` in `lib/openrouter-model-price.ts`); a model with no listed price is refused (422). The request is billed to the person the run acts as. Its reservation, held for the token's attempt, is settled once however the forward ends: 0 when nothing was sent or the upstream answered with an error and no cost, the cost the credit strategy resolved, or the whole reservation when the cost couldn't be learned.

To see a run's counts against its caps:

```sql
SELECT state, error_reason, error_message,
       call_api_calls, call_api_response_bytes, resolve_calls, writes,
       ai_credits_spent, ai_credits_reserved
  FROM automation_runs WHERE id = '<run id>';
```

The caps are the card's `caps`, each held to no more than the automation's caps snapshot (`readRunLimits`): a run already going when someone raises a cap on the card keeps to what the payer agreed. A refused call logs on `automation-run-limits` (`run <id>'s callApi refused: …`, `run <id> … hit its <cap> cap and ended`) or on `request-forward` (`run-token request forward to <url> refused: …`).

## The automation surface

A run's script runs on Realm Runner's **automation surface** (ADR 025 §1.4):
the engine and method names of the assistant's interactive surface, with its
own allowlist of methods, its own time limit, no chat room, and its progress
sent to the run record. The pieces live in `packages/host/app/lib/realm-runner/`:

- `surfaces.ts`: `AUTOMATION_METHODS` and `INTERACTIVE_METHODS`, and
  `METHOD_REACH`, what each method can reach outside QuickJS;
- `automation.ts`: `automationTimeLimitMs`, the progress sink
  (`RunProgressSink`, `RunProgressEvent`) and `redactSecrets`;
- `worker.ts`: builds the guest's `realm`, `room` and `console` from the
  surface's list, so a method off the list is not defined in the script at
  all;
- `runAutomationScript` in `packages/host/app/tools/run-realm-code.ts`: runs
  one script on the surface, with the realm I/O it's given
  (`AutomationRealmIO`). `RunRealmCodeTool.automationRealmIO(realmURL)`
  builds that I/O from the tab's own realm calls, which carry the token the
  tab holds for the realm: the run's token, in an automation run.

### The method list

| Group                 | Methods                                                                               | On the automation surface                                                                    |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reads                 | `cards.search`, `cards.get`, `entries.search`, `fs.readText`, `fs.list`, `fs.exists`  | yes; `entries.search` refuses any realm but the automation's own                             |
| Writes                | `fs.writeText`, `fs.writeBytes`, `fs.replace`, `fs.copy`, `cards.update`              | yes; the realm server stages them in the run's overlay (see _The run overlay_)               |
| Operations            | `operations.invoke`, `operations.invokeBatchOperation`                                | yes; a `callApi` runs as an automation call, admitted only for operations the card declares  |
| Resolve               | `resolve`                                                                             | yes; no per-run count here, the card's `resolve` and `aiCredits` caps bound it on the server |
| Progress              | `activity`, `progress.plan`, `progress.milestone`, `progress.count`                   | yes; `progress.*` only here                                                                  |
| Console               | `console.log`, `console.info`, `console.warn`, `console.error`                        | yes; only here                                                                               |
| Downloads and deletes | `fs.download`, `fs.delete`                                                            | no                                                                                           |
| Web, images, capture  | `web.search`, `web.read`, `images.generate`, `capture`                                | no                                                                                           |
| Session and UI        | `room.*`, `ui.*`, `workspaces.*`, `index.*`, `plan`, `ask`, `operations.capabilities` | no                                                                                           |
| Transforms            | `transform`                                                                           | not yet; the interactive surface has it                                                      |

The unit test `realm-runner-surfaces-test.ts` pins `AUTOMATION_METHODS` and
fails when a method on it reaches anything but a realm read, a staged write,
an operation, the model, progress or the console. Adding a method, or moving
one between surfaces, changes that test in review. The interactive surface
is unchanged by any of this: its guest has the same `realm` and `room` as
before, and no `console` or `progress`.

How a method differs from the interactive surface:

- **`fs.writeText` writes the file whole**, whether or not it exists. The
  interactive surface only creates, and edits through `fs.replace`. A write
  of the content the file already holds is reported as unchanged.
- **No interactive per-run limits**: no 20-file, 200-card-update,
  200-operation or 3-`resolve` limit. The card's caps take their place, and
  the realm server enforces them on each call the run's token carries.
- **Progress and console are one-way**: they return nothing, so a script
  needn't await them, and an unawaited one doesn't fail the run. A bad
  argument (an empty milestone name, `count(3, 2)`) throws in the script.

For media from an AI vendor, author guidance is boxel-skills'
`api-integrations` skill, _Images from an AI vendor_: an automation's own AI
requests carry text only, and an image goes through a `callApi` with the key
of the person who switched the automation on.

### `realm.current.automation`

`AutomationRunContext` in `types.ts`, frozen in the script:

| Field            | What it holds                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `url`            | the automation card's URL                                                                       |
| `trigger`        | `{ label?, kind }`, kind one of `cron`, `once`, `webhook`, `manual` (Preview, Run now), `batch` |
| `scheduledAt`    | when the trigger was due, or when a manual run was asked for (ISO 8601)                         |
| `lastSuccessAt`  | when the automation's last complete run started, if it has had one                              |
| `params`         | the card's params with the trigger's own merged over them                                       |
| `webhookPayload` | the delivery's JSON body, for a webhook run                                                     |
| `dryRun`         | true for a Preview                                                                              |

`realm.current.url` is the realm's root, as on the interactive surface.

### The time limit

`automationTimeLimitMs(seconds)` is the card's `seconds` cap in ms, never more
than `MAX_RUN_SECONDS` (20 minutes); it takes the place of the interactive
100-second deadline. It bounds everything the script does, waiting on realm
calls included: QuickJS's interrupt stops a script that computes past it, and
the runner's own timer stops one that waits past it. Either way
`runAutomationScript` rejects with `The automation run reached its time limit
of N s (its seconds cap)`. A script error rejects with `RealmScriptError`,
which names the script's line.

### Progress and redaction

The run's progress goes to the `RunProgressSink` the caller passes, one
`RunProgressEvent` at a time, in the order the script made them: `activity`
lines, the milestone `plan`, each `milestone` reached, `count`s within one,
and `console` lines with their level and script line (a value that isn't a
string is shown as JSON, an `Error` as `Name: message`; a line past 10,000
characters is cut and says how many it lost). Each event's time is `at`.

Every text in an event passes through `redactSecrets` before the sink sees
it. It replaces with `[REDACTED]` each value the caller registers in
`secrets` (the run's own token) and every credential it recognizes by shape:
a vendor key (a prefix in `CREDENTIAL_PREFIXES`,
`packages/runtime-common/credential-prefixes.ts`, the list the realm server's
response scrubber uses too, and a key-like tail), a JWT, an
`Authorization`-style scheme's value (`Bearer [REDACTED]`), an AWS access key
id, and a PEM private key. The sink is where the run log takes these lines;
the scrubber still removes a vendor's own key from a `callApi` response
before the script sees it.

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
