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
  on `batchedAI`, pause it when its payer loses direct write, and pause it
  after its own runs fail several times in a row (`repeated-failures`), with
  how to read why. Also covers
  the card's index hook, which recomputes the row's next run and *done* when
  the card is indexed and removes the row when the card is deleted or stops
  being an automation, and archiving a realm, which pauses its automations.
  Also covers the tick (`runtime-common/automation-tick.ts`), the
  every-minute `automation-tick` job that claims due rows, starts a run per due
  trigger or joins a pending one (*skipped*), and advances the row, with how to
  see what it enqueued and why a due run didn't start.
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
  `commit-interrupted`, or committed twice. Also covers canceling a run
  (`cancelAutomationRunFor`, for a direct writer) and pausing or removing an
  automation while its run runs: what each leaves behind on the run row, the
  overlay and the log, and how the run's tab learns of it (`/_run-state`,
  `RunStateWatch`) and stops the QuickJS worker. Also covers the run token a run's
  calls carry (`run-token.ts`, `mintRunToken`, `verifyRunToken`), how
  `Realm.handleAutomation` admits a call against the run row, and how to trace
  a refused run-token call or a run's `key_uses`. Also covers the run
  overlay (`run-overlay.ts`, `run_overlay_files`): how a run's writes are
  staged (file writes, `_atomic` and write operations in `_operations`), how
  its reads, listings, card reads and searches read through them, the search
  limit and how scripts work around it, the `writes` cap, and
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
  Also covers the automation command that runs one attempt of a run
  (`AUTOMATION_COMMAND`, `runAutomationAttempt` in
  `runtime-common/tasks/run-automation.ts`, `enqueueAutomationRunJob`, the
  host's `run-automation` tool): the run's job and its timeout, the run's own
  prerender affinity and warm tab, the run token as the tab's only session,
  handed to the tab in memory rather than in `localStorage`, the commit or the recorded error, and how to run one automation by hand in
  development (`pnpm run-automation`) and read its outcome.
  Also covers Preview and Run now (`automation-manual-runs.ts`):
  `startAutomationPreview` and `startAutomationRunNow`, which start a run at
  once for a direct writer, acting as and charged to whoever clicked, the
  batch a finished Preview keeps, `readAutomationRunReport` (a run's state,
  log, timings, cost, and the files it staged or saved), and how to compare
  a Preview with a Run now.
  Also covers the realm-server routes a direct writer drives an automation
  with (`handlers/handle-automations.ts`, paths in
  `runtime-common/automation-routes.ts`): the switch-on estimate, switch-on
  with the monthly credit cap it agrees to, Preview, Run now, pause, resume,
  remove, cancel a run and read a run's log, their bodies, refusals and
  status codes, and how to call them by hand in development.
  Also covers a run's log — `automation_run_log`, `appendRunLog` and
  `readRunLog` in `automation-run-log.ts`, the `/_run-log` route and the
  host's `RunLogSink`, the platform's `callApi`, `resolve`, commit and cap
  lines, redaction, the per-run size cap, the `[automation-run-log]` lines
  in Loki, and how the console reads a log: `GET /_automation-run-log`,
  paged and filtered by level, and `followAutomationRunLog`, which polls a
  running run's log. Use when reading a run's log in Postgres or Loki, adding
  a line the platform logs for a run, showing a run's log in the app, or
  diagnosing a run whose log is missing lines.
  Also covers a run's admission (`automation-admission.ts`): the checks the
  worker makes before a run costs anything (the automation's row, the run's
  identity's direct write, revoked sessions and Matrix account, the script,
  every declared operation, which the realm checks through
  `automationAdmission` at `/_run-admission`, and the spending hook), each
  refusal code and what fixes it, and the `admission` log line and
  `admitted_at`. Use when a run ended with one of those codes, or when
  changing what admission checks.
  Also covers the `job` realm event (`automation-run-events.ts`,
  `Realm.broadcastJobEvent`): what it carries, that it reaches only the
  realm's direct writers' session rooms, which code reports a run's change,
  and how to watch it from the host or a card. Use when a console or card
  should follow a run live, when adding code that moves a run, or when a
  direct writer isn't seeing a run's events.
  Also covers the automations console, the realm config's Automations
  section (`packages/base/realm-automations.gts`): each automation as the
  Automation card's fitted view, New automation through the stack's
  `createCard`, and the realm's `_automations` list route
  (`automation-list.ts`) it reads, with each automation's state, triggers,
  next run, payer, monthly cap, spend this month, last result and current
  run milestone.
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

A trigger's fields by kind: `cron` reads `expression`, `timeZone`, optional `count`, and optional `untilDate` with optional `untilTime` (absent: 23:59, the end of that day) in `timeZone`; `once` reads `date`, `time` and `timeZone`; `webhook` reads `webhookPath`, one of the incoming webhooks the realm can use (_Which webhooks a realm can use_, below). Dates are `DateField` (`yyyy-MM-dd`); times are `StringField`s holding a wall-clock `HH:MM`.

Every view is built from Pret UI, which subset files may import, and speaks plainly: "workspace", "outside services", "AI requests" and "saves", never realm, `callApi` or `resolve`.

- **Isolated**: `PanelSection`s. The script shows read-only in a `CodeView` (from `fields/code/code.gts`, the catalog `CodeField`'s read face over Pret UI's `CodeBlock`). Each trigger is an `Item` row: an icon for its kind (a lightning bolt for a webhook), its label, its schedule in words with the raw expression as a `Token`, and the times, days or months it names as bulleted lists. Limits are two bordered `Descriptions` grids, _Each run_ and _Each month_, with a line under each value saying what it counts. Outside calls are `Item` rows, params a `KeyValue` list, and each empty group an `EmptyState`. Run milestones aren't a field: the script declares them with `realm.progress.plan([...])` and marks each with `realm.progress.milestone(name)` as it reaches it (_Run milestones_, below). For a direct writer, the card's _Run milestones_ section lists the milestones of the run in progress (`currentRun`), or else of the last run (`lastRun`), as a Pret UI `Timeline` whose rail joins them: each one's time and last count, and a marker shaded by state, gray before a milestone runs, yellow while it runs, green once it is done, red where the run ended with an error, and a pause where Boxel stopped the run. The plan's milestones the run hasn't started stay gray after it, marked _Not started_. Without a last run to list, and for everyone else, the section lists the milestones the script declares, each _Not started_. The card reads them from the script's text: the first `realm.progress.plan([...])` whose array holds only string literals (`declaredMilestones`). A plan built at run time shows nothing until a run reports one, and the section shows an `EmptyState`. A `Callout` says who runs it and who pays.
- **Edit**: `FormSection`s of `Field`s. The script is edited in place in a `CodeEdit` (the `CodeField`'s edit face over Pret UI's `CodeEditor`) and saved to its file with the host's `write-text-file` tool. It reloads when the file changes elsewhere, unless it holds unsaved edits. A trigger's form shows only its kind's fields: a `SegmentedControl` for the kind, a `Combobox` of IANA zones, `DatePicker`, `TimeInput` and `NumberInput` controls, and the schedule's reading under its expression. The schedule's expression is checked as the author types with `cronTriggerProblem` in the trigger's time zone, the rule the server reads the declaration with (_The 5-minute minimum_), so the editor shows the server's own message and accepts exactly what the server accepts.
- **Webhook triggers**: the edit view picks the webhook from the realm's `_automation-webhooks` list in a Pret UI `Select`, each choice showing who made it. A path the card holds that the list lacks stays a choice, marked as not one of the workspace's webhooks, with a problem under the field. Without the list (no tools, as in a prerender, a failed request, or an answer that the viewer isn't a direct writer) the field takes a typed path. While the server reports `webhookDeliveriesStartRuns: false` (the status route's attributes in the isolated view, the webhook list's `meta` in the editor), each webhook trigger warns "This trigger can’t fire, Boxel doesn’t run automations from webhooks." A server that reports true, or nothing, gets no warning.
- **Cron in words**: `describeCron(expression)` in `automation/describe-cron.ts` returns `{ summary, groups }`. A short summary ("Weekdays at 9:00 AM", "3 times a day") plus a labelled group for every list of times, days or months, so several values are listed rather than joined into a long sentence. It returns undefined for shapes it can't put plainly, and the view falls back to the expression alone. It is display only; validity and firing times are `automation-schedule.ts`'s.

The card declares `update`, `delete`, `transform` and `appendContainsMany` `nonGrantable`, as `RealmPolicy` does, so only the realm's direct writers edit an automation.

### The card's view and the status route

The views read the card's own fields for everyone, and the server's row for a direct writer:

- **Everyone** who can read the card sees the triggers in words (`describeCron` for a schedule, plus each schedule's stop: a `count`, an `untilDate`, or both), the limits, the outside services and the params.
- **A direct writer** also sees the row: a state chip (Off, On, Paused, Waiting for credits, Done), a sentence on what the state means for the next run (one per pause reason), who pays, the next run and the last result, and under each trigger its runs so far, runs left, last possible run and next run. Isolated shows all of it in a _Status_ `PanelSection` and per-trigger `Descriptions`; embedded and fitted show only the state chip. Everyone else sees the _Who turns this automation on, and who pays_ `Callout` instead.

The views get the row from `GET <realm>/_automation-status?automation=<card URL>` (`Accept: application/json`), through the host's `authed-fetch` tool, so the realm token goes with it. The realm answers on its ACL (read), then `answerAutomationStatus` in `packages/runtime-common/automation-status.ts`:

- **200** with `{ data: null, meta: { directWriter: false } }` unless the caller is a direct writer of the realm (`isDirectWriter`), asked of the session the realm vouches for (`#sessionPrincipal`): a reader, a writer by the `*` or `users` row, a revoked session, a session delegated to another realm, an anonymous caller on a realm anyone can read, and a realm-authority or diagnostic session never see the row. The answer isn't a 403, so the card's own read never counts as an auth failure: the host's `authErrorEventMiddleware` sends a `boxel-auth-error` event for any 401 or 403 that comes back through `authedFetch`, and an auth-error guard that listens fails whatever it is rendering or loading at the time. The listeners are the prerender routes, where the card has no tools and asks nothing, and the in-page indexer (`CardPrerender`) the host's tests mount, where a refusal fails the next card module the realm indexes. A person's browser has no listener, so there a refusal does no harm beyond the event. The card reads `meta.directWriter: false` as "show the card's own fields alone". The ACL's own refusals stay: the route is `ACL_ONLY`, so an anonymous caller gets 401 on a realm only signed-in users can read, and a caller only a policy grant admits gets the ACL's 401 or 403 (a grant reaches a card, not the row).
- **400** when `automation` is missing, not a URL, or outside the realm, asked only for a direct writer.
- **200** with `{ data: { type: 'automation-status', id, attributes }, meta: { directWriter: true } }` for a direct writer. `attributes` is `{ switchedOn: false }` when no row exists. Otherwise it holds `state`, `pauseReason`, `payer`, `viewerIsPayer`, `nextRun`, `lastResult`, `lastFinishedAt`, `failuresInARow` and `lastFailure` (the failure streak and its latest run's id, `reason`, `message` and `finishedAt`, or null; see _Pausing after repeated failures_), `pauseProblems` (what the declaration reader found, each `{ code, path, message }`, when `pauseReason` is `invalid-declaration`, else null), and `triggers`, one per trigger the card declares, in the card's order: `label`, `runs`, and for a bounded trigger `runsLeft` (with `runsLeftAtLeast` past `REMAINING_RUNS_LIMIT`) and `until`, plus `nextRun` and `spent`. Times are ISO strings.

Both shapes carry `webhookDeliveriesStartRuns` (`WEBHOOK_DELIVERIES_START_RUNS`, _Which webhooks a realm can use_), which the card reads to warn under each webhook trigger. Both shapes carry `lastRun`, the automation's last run that started and has ended (`readLastRunMilestones`), and `currentRun`, its run in progress (`readCurrentRunMilestones`), each with its milestones (_Run milestones_) or null. A Preview is a test of the script, so neither is ever one. A run can start and end before switch-on (a Run now), so neither depends on the row.

`payer` is the payer's Matrix id only when the viewer is the payer or `shareARealmGrant` finds a realm whose permission rows name both (ADR 011 §1.2). Otherwise it is null, and the view reads "A person who shares no workspace with you". Each trigger's next run and whether the trigger is spent come from `computeAutomationSchedule` at the realm's clock (`now()` in `clock.ts`), as the tick computes them. Runs left are counted one trigger at a time over the indexed declaration, the row's `scheduled_since` and `trigger_runs`, with no `now`, so a slot that has passed but isn't enqueued yet still counts as left. Counting stops after `RUNS_LEFT_BUDGET_MS` (250 ms) per answer; a trigger past the budget reports no `runsLeft`. When the card no longer reads as a declaration, each trigger the row has counted reports `runs` alone. The response is `no-store`. The view fetches again when the card is re-indexed, and on a `job` or `automation` realm event naming the automation (below), since a run or a change to the row changes the answer and not the card.

The realm loads `automation-status.ts` with a dynamic `import()` on the route's first use, so the schedule code stays out of every bundle that imports the realm. An in-browser test realm has no `automations` table. Host tests mount a virtual-network handler that answers the route (`tests/acceptance/automation-view-test.gts`).

### Which webhooks a realm can use

An incoming webhook (`incoming_webhooks`, made through the realm server's `/_incoming-webhooks`) belongs to the person who made it, not to a realm. A realm can use a webhook when the webhook's owner is a direct writer of the realm (`isDirectWriter`): direct writers administer a realm and are who switch its automations on and pay for them, so a webhook any of them made is one of the realm's. Anyone else's webhook is foreign, so a person who holds a webhook's signing secret but can't write the realm can never start runs the realm's payer pays for. `packages/runtime-common/automation-webhooks.ts` holds the rule:

- **`unusableWebhookProblems(txQuery, realmURL, declaration, matrixServerName)`** returns a problem per webhook trigger the realm can't use: `unknown-webhook` (no webhook has the path) or `foreign-webhook` (the owner isn't a direct writer), each at `triggers.N.webhookPath` with a message for the card. It asks inside the caller's transaction with each owner's permission row locked (`isDirectWriterLocked`). The declaration reader never reports these codes, since it reads the card alone.
- **Switch-on and resume** ask it before they take the payer on, and refuse with `unusable-webhook` and the problems; the routes answer 422 with the messages. Resume asks before it locks the automation's row, so permission rows still lock first.
- **The caps snapshot keeps the webhooks the payer agreed to**, as `webhookPaths` (`declaredWebhookPaths`: each path once, sorted). The index hook pauses a switched-on automation whose card names a path the snapshot lacks, a trigger pointed at another webhook or a new webhook trigger, with `webhook-changed` (`webhooksChangedFrom`). Removing a webhook trigger asks for nothing more. A snapshot without `webhookPaths` limits no webhook. A resume confirms: it checks the webhooks again and takes a new snapshot.
- **`GET <realm>/_automation-webhooks`** (`answerAutomationWebhooks`) lists every webhook the realm can use, oldest first, as `automation-webhook` resources with `webhookPath`, `owner` (a Matrix id the viewer may see, since both are direct writers of the realm), `verificationType` and `createdAt`; never a signing secret. It answers on the realm ACL, then lists webhooks only to a direct writer, with `meta: { directWriter: true, webhookDeliveriesStartRuns }`, `no-store`. Anyone else the ACL lets read gets HTTP 200 with `{ data: [], meta: { directWriter: false } }`, not a 403, for the reason the status route gives; a caller only a policy grant admits gets the ACL's refusal. The card's editor reads it through `authed-fetch`, and takes a typed path for `meta.directWriter: false`, as it does when the route can't be asked.
- **`WEBHOOK_DELIVERIES_START_RUNS`** says whether the webhook receiver starts automation runs from deliveries. While it is false, a webhook trigger never fires and is never spent. The status route reports it as `webhookDeliveriesStartRuns` and the webhook list as `meta.webhookDeliveriesStartRuns`, and the card warns under each webhook trigger. The switch-on estimate (`attributes.notices`), switch-on and resume (`meta.notices`) carry the `webhook-triggers-start-no-runs` notice (`switchOnNotices`) for a card with a webhook trigger. The change that starts runs from deliveries sets the constant to true, and every warning goes away with no card change.

A webhook's owner can lose write after switch-on. Nothing pauses the automation for that, since the webhook starts no runs; the delivery that starts a run checks the webhook against the rule then.

### The declaration reader

`readAutomationDeclaration(entry, { automationTypeKey, virtualNetwork? })` in `packages/runtime-common/automation-declaration.ts` turns an index row (`url`, `realmURL`, `types`, `instance`; `IndexedInstanceSource` has this shape, and `IndexedInstance` maps onto it with `canonicalURL` as `url`) into an `AutomationDeclaration`, or returns every problem it finds. It never throws for anything the card says.

- **Type.** The row's adoption chain (`types`) must include `automationTypeKey`, which is `internalKeyFor(automationRef, undefined, virtualNetwork)`: the catalog type or any type that descends from it. A local class that is merely named `Automation` is refused (`not-an-automation`).
- **Triggers** come out in `automation-schedule.ts`'s `AutomationTrigger` shape, plus `timeZone` on `once` and `webhookPath` on `webhook`, so they go straight into `computeAutomationSchedule`. `until` and `at` are UTC unix seconds, converted from the card's local date and time with `zonedDateTimeToUnixSeconds`.
- **Relative refs** (the script link, an operation's `targetType.module` starting with `./` or `../`) are joined to the card's id with `resolveRRIReference`, so they keep its form: a prefix-form id (`@cardstack/catalog/automations/a`) gives prefix-form refs. The script must be inside `realmURL`, which `RealmPaths.inRealm` decides. When the script's form can differ from `realmURL`'s, pass the `virtualNetwork`; without it a prefix-form script isn't found in a realm known by its URL. A `$REALM/` link resolves to the realm root only from a prefix-form id; from a URL-form id it is refused.

Each problem has a `code`, a `path` into the card (`triggers.0.expression`, `caps.seconds`, `script`) and a message for a person. Codes: `not-an-automation`, `not-indexed`, `missing-script`, `script-outside-realm`, `invalid-trigger-kind`, `missing-label`, `duplicate-label`, `invalid-cron`, `cron-too-frequent`, `missing-time-zone`, `invalid-time-zone`, `invalid-date-time`, `invalid-count`, `missing-webhook-path`, `invalid-operation`, `missing-cap`, `missing-credit-cap`, `invalid-cap`, `seconds-cap-too-high`, `daily-credits-above-monthly`, `invalid-param`, `invalid-batch-deadline`.

### The 5-minute minimum

A cron trigger may fire at most once every `MIN_CRON_INTERVAL_MINUTES` (5). The rule lives in `packages/runtime-common/automation-cron-rule.ts`, which depends only on `automation-schedule.ts` and `Intl`. `cronTriggerProblem(expression, timeZone?)` returns `{ code, message }` (`invalid-cron` for an expression `cronExpressionError` refuses, `cron-too-frequent` for one `cronFrequencyError` refuses) or undefined. The declaration reader reports each trigger's result, and the card's editor shows the message under the expression: the host shims the module as `@cardstack/runtime-common/automation-cron-rule` (`host/app/lib/externals.ts`), so the card and the server run one rule and can't disagree. A change to the rule changes both at once; the messages are shown to people, so they follow the UI copy rules.

`cronFrequencyError(expression, timeZone?)` decides the frequency from the parsed sets rather than by sampling fire times: it takes every minute of the day the hour and minute sets name, finds the closest two distinct ones, and compares the last time of a day with the first of the next only when two consecutive days can both match (a scan of one 400-year Gregorian cycle when a day field is restricted, kept per parsed schedule). `*/5 * * * *` and `3,58 * * * *` pass; `* * * * *`, `*/2 * * * *`, `0,3 * * * *` and `58,1 0,23 * * *` are refused, while `58,1 0,23 * * MON` passes, since Monday is never followed by Monday.

With a time zone it also applies each of the zone's offset changes (found once per zone from 2020 to 2060, then cached, each with the local day it falls on) the way `computeAutomationSchedule` fires them, since a change can bring two times closer. A change applies only when the schedule fires on its day, or on the next day when its window crosses midnight: New York springs forward on a Sunday, so `1,58 2,4 * * MON` passes there and `1,58 2,4 * * SUN` is refused.

- a **wall-clock** expression's time that the clocks skip fires as far past the change as it was into the gap: in New York `1,58 2,4 * * *` fires the skipped 02:58 at 03:58, 3 minutes before 04:01, so it's refused there and passes in UTC. Two times that land on the same instant fire once, which isn't a gap. A window that crosses midnight moves a time into the next day: in Nuuk `1,58 1,23 * * *` fires the skipped 23:58 at 00:58, 3 minutes before 01:01.
- an expression that **follows elapsed time** (`followsElapsedTime`) doesn't fire the wall times the clocks skip, so the times either side of the gap are its length closer than on the wall clock: in London `0,58 */2 * * *` fires 00:58 GMT and then 02:00 BST, 2 minutes later, so it's refused there and passes in UTC.
- an expression that **follows elapsed time** fires repeated wall times twice: in Berlin `1,58 */2 * * *` fires 02:58 and then the repeated 02:01 3 minutes later.

The reader passes the trigger's time zone whenever it's valid.

## The automation row

Every switched-on automation has one row in `automations`, keyed by the card's canonical identifier (`automation_id`). The card is the definition; the row is who pays and where the automation is (ADR 028 §1.3). A card with no row is not switched on, and nothing runs it. The functions that change the row are in `packages/runtime-common/automations.ts`, imported as `@cardstack/runtime-common/automations` (it isn't re-exported from the package index, which would pull the declaration reader into every package that imports the index). The table is server-only and excluded from the SQLite schema dump.

### What a row holds

| Column                                                                   | Holds                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_id`, `realm`                                                 | The automation card and its realm, as canonical identifiers (ADR 002), the same spellings `automation_runs` uses                                                                                                                                                                                                                                     |
| `payer`                                                                  | The Matrix user id of the direct writer who switched it on or last resumed it. Only switch-on and resume set it                                                                                                                                                                                                                                      |
| `state`, `pause_reason`, `paused_by`, `pause_problems`                   | `active`, `paused`, `waiting-for-credits` or `done`. A paused row has a reason, and no other row does; `paused_by` names the person, when a person paused it; `pause_problems` (JSON `[{ code, path, message }]`) what the declaration reader found, read only when the reason is `invalid-declaration`. Every pause writes it, and resume clears it |
| `caps_snapshot`                                                          | JSON: every cap in `AUTOMATION_CAP_NAMES` as the card set it, plus `batchedAI` and the webhooks its triggers named (`webhookPaths`), when the payer switched it on or resumed it                                                                                                                                                                     |
| `trigger_runs`                                                           | JSON keyed by trigger label: `{ runs, lastSlot?, since?, timing?, live? }`, the `runState` `computeAutomationSchedule` reads (see _The cursor_), plus each trigger's `timing` and whether it was `live` when the row last followed the card                                                                                                          |
| `scheduled_since`                                                        | When it was switched on or last resumed: the schedule's `since`. Slots at or before it never run                                                                                                                                                                                                                                                     |
| `next_run`                                                               | The earliest next run across unspent cron and one-time triggers; null when none is left. The `automations_due_idx` partial index serves the tick's search over active and waiting-for-credits rows                                                                                                                                                   |
| `last_enqueued_at`, `last_started_at`, `last_finished_at`, `last_result` | The most recent run: when it was enqueued, started and finished, and whether it ended `complete`, `error` or `canceled`                                                                                                                                                                                                                              |
| `failures_since`                                                         | When it was switched on or last resumed, by the database clock: only runs created at or after it count toward a pause for repeated failures (see _Pausing after repeated failures_)                                                                                                                                                                  |
| `switched_on_at`, `updated_at`                                           | When the row was made and last changed                                                                                                                                                                                                                                                                                                               |

### States and who changes them

| Reason a row is `paused` | Set by                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requested`              | `pauseAutomation`: a direct writer paused it                                                                                                                                                                                                                                             |
| `caps-raised`            | `checkAutomationCaps`: the card, as indexed, sets a cap above the snapshot, or leaves unset a credit cap the snapshot set                                                                                                                                                                |
| `webhook-changed`        | The index hook, and `checkAutomationCaps` when handed the card's triggers (`webhooksChangedFrom`): the card names an incoming webhook the snapshot's `webhookPaths` lacks                                                                                                                |
| `batched-ai-enabled`     | `checkAutomationCaps`: the card turned on `batchedAI` and the snapshot had it off                                                                                                                                                                                                        |
| `payer-lost-access`      | `checkAutomationPayer`: the payer is no longer a direct writer of the realm; or a run's admission (`pauseForPayerLostAccess`): the payer's sessions were revoked, or their account can't sign in                                                                                         |
| `realm-archived`         | `pauseRealmAutomations`: the realm was archived (`handlers/handle-archive-realm.ts`)                                                                                                                                                                                                     |
| `repeated-failures`      | `pauseAfterRepeatedFailures`: the automation's own runs failed `AUTOMATION_FAILURES_BEFORE_PAUSE` (5) times in a row; the worker asks once each run ends as an error                                                                                                                     |
| `invalid-declaration`    | `pauseForInvalidDeclaration`, from the tick and reconcile: a run came due while the card indexed but didn't read as a declaration; `pause_problems` holds the reader's problems. Pending runs are canceled; a running run is left to finish. The index hook lifts it once the card reads |

- **`switchOnAutomation`** makes the row for a direct writer, who becomes the payer, snapshots the caps and webhooks the declaration sets, and starts the schedule now. A webhook trigger naming a webhook the realm can't use is refused (`unusable-webhook`, with the problems). A row whose triggers are all spent starts `done`. A second switch-on is refused (`already-switched-on`).
- **`pauseAutomation`**, **`resumeAutomation`** and **`removeAutomation`** are for a direct writer of the row's own realm. Resume works from any pause reason, makes its caller the payer, takes a new snapshot from the card as it is now, and restarts the schedule at the resume, so slots that passed while paused don't run; each trigger keeps its count. Remove deletes the row and leaves the card and script. Deleting the realm (`removeRealmDatabaseArtifacts`) deletes its rows too, so a realm later made at the same URL starts with none on. Archiving the realm pauses every automation in it that isn't paused already, with `realm-archived`, and cancels their pending and running runs, before the realm is marked archived (a failure in between leaves the realm visible with its automations stopped, and a retry archives it), and pauses them once more after. Switch-on and resume refuse an archived realm (`realm-archived`), asked in their own transaction under the realm's automation lock, which they take shared and `pauseRealmAutomations` takes exclusive (`lockRealmAutomations`), so one that read the realm as not yet archived commits before the second pause reads the realm's automations. Restoring the realm leaves them paused until a direct writer resumes each one.
- **`checkAutomationCaps`** and **`checkAutomationPayer`** pause without a person. A row already paused keeps its reason, since a resume takes a new snapshot whatever paused it. A cap the snapshot doesn't limit (an unset credit cap, or a cap added to the card type after the snapshot) is never "raised"; `capsRaisedAbove` is the comparison.
- **Waiting for credits.** A run's admission moves the row between `active` and `waiting-for-credits` (`setAutomationWaitingForCredits`). A run that acts as the payer and is refused with `insufficient-credits` moves an active row to waiting; the next such run whose balance passes (admitted, or refused only for a credit cap, which the check reads after the balance) moves it back to active. The tick keeps enqueuing a waiting row's due runs as it does an active one's, and each is admitted or refused on the balance at that moment, so the automation continues at its next due time once the balance recovers. Nothing changes the state when the payer tops up; the view says _Waiting for credits_ until the next due run. A Preview or Run now is charged to whoever clicked, so its refusal never moves the row. A paused or _done_ row, or one whose payer a resume changed, is never moved. The move is one conditional `UPDATE`, so a pause that commits first wins.
- The tick, the card's index hook and the run task own `next_run`, `trigger_runs`, `waiting-for-credits`, `done` and the `last_*` columns once the row exists. The lifecycle functions set the next run and `done` only where they start a schedule. Whatever writes `trigger_runs` keeps each entry's `timing`.

### When the row is recomputed: the card's index hook

`syncAutomationsAfterIndex` (`packages/runtime-common/automation-index-hook.ts`) runs in the worker's `from-scratch-index` and `incremental-index` tasks (`tasks/indexer.ts`) once the pass has committed, so it reads the committed index. A from-scratch pass syncs every automation in the realm; an incremental pass syncs those whose card file it visited or deleted. For each, `syncAutomationWithCard` in `automations.ts` reads the card's index row (`IndexQueryEngine.getInstanceSource`) and, in one transaction holding the automation's row:

| The card as indexed                                                                                                     | The row                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No live instance (deleted)                                                                                              | Removed, pending and running runs canceled with `error_reason` `card-deleted`                                                                                                                                                                         |
| Doesn't adopt from the catalog `Automation` type                                                                        | Removed, pending and running runs canceled with `not-an-automation`                                                                                                                                                                                   |
| Failed to index (or carries only an earlier visit, `failureWithheld`)                                                   | Unchanged: the next index that reads it recomputes                                                                                                                                                                                                    |
| Indexed, but doesn't read as a declaration (an invalid cron, a missing cap, a trigger just added and not filled in)     | Unchanged, since the card saves itself mid-edit; the tick pauses it if a run comes due meanwhile. A row paused with `invalid-declaration` has its `pause_problems` replaced by the card's current problems                                            |
| Reads again, and the row is paused with `invalid-declaration`                                                           | Resumed as `resumeAutomation` would, with the same payer and caps snapshot: the schedule restarts now, so no slot from the pause runs. Paused with `caps-raised`, `batched-ai-enabled` or `webhook-changed` instead when the fixed card asks for more |
| Row is paused                                                                                                           | Unchanged, whatever paused it: a resume restarts the schedule                                                                                                                                                                                         |
| Raises a cap or turns on `batchedAI` (`capsRaisedAbove`), or names a webhook the snapshot lacks (`webhooksChangedFrom`) | Paused with `caps-raised`, `batched-ai-enabled` or `webhook-changed`                                                                                                                                                                                  |
| Anything else                                                                                                           | `next_run` recomputed from the triggers and `trigger_runs` with `now`; _done_ when every trigger is spent, active again when a _done_ one has a trigger left                                                                                          |

Run counts are keyed by label, so editing the card keeps them. Each trigger's `timing` (kind, expression, time zone, `at`, `until`; not `count`) and `live` (on the card and unspent) are recorded at switch-on, resume and every sync. A trigger starts afresh, with `since` = now, when its timing changed, its label is new, or it wasn't live last time: re-added after being removed, or a spent trigger given a higher `count` or a later `until`. So a slot that passed before the edit, or while the trigger was gone or spent, never comes due as a make-up run; the count carries on.

`syncAutomationWithCard` takes a `readCard` callback and reads the card only once it holds the automation's row lock. Two incremental passes over one card can overlap (different writers' lanes); reading under the lock means the later sync never reads an older card than the earlier one, so the row ends on the newest card.

The hook only logs a failure; the index pass still succeeds, and the next pass over the card syncs again. Each automation syncs on its own, so one that fails (`failed to sync automation <id> with its card`) doesn't stop the rest of the realm's. A failure before any automation syncs logs `failed to sync automations with their cards in <realm>`. A row stuck on an old schedule after an edit is worth checking against that log line and the card's index row (`has_error`, `types`).

Every direct-writer check is `isDirectWriterLocked`, asked inside the change's transaction against the served URL `virtualNetwork.toURL(realm)` resolves the realm to, since permission rows are keyed by served URLs. A wildcard (`*`, `users`) row, a bot account and a policy grant never make a direct writer. A refusal returns `{ ok: false, reason }` (`not-a-direct-writer`, `missing`, `outside-realm`, `other-card`, `realm-archived`, `already-switched-on`, `not-paused`, `not-pausable`) rather than throwing.

The row's `realm` is what every later check asks about, so switch-on refuses a realm that doesn't contain the automation (`outside-realm`, decided by `RealmPaths.inRealm`), and switch-on and resume refuse a declaration read from another card (`other-card`). Each change locks the person's permission row before the automation's row, in that order everywhere, so two changes never wait on each other; code that touches both, such as a realm's archive or delete, takes them in the same order.

**Every pause and every remove cancels the automation's pending and running runs** in the same transaction (`cancelUnfinishedAutomationRuns`), whatever paused or removed it: a person, a raised cap, the payer losing access, archiving, or the index hook. A pending run never starts. A running run stops as a canceled one does (see _Canceling a run_): its overlay is discarded, the realm server refuses its next call, and its tab stops the script. A running run whose commit was claimed is left to finish, since its writes may already be landing. A run that a person's pause or remove canceled names them in `canceled_by`; one any other pause or remove canceled has no `canceled_by` and carries the reason in `error_reason`. Each canceled run's log ends with a `finish` line saying so, written once the transaction commits (a log line locks the run's row, which the transaction holds).

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
- `paused` with `webhook-changed`: compare `caps_snapshot->'webhookPaths'` with the card's webhook triggers. A direct writer resumes it to agree to the new webhook, and resume refuses a webhook the realm can't use.
- `paused` with `payer-lost-access`: the payer's own permission row no longer grants write. Another direct writer resumes it and becomes the payer.
- `paused` with `invalid-declaration`: a run came due while the card didn't read as a declaration. `pause_problems` (or the status route's `pauseProblems`, which the card's Status section lists by trigger or section) names each problem, and follows the card as it is re-indexed. Fixing the card resumes the automation on the next index pass; no one needs to resume it.
- `paused` with `repeated-failures`: the automation's own runs kept failing. `readAutomationFailures` (or the status route's `failuresInARow` and `lastFailure`) names the latest failed run, its `error_reason` and its `error_message`; the query under _Pausing after repeated failures_ lists the whole streak. Fix what the runs fail on (the script, a key, the card), check it with a Preview, then resume, which clears the streak.
- `active` with a null `next_run`: only webhook triggers, or none left that the schedule can place.
- `waiting-for-credits`: the payer's last run was refused with `insufficient-credits`. Its due runs still start and are refused until the payer's balance, less what their runs in flight hold, reaches the run's minimum balance (the `pricing` skill, _The minimum balance and the credit caps_). The first run admitted makes it `active`.
- A run canceled with no `canceled_by`: an automatic pause, or the index hook's remove, canceled it; its `error_reason` names which.

### Pausing after repeated failures

An automation whose own runs keep failing pauses itself with `repeated-failures`, so a broken script, key or card stops spending the payer's credits every slot, and the payer learns why from the last error.

- **The streak is read from the runs, never stored.** `readAutomationFailures(querier, automationId)` counts the automation's runs that ended as `error` after its latest `complete` one, ordered by `finished_at`, and returns that count (`inARow`) and the latest of them (`last`: run id, `error_reason`, `error_message`, `finished_at`). So a complete run resets it, and a run recorded as an error whose commit lands after all (`recordAutomationRunCommitted` makes it complete) ends it too.
- **Only the automation's own runs count:** runs its triggers started, a batch follow-up included. A Preview (`dry_run`) and a Run now (trigger `manual`) are a person's runs, acting as and charged to them whether or not the automation is on, so they neither extend nor break the streak. Nor does a canceled run, or a failed run whose reason is in either of two lists:
  - `SPENDING_REFUSAL_REASONS` (`insufficient-credits`, `daily-credit-cap-reached`, `monthly-credit-cap-reached`, `pricing-unavailable`): admission refused the run for the payer's spending, and the automation waits for credits instead and runs again once the payer can pay.
  - `PLATFORM_FAILURE_REASONS` (`account-unverifiable`, `run-admission-failed`, `run-failed`, `commit-failed`, `commit-interrupted`, `job-lost`, `dry-run-mismatch`): the platform failed the run, not the automation. A Matrix, prerender, realm or worker outage fails every automation's runs this way, and counting them would pause every automation that runs during it. A realm call that fails on its own terms ends its run as `call-failed`, which counts; the tab answers `run-failed` instead when the platform failed any request the run made (_The tab_ says how the tab tells).
- **Resuming clears it.** Only runs created at or after the row's `failures_since` count, and switch-on and resume set it.
- **`pauseAfterRepeatedFailures(dbAdapter, automationId, { failuresBeforePause }, reporters)`** locks the row, reads the streak and pauses once it reaches `failuresBeforePause` (default `AUTOMATION_FAILURES_BEFORE_PAUSE`, 5), cancelling the pending run as every pause does. Like the other pauses it runs in `withChanges`, so `reporters` hear about the paused automation and each canceled run once the pause commits. Only an active automation, or one waiting for credits, pauses: one already paused keeps its reason, and one _done_ has no runs left to stop. It returns `{ automation, paused }`, where `paused` says whether this call paused it. Since the streak is read from the runs, calling it again, or for a run that didn't fail, changes nothing.
- **Who asks.** The worker's `runAutomationAttempt` asks after every attempt whose run has ended as an error, however it ended: the attempt's own finish, or the realm server ending the run at a cap or a refused credential. The threshold comes from `AutomationAttemptContext.failuresBeforePause`. Reconcile asks too, after each lost run it ends as an error and once it has let go of the automation's row (the pause takes the row itself). Its `job-lost` never counts, so the ask only pauses an automation whose streak an earlier run's attempt reached without getting to ask. Anything else that ends an automation's run with a reason that counts calls it too; a call that is missed is made up by the next failed run's.
- **The run that tripped the pause keeps its own error.** It had ended before the pause, so the pause cancels only the runs after it.

The streak, by hand:

```sql
SELECT id, state, error_reason, error_message, finished_at
  FROM automation_runs
 WHERE automation_id = '<automation card id>'
   AND finished_at IS NOT NULL AND NOT dry_run AND trigger <> 'manual'
   AND created_at >= (SELECT failures_since FROM automations
                       WHERE automation_id = '<automation card id>')
 ORDER BY finished_at DESC
 LIMIT 10;
```

Reading down, the streak is the `error` rows above the first `complete` one, skipping `canceled` rows and errors whose reason is in `SPENDING_REFUSAL_REASONS` or `PLATFORM_FAILURE_REASONS`. The worker logs `automation <id> paused after repeated failed runs; the last was run <run id> (<reason>)` once, from the attempt whose run tripped the pause.

### The tick: enqueueing due runs

`tickAutomations` (`packages/runtime-common/automation-tick.ts`, imported as `@cardstack/runtime-common/automation-tick`) starts the runs of every trigger that has come due. A system cron (`lib/automation-tick-config.ts`, every minute, `AUTOMATION_TICK_CRON_SCHEDULE` overrides it) enqueues an `automation-tick` job from every worker manager, at the automation tier in the `automation-tick` concurrency group. A tick that arrives while another is still waiting joins it; one that arrives while another runs queues behind it. The job (`tasks/automation-tick.ts`) reads each card's declaration with `readRunDeclaration`, as a run does.

For each row due at `now` (`state` `active` or `waiting-for-credits`, `next_run` at or before now; the `automations_due_idx` rows), one transaction:

1. Claims the row with `FOR UPDATE SKIP LOCKED`. A row another tick holds, or one no longer due, is skipped.
2. Reads the card. A card that doesn't read as a declaration enqueues nothing (`unreadable`). Once the claim ends, `pauseForInvalidDeclaration` locks the row, reads the card again, and pauses the automation with `invalid-declaration` when the card indexed and still doesn't read (the outcome's `paused`), so a due automation says why rather than skipping its runs in silence. The index hook lifts that pause once the card reads. A card with nothing indexed to read, or one that no longer adopts from `Automation` (the index hook removes it), leaves the row due and unchanged. A card that raises a cap above the snapshot enqueues nothing (`caps-raised`); the index hook pauses it.
3. Follows an edit the index hook hasn't applied yet the way the hook does (`withEditCursors`), then computes the schedule with `now`.
4. For each trigger due at the next run: if a **scheduled** run of the automation (one a cron or one-time trigger on the card started) is pending from an **earlier instant**, the slot **joins** it (_skipped_): no run, no job, the trigger's `runs` stays, its `lastSlot` moves to the slot, and the pending run's log gets a `trigger` line naming the slot. Otherwise it makes the run row (`trigger` = label, `slot` = the instant as ISO text, `acts_as` = the payer) and enqueues its job with `enqueueAutomationRunJob` (the card's `seconds` cap sets the timeout), then counts the run and moves `lastSlot`. A run at the same instant is another trigger's and is never joined, nor is a Preview or Run now (a Preview never commits, and a Run now acts as whoever clicked), nor a run already running: the new run waits behind it in the automation's concurrency group.
5. Repeats for any other trigger due by now (each cron trigger owes at most one make-up run), then writes `trigger_runs` (each entry's `timing` and `live` recorded as the index hook records them), `next_run`, `done` when every trigger is spent, and `last_enqueued_at` when a run started.

Two triggers due at the same instant start two runs, keyed apart by their labels, which the concurrency group runs one after the other.

The run row and the job are written before the row is advanced, while the claim is held: the queue publishes in a transaction of its own, and a worker taking the job must find the run row. Both are keyed by the automation, trigger and slot, so a tick that dies before the advance leaves the slot due, and the next tick finds the same run (`createAutomationRun` returns it) and joins the same job (the `dedupeKey` and identical args), or, once that job has run, enqueues one that finds the run over and leaves it. Before scheduling, the tick **adopts** every pending run that a trigger on the card started for a slot past that trigger's `lastSlot`: only a tick that stopped before advancing the row leaves one. Each is counted as started, its trigger's `lastSlot` moves to its slot, and its job is enqueued again (the queue joins the job still there), so a stopped tick's runs are each counted once, however many triggers it had handled.

**What the tick enqueued.** The worker logs one `automation-tick` line per trigger it handled and a summary per tick that had anything due:

```
automation-tick: automation <id> trigger <label> started run <run id> (job <job id>) for <slot>
automation-tick: automation <id> trigger <label> skipped <slot>: it joined pending run <run id>
automation-tick: <n> due, <n> started, <n> skipped, <n> unreadable, <n> caps raised, <n> failed
```

In Postgres, a run's log starts with a `trigger` line saying which trigger and slot started it, and a run that slots joined carries one `trigger` line per joined slot (`data.skipped` is true):

```sql
SELECT r.id, r.trigger, r.slot, r.state, r.created_at, l.message
  FROM automation_runs r
  LEFT JOIN automation_run_log l ON l.run_id = r.id AND l.kind = 'trigger'
 WHERE r.automation_id = '<automation card id>'
 ORDER BY r.created_at DESC, l.seq;
```

The ticks themselves are `automation-tick` rows in `jobs`; their `result` counts what each did.

**Why a due run didn't start.** Check in this order:

- The row: `state` must be `active` or `waiting-for-credits` and `next_run` at or before now (see _Inspecting an automation_). A paused or _done_ row is never due, and an `active` row with a null `next_run` has nothing to schedule.
- `next_run` long past and not moving: the tick isn't claiming it. Look for `automation-tick` lines naming the automation: `can't be read` (the card fails to read as a declaration: the index row's `has_error`, an invalid trigger or cap), `asks for more than its caps snapshot` (the index hook should pause it; check its log), or `failed`. No lines at all: check that `automation-tick` jobs are being enqueued and completed (the cron logs `automation-tick cron scheduled for …` at startup, and `automation-tick cron failed to enqueue job` on an error) and that some worker claims the automation tier.
- A slot reported _skipped_: the automation had a run still pending (waiting for its turn in the concurrency group, or for a worker). That pending run covers the slot. Several skipped slots in a row mean runs take longer than the trigger's interval, or the automation tier is backed up (see _The queue tier and worker lane_).
- A run made but never started: its job is waiting. `SELECT id, status, priority, concurrency_group FROM jobs WHERE job_type = 'run-command' AND args->>'dedupeKey' LIKE 'automation:<automation card id>:%'`.
- A trigger with `runs` at its `count`, or whose next slot is past `until`, is spent and doesn't run again.
- A run that ended as an error with `insufficient-credits`, `daily-credit-cap-reached`, `monthly-credit-cap-reached` or `pricing-unavailable` was refused by the spending check (_Admission_). It used nothing and costs nothing.

### Reconcile: making up a missed run

`reconcileAutomations` (`packages/runtime-common/automation-reconcile.ts`, imported as `@cardstack/runtime-common/automation-reconcile`) makes up runs an outage cost (ADR 028 §1.5). Every worker manager enqueues an `automation-reconcile` job when it starts and on a cron every five minutes (`lib/automation-reconcile-config.ts`; `AUTOMATION_RECONCILE_CRON_SCHEDULE` overrides it), at the automation tier in the `automation-reconcile` concurrency group. A pass that arrives while another waits joins it. Each pass handles two kinds of missed work, at most one run per trigger:

1. **A run whose job is gone**: `pending` or `running`, made at least `AUTOMATION_RECONCILE_GRACE_SECONDS` (2 minutes) ago, with no `unfulfilled` `run-command` job carrying its `dedupeKey`. The queue gave up on its job after the last reservation, or the job finished without ending the run, or it was never published. Reconcile holds the automation's row, as the tick does while it writes runs.
   - A **pending** run never started, so reconcile **enqueues the same run's job again** and sets `reconciled_at`. The run keeps its slot, which is the missed instant, so its trigger's count and cursor don't change, and a slot that joined the pending run is covered when it runs. The card's `seconds` cap sets the job's timeout; a card that can't be read gets `MAX_RUN_SECONDS`, and the run's admission then ends it with the reason the card doesn't read. A Run now or Preview is enqueued again whether or not the automation is switched on.
   - Reconcile **ends** the run with `abandonAutomationRun` (`error_reason` `job-lost`, or `complete` if its commit landed) and charges it when the run is **running** (a retry gets only what is left of the run's time limit, counted from its first start, which a job the queue gave up on has long since used; the trigger's next run catches up), when `reconciled_at` is already set (its extra job was lost too), when a scheduled run's automation is paused or no longer switched on, or when no cron or one-time trigger on the card has the run's label.

2. **A due time that passed with nothing enqueued**: a row whose `next_run` is the grace or more behind `now`, which the minute tick missed (the tick was down, or the worker manager just started). Reconcile runs the tick's own procedure on those rows (`tickAutomations` with `overdueBy`), so every slot that passed collapses into one make-up run at the latest of them, counted once against `count`. The tick and reconcile both claim with `FOR UPDATE SKIP LOCKED` and key each run by automation, trigger and slot, so they can't both start it.

Lost runs go first, so a due slot finds a pending run that will run (and joins it) or none (and starts its own). Other missed work, such as a batch follow-up whose deadline passed with nothing enqueued, registers a step with `registerAutomationReconcileStep(name, step)`, which returns a function that removes it; each pass runs every registered step after its own and logs how many runs each made up. A pass calls its `onProgress` after each run, automation and step, and the job heartbeats there (`heartbeatJob`), so a pass after a long outage isn't timed out while it still makes progress.

**What reconcile did.** The worker logs one `automation-reconcile` line per run or automation it handled, and a summary per pass that found anything:

```
automation-reconcile: run <run id> of automation <id> (trigger <label>, slot <slot>) had no live job; enqueued it again as job <job id>
automation-reconcile: run <run id> of automation <id> (trigger <label>, slot <slot>) had no live job and ended error: <why>
automation-reconcile: automation <id> trigger <label> was overdue; made up run <run id> (job <job id>) for <slot>
automation-reconcile: <n> requeued, <n> ended, <n> overdue, <n> made up, <n> skipped, <n> failed
```

A run reconcile enqueued again has a `trigger` line in its log, `Reconcile enqueued this run again: it was still pending and its job was gone` (`data.reconciled` true); one it ended has a `finish` line with `job-lost`. The passes themselves are `automation-reconcile` rows in `jobs`, whose `result` counts what each did.

```sql
-- Runs reconcile has enqueued again, and how they ended.
SELECT id, trigger, slot, state, error_reason, reconciled_at, finished_at
  FROM automation_runs
 WHERE reconciled_at IS NOT NULL
 ORDER BY reconciled_at DESC LIMIT 20;
```

Make-ups that keep happening point at the queue rather than at reconcile: `requeued` lines for one automation mean its jobs keep dying (look up the rejected `run-command` job's `result` for the queue's reason, often a worker killed for memory); `overdue` lines mean the tick isn't running or isn't claiming (see _Why a due run didn't start_).

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
| `dry_run`                                                                      | A Preview: the run stops before its commit, and a complete one keeps a copy of its staged files (_Preview and Run now_)                                                                            |
| `attempt`                                                                      | The queue attempt that owns the run: the job's reservation id, which grows with each reservation                                                                                                   |
| `script_id`, `script_hash`                                                     | The script file the run read, as an identifier, and the hash of the text it ran                                                                                                                    |
| `state`                                                                        | `pending`, `running`, `complete`, `error` or `canceled`                                                                                                                                            |
| `error_reason`, `error_message`                                                | For an error: a code (such as `script-error`, `timed-out`, `commit-interrupted`) and its detail. A run canceled by a pause no person asked for carries that pause's reason (such as `caps-raised`) |
| `credential_reason`, `credential_share_id`, `credential_key_id`                | For a run that ended `credential-rejected`: `rejected` or `needs-admin`, and the share or personal key the refused slot is filled from (the `oauth-connections` skill's _Unattended runs_)         |
| `canceled_by`                                                                  | Who canceled the run, when a person did; null when an automatic pause canceled it                                                                                                                  |
| `call_api_calls`, `call_api_response_bytes`, `resolve_calls`, `writes`         | The metered counts, which the realm server must add to where it does the work, never taking them from the tab                                                                                      |
| `ai_credits_spent`, `ai_credits_reserved`, `ai_reservations`                   | Credits the run's finished AI requests cost, and the worst case of those in flight (see _The AI spending cap_)                                                                                     |
| `created_at`, `started_at`, `commit_started_at`, `committed_at`, `finished_at` | When the run was enqueued, first started (a retry keeps it), claimed its commit, had its commit land, and ended                                                                                    |
| `reconciled_at`                                                                | When reconcile enqueued a pending run's job again because its job was gone. Reconcile does that once; null for a run it never touched                                                              |

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
  an error. A Preview never claims a commit and finishes complete, and its
  finish keeps a copy of the files its attempt staged
  (`automation_preview_files`) before it discards the overlay.
- **`abandonAutomationRun(db, id, reason)`** closes a pending or running run
  whose job is gone, whoever owned it: the queue gives up on a job after its
  last reservation, and no attempt is left to finish the run. Reconcile calls
  it with `job-lost` for a run it already enqueued once more (see
  _Reconcile: making up a missed run_). A run whose commit landed finishes
  complete; any other finishes as an error with `reason`. No attempt is left
  to charge it, so the caller does (`chargeAutomationRun`).
- **`cancelUnfinishedAutomationRuns(querier, automationId, by)`** cancels
  every pending run of an automation, and its running one unless its commit
  was claimed, inside the caller's transaction, as pausing and removing it do.
  It discards the overlays of the runs it cancels and returns them; the caller
  writes each one's `finish` line with `logAutomationRunEnded` once its
  transaction commits.
- **`cancelAutomationRun`** cancels a pending or running run, records who
  canceled it, discards its overlay and logs its `finish` line.
  `cancelAutomationRunIn` does the same inside the caller's transaction,
  without the line. It is refused once the commit is claimed, since the
  writes may already be landing. A canceled run can't be started, claim a
  commit or finish. A person's cancel goes through `cancelAutomationRunFor`
  (_Canceling a run_), which checks they may.
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

### Canceling a run

`cancelAutomationRunFor(dbAdapter, { runId, user }, options)` in
`automations.ts` (imported as `@cardstack/runtime-common/automations`, with
the `AutomationActorOptions` the lifecycle functions take) cancels a pending
or running run for a direct writer of the run's realm. It locks the person's
permission row before the run's row, the order every change here takes them
in, and returns `{ ok: true, run }` or a refusal: `missing`,
`not-a-direct-writer`, or `not-cancelable` with the run as it stands (it
already ended, or its commit was claimed). The automation's own row doesn't
change: it stays active, and its next run comes due as scheduled.
`POST /_automation-run-cancel` serves it (_The routes_, below).

What a cancel leaves behind:

- **The run row**: `state` `canceled`, `canceled_by` the person,
  `finished_at` set, `commit_started_at` null. The metered counts and AI
  credits it spent stay, since the work they count was done.
- **The overlay**: discarded in the cancel's transaction, so a cancel before
  the commit writes nothing to the realm. A write staged while the cancel
  waited on the run's row lock is discarded too; one after finds the run
  not running and is refused (401).
- **The log**: a `finish` line, `The run was canceled by <user>`, after
  whatever the script and the platform logged before it. The tab's later
  lines are refused, since `/_run-log` admits only a running run.
- **The run's calls**: `Realm.handleAutomation` refuses the next one with
  401 `The automation run is not running`. A commit sent after the cancel is
  refused the same way, and the worker's finish is refused, so the attempt
  leaves the run as the cancel left it (`could not finish the run`).
- **The tab**: the `run-automation` tool runs a `RunStateWatch`
  (`host/app/lib/realm-runner/run-state-watch.ts`) beside the script. Every
  `RUN_STATE_POLL_MS` (2 s) it asks the realm's `GET /_run-state`
  (`RUN_STATE_PATH` in `automation-run-command.ts`) with the run's token,
  which `handleAutomation` admits only while the run is running under the
  token's attempt; the route answers 200 with the run's id, and 403
  `not-a-run` to anything but the run's own token in its own realm. On a
  401 the watch aborts the signal `runAutomationScript` runs under, which
  terminates the QuickJS web worker at once, so a script spinning in a loop
  with no calls of its own stops too. The tool answers `error` with reason
  `stopped`. A 401 saying `Token expired` is not a stop: the token expires
  at the run's time limit, which the runner enforces and reports as
  `timed-out`. A failed or slow ask is not a stop either; the time limit
  still bounds the script.

A pause or remove stops a running run the same way (_States and who changes
them_, above), with `canceled_by` the person who paused or removed it, or
none and the reason in `error_reason`.

### Diagnosing a run

```sql
SELECT state, attempt, error_reason, error_message, canceled_by,
       started_at, commit_started_at, committed_at, finished_at
  FROM automation_runs
 WHERE automation_id = '<automation card id>'
 ORDER BY created_at DESC LIMIT 10;
```

- `running` with no live job: the attempt died. If the job has a reservation
  left, its next attempt takes the run over. If not, reconcile ends the run
  with `job-lost` within a few minutes. A `pending` run with no live job is
  enqueued again once instead (`reconciled_at` set means it already had its
  extra job). `started_at` is the first attempt's start, so an old one alone
  says only that the run was retried.
- `commit_started_at` set and `committed_at` null on a finished run: the
  claiming attempt stopped between the claim and the landing. Check the
  realm's files for the batch's writes to see whether it landed.
- `complete` with `committed_at` later than `finished_at`: the batch landed
  after a retry or the reconcile pass had closed the run as an error, and
  recording the landing made it complete.

The row holds run state, and the counts its log's cap is checked against
(`log_lines`, `log_chars`, `log_dropped`). The log itself is in
`automation_run_log` (_The run log_).

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
  next call with `The automation run is not running`;
- `acts_as` is a direct writer (`isDirectWriter`) of the run's own realm,
  whichever realm the call reaches. Losing direct write mid-run refuses the
  next call with 403 `not-a-direct-writer` and ends the run with that reason
  (`endAutomationRunNotADirectWriter`), so the calls after it, and the tab's
  `/_run-state` check, answer 401 and the script stops. The commit checks it
  again inside its write lock. The realm-server routes that take run tokens
  (`/_request-forward`, `/_ai-batches`) check and end the run the same way.
  All three, and the worker's admission, ask `runActsAsDirectWriter`.

In `handleAutomation` the revoked-session, run-row and direct-writer reads
go to the database together, one indexed row each, so the check costs a call
about one round trip. The realm-server routes read them one after another,
so there the check adds a round trip.

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

A run's writes don't reach the realm while it runs (ADR 027 §1.2). Three
routes stage them: the card+source write and its octet-stream spelling, the
operations envelope (`_operations`) and the atomic write (`_atomic`). Every
other run-token write (any `PUT`, `PATCH`, `POST` or `DELETE`) to a route
without `takesRunWrites` is refused with 403 before the route runs, and logged
as `run-token call <method> <url> refused: … wrote through a route that
doesn't stage its writes`. So `fs.delete` and the card+json writes are refused
for a run (see `docs/adr/remediation/027.md`). Each staged write lands in the
run's **overlay**, `run_overlay_files` in Postgres, one row per file keyed by
run, attempt and realm-local path, with the bytes inline. The functions are in
`packages/runtime-common/run-overlay.ts`. Every realm-server instance reads
the same overlay, so a run's calls can land on any of them.

What goes through it, for a run-token call in the run's own realm
(`requestContext.automationRun`, not `readOnly`):

- **File writes** (`realm.fs.writeText`, `writeBytes`, and the writes behind
  `replace` and `copy`): a card+source `POST`, or its octet-stream spelling,
  is staged with `stageRunOverlayFile` instead of written.
- **`cards.update`**, which the Realm Runner saves through `_atomic`:
  `Realm.#stageRunAtomic` stages every file the request adds or updates, all
  or none. An `add` of a path the run sees (staged or in the realm) is 409,
  an `update` of one it doesn't see is 404, as the atomic write answers.
- **Write operations** (`operations.invoke` and
  `operations.invokeBatchOperation` on `appendLine`, `appendContainsMany`,
  `update`, `create`, `transform`): `handleOperations` hands a run's batch to
  `commitBatch` with `Realm.#runBatchCore` in place of the realm's batch
  core. It is the realm's own, except that every file the batch reads (whole,
  in byte ranges, or for whether it exists) is read through the overlay, and
  its commit stages the batch's result with `stageRunOverlayFiles`, in one
  transaction, instead of writing the realm. So the operation runs against
  the overlay's view of the file, and a second `appendLine` adds to what the
  first staged. A `delete` operation is refused (403 `run-write-not-staged`),
  since the overlay can't hold a removal; a result the overlay refuses
  answers with the status and code below (`run-write-refused` where the
  commit has no code for it). A `callApi` entry still
  runs at once and isn't staged. The envelope still resolves each entry, and
  runs its `read` and `readSource` entries, against the realm and its index:
  a declared operation on a card created in this run doesn't resolve, and a
  read entry answers the realm's version (`docs/adr/remediation/027.md`).

Every staged write meets the same checks (`Realm.#stageRunFiles`), and they
include every check the commit makes of a file on its own, in the commit's
order (with one exception through `_operations`, below), so a staged write (a 204 from the card+source write, a 201 from
`_atomic`, a 200 from `_operations`) is a file the commit takes unless the
realm changes in between. Any file may be staged, card instance or not.
First, `Realm.#runFileRefusal`, which the commit asks again of every file,
refuses the realm's reserved paths and the files a run may not write:
`realm.json`, a module (`.gts`, `.ts`, `.gjs`, `.js`), the realm's policy
card, a RealmPolicy card or an automation card, whether the realm holds one
at the path or the run's bytes would make one (403 `forbidden-path`). It also
refuses a file under a path the realm holds as a file, or at a path where it
holds a directory (409 `path-clash`). Modules are refused because the module
a card's class comes from decides whether it's a RealmPolicy or an
automation, and the type check reads modules from the index, which never sees
a staged one. Then the realm's size limit for the file's kind applies,
through the same `assertWriteSize` the commit's batch applies (the card limit
for a card document, the file limit otherwise) (413 `payload-too-large`).
The card+source write refuses a body past the larger of the two before
buffering it, after asking `#runFileRefusal` what the path alone decides. A
refusal carries the commit's status, code and reason, without its "nothing
was saved", on every route: a run's write to a reserved path is answered by
`#routeRequest` whatever route it names, and in a run's `_operations` batch
the run's batch core gives the coordinator's reserved-path refusal
(`BatchCore.reservedWriteRefusal`), and `_atomic` refuses a reserved path
ahead of whether it exists. The exception: through `_operations` the batch
checks a file's size before the overlay sees it, so a file refused for its
size and for its path (409 `path-clash`, or 403 `forbidden-path` for
anything but a reserved path, such as an oversize automation card) answers
413 there. A path can't be
staged as both a file and a directory among the run's own files either (409
`path-clash`). The token's
`run.writesCap` bounds how many files the attempt stages (403 `writes-cap`,
titled `Writes cap reached`), and `RUN_OVERLAY_MAX_BYTES` (100 MiB) bounds their bytes together
(413). Rewriting a staged path replaces it and doesn't count again. The run's
row is locked for the check, so racing writes can't pass the cap or stage a
path as both a file and a directory, and a write after the run stopped
running is refused (401). A request that stages several files stages all of
them or none. Every staging route takes the realm's write locks on the
files it stages, as the batch does, so a write can't land between a batch's
read of a file and its commit.

And the run's reads:

- **File reads** (`realm.fs.readText`, `exists`): a card+source `GET` or
  `HEAD` of a path the attempt staged answers with the staged bytes; any other
  path reads the realm as usual.
- **Listings** (`realm.fs.list`): a directory listing adds the files the
  attempt staged under it, and the directories they make, beside the realm's
  own entries. A directory only staged files make is listed for the run.
- **`cards.get`**: a card+json `GET` of a card the attempt staged answers
  with the staged document (`Realm.#stagedCardResource`): its resource with
  the card's id, its own link, its type's module resolved against the card,
  and `realmURL` and `realmInfo`, never cached. It has no computed fields
  and no expanded links, since staged files aren't indexed. A card the run
  created is read this way too. A staged `.json` that isn't a card document
  answers 422, never the realm's version.
- **Operations** (`operations.invoke`, `operations.invokeBatchOperation`):
  `handleOperations` resolves a run's batch against `Realm.#runOperationCore`,
  the realm's operation core with each card the attempt staged answered from
  the overlay. Its index row is built from the staged document, with the
  adoption chain its `adoptsFrom` names, so an operation on a card the run
  created or re-typed resolves against the staged type (a declared name the
  staged type carries runs, and the policy gate matches rules against that
  type), and a predicate reads the staged fields. A `read` entry answers the
  staged document as the realm's card+json `GET` of it does, so with no
  computed fields and no expanded links (unlike a script's `cards.get`, whose
  `readCard` computes them). Its generation is taken from the realm's index
  row, or 0 for a card the run created, and a `read` of a staged file that
  isn't a card answers its metadata from the staged bytes. A staged `.json`
  that isn't a card document is no card to an entry, and a `read` of it
  answers 422, as the card+json `GET` does. A transform program reads a
  staged card as not indexed (`#runBatchCore`'s `indexedCardValues`), so it
  never sees the realm row's computed or linked values. An entry that finds
  its targets with a query searches the index, as `cards.search` does.
- **`cards.search`** runs on the index, and answers each card the attempt
  staged as staged (`Realm.#withStagedCards`): its attributes,
  relationships and type come from the staged document, and the rest of what
  the search answered for it stays. Its attributes are the staged ones, so a
  staged hit carries no computed fields; read it with `cards.get`, which
  computes them from the staged values. A hit whose staged file isn't a card
  document keeps the index's version. Which cards match, and their order, are
  the index's, so **a search won't find a card created in this run, and
  won't match on a value this run changed**; a card it returns staged may no
  longer match the query. This is the decided shape (ADR 027 §1.3), not a
  gap: indexing staged cards would cost a render each.

A script works around the search limit by keeping what it writes in memory:
it builds each card's path from a stable key in the upstream data, so it
reads a card it may have written with `cards.get` (which sees the staged
version) instead of searching for it, and it keeps the cards it creates in
this run in a map of its own rather than finding them again. A search is for
what the realm held when the run started.

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
file's is left alone and enqueues no indexing. The batch carries the run's
`automationRun` (its run id, and the automation id from the run's row), so
the realm records every file it creates in `automation_files` as the
automation's, in the same transaction as its `realm_file_meta` row (after
its bytes are on disk, so a write that fails partway still records the files
that landed); a file the run only changes gets no row. Those rows are what the daily storage charge counts
(see the `pricing` skill). Once it lands, the commit
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

A Preview never commits: it finishes complete, and the finish copies its
attempt's staged files out as the batch it shows (_Preview and Run now_)
and discards its overlay. A run with nothing staged commits an empty batch, which claims and
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

| Group                 | Methods                                                                               | On the automation surface                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads                 | `cards.search`, `cards.get`, `entries.search`, `fs.readText`, `fs.list`, `fs.exists`  | yes, in the run's own realm only: `entries.search` refuses any other, and both searches go to the realm's own `_search` (the realm server's `_federated-search` takes only a session token)                     |
| Writes                | `fs.writeText`, `fs.writeBytes`, `fs.replace`, `fs.copy`                              | yes; card+source writes the realm server stages in the run's overlay (_The run overlay_)                                                                                                                        |
| Card updates          | `cards.update`                                                                        | yes; saved through `_atomic` when the script finishes, within its time limit. The realm server refuses a run's `_atomic` unless that route stages its writes, and the run then fails at the save                |
| Operations            | `operations.invoke`, `operations.invokeBatchOperation`                                | yes; the realm server admits a `callApi` only for an operation the card declares, counts it against `callApiCalls`, and refuses a write operation it doesn't stage (_Declared operations and the per-run caps_) |
| Resolve               | `resolve`                                                                             | yes; counted against `resolveCalls` and priced against `aiCredits` at `_request-forward` when the forward carries the run's token                                                                               |
| Progress              | `activity`, `progress.plan`, `progress.milestone`, `progress.count`                   | yes; `progress.*` only here                                                                                                                                                                                     |
| Console               | `console.log`, `console.info`, `console.warn`, `console.error`                        | yes; only here                                                                                                                                                                                                  |
| Downloads and deletes | `fs.download`, `fs.delete`                                                            | no                                                                                                                                                                                                              |
| Web, images, capture  | `web.search`, `web.read`, `images.generate`, `capture`                                | no                                                                                                                                                                                                              |
| Session and UI        | `room.*`, `ui.*`, `workspaces.*`, `index.*`, `plan`, `ask`, `operations.capabilities` | no                                                                                                                                                                                                              |
| Transforms            | `transform`                                                                           | no; interactive surface only                                                                                                                                                                                    |

The unit test `realm-runner-surfaces-test.ts` pins `AUTOMATION_METHODS` and
fails when a method on it reaches anything but a realm read, a staged write,
an operation, the model, progress or the console. Adding a method, or moving
one between surfaces, changes that test in review. The interactive surface's
guest has `realm` and `room`, and no `console` or `progress`.

How a method differs from the interactive surface:

- **`fs.writeText` writes the file whole**, whether or not it exists. The
  interactive surface only creates, and edits through `fs.replace`. A write
  of the content the file already holds is reported as unchanged.
- **No interactive per-run limits**: no 20-file, 200-card-update,
  200-operation or 3-`resolve` limit. The card's caps take their place, and
  the realm server counts each against the run row (_Declared operations and
  the per-run caps_).
- **A limit on file content held**: a run keeps every file it reads, every
  version it writes and every card it updates until it ends, in a tab other
  runs share, so it holds at most `MAX_AUTOMATION_HELD_CHARS` (20,000,000)
  characters of them. A read, write or update past that throws in the script,
  before anything is held or written. A file counts as the version the run
  first read and its latest one, so a loop of edits to one file stays within
  it.
- **Progress and console are one-way**: they return nothing, so a script
  needn't await them, and an unawaited one doesn't fail the run. A bad
  argument (an empty milestone name, `count(3, 2)`) throws in the script.
  A run reports at most `MAX_RUN_NOTIFICATIONS` (5,000) of them, of
  `MAX_RUN_NOTIFICATION_CHARS` (2,000,000) characters of arguments together:
  they cost memory in a tab other runs share. The worker drops the rest
  before posting them, and the run's progress ends with one `warn` line
  saying how many it dropped.

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
| `lastSuccessAt`  | when the automation's last complete run started, if it has had one; a Preview never counts      |
| `params`         | the automation card's params; a trigger has none of its own                                     |
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

Every text in an event, the script's result and the message of the error a
run rejects with pass through `redactSecrets` first. It replaces with
`[REDACTED]` each value the caller registers in `secrets` (the run's own
token) and every credential it recognizes:

- by shape: a vendor key (a prefix in `CREDENTIAL_PREFIXES`,
  `packages/runtime-common/credential-prefixes.ts`, the list the realm
  server's response scrubber uses too, and a key-like tail), a JWT, a
  `Bearer` token (only as written, so "the bearer of" stays), an AWS access
  key id and a PEM private key;
- by name: the value of an `Authorization` header, and of a JSON field or
  query parameter named like a credential (`"api_key": "…"`, `"password":
…`, `?token=…`, `&key=…`).

The name it was found under stays (`Authorization: Bearer [REDACTED]`,
`"api_key":"[REDACTED]"`). `redactSecrets` lives in
`packages/runtime-common/redact-secrets.ts`, a leaf module the worker bundle
and the realm server both import. The scrubber still removes a vendor's own
key from a `callApi` response before the script sees it.

When the run rejects, `runAutomationScript` records one last event before it
does: `{ kind: 'error', message, line?, stack? }`. `line` is the script's line
the error was thrown on, and `stack` keeps only the stack's frames on the
script's own lines, each naming its `script line N` (the bootstrap's frames
and the wrapper's call to the script are left out). The worker maps them from
QuickJS's dumped stack, minus the wrapper's line
(`REALM_RUNNER_WRAPPER_LINES`), for every error the script throws, not only
the four kinds `RealmScriptError` describes. A run stopped at its time limit
ends with that message and no line or stack, since it was stopped wherever it
was. The run's token expires at that same limit, so the tab's send of that
line is usually refused; the realm server's `finish` line (below) says why the
run ended either way.

## The run log

A run's log is its script's lines and the platform's lines (ADR 025 §1.1). It is stored in Postgres for the console and written to the
realm server's log for Loki. The code is
`packages/runtime-common/automation-run-log.ts`.

### Where the lines come from

| `source`   | `kind`                                                       | Written by                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `script`   | `console`, `activity`, `plan`, `milestone`, `count`, `error` | the run's tab: `RunLogSink` (`packages/host/app/lib/realm-runner/run-log-sink.ts`) sends the progress sink's events to the realm's `POST /_run-log` with the run token                                                                     |
| `platform` | `call-api`                                                   | `callApiOperation`, through the run's `CallApiRunMeter.logCall`: operation, method, destination with query values masked, status, time and size, or why it was refused                                                                     |
| `platform` | `resolve`                                                    | `_request-forward`, for a forward that carried the run's token: model, status, time and cost                                                                                                                                               |
| `platform` | `commit`                                                     | `/_run-commit`: the files saved, or the refusal's code and detail                                                                                                                                                                          |
| `platform` | `finish`                                                     | `finishAutomationRun`, `abandonAutomationRun` and `cancelAutomationRun`, once the row changes: how the run ended, with the row's `error_reason` and `error_message` (a cap that ended it, a time limit, a script error) or who canceled it |

`RunLogSink` implements `FlushableRunProgressSink`. It sends a batch of at
most `RUN_LOG_MAX_BATCH_LINES` (500) events and `RUN_LOG_MAX_BATCH_BYTES`
encoded bytes (`RUN_LOG_MAX_REQUEST_BYTES`, 2 MiB, less headroom; the realm
counts the body in bytes, so text outside ASCII fills a batch first) once
either is reached or a second after the first of them, one batch at a time, each given up on after
`RUN_LOG_SEND_TIMEOUT_MS` (10 s), so `flush` always settles. Whoever runs the
script calls `await sink.flush()` before the commit and before finishing the
run.

**Order.** The realm server stores its lines as it does the work, while the
script's lines wait in the sink. So `runAutomationScript` flushes a flushable
sink before each `operations.*` and `resolve` call, and the script's lines
from before a call are stored before the call's own line. `seq` is the order
lines were stored in.
`/_run-log` goes through `Realm.handleAutomation` like every run-token call,
so it takes lines only while the run is `running` under the token's attempt.
A flush after the run finished is refused with a 401, and the sink reports
that to its `onError` and never throws: the log never fails a run. A route
takes only the script's kinds, so nothing the tab sends can pass for a
platform line.

Every line is redacted again as it is stored, with `redactSecrets` and the
token it arrived with, whoever sent it. A message is cut at
`RUN_LOG_MAX_MESSAGE_CHARS` (10,000) and says how much it lost. Query values
in a logged URL are always masked (`maskedRunLogURL`); header values are
never logged.

### The cap

A run's log holds at most `RUN_LOG_MAX_LINES` (10,000) lines and
`RUN_LOG_MAX_CHARS` (5,000,000) characters of messages and data together.
`appendRunLog` locks the run row, checks the cap against `log_lines` and
`log_chars`, stores what fits and adds the rest to `log_dropped`. `readRunLog`
ends a capped log with one `warn` line saying how many were dropped. Separately,
the worker drops one-way calls past `MAX_RUN_NOTIFICATIONS`, and `RunLogSink`
drops the oldest past `RUN_LOG_MAX_PENDING` (5,000) waiting events, besides
the batch in flight, when the realm server answers slowly; each says how many
in a line of its own. A time no `Date` holds is stored as the time the line
arrived, and a script line past Postgres's `integer` is left off, so one bad
event doesn't cost its batch.

### How the console reads a run's log

The console reads a run's log through the realm server's
`GET /_automation-run-log` (`handleAutomationRunLog` in
`handlers/handle-automations.ts`; path, parameters and the answer's shape in
`runtime-common/automation-routes.ts`), never through the realm's
`/_run-log`, which only takes the lines a run's tab sends with its token.

```
GET /_automation-run-log?realm=<realm URL>&run=<run id>&after=<seq>&limit=<n>&level=warn,error
```

| Parameter | Means                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `realm`   | the realm the run belongs to                                                                                                        |
| `run`     | the run's id                                                                                                                        |
| `after`   | the `seq` the page starts past; absent or `-1` reads from the start                                                                 |
| `limit`   | the most lines on a page: `AUTOMATION_RUN_LOG_DEFAULT_LIMIT` (500) when absent, at most `AUTOMATION_RUN_LOG_MAX_LIMIT` (1000)       |
| `level`   | the levels to keep, comma-separated from `log`, `info`, `warn` and `error`; absent keeps every line. A line with no level is `info` |

It answers only the session's own user, and only a direct writer of `realm`,
like the other automation routes. The session check refuses a delegated
session and a run token with 401. The route refuses a reader and a
realm-authority session with 403 before it looks the run up, so that refusal
is the same whether or not the run exists. A run of another realm, or an id
that names no run, is 404. A parameter out of range is 400.

The answer is one page (`readRunLogPage` in `automation-run-log.ts`):

```json
{
  "data": {
    "type": "automation-run-log",
    "id": "<run id>",
    "attributes": {
      "state": "running",
      "lines": [
        {
          "seq": 0,
          "at": 1795424400000,
          "source": "script",
          "kind": "console",
          "level": "log",
          "message": "…",
          "scriptLine": 3
        }
      ],
      "next": 0,
      "more": false,
      "total": 1,
      "dropped": 0
    }
  }
}
```

- **`next`** is the `after` for the next page. With a level filter it passes
  the lines the filter left out, so a reader never scans them again.
- **`more`** says the log already holds lines past `next`: read again at once.
- **`total`** is the lines stored, whatever the filter. **`dropped`** is the
  lines the cap refused (`log_dropped`). The console shows the count beside
  the log; no line on a page stands for them, unlike `readRunLog`'s closing
  `warn` line.
- A page ends at the lines stored when the run's row was read, so a line
  appended while the page is read waits for the next page and is never
  skipped by the cursor.

**Live lines are polled.** The `job` realm event never carries log text (see
_The `job` realm event_), so the console follows a running run with
`followAutomationRunLog` (`runtime-common/automation-run-log-follow.ts`). It
reads page after page with the last `next`, reads on at once while `more`,
and otherwise asks again every `AUTOMATION_RUN_LOG_FOLLOW_INTERVAL_MS`
(2 s) while the run is `pending` or `running`. Call its `wake()` on each `job`
event for the run, so a milestone or the run's end is read at once. The
realm server writes the run's `finish` line just after the row ends, so once
a page reads the run ended with nothing more, the follower reads once more an
interval later, which a wake doesn't shorten, and then stops; `done` settles
then. A refused read (a 4xx) stops it too, with the refusal passed to
`onError`; any other failure is tried again at the next interval. `stop()`
settles `done` at once, and a read in flight then reports neither its page
nor its failure. A finished run's log is read the same way:
its pages in turn, then the follower stops.

By hand in development, with a realm-server session token for a direct writer:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4201/_automation-run-log?realm=http://localhost:4201/example-user/example-realm/&run=<run id>&level=warn,error'
```

### Reading a run's log in Postgres

```sql
SELECT seq, at, source, kind, level, script_line, message, data
  FROM automation_run_log WHERE run_id = '<run id>' ORDER BY seq;

-- the log's size against its cap
SELECT log_lines, log_chars, log_dropped FROM automation_runs WHERE id = '<run id>';

-- just the errors and refusals, across an automation's recent runs
SELECT l.run_id, l.at, l.kind, l.message
  FROM automation_run_log l JOIN automation_runs r ON r.id = l.run_id
 WHERE r.automation_id = '<automation card id>' AND l.level = 'error'
 ORDER BY l.at DESC LIMIT 50;
```

Deleting a run row deletes its log (`ON DELETE CASCADE`).

### Reading a run's log in Loki

Each stored line is also logged once by the realm server on the
`automation-run-log` logger, as

```
[automation-run-log] automation=<card id> run=<run id> job=<queue job id> seq=3 source=platform kind=call-api level=info status=200 ms=41 msg="callApi latest GET https://…: 200 in 41 ms, 912 bytes"
```

The tags are in the line, not Loki labels (a run id per label would be a
series per run). `job` is the queue job that owns the run's attempt
(`job_reservations.job_id` for the row's `attempt`), absent when there is
none. The tags come right after the prefix and the message is last and
JSON-quoted, but a script can print text that looks like tags, and LogQL's
`|=` and `|~` match anywhere in the line. Anchor a query on the prefix and the
tags, so it reads the tags the platform wrote. With the `tail-logs` skill:

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex '\[automation-run-log\] automation=\S+ run=<run id> ' --since 1h --no-follow
# one queue job's run
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex '\[automation-run-log\] automation=\S+ run=\S+ job=42 ' --since 1h --no-follow
```

A log that reaches its cap logs one `warn` line saying later lines are
dropped. Lines come from whichever realm-server task took the request, so
query by the run, not by one task.

### Run milestones

The script is the only source of a run's milestones; the card holds no list of them, since a list kept on the card drifts from what the code does. The script declares them all up front and marks each as it reaches it:

```js
realm.progress.plan(['Fetch issues', 'Group by label', 'Write digest']);
realm.progress.milestone('Fetch issues');
for (let [i, page] of pages.entries()) {
  realm.progress.count(i + 1, pages.length); // within the milestone
  // …
}
realm.progress.milestone('Group by label');
```

They reach the realm server as the run's `plan`, `milestone` and `count` log lines. `appendRunLog` hands each batch to `recordRunMilestones` (`packages/runtime-common/automation-run-milestones.ts`) under the run row's lock, before it checks the log's cap, so a run whose log is full still records where it got to:

| Where                                | Holds                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `automation_runs.milestone_plan`     | the plan the script declared last (a second `plan` replaces it), at most `RUN_MILESTONE_MAX_PLAN` (50) names of `RUN_MILESTONE_MAX_NAME_CHARS` (80) characters, the surface's limits |
| `automation_run_milestones`          | one row per milestone the run reached, at `position` in the order reached, with `started_at` (the tab's time for the mark) and the last `count_done` / `count_total` inside it       |
| `automation_runs.milestones_dropped` | marks past `RUN_MAX_MILESTONES` (200) a run records; the run's last recorded milestone then lasts until the run ends                                                                 |

A milestone lasts until the next one starts, or until the run ends (`finished_at`). A milestone the plan doesn't name is recorded like any other and reads as unplanned; one marked twice is two rows. A count before the run's first milestone is ignored, as is one inside a milestone marked past the limit. An attempt that takes a run from another attempt (`startAutomationRunAttempt`, before the commit is claimed) clears the run's plan and milestones, since the script runs again from its start.

**Reading them.** `readRunMilestones(dbAdapter, runId)` answers a run's `plan`, its `milestones` in order (`name`, `planned`, `startedAt`, `endedAt`, `ms`, and `done` / `total` when counted), `current` (the milestone a running run is in), `ahead` (the plan's milestones it hasn't reached), `failedIn` (for a run that ended with an error, the milestone it was in) and `dropped`. `readLastRunMilestones(dbAdapter, automationId)` answers the same for the automation's last run that started and has ended, leaving Previews out: what the card shows, through `_automation-status`'s `lastRun`.

```sql
SELECT r.state, r.milestone_plan, m.position, m.name, m.started_at, m.count_done, m.count_total
  FROM automation_runs r LEFT JOIN automation_run_milestones m ON m.run_id = r.id
 WHERE r.id = '<run id>' ORDER BY m.position;
```

**Telemetry.** As a run ends (`finishAutomationRun`, `abandonAutomationRun`, `cancelAutomationRun`), `closeRunMilestones` writes each of its milestones once to the `boxel:automation-milestones` channel: one JSON line with `automation`, `realm`, `run`, `job` (the run's queue job, when it had one), `outcome`, `errorReason`, `milestone`, `position`, `planned`, `ms`, `done`, `total` and `failedHere`, the numbers flat so LogQL can `unwrap` them. `outcome` is the run's state as it ended, so a `commit-interrupted` run whose batch landed afterwards reads `error` there and `complete` on its row:

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex '"channel":"boxel:automation-milestones"' --since 1d --no-follow
```

Every boundary a run crosses (enqueue, claim, admission, the tab, the
commit, the finish, the index pass, each charge) is also one line on the
`boxel:automation-runs` channel, tagged with the run's ids; the
`automation-diagnostics` skill reads them.

## The `job` realm event

A run that moves sends a `job` realm event. The run moves when its state, its
step or its run milestone changes. The event is `JobEventContent` in
`packages/base/matrix-event.gts`:

```json
{
  "eventName": "job",
  "runId": "<automation_runs id>",
  "automation": "<the automation card's id, in RRI form>",
  "state": "running",
  "step": "script",
  "milestone": "Write digest",
  "realmURL": "<the realm's URL>"
}
```

- **`step`** is `admission`, `script` or `commit`, read from the run row by
  `automationRunStep`. `commit_started_at` set means `commit`. `admitted_at`
  set means `script`. `started_at` set means `admission`. A run no attempt has
  started has no step (`null`). An ended run keeps the step it got to, so a
  run that admission refused reads `error` at `admission`. An attempt that
  takes a run over from another clears `admitted_at`, so the retry's own
  admission reads as `admission` again.
- **`milestone`** is the name of the run's last `automation_run_milestones`
  row, or `null` before its first. A `count` inside a milestone sends no
  event.
- **`automation`** is the card's identifier in RRI form (ADR 002 §1.3), the
  spelling the card's own id has, so a card matches the event against its id.
- **No person is in it.** Who the run acts as, who canceled it, and its error
  reason and message aren't in the event. A subscriber reads them from a route
  that checks who is asking (ADR 011).

### Who receives it

`Realm.broadcastJobEvent` sends the event only to the session rooms of the
realm's direct writers (`fetchDirectWriters`). It hands the adapter a
`RealmEventDelivery.refresh`, which the node adapter asks when the event
reaches the head of the realm's line of events (`realm-event-dispatcher.ts`):
the run's event and the writers are read again then, so an event that waited
behind others goes out with the run as it is and only to the writers there
are when it is sent. It never goes into the realm's own event room, and never to a reader, a `*` or
`users` row, a policy grant or a bot account. A realm with no direct writer
sends it nowhere. Every route into delivery leads there:
`Realm.broadcastEvent` (the worker's bridge) and the realm's private
broadcast both hand any `job` event to it. A writer without a session room
receives nothing, as with every narrowed realm event.

### Who reports a change

Each process reports through a `ReportRunChange` (`runId => Promise<void>`)
that reads the row (`readJobEvent`) and sends the event. Within one realm
server process the events go out in order, each read as it is sent. A worker's
reports reach whichever realm server answers its request, so events from
different processes can still arrive out of order: a subscriber treats the
event as a cue to read the run again. A report never rejects. A failed one is
logged as `could not send the job event for automation run …`.

| Change                                           | Reported by                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trigger's run is created (pending)             | the `automation-tick` task                                                                                                                                                                |
| Preview or Run now creates its run               | `startAutomationPreview` / `startAutomationRunNow`, given `reportRunChange` in their options                                                                                              |
| An attempt starts the run, admits it, or ends it | `runAutomationAttempt` (`AutomationAttemptContext.reportRunChange`, built in the `run-command` task)                                                                                      |
| A milestone is reached                           | the realm's `/_run-log` route, when `appendRunLog` reports `milestones > 0`                                                                                                               |
| The commit is claimed, released or lands         | the realm's `/_run-commit` route                                                                                                                                                          |
| A call ends the run at a cap                     | `endRunAtCap` (the realm's `callApi` meter; the request forwarder for AI requests)                                                                                                        |
| A pause, remove or cancel ends runs              | `withRunCancels` and `cancelAutomationRunFor`, given `reportRunChange` (`AutomationActorOptions`, `AutomationSyncOptions`, or a trailing argument); archiving and the index hook pass one |

A worker holds no Matrix client. `taskRunChangeReporter` hands its event to
`reportRealmEvent`, and the realm server's `/_worker-request` delivers it
through `Realm.broadcastEvent`. A route that serves no single realm (the
request forwarder, archiving) uses `realmServerRunChangeReporter`
(`realm-server/lib/run-change-reporter.ts`), which finds the run's realm
through the reconciler. **New code that moves a run** reports it the same way.
A lifecycle function that takes `AutomationActorOptions` reports when its
caller passes `reportRunChange`. A route that serves one of them passes the
realm's `reportRunChange`.

### Watching it

In the host, subscribe to the realm's events the way other realm-event
consumers do. Skip any event whose `eventName` isn't `'job'`, then match
`automation` (or `runId`) and read the run again. For an automation card,
read `GET <realm>/_automation-status`. For a run, read its report. For a
run's log, wake the run's `followAutomationRunLog` (see _How the console
reads a run's log_). The
event is a cue to re-read, not the run's record. Missing one is harmless,
because the next change sends another, and a subscriber that comes back reads
the run afresh anyway.

To see the events locally, read the direct writer's session room
(`users.session_room_id`) in Synapse. The event type is
`app.boxel.realm-event`, with `content.eventName = "job"`. If a writer gets
nothing, check that they hold a `write` row of their own in
`realm_user_permissions` and aren't a bot account (`isBotAccount`), and that
`users.session_room_id` is set.

## The `automation` realm event

A change to an automation's own row sends an `automation` realm event: a
direct writer switches it on, pauses, resumes or removes it; something pauses
it without a person (a raised cap, the payer losing access, its runs failing
repeatedly, archiving the realm); its card is deleted or stops adopting from `Automation`, which removes
the row; or its state moves between active, waiting for credits and done. The
event is `AutomationEventContent` in `packages/base/matrix-event.gts`:

```json
{
  "eventName": "automation",
  "automation": "<the automation card's id, in RRI form>",
  "realmURL": "<the realm's URL>"
}
```

It is its own event rather than a `job` event with no run. A `job` event
describes a run: its `runId`, its run state, its step and its milestone. None
of those exist for a change to the row, and a subscriber that reads a run on
every `job` event would have to learn to skip run-less ones. The `automation`
event carries no state of its own, only the automation, so it can't go stale
behind another event: a subscriber reads the automation again on it
(`GET <realm>/_automation-status`). A change that cancels runs (a pause, a
remove) sends a `job` event for each run and one `automation` event.

### Who receives it, who reports it

It goes where a `job` event goes: `Realm.broadcastAutomationEvent` sends it to
the session rooms of the realm's direct writers alone, read again as it is
sent, never into the realm's own room. `Realm.broadcastEvent` (the worker's
bridge) and the realm's private broadcast route any `automation` event there.

Every function that changes the row takes `AutomationReporters`
(`reportRunChange`, `reportAutomationChange`) and reports once its
transaction has committed. `withChanges` in `automations.ts` collects the
canceled runs and the changed automations, so a transaction the database
retries reports once. A `ReportAutomationChange` (`automation-change-events.ts`)
takes the automation's id and realm, since a removed automation has no row to
read them from, and never rejects; a failed report is logged as
`could not send the automation event for …`.

| Change                                                                                                                                                                             | Reported by                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch-on, pause, resume, remove                                                                                                                                                   | `switchOnAutomation`, `pauseAutomation`, `resumeAutomation`, `removeAutomation`, given the reporter                                                                       |
| The payer losing access                                                                                                                                                            | `checkAutomationPayer`, `pauseForPayerLostAccess`, from the run's admission (`AdmissionContext.reportAutomationChange`)                                                   |
| A move into or out of waiting for credits                                                                                                                                          | `setAutomationWaitingForCredits`, from the run's admission (`AdmissionContext.reportAutomationChange`)                                                                    |
| Archiving the realm                                                                                                                                                                | `pauseRealmAutomations`, from the archive handler (`realmServerAutomationChangeReporter`)                                                                                 |
| Its runs failing repeatedly                                                                                                                                                        | `pauseAfterRepeatedFailures`, from `runAutomationAttempt` (`AutomationAttemptContext.reportAutomationChange`)                                                             |
| The card's index hook removes it, pauses it for a raised cap, batched AI or a changed webhook, lifts an invalid-declaration pause or updates its problems, or makes it done/active | `syncAutomationWithCard`, from `syncAutomationsAfterIndex` in the indexing tasks. `checkAutomationCaps` pauses the same way and reports to a caller that passes reporters |
| The tick makes it done, or moves its next run without starting a run (every due slot joined a pending run)                                                                         | `tickAutomations` (`AutomationTickOptions.reportAutomationChange`)                                                                                                        |
| The tick or reconcile pauses it for an invalid declaration                                                                                                                         | `pauseForInvalidDeclaration`, from `tickAutomations` (`AutomationTickOptions.reportAutomationChange` and `reportRunChange`, which reconcile passes through too)           |

A sync that leaves the state as it was reports nothing: its new next run
follows a card edit, which the card's `index` event already announces. A tick
that starts a run and leaves the state as it was reports nothing either, since
the run's `job` event announces it. A worker reports through
`taskAutomationChangeReporter`, which hands the event to `reportRealmEvent`.
A realm route that changes a row passes `Realm.reportAutomationChange`. **New
code that changes an automation's state** (a new pause reason, say) reports
the automation the same way once its change commits.

### Watching it

Subscribe to the realm's events, skip any event whose `eventName` isn't
`'automation'` (or `'job'`, when runs matter too), match `automation` against
the card's id, and read `_automation-status` again. The catalog `Automation`
card's status does this, and so should anything that lists a realm's
automations. To see it locally, read a direct writer's session room in
Synapse for `app.boxel.realm-event` with `content.eventName = "automation"`.

## The automations console

The automations console is the realm config's **Automations** section, where a realm's direct writers see every automation in the realm. There is no separate console surface: "the console" means this section. It lives in `packages/base/realm-automations.gts` (`RealmAutomations`, the default export), which the realm config card's isolated view (`packages/base/realm-config.gts`) renders last.

- **Each automation is the Automation card's own fitted view** (the catalog's `automation/automation.gts`), loaded through the card context's `getCard` and rendered in a slot as wide as the section and 105px tall (the height of the `triple-extra-wide-strip` fitted size). At that size the fitted view shows the state chip, the first trigger, the next run in the viewer's own time, the last result, the run's milestones as a vertical timeline that fits the space, the payer, this month's spend against the monthly cap, and any limit the automation is near or at. A card that doesn't load (a switched-on automation whose card the index lacks, say) falls back to a one-line summary from the route: name, state chip, and the next run, the milestone a run is in, or why Boxel paused the automation.
- **A click on an automation**, or Enter on its row, opens the card's isolated view (`ShowCardTool`).
- **New automation** calls the stack's `createCard` (the realm config passes its `@createCard` down), which makes the Automation in the store, with no round trip through the realm's index, and opens it in its edit view in the realm config's own stack. The edit view fills the default caps on a card that has none, and the person names the automation there. The button shows only where the realm config has a `createCard`.

The section renders only once the route answers, and only when it answers that the viewer is a direct writer; anyone else sees no section at all. It reads `GET <realm>/_automations` through the host's `authed-fetch` tool, and reads the route again on every `job`, `automation` and `index` realm event for the realm (a burst reads the route once), since a run moving, a change to a row and a card edit each change the list.

### The list route

`GET <realm>/_automations` (`answerAutomationList` in `packages/runtime-common/automation-list.ts`, loaded on first use like `automation-status.ts`) answers on the realm ACL (401 for an anonymous caller on a realm only signed-in users read), then lists automations only to a direct writer (`isDirectWriter`, asked of `#statusViewer`'s session). Anyone else the ACL lets read gets HTTP 200 with `{ data: [], meta: { directWriter: false } }`, not a 403: the host's `authErrorEventMiddleware` takes any 401 or 403 that comes back through `authedFetch` as an auth failure and fails whatever is rendering at the time, and the realm config asks while it renders. A direct writer gets `no-store` `{ data: [<automation-summary>], meta: { directWriter: true } }`, ordered by name. It holds one resource per automation card the index holds (`IndexQueryEngine.getInstanceSourcesOfType` with the `automationRef` key the declaration reader requires), switched on or not, plus any switched-on automation whose card doesn't read from the index, listed from the row with a null `title` and each trigger the row counted. Each resource's `id` is the card's URL, and its attributes are:

| Attribute                            | Holds                                                                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                              | the card's `cardInfo.name`, or null                                                                                                                                                                                                                  |
| `switchedOn`, `state`, `pauseReason` | from the row; `state` and `pauseReason` are null when the automation isn't switched on                                                                                                                                                               |
| `triggers`                           | each trigger as the card declares it: `label`, `kind`, and the kind's fields (`expression` and `timeZone`; `date`, `time` and `timeZone`; `webhookPath`)                                                                                             |
| `nextRun`                            | the row's next run as an ISO time; null when none is left, or when the automation isn't switched on                                                                                                                                                  |
| `payer`, `viewerIsPayer`             | the payer's Matrix id only when the viewer is the payer or shares a realm grant with the payer (ADR 011 §1.2), else null                                                                                                                             |
| `monthlyCredits`                     | the monthly cap the payer agreed to (the caps snapshot) when switched on, the card's otherwise                                                                                                                                                       |
| `spentThisMonth`                     | what the automation was charged this UTC month across every charge kind that names it: `automationCreditsSince` in `automation-spend.ts`, the sum the monthly cap's admission check compares, so the figure a viewer reads is the one the cap counts |
| `lastResult`, `lastFinishedAt`       | the automation's last run that started and ended, leaving out Previews                                                                                                                                                                               |
| `currentRun`                         | the run in progress, leaving out a Preview: `runId`, `startedAt`, `milestone` (the run milestone the script last reported, or null before the first) and `done` / `total` when the script counts inside the milestone; null when nothing runs        |

Host tests mount a virtual-network handler that answers the route (`tests/acceptance/realm-automations-test.gts`), since an in-browser test realm has no `automations` table.

## The automation command

One attempt of a run is a `run-command` job naming `AUTOMATION_COMMAND`
(`@cardstack/boxel-host/tools/run-automation/default`, in
`runtime-common/automation-run-command.ts`). The run-command task hands such a
job to `runAutomationAttempt` (`runtime-common/tasks/run-automation.ts`)
instead of the ordinary command path. No other path runs it:
`prepareRunCommand` refuses it, so `/_run-command`, bot commands and webhook
receivers can't run it with a person's sessions (ADR 025 §1.3).

### The job

`enqueueAutomationRunJob` (`runtime-common/jobs/run-command.ts`) enqueues it
for a run row its trigger has already made with `createAutomationRun`:

- `commandInput` is an `AutomationJobInput`: the run's id, `scheduledAt`,
  `dryRun`, and for a run no trigger on the card names, `triggerKind`
  (`manual` or `batch`), plus a webhook run's `webhookPayload`;
- `dedupeKey` is `automationRunDedupeKey(run)`,
  `automation:<id>:<trigger>:<slot>`. The worker runs a job only when its key
  is its run's, so a job some other publisher enqueued that names a run id
  touches nothing (`not-the-runs-job`);
- `concurrencyGroup` is `automation:<id>`, so an automation runs one at a time;
- the priority is `automationInitiatedPriority`;
- the timeout is `automationJobTimeoutSec(secondsCap)`: the run's time limit
  plus `AUTOMATION_JOB_OVERHEAD_SEC` (120 s) for the steps around the script.
  Every other `run-command` job keeps `RUN_COMMAND_JOB_TIMEOUT_SEC` (60 s).

### One attempt

`runAutomationAttempt`, in order:

1. Checks the job's key against the run, then `startAutomationRunAttempt`
   with the job's reservation id as the attempt, and does what the start says
   (_An attempt, start to finish_).
2. Reads the card's declaration and the run's limits from the index. A card
   that doesn't read as an automation ends the run (`not-an-automation`).
   Then admits the run's identity and the automation's row (_Admission_). A
   retry gets what is left of the run's time, counted from its first start,
   never a fresh limit; none left ends it (`timed-out`).
3. Mints the run's token with the worker's `mintRunToken`
   (`buildMintRunToken` in `realm-server/lib/run-token.ts`, wired in
   `worker.ts`). Read realms are `RUN_READ_REALMS`, the base and catalog
   realms.
4. Reads the script file with the run's token, so the read takes the realm's
   check as the run's identity (`missing-script` when it can't), and records
   its id and the sha256 of its text with `recordAutomationRunScript`. At
   most `MAX_AUTOMATION_SCRIPT_CHARS` (100,000) characters. Then finishes
   admission: the script parses, every declared operation passes, and the
   spending check, after which `recordAutomationRunAdmitted` sets
   `admitted_at` and the log gets its `admission` line.
5. Sends the script to a prerender tab with `prerenderer.runCommand`, with
   `runRealm` set to the automation's realm, the run's token as the whole of
   the tab's auth, the `AutomationScriptInput` as a `JsonCard`'s `json`, and
   `timeoutMs` of what's left of the time limit plus 30 s
   (`AUTOMATION_TAB_GRACE_MS`). The input carries `endsAt`, when the time
   limit passes, so time spent waiting for the tab comes off the script's.
6. Finishes the run from what the tab answers:
   - `complete`, Preview (the row's `dry_run`, or the job's `dryRun`):
     finishes complete without a commit, which copies the staged files out
     as the Preview's batch and discards the overlay;
   - `complete`: commits with `POST /_run-commit` carrying the token, sent
     again up to three times on `overlay-changed` or when its answer is lost
     (the realm answers this attempt's commit again with the same success),
     and finishes complete on `200`. Any other answer finishes the run as an
     error named by the refusal's code (_Committing the overlay_), unless
     the row says the batch landed, which finishes it complete;
   - `error`: finishes the run as an error with the outcome's reason
     (`script-error`, `timed-out`, `call-failed`, `run-failed`, `stopped`) and its message, prefixed
     `line N:` for a script error that has a line. The finish discards the
     overlay, so nothing the script staged lands;
   - a tab that never answered (`unusable`) is `timed-out`; a command that
     failed or a request that failed is `run-failed`.

The run's token is redacted from every message the row records.

### Admission

Before a run costs anything, each attempt admits it
(`packages/runtime-common/automation-admission.ts`, ADR 026 §1.5). Every
attempt admits again, since what admitted an earlier one can have changed. A
refused run finishes as an error whose `error_reason` is the refusal's code,
its tab is never asked to run the script, and its log gets one `admission`
line at level `error` with `data.reason`. An admitted run sets
`automation_runs.admitted_at` and logs an `admission` line with
`data.admitted = true`.

The declared operations are checked by the automation's realm, not the
worker. The worker asks `GET <realm>/_run-admission` (`RUN_ADMISSION_PATH` in
`automation-admission-route.ts`) with the run's token, and the realm checks
each operation the card declares as the run's identity through
`CallApiSender.admitAutomation`, which realm-server implements with
`automationAdmission` over the realm's own operation core. Only a realm can
check an operation the way its call is checked: the worker mounts no realm,
and its definition cache can't read a private realm's modules. The route
answers the first refusal, or none. Anything but the run's own token in its
own realm gets 403 `not-a-run`, and a realm the worker can't ask refuses the
run (`run-admission-failed`).

The worker's own checks (`AutomationAdmissionChecks`) are built in
`realm-server/worker.ts` by `buildAutomationAdmissionChecks`
(`lib/automation-admission-checks.ts`): the Matrix account lookup, and the
spending hook. A worker without them refuses every run as
`account-unverifiable`.

| Code                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                      | What fixes it                                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `not-switched-on`                                                                 | A run of one of the card's triggers, and the automation has no row: it was removed, or never switched on                                                                                                                                                                                                                                                                                                 | A direct writer switches it on again                                                                                   |
| `automation-paused`                                                               | A run of one of the card's triggers, and the row is `paused` (the run was enqueued before the pause)                                                                                                                                                                                                                                                                                                     | A direct writer resumes it, which also makes them the payer                                                            |
| `payer-changed`                                                                   | A trigger's run that acts as someone other than the automation's payer: a resume made someone else the payer after the run was enqueued                                                                                                                                                                                                                                                                  | Nothing: the automation's next run acts as the new payer                                                               |
| `not-a-direct-writer`                                                             | The person the run acts as has no permission row of their own granting write in the realm (a `*` or `users` row, a policy grant and a bot account never count). When they are the automation's payer, the automation is paused with `payer-lost-access` too (`checkAutomationPayer`)                                                                                                                     | Another direct writer resumes the automation and becomes the payer; for a Run now, someone who writes directly runs it |
| `session-revoked`                                                                 | `users.sessions_revoked_at` is after the run was given its identity's authority: the payer's switch-on or last resume (`automations.scheduled_since`) for a trigger's run, the submitting run's start for a batch's follow-up, the run's own start (`automation_runs.created_at`) for a manual run. A payer's revocation also pauses the automation with `payer-lost-access` (`pauseForPayerLostAccess`) | The person signs in again and a direct writer resumes the automation, which moves `scheduled_since`                    |
| `account-deactivated`                                                             | The Matrix server's admin API says the account is deactivated or locked, or has no such user. A payer's also pauses the automation with `payer-lost-access`                                                                                                                                                                                                                                              | Another direct writer resumes the automation and becomes the payer                                                     |
| `account-unverifiable`                                                            | The worker can't ask: it has no admission checks, no Matrix server name, no admin credentials (`MATRIX_ADMIN_USERNAME`/`MATRIX_ADMIN_PASSWORD`, set on the worker task in infra's `configs/boxel-worker`), or the Matrix server didn't answer. What the Matrix server answered goes to the worker's log (`automation-admission`), never to the run                                                       | Fix the worker's credentials or the Matrix server; the next run is admitted                                            |
| `not-an-automation`, `missing-script`, `script-error`                             | The card doesn't read as an automation, the script can't be read with the run's token, or it is empty, too long, or doesn't parse as the Realm Runner wraps it (`scriptParseError`)                                                                                                                                                                                                                      | Fix the card or the script                                                                                             |
| `binding-not-approved`                                                            | A declared operation has no approval for automations by the run's identity                                                                                                                                                                                                                                                                                                                               | The person approves the operation in the secure window                                                                 |
| `binding-needs-reapproval`                                                        | The operation's request changed since it was approved                                                                                                                                                                                                                                                                                                                                                    | The person reviews the changes and approves again in the secure window                                                 |
| `share-suspended`                                                                 | The realm's share the operation's `{{apiKey}}` slot uses is suspended                                                                                                                                                                                                                                                                                                                                    | A direct writer resumes the share, or the key's owner swaps another key into it                                        |
| `credential-rejected`                                                             | The vendor refused the key or connection the operation uses, or its OAuth client is broken (see the `oauth-connections` skill). The realm records the credential on the run (`credential_*`) before answering                                                                                                                                                                                            | Reconnect or replace the key                                                                                           |
| any other `automationAdmission` code (`target-not-found`, `invalid-operation`, …) | The declared operation can't be found or lowered for the run's identity                                                                                                                                                                                                                                                                                                                                  | Fix the card's declaration or the operation's module                                                                   |
| `run-admission-failed`, `run-admission-unavailable`                               | The worker couldn't ask the realm (the realm's answer is in `error_message`), or the realm has no `admitAutomation` (a published realm)                                                                                                                                                                                                                                                                  | Look at the realm server's log for the `_run-admission` request                                                        |
| `insufficient-credits`                                                            | The spending check (`AutomationAdmissionChecks.admitSpending`, last): the run's identity's balance, less what their other runs in flight hold, is below the run's minimum balance. A payer's run also moves the automation to `waiting-for-credits`                                                                                                                                                      | The person adds credits; the next due run is admitted (the `pricing` skill)                                            |
| `daily-credit-cap-reached`, `monthly-credit-cap-reached`                          | The spending check: what the automation was charged this UTC day or month, plus what its other runs in flight hold, reached the caps snapshot's `dailyCredits` or `monthlyCredits`. Only a trigger's or batch's run is held to them                                                                                                                                                                      | The day or month turns; or a direct writer raises the cap on the card and resumes the automation                       |
| `pricing-unavailable`                                                             | The spending check: the worker's pricing check failed, so it admits no run (ADR 029 §1.3)                                                                                                                                                                                                                                                                                                                | Fix the `PRICING_*` values and restart the worker (the `pricing` skill)                                                |

A credential refused during the run, at one of its `callApi` calls, ends the
run with `credential-rejected` too, unless the token endpoint is only failing
for now, which the call waits out. How unattended runs refresh and retry, what
the run records, and who is told (`automationCredentialNotices`) are in the
`oauth-connections` skill's _Unattended runs_ section.

When admission pauses the automation with `payer-lost-access`, the refused
run ends with its own code first, and the pause follows (the refusal carries
it, and `runAutomationAttempt` makes it). A pause cancels the automation's
unfinished runs, so its other pending runs end `canceled` with
`error_reason = 'payer-lost-access'`.

A run's kind comes from its job: `triggerKind: 'manual'` (Preview, Run now)
or `'batch'` (a batch's follow-up); a job without one is a trigger's, even
when the card no longer names that trigger. Trigger and batch runs need the
automation's row. A trigger's run is admitted for an `active`,
`waiting-for-credits` (left to the spending check) or `done` row (the run of
the last slot is enqueued before the row is done), and refused for a paused
one. A batch's follow-up runs while the automation is paused: it reads
results its submitting run already paid for, and nothing runs it again after
a resume. Its revocation check is anchored at the submitting run's start
(the follow-up's slot is the batch's id, and `ai_batches.run_id` names that
run). A manual run needs no row and runs while the automation is paused.

```sql
-- why a run didn't start
SELECT error_reason, error_message, admitted_at
  FROM automation_runs WHERE id = '<run id>';
-- the admission line in its log
SELECT message, data FROM automation_run_log
 WHERE run_id = '<run id>' AND kind = 'admission';
```

### The tab

The run goes to its realm's **run affinity**, `realm:<realm>#run:<identity>`
(`renderSessionOf` reads a run token as a `run` session; `toAffinityKey`). The
prerender server takes a realm affinity for `/run-command` only when the
whole of the auth is one run token, so no other session reaches a run's tab
and a run's token reaches no other tab. The pool holds a run affinity to one
tab (`isRunAffinityKey`), so runs of one realm and identity take turns on that
tab and never hold more than one of the tabs index renders also draw on. The
tab is a warm one, never one the run starts itself (ADR 025 §1.2); see the
`prerender-sizing` skill.

**The token reaches the tab in memory.** A run's token MUST NOT be written
anywhere the tab keeps state (ADR 026 §1.2), so the run's sessions never go
through `localStorage['boxel-session']`, which hands every render and every
other command its sessions. `runCommandAttempt` in `render-runner.ts` sees a
`run` session and sets the sessions map on the page global
`__boxelInMemorySessions` (`inMemorySessionsGlobal` in
`runtime-common/in-memory-sessions.ts`), and removes `boxel-session` from the
tab's storage, so the tab holds no other session. While that global is set the
host reads and writes the tab's sessions there and nowhere else: the realm
service's session store and `restoreSessionsFromStorage`
(`host/app/utils/realm-sessions.ts`), `RealmAuthClient.getJWT` in a render
context, and the realm-server service's session read. No session is synced to
the auth service worker, which would keep the token past the run, and the
visit's start clears the worker's tokens (`clearServiceWorkerTokens`), since a
tab taken from another affinity brings that affinity's worker with it. The
`command-runner` route answers through `#answer`, which first calls
`RealmService.dropInMemorySessions`: every realm holding a session is removed,
along with its token and refresher, and the global is deleted, so nothing of
the run is left in the tab once the run answers. A run that doesn't answer
(the tab's wait times out, or the attempt throws) may still be running its
script with the token, so `runCommandAttempt` evicts the run's affinity and
the page never goes back to the pool. Every other prerender visit
(render, module, capture, ordinary command) sets `boxel-session` and deletes
the global, so a tab that served a run and is then handed to another affinity
never reads the run's sessions in place of its own.

To check a tab by hand after a run, read `localStorage` and
`globalThis.__boxelInMemorySessions` in it: neither holds the run's token.

While the script runs, the tool's `RunStateWatch` asks the realm every 2 s
whether the run is still running, and stops the script once it isn't: a
cancel, a pause or remove, a cap that ended the run, or a newer attempt
taking it over (_Canceling a run_). The tool then answers `stopped`, and the
worker's finish is refused unless the run is still running under this
attempt (the person's sessions were revoked, say), when it records the run
as an error with reason `stopped`.

`timeoutMs` widens every layer's timeout for this one request: the worker's
request to the manager, the manager's proxy, and the tab's wait on the
command (`commandRequestTimeoutMs` in `prerender-constants.ts`, up to
`MAX_COMMAND_TIMEOUT_MS`, which is `MAX_RUN_SECONDS` plus the tab's grace).

In the tab, the `run-automation` tool (`host/app/tools/run-automation.ts`)
refuses to run unless the tab's session for the realm is a run token. It runs
the script with `runAutomationScript` on `automationRealmIO`, with `resolve`
sent to the realm server's `_request-forward` carrying the run's token, so it
is counted and priced against the run's caps. It answers an
`AutomationScriptOutcome`: an error the script throws itself
(`RealmScriptError`) is `script-error` with its line, a run out of time
(`AutomationTimeLimitError`) is `timed-out`, and a realm call's error the
script didn't catch (`RealmCallFailure`) is `call-failed`. A card update that
`realm.cards.update` staged and the realm refuses to save once the script ends
is `call-failed` too. In the script, a realm call's error is an `Error` named
`RealmCallError`; the sandbox reports that one ended the script with
`realmCallFailed`.

`call-failed` counts toward a pause for repeated failures, so the tab answers
`run-failed` in its place when the platform failed any request the tab made
while the script ran (`watchedScriptOutcome`). `isPlatformFailure` counts a
server error, a 429 load shed, no answer, and a body that fails while it is
read; a refusal and an abort don't count. The tab hears every fetch through
`NetworkService.watchFetches`, which sits on `NetworkService.fetch`, the one
fetch everything in the tab goes through: `authedFetch` and the realm calls,
the loader's module fetches, `realm.resolve`'s request forwarding, and the
run's log and state checks. A prerender tab runs one automation run at a
time, so those requests are all the run's. Anything else the runner fails
with is `run-failed`. A script that couldn't start before the
run's `endsAt` is `timed-out`.

The run's progress goes to its run log: the tool records it with a
`RunLogSink` for the run's realm and token, sending through the host's
`network.fetch` like the run's other realm calls, so the script's console
lines, its activity and milestones, and the error it ends with reach
`automation_run_log` and Loki (_The run log_). The tool flushes the sink
before it answers, while the run is still running, since `/_run-log` takes
lines only from a running run and the worker finishes the run once it has
the answer. It waits on that flush only until `FINAL_FLUSH_MARGIN_MS` (5 s)
before the run's `endsAt`, so a slow log never costs the run its commit; a
line sent past the limit is refused with the expired token anyway. A batch
the log refuses or can't take is reported with the tab's `console.warn`,
prefixed `[automation run <run id>]`.

### Running one automation by hand in development

With the dev stack up (a worker and the prerender server running), from
`packages/realm-server`:

```sh
pnpm run-automation \
  --realm http://localhost:4201/user/my-realm/ \
  --card http://localhost:4201/user/my-realm/automation/sync \
  --as @user:localhost          # add --preview to stop before the commit
```

It creates a `manual` run row for the card, enqueues its job, waits for it
and prints the run row. `--as` must be a direct writer of the realm, since the
commit re-confirms it. The script skips the direct-writer check
`startAutomationRunNow` makes before the row; with `--preview` the row is a
Preview (`dry_run`), and its staged files are in `automation_preview_files`
once it completes. Then read the outcome:

- the printed row: `state`, `error_reason`, `error_message` (a script error
  starts `line N:`), `script_hash`, `committed_at`;
- the files: a complete run's writes are in the realm, indexed in the
  background (`writes` on the row counts them);
- the worker's log: `automation run <id> attempt <n> complete`, `ended as an
error (<reason>)` or `left alone: …`;
- the run's log: the script's console lines, progress and the error it
  ended with, beside the platform's lines (_Reading a run's log in
  Postgres_). A batch the run's log refused or couldn't be sent shows in
  the prerender server's log as the tab's `[automation run <run id>]`
  warning, saying why.

A run that stays `pending` was never claimed: check that a worker can claim
priority 5 (_The lanes_). One that stays `running` lost its attempt; see
_Diagnosing a run_.

## The routes

A direct writer switches an automation on, runs it by hand, pauses, resumes
or removes it, cancels a run, and reads what the console shows (a run's
report, a Preview's staged file, the automation's storage) through
realm-server routes
(`packages/realm-server/handlers/handle-automations.ts`; paths and body
types in `packages/runtime-common/automation-routes.ts`). They are not on a
realm: each takes the realm-server session (`Authorization: Bearer <realm-server
token>`, behind `jwtMiddleware`) and acts as that session's own user, never as
a user a header names (ADR 006). A realm-authority session is refused (403),
and a delegated or revoked one by the session check (401).

Every request names the realm, and the route asks `isDirectWriter` of that
realm and the caller **before it reads anything else**, so a caller who isn't
a direct writer gets the same 403 whether or not the automation or run
exists. It then checks the automation is in the realm (400), reads the card
from its index row with `readRunDeclaration` (422 when the card isn't
indexed or doesn't read as an automation), and calls the lifecycle function,
which checks direct write again under its own locks. Each change reports its
`automation` and `job` events through `realmServerAutomationChangeReporter`
and `realmServerRunChangeReporter`.

A request body is JSON:API: `{ "data": { "type": "automation", "id": "<card
URL>", "attributes": { "realm": "<realm URL>", ... } } }`; a cancel names the
run instead, `{ "data": { "type": "automation-run", "id": "<run id>",
"attributes": { "realm": "<realm URL>" } } }`. Answers are `no-store`.

| Route                                                                | Body attributes  | Answers                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /_automation-switch-on?realm=<realm URL>&automation=<card URL>` | —                | 200 `automation-estimate`: `switchedOn`, the card's `monthlyCredits`, and `estimate` (`estimateAutomationCost`, with `recentPreviewCredits`: what the caller's latest finished Preview of it cost). 503 while the process has no prices |
| `POST /_automation-switch-on`                                        | `monthlyCredits` | 201 `automation` (state, pause reason, `viewerIsPayer`, next run, caps snapshot), with `meta.estimate`. The caller is the payer                                                                                                         |
| `POST /_automation-preview`                                          | `click`          | 202 `automation-run`, pending, `dryRun` true, acting as and charged to the caller                                                                                                                                                       |
| `POST /_automation-run-now`                                          | `click`          | 202 `automation-run`, pending, `dryRun` false                                                                                                                                                                                           |
| `POST /_automation-pause`                                            | —                | 200 `automation`, paused `requested`; its pending and running runs are canceled                                                                                                                                                         |
| `POST /_automation-resume`                                           | `monthlyCredits` | 200 `automation`; the caller is the payer, with a new caps snapshot                                                                                                                                                                     |
| `POST /_automation-remove`                                           | —                | 200 `automation`, the row as it was; the row is gone                                                                                                                                                                                    |
| `POST /_automation-run-cancel`                                       | —                | 200 `automation-run`, canceled by the caller                                                                                                                                                                                            |
| `GET /_automation-run-report?realm=&run=`                            | —                | 200 `automation-run-report` (_The console's reads_, below)                                                                                                                                                                              |
| `GET /_automation-preview-file?realm=&run=&path=`                    | —                | 200, the staged file's bytes as `application/octet-stream`                                                                                                                                                                              |
| `GET /_automation-storage?realm=&automation=`                        | —                | 200 `automation-storage` (_The console's reads_, below)                                                                                                                                                                                 |

**The monthly cap.** Switch-on and resume make the caller the payer of the
caps the card sets (the caps snapshot), and the monthly credit cap is what
the payer confirms. `monthlyCredits` must be a whole number (400 when it is
missing or isn't), the card must set `caps.monthlyCredits` (422 when it
doesn't: a card capped by the day alone can't be switched on), and the two
must be equal (409 otherwise). So the monthly cap a person or the assistant
confirmed is the one the snapshot holds, and a card whose monthly cap changed
between reading the estimate and switching on is refused: read the estimate
again and confirm its cap. Only the monthly cap is compared. The rest of the
snapshot (the per-run and daily caps, `batchedAI`) and the triggers are taken
from the card as the route reads it, so an edit to them in between is taken
on, and spending stays within the confirmed monthly cap whatever they say. A
screen that lets the person choose another cap writes it to the card first.

**The realm.** The card's own realm, as its index row records it, must be
the realm the request names (400 otherwise). Switch-on and resume refuse an
archived realm (409, `realm-archived`) in the transaction that writes the
row, holding the realm's automation lock shared (`lockRealmAutomations`);
`pauseRealmAutomations` holds it exclusive, and archiving pauses the realm's
automations both before and after marking it archived, so a switch-on or
resume racing an archive ends paused or refused. Preview and Run now check
the archive at the route.

**Webhooks.** Switch-on and resume refuse a webhook trigger naming a webhook the realm can't use with 422 and each trigger's message (_Which webhooks a realm can use_), and, while `WEBHOOK_DELIVERIES_START_RUNS` is false, carry `meta.notices` saying the webhook triggers can't fire; the estimate carries the same in `attributes.notices`.

**Refusals.** 403 not a direct writer; 404 not switched on (pause, resume,
remove) or no such run in the realm (cancel); 409 already switched on, already
paused, not paused, a click already used for another person's run or the
other kind of run, a run that already ended or whose commit was claimed; 400
for a malformed body, an automation outside the realm, or a missing click.
The error body is `{ "errors": [<message>] }`.

### The console's reads

The three GETs take the realm and the run or card as query parameters, check
direct write on the realm first, and answer `no-store`. A run of another
realm, or a run id that isn't a UUID, answers 404 as no such run, so a
writer of one realm learns nothing about another realm's runs.

**Identities follow ADR 011 §1.2.** An answer names a person's Matrix id only
to that person or to a viewer who shares a named realm grant with that
person (`shareARealmGrant`); anyone else reads `null`. Booleans say as much as
the viewer may know: `viewerIsActsAs`, `viewerCanceled` and
`canceledByAPerson` on a run's report, and `viewerIsPayer` on the storage
answer.

**`/_automation-run-report`** serves `readAutomationRunSummary`, which reads
the run as `readAutomationRunReport` does but counts the log instead of
returning the lines. The attributes:

- the run: `automation`, `trigger`, `dryRun`, `state`, `errorReason`,
  `errorMessage`, `credentialRefusal`, `actsAs`, `canceledBy`;
- `timings` and `cost`, as in _The run's report_ (`cost.creditsByKind` holds
  `ai`, `run`, `run_indexing` and `batched_ai`);
- `milestones`: the run's `RunMilestones` (_Run milestones_): the plan, each
  milestone reached with its time and count, the current one, the ones
  ahead, and the one a failed run was in;
- `log`: `{ lines, dropped, byLevel, byKind }`, line counts without the
  text. `/_automation-run-log` serves the lines;
- `callApiCalls` (`operation`, `method`, masked `destination`, `status` or
  `code`, `ms`, `bytes`) and `resolveCalls` (`model`, `status`, `ms`,
  `costInUsd`), one per `call-api` or `resolve` platform line, with the
  line's `seq` and `at`. The automation surface has no `transform`, so a
  run makes no transform calls;
- `writes`: `count` (the row's `writes`), plus `staged` and
  `stagedReplacedBy` for a complete Preview and `committed` for a run whose
  commit landed, as `stagedFiles`, `stagedFilesReplacedBy` and
  `committedPaths` in _The run's report_.

**`/_automation-preview-file`** serves `readAutomationPreviewFile`: 404 when
the Preview kept no file at `path`, 400 without a `path`. The script chose
the bytes, so the route always answers `application/octet-stream` with
`X-Content-Type-Options: nosniff`, and the console picks how to show the file
from its path.

**`/_automation-storage`** serves `getAutomationStorage`
(`automation-files.ts`): `files` (`path`, `run`,
`createdAt`, `fileBytes`, `indexBytes`) with the totals `fileBytes` and
`indexBytes`; `switchedOn` and the `payer`, who pays the storage charge;
`dailyCredits`, what one day of that storage costs at the server's prices
before rounding (`exactMeteredCredits` of a day's GB-months, `null` without
prices) with `pricingVersion`; and `charges`, the last 30 storage charges in
`credits_ledger` as `{ day, credits }`, newest first. A charge covers the
days since the previous one and is written once they cost a whole credit
(_The daily storage charge_ in the `pricing` skill).

### Calling them in development

Mint a realm-server session for a user who directly writes the realm, from
`packages/realm-server` (the dev stack signs sessions with the dev seed):

```sh
TOKEN=$(node -e "console.log(require('jsonwebtoken').sign({ user: '@user:localhost', sessionRoom: 'dev' }, \"shhh! it's a secret\", { expiresIn: '1h' }))")
REALM=https://localhost:4201/user/my-realm/
CARD=${REALM}automations/nightly-sync

curl -sk -H "Authorization: Bearer $TOKEN" \
  "https://localhost:4201/_automation-switch-on?realm=$REALM&automation=$CARD"

curl -sk -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"data\":{\"type\":\"automation\",\"id\":\"$CARD\",\"attributes\":{\"realm\":\"$REALM\",\"click\":\"$(uuidgen)\"}}}" \
  https://localhost:4201/_automation-preview
```

Name the realm by the URL its permission rows use
(`realm_user_permissions.realm_url`); a URL in another form isn't found as
one the caller writes, and is refused with 403. The same body with
`monthlyCredits` (the card's) switches it on at
`/_automation-switch-on`. A Preview or Run now answers its run's id; follow
the run in Postgres (_Diagnosing a run_) or at `/_automation-run-report`,
and the automation's row with `GET <realm>/_automation-status`.

## Preview and Run now

A direct writer starts a run of an automation at once, whether or not it is
switched on, acting as and charged to whoever clicked (not the payer). The
functions are in `packages/runtime-common/automation-manual-runs.ts`,
imported as `@cardstack/runtime-common/automation-manual-runs`:

- **`startAutomationPreview(ctx, request, options)`**: a run with
  `dry_run` true. The script runs as usual and sees
  `realm.current.automation.dryRun`, its writes are staged, and it stops
  before the commit, so the realm is left as it was.
- **`startAutomationRunNow(ctx, request, options)`**: the same run, which
  commits.

`ctx` is `{ dbAdapter, queue }`, `options` the `AutomationActorOptions` the
lifecycle functions take, and `request` is `{ automationId, realm, user,
click, declaration }`: `user` is whoever clicked, `click` a fresh id per
click, and `declaration` the card as `readAutomationDeclaration` read it.
Each checks, in this order, that the automation is in `realm`
(`outside-realm`), that the declaration is the card's own (`other-card`),
and that `user` is a direct writer of the realm (`not-a-direct-writer`,
asked with `isDirectWriterLocked` in the transaction that makes the row).
It then makes an ordinary run row, trigger `manual` (`MANUAL_RUN_TRIGGER`),
slot the click, `acts_as` the clicker, and enqueues it with
`enqueueAutomationRunJob` (`triggerKind: 'manual'`, the card's `seconds`
cap for the job's timeout, `scheduledAt` the row's `created_at`). The
declaration reader refuses a card trigger labelled `manual`
(`reserved-label`), so a click never shares a slot and dedupe key with a
scheduled run. A worker runs it exactly as it runs a scheduled run, through
`runAutomationAttempt`: every check that makes before the script starts
applies to it, as do the caps (`readRunLimits`: the card's caps, held to
the snapshot once the automation is switched on), the automation's
concurrency group, which queues a click behind a run of the same automation
already going, and the automation tier. The commit re-confirms the
clicker's direct write, as for any run.

The row's `dry_run` alone decides whether a run is a Preview: everything
after the run (its batch, its report, `lastSuccessAt`) reads the row. A job
whose `dryRun` disagrees with its row runs nothing and ends the run as an
error with `error_reason` `dry-run-mismatch`.

They answer `{ ok: true, run, job? }`, with the run `pending`. Sending the
same click again answers the same run: a pending one joins the job already
enqueued (the job's key is the run's), and a finished one isn't enqueued
again (`job` absent). A click that already started a run for someone else,
or a run of the other kind, is refused (`click-reused`). Both then move
through `pending`, `running`, and `complete` or `error`, like any run.

### The batch a Preview keeps

A Preview that finishes complete copies the files its attempt staged into
`automation_preview_files` (run, realm-local path, bytes and size), in the
transaction that finishes it, and then discards its overlay like every run
(ADR 027 §1.4). The copy is the batch the Preview shows, and nothing writes
to it afterwards. A Preview that errors or is canceled keeps nothing.

Only a person's latest complete Preview of an automation keeps its batch,
"latest" by when each was asked for (`created_at`, then `id`), not by when
it finished (`keepPreviewBatch` in `automation-runs.ts`). The finish that
keeps a batch deletes the batch of every earlier complete Preview by that
person of that automation and records itself in their
`preview_replaced_by`. A Preview that finishes after a later one has
completed keeps nothing, and records that one. The finishes of one
person's Previews of one automation take a transaction-scoped advisory
lock, so two finishing together never both keep a batch. A Preview is
never the automation's `lastSuccessAt`.

To read a batch by hand:

```sql
SELECT path, size, convert_from(content, 'UTF8') AS text
  FROM automation_preview_files WHERE run_id = '<run id>' ORDER BY path;
```

### The run's report

`readAutomationRunReport(dbAdapter, { runId, user }, options)` answers
`not-a-direct-writer` unless `user` directly writes the run's realm, and
`missing` for no such run. Otherwise its `report` holds:

- `run`: the run row (`state`, `acts_as`, `dryRun`, `error_reason`, …);
- `timings`: the row's times, plus `queuedMs` (enqueue to first start),
  `runMs` (first start to finish) and `commitMs` (claim to landing);
- `cost`: the run's charges in `credits_ledger` by `charge_kind` and in
  total (`credits`, `creditsByKind`), and the metered counts against its
  caps (`callApiCalls`, `callApiResponseBytes`, `resolveCalls`, `writes`,
  `aiCreditsSpent`, `aiCreditsReserved`);
- `log`: the run's log (`readRunLog`);
- `stagedFiles`: for a complete Preview, `{ path, size }` per staged file,
  in path order. Empty when the script staged nothing, or when
  `stagedFilesReplacedBy` names the later Preview whose batch replaced
  this one's;
- `committedPaths`: for a run whose commit landed, the realm-local paths
  its commit line records (`data.paths` on the `commit` platform line).
  Absent when the log dropped that line at its cap (_The cap_); `cost.writes`
  still counts the files.

The report carries no file bytes, since a Preview's batch can reach
`RUN_OVERLAY_MAX_BYTES`. `readAutomationPreviewFile(dbAdapter, { runId,
path, user }, options)` answers one staged file's `content`, for a direct
writer of the run's realm, or `missing` when the Preview kept no file at
`path`.

### Comparing a Preview with a Run now

Both read the realm and call every vendor fresh: nothing a Preview fetched
is reused by the Run now that follows it, and each pays its own `callApi`
and `resolve` calls. So a Preview shows what a run would write at the time
it ran, not what the next run will write. To compare them, set the
Preview's `stagedFiles` paths beside the Run now's `committedPaths`, and
read each file's committed text from the realm. A difference comes from
one of:

- an upstream answer that changed between the two runs (compare the
  `call-api` lines in both logs: status, size and time);
- the realm changing between them: a search reads what the realm held when
  the run started (_The run overlay_), and the commit leaves a file whose
  text matches the stored file's alone, though `committedPaths` names it
  too;
- the card or script changing between them (`script_hash` on each row);
- a cap reached in one and not the other (`error_reason` `hit-a-cap`).

`cost.writes` is 0 for a Preview, which commits nothing, and counts every
file the commit wrote for a Run now.

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
- **The deployed counts.** The `prerender-sizing` skill's _Automation runs and the worker lanes_ records the counts each environment runs, why, what a run's tab was measured to cost, and how to measure it again.

### The prerender high-priority tier

The prerender server's page pool reserves headroom past `PRERENDER_PAGE_POOL_MAX`, up to `PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX`, for renders whose priority is at least `PRERENDER_HIGH_PRIORITY_THRESHOLD`. An automation run does not count as high priority there: the headroom is for a user who is waiting. That holds only while the threshold is above 5, so set it to `userInitiatedPrerenderHtmlPriority` (9). A threshold of 5 or less admits automation runs to the reserved headroom.
