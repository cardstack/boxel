---
name: automations
description: Developer guide to the automations system — realm admins' Realm Runner scripts that run on cron, one-time or webhook triggers. Covers how trigger timing is computed (cron in a time zone, daylight saving, `once`, `until` and `count`, per-trigger cursors and run counts, make-up runs after an outage, next run, *done*, runs left) in `runtime-common/automation-schedule.ts`. Use when working on the automations table, the tick, reconcile, the automation card's view, the switch-on estimate, or anything that asks when an automation runs next.
---

# Automations

An automation is a card in a realm that names a Realm Runner script, its triggers, and what the script may do. A direct writer switches it on and becomes its payer; the server keeps one row per switched-on automation with its payer, state, next run and per-trigger run counts. The card is the definition; the row is the state.

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
