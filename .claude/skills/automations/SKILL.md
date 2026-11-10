---
name: automations
description: Developer guide to the automations system — realm admins' Realm Runner scripts that run on cron, one-time or webhook triggers. Covers how trigger timing is computed (cron in a time zone, daylight saving, `once`, `until` and `count`, per-trigger run counts, next run, *done*, runs left) in `runtime-common/automation-schedule.ts`. Use when working on the automations table, the tick, reconcile, the automation card's view, the switch-on estimate, or anything that asks when an automation runs next.
---

# Automations

An automation is a card in a realm that names a Realm Runner script, its triggers, and what the script may do. A direct writer switches it on and becomes its payer; the server keeps one row per switched-on automation with its payer, state, next run and per-trigger run counts. The card is the definition; the row is the state.

## Trigger timing

`packages/runtime-common/automation-schedule.ts` answers, for an automation's triggers and its per-trigger run state, when it runs next and which triggers are spent. It is pure (no I/O, no clock) and depends only on `Intl`, so the realm server, the worker and the host (the card's view) share it.

### Units

Every instant in and out is **UTC unix seconds**. A trigger's time zone is used only to work out which instants its cron expression names. A card's `once` date, time and time zone become unix seconds through `zonedDateTimeToUnixSeconds('2026-11-09T15:00', 'America/Chicago')`; a cron trigger's `until` goes through the same function in the trigger's zone.

### Triggers

| Kind      | Fields                                              | Spent when                                                     |
| --------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `cron`    | `expression`, `timeZone`, optional `until`, `count` | `count` runs started, or its next time is past `until`         |
| `once`    | `at`                                                | it started its run, or `at` is at or before the trigger cursor |
| `webhook` | —                                                   | never                                                          |

`until` is inclusive: a time exactly at `until` still fires. With both `until` and `count`, the trigger is spent at whichever comes first.

Every trigger has a **label**, unique within its automation (ADR 028). Run counts, `runState` and run `dedupeKey`s are keyed by it, so editing a trigger's expression, time zone or bounds keeps its count, and a renamed label starts a new one.

### The cursor

`computeAutomationSchedule({ triggers, since, runState })` schedules each trigger strictly after its own cursor: the later of `since` (when the automation was switched on or resumed) and that trigger's `lastSlot` (the scheduled instant of the last run it started). It never uses the current time. That keeps a slot that came due but hasn't been enqueued yet due: recomputing the row when the card is re-indexed between a trigger's time and the tick that claims it doesn't skip the run. It also means a `once` trigger whose time is before `since` is spent, never run late.

`runState[label].runs` counts runs the trigger **started**. A trigger that joined a run already pending (skipped) didn't start one and isn't counted.

### What it returns

- `nextRun`: the earliest next time across unspent `cron` and `once` triggers, or absent when none is left.
- `dueTriggers`: the label of every trigger that fires at `nextRun`. Two triggers at the same instant each start a run.
- `done`: every trigger is spent. An automation with a `webhook` trigger is never done; one with no triggers is.
- per trigger: `spent`, `nextRun`, `until`, and `remainingRuns` for bounded triggers (`once`, or `cron` with `until` or `count`): `count − runs`, or the times left up to `until`, whichever is smaller. Unbounded cron and webhook triggers have no `remainingRuns`. The card's view shows it as runs left, and the switch-on estimate adds it up.

### Cron expressions

Five fields (minute, hour, day of month, month, day of week) with `*`, lists, ranges, steps (`*/15`, `1-30/5`, `10/20`), month and day names, `7` for Sunday, and the macros `@hourly`, `@daily`/`@midnight`, `@weekly`, `@monthly`, `@yearly`/`@annually`. No seconds field, no `?`, `L`, `W` or `#`. When both day fields are restricted (neither starts with `*`) a day matches if **either** does, as in Vixie cron: `0 0 13 * FRI` is every Friday and every 13th. An expression that names no day that exists (`0 0 30 2 *`) is an error, because it would never fire.

`parseCronExpression` throws `CronExpressionError`; `cronExpressionError` returns the message or `undefined`, for validators that report rather than throw. `isValidTimeZone` checks an IANA name.

`nextCronTime`, `nextCronTimes` and `countCronTimes` are the primitives underneath, for the estimate's frequency of unbounded triggers and anything else that needs raw times.

### Daylight saving

- **Fixed-hour** expressions (hour field not starting with `*`) name a wall-clock time, so "daily at 05:30" stays at 05:30 local time all year. A time the clocks skip fires as far past the change as it was into the gap (02:30 in a 02:00→03:00 change fires at 03:30). A time that happens twice fires once, at the first.
- **Hourly-style** expressions (hour field `*` or `*/n`) follow elapsed time. Wall times inside a skipped hour don't happen; wall times in a repeated hour fire twice. An hourly trigger gets 23 runs on the spring-forward day and 25 on the fall-back day.

### Cost

Each call scans local days with one `Intl` offset lookup per day (a few microseconds each). `nextCronTime` stops at the first day with a time; any satisfiable expression fires within nine years. `countCronTimes` scans the whole range, so an `until` decades away costs hundreds of milliseconds. Pass a `limit` when a bound is known (`computeAutomationSchedule` passes `count − runs`).

## The automation card and its declaration

### The card

`Automation` is a catalog system card, like the policy cards: its only source is boxel-catalog's `automation/automation.gts`, it is in the catalog test subset (`packages/catalog/test-subset.json`), and boxel code names it by the catalog code ref `automationRef` in `packages/runtime-common/automation-declaration.ts`. Nothing about it goes in `packages/base`. Changing it is a boxel-catalog PR plus a boxel PR that pins it (the `catalog-test-subset` and `catalog-pairing` skills). Its `Spec` and a linked example (`automation/Automation/weekly-card-count`, with `automation/scripts/weekly-card-count.js`) sit beside it in the catalog; they are catalog content, not subset entries.

The server reads the card from the index as data and never runs its module, so every field it reads is a stored value, never a computed:

| Field        | Type                                | Notes                                                                                                               |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `script`     | `linksTo(FileDef)`                  | the Realm Runner script, in the card's realm                                                                        |
| `triggers`   | `containsMany(AutomationTrigger)`   | `kind` (`cron` / `once` / `webhook`), `label`, then the fields for that kind (below), and `params`                  |
| `operations` | `containsMany(AutomationOperation)` | `targetType` (code ref) and `operation`: the `callApi` operations a run may call                                    |
| `caps`       | `contains(AutomationCaps)`          | per run `callApiCalls`, `responseBytes`, `resolveCalls`, `writes`, `seconds` (≤ 1200); per month `monthlyCredits`   |
| `params`     | `containsMany(AutomationParam)`     | `name` / `value` strings handed to the script; a trigger's own `params` are merged over them for the runs it starts |
| `milestones` | `containsMany(StringField)`         | a run's milestone names, in order                                                                                   |
| `batchedAI`  | `BooleanField`                      | off unless `true`                                                                                                   |

A trigger's fields by kind: `cron` reads `expression`, `timeZone`, optional `count`, and optional `untilDate` with optional `untilTime` (absent: 23:59, the end of that day) in `timeZone`; `once` reads `date`, `time` and `timeZone`; `webhook` reads `webhookPath`, one of the realm's incoming webhooks. Dates are `DateField` (`yyyy-MM-dd`); times are `TimeField`, stored as `{ value: 'HH:MM' }`.

The card declares `update`, `delete`, `transform` and `appendContainsMany` `nonGrantable`, as `RealmPolicy` does, so only the realm's direct writers edit an automation.

### The declaration reader

`readAutomationDeclaration(entry, { automationTypeKey })` in `packages/runtime-common/automation-declaration.ts` turns an index row (`url`, `realmURL`, `types`, `instance`; `IndexedInstanceSource` has this shape, and `IndexedInstance` maps onto it with `canonicalURL` as `url`) into an `AutomationDeclaration`, or returns every problem it finds. It never throws for anything the card says.

- **Type.** The row's adoption chain (`types`) must include `automationTypeKey`, which is `internalKeyFor(automationRef, undefined, virtualNetwork)`: the catalog type or any type that descends from it. A local class that is merely named `Automation` is refused (`not-an-automation`).
- **Triggers** come out in `automation-schedule.ts`'s `AutomationTrigger` shape, plus `params` (and `timeZone` on `once`, `webhookPath` on `webhook`), so they go straight into `computeAutomationSchedule`. `until` and `at` are UTC unix seconds, converted from the card's local date and time with `zonedDateTimeToUnixSeconds`.
- **Relative refs** (the script link, an operation's `targetType.module` starting with `./` or `../`) are resolved against the card's URL. The script must resolve inside `realmURL`.

Each problem has a `code`, a `path` into the card (`triggers.0.expression`, `caps.seconds`, `script`) and a message for a person. Codes: `not-an-automation`, `not-indexed`, `missing-script`, `script-outside-realm`, `invalid-trigger-kind`, `missing-label`, `duplicate-label`, `invalid-cron`, `cron-too-frequent`, `missing-time-zone`, `invalid-time-zone`, `invalid-date-time`, `invalid-count`, `missing-webhook-path`, `invalid-operation`, `missing-cap`, `invalid-cap`, `seconds-cap-too-high`, `invalid-param`, `invalid-milestone`.

### The 5-minute minimum

A cron trigger may fire at most once every `MIN_CRON_INTERVAL_MINUTES` (5). `cronFrequencyError(expression, timeZone?)` decides it from the parsed sets rather than by sampling fire times: it takes every minute of the day the hour and minute sets name, finds the closest two distinct ones, and compares the last time of a day with the first of the next only when two consecutive days can both match (a scan of one 400-year Gregorian cycle when a day field is restricted). `*/5 * * * *` and `3,58 * * * *` pass; `* * * * *`, `*/2 * * * *`, `0,3 * * * *` and `58,1 0,23 * * *` are refused, while `58,1 0,23 * * MON` passes, since Monday is never followed by Monday.

With a time zone it also applies each of the zone's offset changes (found once per zone from 2020 to 2060, then cached) the way `computeAutomationSchedule` fires them, since a change can bring two times closer:

- a **fixed-hour** time the clocks skip fires as far past the change as it was into the gap: in New York `1,58 2,4 * * *` fires the skipped 02:58 at 03:58, 3 minutes before 04:01, so it's refused there and passes in UTC. Two times that land on the same instant fire once, which isn't a gap.
- an **hourly-style** expression fires repeated wall times twice: in Berlin `1,58 */2 * * *` fires 02:58 and then the repeated 02:01 3 minutes later.

The reader passes the trigger's time zone whenever it's valid.
