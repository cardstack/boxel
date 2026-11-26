---
name: pricing
description: The cost model metered usage is charged by (hosting unit cost times one margin, at 1,000 credits to the dollar, ADR 029), the `PRICING_*` environment variables that carry the unit rates, task shapes, margin and minimum-balance floor to the realm-server, worker and prerender processes, the startup check and pricing version each process logs on the `pricing` log channel, how to change a price (an SSM edit under `/${env}/boxel/` and a redeploy), and how to read the credits ledger by charge kind (run, run indexing, storage, AI, batched AI, grant, purchase, expiry) and reference (realm, run, batch, automation and day), including entries with no kind and the write-once rule for a charge, auditing the usage each charge priced (tab-seconds, worker-seconds, GB downloaded, GB-months, AI cost and tokens), the record of each pricing version's values and unit rates (`pricing_versions`), and the cost coverage report that compares, for a period, the credits each charge kind drew with the hosting cost of the usage it priced, by pricing version (`getCostCoverage` and the `credit_charge_costs` view). Use when asking whether the margin covers our cost, which charge kind under-charges, or what prices a pricing version stands for, when changing a price, the margin or the floor, when a process logs `pricing check failed`, when a pricing alert fires, when asking which prices a charge used or why two processes report different pricing versions, when adding a pricing value, when working on the monthly estimate the switch-on screen shows (the per-run ceiling under an automation's caps times the runs its triggers start in a month), when asking why that ceiling and the minimum balance leave out the indexing a run's writes cause or how much of a run's indexing went unpaid, when an automation run was refused for its balance or a credit cap (`insufficient-credits`, `daily-credit-cap-reached`, `monthly-credit-cap-reached`, `pricing-unavailable`), when asking how a run's minimum balance is computed, what runs in flight and unsettled batches hold against a balance, why an automation that turns on `batchedAI` counts its AI twice in its minimum balance and estimate (the 2× reserve), or which charges count toward an automation's daily and monthly caps, when asking how a run's AI requests (its `resolve` calls) are billed, to whom and against which cap, when asking how a batch of AI requests is recorded before it is billed (the `ai_batches` row, its estimate at the model's listed batch price, and the batch path that writes it), how and when the settle job bills a batch that has ended (its reported cost, or its estimate for an expired batch with no reported cost), why a batch's cost reads as pending, why a late batch's results are discarded, or what an `unrecorded_ai_batches` row means, when an operator handles a batch the settle job reports (one whose charge drew nothing because the payer's balance was empty or the payer has no `users` row, or one OpenRouter lists with no `ai_batches` row), meaning how to find each, check it against both environments (staging and production share one OpenRouter workspace), and bill it later, write it off, record it or dismiss it with the `/_grafana-*-ai-batch` endpoints and the Automations dashboard's Batches panels, when asking how a run's own compute (its prerender tab time) and network (the bytes its `callApi` calls downloaded) are charged, to whom and when, including failed and canceled runs, when asking what a user, run, realm or automation was charged or how much it used or why a charge didn't write twice, or where an operator sees a user's or realm's charges and automations (the Grafana Users and Realms dashboards), when asking why an automation's storage was or wasn't charged, which files it counts or how big they are, or when changing `packages/realm-server/lib/pricing.ts`, `packages/realm-server/lib/automation-estimate.ts`, `packages/realm-server/lib/automation-spending.ts`, `packages/realm-server/lib/ai-batch-estimate.ts`, `packages/realm-server/lib/ai-batch-settle.ts`, `packages/realm-server/handlers/handle-ai-batch-operator.ts`, `packages/runtime-common/automation-spend.ts`, `packages/runtime-common/automation-files.ts`, `packages/runtime-common/automation-storage-charge.ts`, `packages/runtime-common/automation-run-charge.ts` or the ledger functions in `packages/billing/billing-queries.ts`.
---

# Pricing (operators and boxel developers)

Read ADR 029 for the rules. This skill is the operating procedure, and how to
read what each charge paid for.

## The cost model

A metered charge is what the hosting provider charges us for the usage,
times one margin, at 1,000 credits to the dollar (`CREDITS_PER_USD`):

```
credits = hosting cost in USD × PRICING_MARGIN × 1000
```

| Usage                               | Hosting cost in USD                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| A run's compute, in a prerender tab | tab-seconds × `prerenderTabUsdPerSecond`                                                       |
| The indexing a run's writes cause   | worker-process-seconds × `workerProcessUsdPerSecond`, plus the tab-seconds its prerenders take |
| Network a run downloads             | GB downloaded × `PRICING_USD_PER_DOWNLOADED_GB`                                                |
| Files an automation's runs created  | GB-months × `PRICING_USD_PER_FILE_STORAGE_GB_MONTH`                                            |
| Index rows for those files' cards   | GB-months × `PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH`                                        |

The two per-second rates spread a whole task's hourly cost over what shares
it:

```
prerenderTabUsdPerSecond =
  (PRICING_PRERENDER_TASK_VCPUS × PRICING_PRERENDER_USD_PER_VCPU_HOUR
   + PRICING_PRERENDER_TASK_MEMORY_GB × PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR)
  / PRICING_PRERENDER_TASK_TABS / 3600

workerProcessUsdPerSecond =
  (PRICING_WORKER_TASK_VCPUS × PRICING_WORKER_USD_PER_VCPU_HOUR
   + PRICING_WORKER_TASK_MEMORY_GB × PRICING_WORKER_USD_PER_MEMORY_GB_HOUR)
  / PRICING_WORKER_TASK_PROCESSES / 3600
```

AI is not metered. A run's AI, plain or batched, is billed at the cost the
AI provider reports, with no margin (ADR 029 §1.1).

## The variables

Every process reads the whole set: the realm-server, every worker process and
every prerender server. The code holds no prices and no fallbacks.

| Variable                                    | Unit                                 | Check                   |
| ------------------------------------------- | ------------------------------------ | ----------------------- |
| `PRICING_PRERENDER_USD_PER_VCPU_HOUR`       | USD per vCPU-hour                    | above 0                 |
| `PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR`  | USD per GB-hour of memory            | above 0                 |
| `PRICING_PRERENDER_TASK_VCPUS`              | vCPUs per prerender task             | above 0                 |
| `PRICING_PRERENDER_TASK_MEMORY_GB`          | GB of memory per prerender task      | above 0                 |
| `PRICING_PRERENDER_TASK_TABS`               | render tabs per prerender task       | whole number above 0    |
| `PRICING_WORKER_USD_PER_VCPU_HOUR`          | USD per vCPU-hour                    | above 0                 |
| `PRICING_WORKER_USD_PER_MEMORY_GB_HOUR`     | USD per GB-hour of memory            | above 0                 |
| `PRICING_WORKER_TASK_VCPUS`                 | vCPUs per worker task                | above 0                 |
| `PRICING_WORKER_TASK_MEMORY_GB`             | GB of memory per worker task         | above 0                 |
| `PRICING_WORKER_TASK_PROCESSES`             | worker processes per worker task     | whole number above 0    |
| `PRICING_USD_PER_DOWNLOADED_GB`             | USD per GB downloaded                | above 0                 |
| `PRICING_USD_PER_FILE_STORAGE_GB_MONTH`     | USD per GB-month of files            | above 0                 |
| `PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH` | USD per GB-month of database storage | above 0                 |
| `PRICING_MARGIN`                            | multiplier                           | at least 1              |
| `PRICING_MINIMUM_BALANCE_FLOOR_CREDITS`     | credits                              | whole number, 0 or more |

- **Compute rates are per task family.** Prerender and worker tasks can run
  on different CPU architectures, which the provider prices differently, so
  set each family's rates to the architecture its task definition uses.
- **Shapes describe the real task.** `PRICING_PRERENDER_TASK_TABS` is the
  tabs one prerender task runs in ordinary load. A deployed prerender task
  runs one prerender server, so that is its page pool's ceiling,
  `PRERENDER_PAGE_POOL_MAX`, when the pool is sized by
  `PRERENDER_PAGE_POOL_MIN` and `PRERENDER_PAGE_POOL_MAX`, and the fixed
  pool's page count otherwise. Leave out the high-priority tier
  (`PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX`), which only high-priority
  renders can grow into: dividing by fewer tabs charges each tab a larger
  share, which never under-charges. `PRICING_WORKER_TASK_PROCESSES` is every
  worker process one worker task runs: `WORKER_ALL_PRIORITY_COUNT` plus
  `WORKER_AUTOMATION_PRIORITY_COUNT` plus `WORKER_HIGH_PRIORITY_COUNT`, plus the worker manager's `--userIndexCount`
  when its start script passes one. When a task definition is resized or its
  pool or worker counts change, change its shape values in the same deploy,
  or a tab's or process's share of the task is wrong.
- **Values are plain decimals**: digits, optionally a `.` and more digits.
  A sign, an exponent, a thousands separator or surrounding spaces fail the
  check rather than being guessed at.
- **The floor is a floor.** An automation's minimum balance is computed from
  its caps at the current prices, and is never lower than
  `PRICING_MINIMUM_BALANCE_FLOOR_CREDITS` (ADR 029 §1.5; _The minimum balance
  and the credit caps_, below).

## The startup check and the pricing version

Each process checks the set once, at startup, in `checkPricingAtStartup`
(`packages/realm-server/lib/pricing.ts`), and logs on the `pricing` channel.

- **Passing**: one info line, `pricing check passed in <process>: pricing
version <hash>; PRICING_…=… …`, with every value. The version is the first
  16 hex characters of a SHA-256 over the parsed values, so `1.5` and `1.50`
  give the same version. Every metered charge records it (ADR 029 §1.4).
- **Failing**: one error line, `pricing check failed in <process>: …`, naming
  every bad variable and what is wrong with it, and the same message sent to
  Sentry tagged `pricingCheck: failed` and `process: <name>`. The Grafana
  alert `Pricing check failed` fires on the realm-server's and the worker's
  line, one alert per service, and `Pricing check failed in the prerender
server` fires on the prerender server's; the
  `automation-diagnostics` skill's _Alerts_ section covers both. One bad value
  fails the whole set:
  `currentPricing()` then returns undefined, and the process admits no new
  run and submits no new batch until it restarts with good values (ADR 029
  §1.3). Interactive work and runs already going are unaffected.

To read either line in a deployed environment, use the `tail-logs` skill, for
example:

```sh
packages/observability/scripts/tail-logs.sh --env staging --service worker \
  --regex 'pricing check' --since 1h --no-follow
```

**The record of a version.** The realm-server and every worker process also
record their version in the database at startup (`recordCurrentPricing` in
`packages/realm-server/lib/metered-charge.ts`), once per version, since
every charge they write records it: workers write the metered and batched AI
charges, and the realm-server the AI charges for the calls it forwards.
`pricing_versions` holds the version and its margin, `pricing_version_values` every value by its variable
name, and `pricing_version_rates` the USD one unit of each metered usage
costs at those values, keyed by the `credit_charge_usage` unit. A version is a
hash of its values, so a row is never changed. Nothing reads these rows to
price a charge (ADR 029 §1.2): they let a charge's usage be priced again at
its version after the startup log is gone. A failure to record logs `could
not record pricing version` on the `pricing` channel and doesn't stop the
process; its charges read as unpriced in the cost coverage report until a
process with the same prices records the version.

```sql
-- What a pricing version stands for.
SELECT variable, value FROM pricing_version_values
WHERE pricing_version = '<version>' ORDER BY variable;
SELECT unit, usd_per_unit FROM pricing_version_rates
WHERE pricing_version = '<version>' ORDER BY unit;
```

**Different versions across processes** mean the processes started with
different values: usually a deploy that restarted some tasks but not others
after an edit, or a variable wired to one task family and not another. Every
process should log the same version once a deploy settles.

## Changing a price, the margin or the floor

In our AWS deployment each variable is an SSM parameter at
`/${env}/boxel/<VARIABLE NAME>` (for example
`/staging/boxel/PRICING_MARGIN`), exposed to the realm-server, worker and
prerender tasks as an environment variable. Terraform creates each parameter
with a starting value and ignores later changes to it.

1. Edit the parameter's value in the SSM console (or `aws ssm put-parameter
--overwrite`) for the environment. Use the `aws-access` skill for access.
2. Redeploy the realm-server, worker and prerender services, since each
   process reads its environment only at start.
3. Check that every process logs `pricing check passed` with the same new
   pricing version.

Raise a rate when the provider raises it or a task moves to a pricier shape.
Change the margin to change what we earn. Never lower the margin below 1: the
check refuses it.

A realm server hosted elsewhere sets the same variables however its
deployment sets environment variables, at its own provider's rates.

## Local stacks

`mise-tasks/lib/env-vars.sh` sets every `PRICING_*` variable for local
stacks, with the shapes following the local prerender and worker scaling, so
a local process passes the check. Deployed tasks never source that file. To
see a failing check locally, override one value when starting a service, for
example `PRICING_MARGIN=0.5 mise run dev`.

## Adding or changing a pricing value

Add the variable to `PRICING_VARIABLES` and its check to `VALUE_KINDS` in
`packages/realm-server/lib/pricing.ts`, cover it in
`packages/realm-server/tests/pricing-test.ts`, add a local value to
`mise-tasks/lib/env-vars.sh`, update the table above, and add its SSM
parameter and task wiring in the infra repo before the release that reads it
reaches an environment, since a process without it fails its check. Name it
for the resource and unit it prices, not a provider's product (ADR 029 §1.2).

## Writing a metered charge

A charge is priced and written by `chargeMetered`
(`packages/realm-server/lib/metered-charge.ts`): it sums each unit's
quantity times its rate (`meteredUsd`), times the margin, at
`CREDITS_PER_USD` (`exactMeteredCredits`), and rounds up to a whole credit
(`meteredCredits`), so any usage costs at least one credit and a charge never
rounds down to less than its cost. It resolves the payer's `users` row, holds
their `withUserCostLock` and calls `spendCredits` with the usage and the
pricing version.

Worker tasks run in runtime-common, which reads no prices, so a worker hands
its tasks `TaskArgs.meteredCharges` (`MeteredCharges`, in
`packages/runtime-common/metered-charges.ts`), built by `meteredChargesFor`
over the process's current prices. A worker whose pricing check failed
answers `no-prices` and writes nothing. `MeteredUsage` is keyed by the usage
unit names below, and `BYTES_PER_GB` lives beside it, so a task measures GB
the way the prices quote them.

## A run's compute and network

A run's own compute and network are one `run` charge, to the run's identity
(`automation_runs.acts_as`: the automation's payer for a scheduled or webhook
run, the person who clicked for a Preview or Run now), referencing the run:

```
usage   = prerender_tab_seconds: automation_runs.prerender_tab_ms / 1000
          downloaded_gb:         automation_runs.call_api_response_bytes / 2^30
credits = ceil((tab seconds × prerenderTabUsdPerSecond
               + GB downloaded × PRICING_USD_PER_DOWNLOADED_GB) × PRICING_MARGIN × 1000)
```

`prerenderTabUsdPerSecond` is the prerender task's hourly cost divided over
its tabs, so a tab-second is the tab's share of its server. The tab time is
what the script took in its tab, measured by the worker around the
automation command (`renderTabMs`: the prerender server's `renderElapsedMs`,
falling back to `totalElapsedMs`, then to the call's wall clock) and added
to the row by each attempt that ran it (`addAutomationRunTabTime`). Each
attempt's time is held to what was left of the run's time limit when its
script started: the tab call gets a grace past the limit so the tab can
answer, and that grace isn't charged, so a run's compute never costs more
than the seconds cap prices it at in the minimum balance and the estimate
below. A tab call that throws carries no measure from a prerender server and
may never have reached a tab, so it adds no tab time. A `callApi` transform
runs inside the script, so its time is part of that tab time. The bytes are the response bytes the realm server counted for the
run's `callApi` calls, divided by `BYTES_PER_GB`, the same GB the switch-on
estimate prices the response-bytes cap in.

`runAutomationAttempt` charges the run through `chargeAutomationRun`
(`packages/runtime-common/automation-run-charge.ts`) once the attempt is
done and the run has ended, however it ended: complete, an error (a script
that threw, a cap, a time limit, a tab that failed) or canceled, each for
the tab time and bytes it used. A run canceled while its script ran is
charged when the script's tab answers. A run still pending or running is
left for the attempt running it, and a run that used no tab time and
downloaded nothing (one canceled before it started) has nothing to charge.
The charge is written once per run, priced from what the row holds when it
is first written, and a charge that can't be written is retried a few times
and then logged on the attempt's log, never failing the job. An attempt that
a retry replaced can still be in its tab; when that tab answers after the
newer attempt has ended and charged the run, its time reaches
`prerender_tab_ms` but isn't billed, so the row can read more tab time than
the charge's usage. A run closed without an attempt (`abandonAutomationRun`)
is charged by whatever closes it.

```sql
-- A run's compute and network: credits beside the usage they priced.
SELECT l.charge_id, l.pricing_version, -SUM(l.credit_amount) AS credits,
       (SELECT json_object_agg(unit, quantity) FROM credit_charge_usage u
        WHERE u.charge_id = l.charge_id) AS usage
FROM credits_ledger l
WHERE l.run_id = '<run id>' AND l.charge_kind = 'run'
GROUP BY l.charge_id, l.pricing_version;

-- What the row holds for it.
SELECT state, prerender_tab_ms, call_api_response_bytes, acts_as
FROM automation_runs WHERE id = '<run id>';
```

## The indexing a run's writes cause

A run's writes land as one commit (`WriteOptions.automationRun` on the realm's write),
and the indexing that commit causes is one `run_indexing` charge, to the run's
identity (`automation_runs.acts_as`), referencing the run:

```
usage   = worker_process_seconds: each job's wall clock, start of task to its charge
          prerender_tab_seconds:  each render's renderElapsedMs, summed over the renders
                                  the jobs make (not the definition-cache fills, which
                                  the shared definition lookup makes)
credits = ceil((worker seconds × workerProcessUsdPerSecond
               + tab seconds × prerenderTabUsdPerSecond) × PRICING_MARGIN × 1000)
```

Each job the commit causes carries the run and what the jobs before it
measured (`runIndexing` in its args): the index pass, a second pass when the
commit writes a module before instances, and the `prerender_html` job that
renders what the passes invalidated. The last of them adds its own
measurement and charges the total, through `chargeRunIndexing`
(`packages/runtime-common/run-indexing.ts`). So the charge is written when
the commit's indexing is done, after the run has finished. The charge covers
re-indexing and re-rendering the cards that depend on what the run wrote. A
run's jobs never coalesce with another write's, and work another writer
causes is left out: when another writer's pass commits while the run's pass
runs, the rounds the run's pass spends checking and re-visiting what that
commit left stale are not measured (their worker time is the pass's
`validationMs`, and renders started in them are not metered), and the
follow-up pass a commit enqueues for what is still stale after them carries
no run. The one exception is a URL such a round adds to the run's render
set: the run's render job renders it, and that render is counted.

A run that wrote nothing, or only files identical to what was stored, causes
no index pass and no charge. Only commits made with a run id are charged;
no other write's indexing is. The `indexing-diagnostics`
skill shows how to find a run's jobs and what each measured.

## The estimate shown at switch-on

Switching an automation on shows what it is likely to cost a month and asks
for a monthly cap. `estimateAutomationCost`
(`packages/realm-server/lib/automation-estimate.ts`) builds it from the
automation's triggers, its caps and the current prices, and records the
pricing version it used.

**The per-run ceiling.** `runCostCeiling` prices the most one run's compute,
network and AI can cost under its caps, each part in credits:

```
compute = seconds cap × prerenderTabUsdPerSecond × PRICING_MARGIN × 1000
network = response-bytes cap / 2^30 × PRICING_USD_PER_DOWNLOADED_GB × PRICING_MARGIN × 1000
AI      = the run's AI spending cap, already in credits, no margin
          × 2 (BATCHED_AI_RESERVE_FACTOR) when the automation turns on batchedAI
```

**The 2× reserve for batched AI** (ADR 030 §1.4). A batch costs at most the
normal price, and a batch that misses its deadline is paid for along with the
same requests sent again at the normal price by its follow-up run. So
wherever spending is bounded before a request is sent, each batched request
counts at twice the most it can cost at the normal price: the run's
`aiCredits` cap (each batch reserves twice its worst case, below), the
minimum balance and this estimate (the AI part counts twice for an automation
whose card turns on `batchedAI`), and the balance and caps a run is admitted
under while a batch is unsettled (_The minimum balance and the credit caps_).
The factor only reserves headroom and is never charged: each charge is what
OpenRouter billed. An automation that doesn't opt in counts its AI once, and
so does a Preview, which never submits a batch.

The estimate reads `batchedAI` from the card, which is what a switch-on
agrees to. A card that turns `batchedAI` on after switch-on pauses the
automation until the payer confirms it (the `automations` skill), and the
estimate the payer confirms against counts the AI twice.

A GB is 2^30 bytes (`BYTES_PER_GB` in `runtime-common/metered-charges.ts`), the unit AWS bills
transfer and storage in. Every per-GB quantity in this skill, `downloaded_gb`
and the GB-months included, is in that unit, and code that meters bytes into
GB divides by `BYTES_PER_GB` rather than its own constant, or the estimate and
the charge disagree by about 7%. Two charges the payer also pays are outside the
estimate, and the result lists them in `uncountedChargeKinds`: run indexing,
covered below, and storage, which depends on what the realm keeps rather than
on any one run.

**Indexing is outside the ceiling** (ADR 029 §1.5). The index and prerender
time a run's writes cause includes re-indexing every card that links to what
the run wrote, so it depends on the realm's links and templates, not on
anything the author sets. The `writes` cap limits files written, not that
time, and the caps have no indexing cap: choosing one would mean guessing at
the index's internals. So `runCostCeiling` prices compute, network and AI
only, and the minimum balance built on it doesn't cover indexing either. The
`run_indexing` charge is priced as measured when the index pass completes,
and `spendCredits` draws only what the balance holds then, so a large pass
can go partly unpaid. The pass completes after its run ends, so it can also
draw down the balance a later run was admitted against.

A partial charge records all the usage it priced, so its unpaid part is that
usage at its pricing version less the credits it drew. The cost coverage
report below sums that as its shortfall, by kind and pricing version. Credits
are whole numbers, so allow for the charge's rounding to a whole credit.

```sql
-- A run's indexing: credits drawn beside the usage they priced.
SELECT l.charge_id, l.pricing_version, -SUM(l.credit_amount) AS credits,
       (SELECT json_object_agg(unit, quantity) FROM credit_charge_usage u
        WHERE u.charge_id = l.charge_id) AS usage
FROM credits_ledger l
WHERE l.run_id = '<run id>' AND l.charge_kind = 'run_indexing'
GROUP BY l.charge_id, l.pricing_version;
```

A balance that held nothing at all records no charge and no usage
(`nothing-to-charge`), so that run shows no `run_indexing` row.

**The runs counted in a month.** The ceiling is multiplied by:

- each cron trigger's runs in an average month (`cronRunsPerMonth`). A
  trigger that fires at least 28 times in the coming average month (1461/48
  days) counts that month's runs. A rarer one counts its runs over the coming
  four years, over 48, so a monthly trigger counts 1, a yearly one 1/12 and
  one on February 29 1/48;
- for a bounded cron trigger (`until`, `count` or both), no more than the
  runs it has left (the schedule library's `remainingRuns`), so "hourly, 24
  times" counts 24 and "hourly until next year" counts a month of hours;
- one run for each `once` trigger that hasn't fired.

Two triggers that fire at the same instant each count, since each starts a
run. Webhook triggers aren't counted, because nothing predicts deliveries;
the result lists their labels in `webhookTriggers` for the screen to say so.
A trigger with an invalid expression or time zone never runs and counts
nothing. The total is rounded up to whole credits.

**Recent Preview cost** is passed in and returned beside the estimate, never
added to it, since Preview is charged to whoever clicks, not the payer.

The result also breaks the ceiling into its parts (`perRun`) and the runs
into `unboundedRunsPerMonth`, `boundedRunsPerMonth`, `onceRuns` and one entry
per trigger, so the screen can show where the number comes from.

## The minimum balance and the credit caps

Before a run costs anything, its admission's spending check
(`buildAdmitSpending` in `packages/realm-server/lib/automation-spending.ts`,
wired as `admitSpending` by `buildAutomationAdmissionChecks`) admits it or
refuses it (ADR 029 §1.5). It holds the cost lock of the person the run acts
as (`withUserCostLock`), so it serializes with that person's charges and
their other runs' checks, and in order:

1. **The minimum balance.** The person's balance (every bucket's grants and
   purchases less what was used and expired, `sumUpAvailableCredits`), less
   what their other runs in flight and their unsettled batches hold, must be
   at least the run's minimum balance:

   ```
   ceiling = ceil(runCostCeiling(caps).totalCredits)
   minimum = max(ceiling, PRICING_MINIMUM_BALANCE_FLOOR_CREDITS)
   ```

   `caps` is the caps snapshot once the automation is switched on, and the
   run's caps for a run with no row. The AI part counts twice when the
   snapshot turned on `batchedAI` and the run isn't a Preview (the 2×
   reserve above). The minimum covers a whole run because `spendCredits`
   charges only what the balance holds. Like the estimate, it leaves out the
   run's indexing.

2. **The automation's credit caps**, for a run of the automation's own (a
   trigger's run or a batch's follow-up; a Preview or Run now is charged to
   whoever clicked and isn't held to the payer's caps). What the ledger
   charged the automation since the start of this UTC day, and of this UTC
   month, plus what its other runs in flight and its unsettled batches hold,
   must be under `dailyCredits` and `monthlyCredits` from the caps snapshot.
   A cap the snapshot leaves unset doesn't limit. The caps cover every
   charge kind that names the automation (`automationCreditsSince` in
   `runtime-common/automation-spend.ts`): rows whose `run_id` is one of its
   runs (run, run indexing, AI), its batches' `batched_ai` rows and its
   `storage` rows. For run charges, only runs created up to two days before
   the day or month began are read, which covers a run's own charges and its
   index pass. A batch can be billed much later than that (a `402` waits on
   the platform's OpenRouter balance, a `410` comes 30 days after submit), so
   `batched_ai` rows are read through `ai_batches` by when the batch was
   settled, whatever its run's age, and are left out of the run join so none
   is counted twice. A Run now's batch is left out, as its run is. A run
   admitted under a cap can take the automation past it by at most what that
   run costs. The balance comes first, so a run refused for a cap had
   balance enough.
3. **The hold.** An admitted run records `ceiling` as
   `automation_runs.cost_ceiling_credits` (`holdAutomationRunCredits`), so the
   next check counts it. `creditsHeldByRunsInFlight` sums the holds:
   - a run holds its ceiling less the AI the ledger has charged it (its `ai`
     rows), since each AI request is charged as it finishes and is already
     out of the balance. `ai_credits_spent` isn't used: a request whose cost
     couldn't be learned adds its reservation there but charges nothing;
   - a hold counts from admission until `chargeAutomationRun` releases it
     (`credit_hold_released_at`, `releaseAutomationRunCreditHold`) once the
     run has ended and its `run` charge is written, or it had nothing to
     charge. A run canceled while its tab still runs keeps its hold until the
     attempt has charged what the tab used;
   - a hold nothing releases (the charge couldn't be written, or the run was
     closed without an attempt) lapses an hour after the run ended.

   Two runs admitted at once can't both pass on one run's worth of balance.

   **Unsettled batches hold too** (`creditsHeldByUnsettledAIBatches` in
   `runtime-common/ai-batches.ts`). A batch is billed only when the settle job
   settles it, after its run has stopped holding. From then until
   `settled_at` is set, it holds `ai_batches.reserved_credits`, the 2×
   reservation it took on its run's `aiCredits` cap, against the person it
   is billed to (the balance) and, unless a Run now submitted it, against its
   automation (the caps). While its run's own hold still counts, that hold
   covers the batch, since the run's ceiling includes its AI cap, so the
   batch holds nothing then. A row with no `reserved_credits` holds
   the reservation its run's row names (`ai_reservations`), or failing that
   twice `estimated_usd` in credits (the estimate is the most the batch can
   be billed, so this covers its own bill with headroom; a follow-up's
   normal-price requests are held by the follow-up run). A batch stops
   holding 31 days after `submitted_at` (`AI_BATCH_HOLD_SECONDS`): a `410`
   settles it at 30 days, so one still unsettled then is a `404` or a batch
   OpenRouter won't answer for, which the settle job keeps reading and the
   unsettled batch alert reports without it keeping the payer short. A
   batch whose charge is written but whose
   `settled_at` isn't yet set (a settle pass that stopped partway) is still
   held, so the caps never miss it, and the balance counts it twice until
   the next pass sets `settled_at`.

The hold binds automation runs only: an interactive AI request is admitted on
the plain balance (`validateAICredits`), so it can spend credits a run holds,
and the run's charge then draws what is left.

A worker whose pricing check failed refuses every run. The refusal codes,
each the run's `error_reason`:

| Code                         | Why                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `insufficient-credits`       | the balance less the holds (runs in flight and unsettled batches) is below the minimum  |
| `daily-credit-cap-reached`   | the automation's charges today (UTC) plus its other holds reached `dailyCredits`        |
| `monthly-credit-cap-reached` | the automation's charges this month (UTC) plus its other holds reached `monthlyCredits` |
| `pricing-unavailable`        | the worker has no prices (ADR 029 §1.3)                                                 |

`SPENDING_REFUSAL_REASONS` in `automation-admission.ts` lists them. A payer's
run refused with `insufficient-credits` moves the automation to _waiting for
credits_ (the `automations` skill); a payer's run admitted, or refused only
for a cap, moves it back to active. A cap leaves the automation's runs
refused until the day or month turns.

```sql
-- What a person's runs in flight hold against their balance, as admission
-- counts it.
SELECT r.id, r.automation_id, r.state, r.cost_ceiling_credits,
       COALESCE(ai.charged, 0) AS ai_charged,
       GREATEST(r.cost_ceiling_credits - COALESCE(ai.charged, 0), 0) AS held
FROM automation_runs r
LEFT JOIN LATERAL (
  SELECT -SUM(l.credit_amount) AS charged FROM credits_ledger l
  WHERE l.run_id = r.id AND l.charge_kind = 'ai'
) ai ON true
WHERE r.acts_as = '<matrix user id>'
  AND r.cost_ceiling_credits IS NOT NULL
  AND r.credit_hold_released_at IS NULL
  AND (r.finished_at IS NULL OR r.finished_at > now() - interval '1 hour');

-- What a person's unsettled batches hold against their balance, as admission
-- counts it: those whose run no longer holds its ceiling.
SELECT b.batch_id, b.run_id, b.automation_id, b.state, b.submitted_at,
       COALESCE(b.reserved_credits,
                (r.ai_reservations ->> b.run_ai_reservation)::numeric,
                b.estimated_usd * 2000) AS held
FROM ai_batches b LEFT JOIN automation_runs r ON r.id = b.run_id
WHERE b.acts_as = '<matrix user id>' AND b.settled_at IS NULL
  AND b.submitted_at > now() - interval '31 days'
  AND NOT (r.cost_ceiling_credits IS NOT NULL AND r.credit_hold_released_at IS NULL
           AND (r.finished_at IS NULL OR r.finished_at > now() - interval '1 hour'));

-- What an automation was charged this UTC month, by kind.
SELECT l.charge_kind, -SUM(l.credit_amount) AS credits
FROM credits_ledger l
WHERE l.created_at >= extract(epoch FROM date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  AND ((l.charge_kind = 'storage' AND l.automation_id = '<automation card id>')
       OR (l.charge_kind = 'batched_ai' AND l.batch_id IN
             (SELECT b.batch_id FROM ai_batches b
              LEFT JOIN automation_runs r ON r.id = b.run_id
              WHERE b.automation_id = '<automation card id>'
                AND r.trigger IS DISTINCT FROM 'manual'))
       OR (l.charge_kind IS DISTINCT FROM 'batched_ai' AND l.run_id IN
             (SELECT id FROM automation_runs
              WHERE automation_id = '<automation card id>' AND trigger <> 'manual')))
GROUP BY l.charge_kind;
```

## A run's AI requests

A run's `resolve` call is a chat completion it forwards to OpenRouter through
`_request-forward` with its run token, the same path a person's own AI
requests take. It is billed the same way, at the cost OpenRouter reports, and
differs in who pays and what the ledger row names:

| A request made by      | Billed to                                      | Its ledger rows                                      |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| a person, in their tab | the session's user                             | `charge_kind = 'ai'`, no `realm`, no `run_id`        |
| an automation run      | the run's identity (`automation_runs.acts_as`) | `charge_kind = 'ai'`, the run's `realm` and `run_id` |

`admitRunForward` (`packages/realm-server/lib/run-token-forward.ts`) admits
the request for the run, and the handler passes the run's charge,
`{ kind: 'ai', realm, runId }`, to `withBillableCall`
(`packages/realm-server/lib/billable-call.ts`), which adds the realm-server's
pricing version and hands it to the credit strategy's `spendUsageCost` when it
records the cost. Every AI call `withBillableCall` bills records that version,
a person's own included. The request is held to
the person's credits like any AI request (the minimum balance to start one,
and the per-user in-flight limit), and also to the run's caps: it counts as
one of the run's `resolveCalls` just before it is sent, and its worst case at
the model's listed price is reserved against the run's `aiCredits` until its
cost is known. A request past either cap is refused, nothing is sent or
billed, and the run ends as an error, `hit-a-cap`. The `automations` skill
has how the caps are counted.

The run row and the ledger record the same spend twice, for different
readers, and the two can differ. `automation_runs.ai_credits_spent` is
exact (fractional credits), and it is what the `aiCredits` cap reads. The
ledger is what the person pays:

- It rounds each call to whole credits, as every AI charge does, so a call
  that cost less than half a credit writes no row.
- A request whose cost can't be learned (no inline `usage.cost`, and the
  generation lookup fails) spends its whole reservation on the run row and
  writes no ledger row.
- A charge draws only what the person's credit buckets hold, so a call that
  costs more than the balance left writes less than its cost.
- An upstream error with no cost writes neither.

So a run's ledger total can read below its `ai_credits_spent`, never above
it beyond rounding. Each call is its own `ai` charge, with no identity, so a
run's AI requests are `charge_kind = 'ai' AND run_id = '<run id>'`, one
charge per request.

```sql
-- A run's AI requests: how many were billed, and what they cost.
SELECT COUNT(DISTINCT charge_id) AS requests, -SUM(credit_amount) AS credits
FROM credits_ledger WHERE run_id = '<run id>' AND charge_kind = 'ai';
```

## Batches: recorded at submit, billed when they end

A batch of AI requests sent to OpenRouter's Batch API (ADR 030) is not
charged when it is submitted. OpenRouter reports a batch's cost only once the
batch ends, in its `usage.cost`, and says so only for a completed batch. A
batch can't be canceled, so every submitted batch is paid for, and billed,
whatever happens to its run.

**The batch path.** An automation run submits and reads batches through
`POST /_ai-batches` and `GET /_ai-batches/<batch id>`
(`packages/realm-server/handlers/handle-ai-batches.ts`), which call
`https://openrouter.ai/api/v1/batches` with the platform's OpenRouter key.
That key is the system key whose destination covers that URL in
`proxy_endpoints` (see the `system-keys` skill). Add it with
`--credit-strategy none`, which the server stores as `no-credit`, since
nothing is charged per call. Only a run token reaches the path, from a
running run that its token's attempt still owns, for a person whose sessions
weren't revoked since the token was minted. A submit also needs the
automation's caps snapshot to have `batchedAI` on; a status read doesn't, so
a follow-up run can read a batch that is already paid for.
`_request-forward` refuses OpenRouter batch URLs, percent-encoded spellings
included, so a batch goes out only through the batch path.

**The record.** Each accepted submit writes one `ai_batches` row:

| Column                   | Holds                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `batch_id`               | OpenRouter's id for the batch, which a `batched_ai` ledger entry's `batch_id` names                          |
| `run_id`, `acts_as`      | the run that submitted it, and the person that run acted as, whom the batch is billed to                     |
| `realm`, `automation_id` | the automation's realm and card. Copied, not joined: a batch still settles after its realm and runs are gone |
| `model`, `request_count` | the model every request names, and how many requests the batch holds                                         |
| `estimated_usd`          | the most the batch can cost, in USD (below)                                                                  |
| `run_ai_reservation`     | the id of the reservation the batch holds on the submitting run's AI spending cap (below)                    |
| `reserved_credits`       | the credits that reservation holds, which the batch holds against balance and caps until it is settled       |
| `deadline`               | how long the submitting script waits for the results, at most 24 hours                                       |
| `expires_at`             | when OpenRouter says the provider stops working on the batch                                                 |
| `state`, `state_read_at` | OpenRouter's status as last read, and when. A final status is never overwritten                              |
| `finalized_at`           | when the batch reached a final status: OpenRouter's `finalized_at`, or when a final status was first read    |
| `deadline_missed_at`     | when a run first read the batch, at or after its deadline, and found it still open                           |
| `settle_read_at`         | when the settle job last tried to read the batch                                                             |
| `settled_at`             | when the settle job billed the batch. Null while its cost is pending                                         |
| `billed_usd`             | what the settle job billed, in USD                                                                           |
| `billed_at_estimate`     | true when `billed_usd` is the estimate because OpenRouter reported no cost                                   |

A batch whose `state` is not `completed`, `failed`, `expired` or
`cancelled` is still open; the partial index `ai_batches_open_idx` serves the
search for them. A batch OpenRouter refuses at submit (a `402` when the
platform's OpenRouter balance can't cover it, a `400` for a body it won't
take) is not submitted and not recorded.

**The estimate.** OpenRouter gives no cost estimate when it accepts a batch,
so the realm server works one out before submitting
(`packages/realm-server/lib/ai-batch-estimate.ts`): each request's worst case
(`aiRequestCostCeiling`: its body's bytes as input tokens and its
output-token limit) at the model's listed batch price, summed. OpenRouter
lists a model's batch price under `<model>:batch`, which the model sync keeps
as an `OpenRouterModel` card in the `@cardstack/openrouter/` realm like any
other model. A model with no batch listing is priced at its own listed price,
which a batch never costs more than. A request whose worst case can't be
priced, or a model with no listing, is refused before anything is sent. The
estimate is what a batch that ends with no reported cost is billed at.

**The run's AI spending cap.** Before a batch is sent, it reserves twice its
requests' worst case at the model's listed (normal) price on the submitting
run's `aiCredits` cap, in one statement (`reserveAutomationRunAICredits`,
ADR 030 §1.4): once for the batch, and once for the normal-price requests it
falls back to when the batch misses its deadline. A batch that would pass the
cap is refused whole, with a 403. When the batch isn't submitted (OpenRouter
refuses it with a 4xx, or no key covers the URL), the reservation is
released. Otherwise it stays held, named by `run_ai_reservation` and
recorded as `reserved_credits`, until the settle job settles it with what the
batch cost. Until then the batch also holds `reserved_credits` against its
payer's balance and its automation's caps, once its run has stopped holding
(_The minimum balance and the credit caps_).

A batch carries no margin, like any AI charge (ADR 029 §1.1).

```sql
-- Open batches, oldest first, with what each would be billed if it ended
-- with no reported cost.
SELECT batch_id, run_id, acts_as, request_count, estimated_usd, state,
       submitted_at, deadline, expires_at
FROM ai_batches
WHERE state NOT IN ('completed', 'failed', 'expired', 'cancelled')
ORDER BY submitted_at;

-- A batch beside its charge, once settled.
SELECT b.batch_id, b.estimated_usd, b.state,
       -SUM(l.credit_amount) AS credits_charged
FROM ai_batches b
LEFT JOIN credits_ledger l
  ON l.batch_id = b.batch_id AND l.charge_kind = 'batched_ai'
WHERE b.batch_id = '<batch id>'
GROUP BY b.batch_id, b.estimated_usd, b.state;
```

The submit logs one line on the `ai-batches` channel naming the run, the
batch, its request count, the estimate and the listing it was priced at.

**The settle job.** A cron on every worker manager enqueues an
`ai-batch-settle` job every five minutes (`AI_BATCH_SETTLE_CRON_SCHEDULE`
and `AI_BATCH_SETTLE_CRON_TZ` override it), at the system tier. A job that
arrives while another is waiting joins it. Its task hands the pass to the
realm server's `aiBatchSettlementFor`
(`packages/realm-server/lib/ai-batch-settle.ts`), which reads OpenRouter
with the same system key the batch path uses. For each unsettled batch, the
ones it tried least recently first (`settle_read_at`, so a batch OpenRouter
never answers for can't hold back the rest), a pass reads `GET /api/v1/batches/<batch id>`, records its
status, and settles it once it has ended (`completed`, `failed`, `expired`
or `cancelled`):

1. **The charge.** One `batched_ai` charge naming the batch, its run, its
   realm and the worker's pricing version (none when the worker has no
   prices, which never holds a batch back), to `acts_as`, at 1,000 credits
   to the dollar with no margin,
   rounded to the nearest credit (`chargeAIBatch` in
   `packages/billing/ai-billing.ts`). It bills what OpenRouter reported in
   `usage.cost`, recorded as `ai_provider_usd` usage. **The expired-batch
   rule:** a batch that ended with no reported cost (expired, failed or
   cancelled, as OpenRouter reports cost only for a completed batch) is
   billed at `estimated_usd`, recorded as `ai_estimated_usd` usage, so the
   platform never pays for a batch it didn't bill. A reported cost always
   wins over the estimate, whatever the status.
2. **The run's cap.** The batch's reservation (`run_ai_reservation`) is
   settled on its run with what was billed, so the run's
   `ai_credits_spent` gains it once. A run whose row is gone changes
   nothing; the charge still names it.
3. **The record.** `settled_at`, `billed_usd` and `billed_at_estimate` are
   written. Until then the batch's cost reads as pending (`aiBatchCost` in
   `packages/runtime-common/ai-batches.ts`; `listAIBatchesForRun` lists a
   run's batches).

Every step is safe to repeat: a charge writes once by its batch, a
reservation settles once, and the first settlement stands. So a pass that
stops partway is finished by the next one, which bills nothing twice.

What OpenRouter answers decides the rest:

| OpenRouter answers                       | The pass                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `200`, status still open                 | records the status; the batch stays pending                                                       |
| `200`, final status                      | settles it at the reported cost, or at its estimate                                               |
| `402`, final status with a reported cost | settles it at that cost, and logs that the platform's OpenRouter balance is short                 |
| `402` with no reported cost              | records the status and waits: OpenRouter reports the cost once the balance is topped up           |
| `410` (results deleted, 30 days on)      | settles it at its estimate                                                                        |
| `404`                                    | logs an error and leaves it unsettled: a batch the platform recorded that OpenRouter doesn't know |
| anything else, or no key covers the URL  | logs and leaves it for the next pass                                                              |

A charge the payer's balance can't cover draws what it holds, like any
charge. One that draws nothing, or whose payer has no `users` row, writes
no ledger row, and the batch is still settled, so the job never reads it
again; the cost coverage report lists it as unbilled (below), and
_Batches the settle job reports_ says what an operator does about it. The
job logs `settled batch <id> …` on the `ai-batch-settle` channel for each
batch, with what it billed and whether that was the estimate.

**A late batch.** A run that reads a batch at or after its `deadline` and
finds it still open sends the same requests at the normal price (ADR 030
§1.3). The batch path records that read as `deadline_missed_at`, and the
batch is late from then on. It is billed like any batch, and its results are
discarded: a status read answers with `results: null` (`isLateAIBatch`). A
batch that ended before any run read it past its deadline isn't late, and
its results are used. Only a run's read counts, not the settle job's.

**A batch that may exist with no row.** A batch is recorded only after
OpenRouter answers its submit. A submit whose outcome is unknown (it timed
out, its answer couldn't be read, OpenRouter answered with a 5xx, or
OpenRouter accepted it and named no batch) logs `batch submit outcome
unknown`, and one whose row couldn't be written logs that it was submitted
but not recorded; both go to Sentry with the run, identity, realm,
automation, model, request count, estimate and reservation in the event's
extras (`runId`, `actsAs`, `realm`, `automationId`, `model`,
`requestCount`, `estimatedUsd`, `runAIReservation`) and the tag
`ai-batch-submit` (`outcome-unknown` or `not-recorded`). A process that stops between the answer and the insert leaves no event.

Each settle pass also reads OpenRouter's batch list
(`GET /api/v1/batches`, newest first, every key in the workspace sees the
same list) for the batches created in the last 48 hours, and records each
one older than 30 minutes (three times the longest a submit waits for
OpenRouter's answer) that has no `ai_batches` row in
`unrecorded_ai_batches` (batch id, model, status, request count, reported
cost, created at). Each is logged and sent to Sentry once, as `OpenRouter
batch <id> has no ai_batches row`. Staging and production share an OpenRouter
workspace, so it may be the other environment's batch; _Batches the settle
job reports_ says how to tell, and how to record it from its submit's Sentry
event or dismiss it. A row whose batch turns up in `ai_batches` after all is resolved by the next
pass, as `recorded`. A pass reads every page of the window, and the
job heartbeats after each batch and page, so a long pass isn't timed out:

```sql
-- Batches OpenRouter lists that nothing bills.
SELECT batch_id, model, status, request_count, cost_usd, created_at, found_at
FROM unrecorded_ai_batches WHERE resolved_at IS NULL ORDER BY created_at;

-- How each resolved one was resolved: `recorded`, or an operator's reason.
SELECT batch_id, resolved_at, resolution
FROM unrecorded_ai_batches WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC;

-- Batches still unsettled a day after submission.
SELECT batch_id, run_id, state, state_read_at, submitted_at
FROM ai_batches
WHERE settled_at IS NULL AND submitted_at < now() - interval '24 hours'
ORDER BY submitted_at;
```

## Batches the settle job reports

The settle job finishes almost every batch on its own. Two cases it reports
and leaves to an operator: a batch it billed whose charge drew nothing, and a
batch OpenRouter lists that has no `ai_batches` row. Both are in the
Automations dashboard's **Batches** row (Boxel Status folder), each with its
actions, and each action is a Grafana endpoint an operator can also call with
the Grafana secret (`curl -X POST -H "Authorization: Bearer $GRAFANA_SECRET"
"$REALM_SERVER/_grafana-…"`, as in the `indexing-diagnostics` skill). The
endpoints are in `packages/realm-server/handlers/handle-ai-batch-operator.ts`
and log on the `ai-batch-settle` channel. The dashboard's **Reason** box
holds the reason a write-off or a dismissal records; type it before
clicking.

### A batch the payer couldn't pay for

**Find it.** The _Batches still to bill_ panel lists every settled batch
whose charge drew nothing although it cost a credit or more, oldest first,
whatever the dashboard's time range. The settle job logged `settled batch
<id> … nothing charged: the payer's balance held nothing` (or `… no payer`,
with a Sentry error `batch <id> is billed to <id>, who has no users row`). The
same list, against the read-only database:

```sql
SELECT b.batch_id, b.acts_as, b.billed_usd, b.billed_at_estimate, b.settled_at, b.run_id
FROM ai_batches b
WHERE b.settled_at IS NOT NULL AND b.written_off_at IS NULL
  AND ROUND(b.billed_usd * 1000) >= 1
  AND NOT EXISTS (SELECT 1 FROM credits_ledger l
                  WHERE l.charge_kind = 'batched_ai' AND l.batch_id = b.batch_id)
ORDER BY b.settled_at;
```

**Check.**

- Does the payer exist? A batch whose `acts_as` has no `users` row can't be
  billed to anyone. That's worth investigating: a run acts as someone with
  a `users` row, so the account was removed after the run, or `acts_as` was
  recorded wrong.
- What does the payer hold now? Their balance (Users dashboard, or
  `sumUpAvailableCredits`) less what their runs in flight hold (_The
  minimum balance and the credit caps_). A payer whose automations keep
  being refused with `insufficient-credits` is still empty.
- How much is it? `billed_usd` at 1,000 credits to the dollar, and whether
  it is the estimate (`billed_at_estimate`).

**Act.**

- **Bill it** once the payer's balance covers it: the panel's _Bill_ action,
  or `POST /_grafana-bill-ai-batch?batch=<batch id>`. It charges what the
  settle job billed, to `acts_as`, as the settle job does, so it writes the
  charge once however often it is called (`already-charged` the second
  time). A charge draws what the balance holds, and a batch is charged once,
  so whatever the balance can't cover is given up for good. So a balance
  that can't cover the whole batch answers `409` with what it holds, and
  writes nothing; add `&partial=true` to draw what it holds and give up the
  rest. A payer with no `users` row answers `409` too. A written-off batch
  is refused: the write-off stands.
- **Write it off** when it won't be billed: the payer is gone, or the
  amount isn't worth chasing. The panel's _Write off_ action, or
  `POST /_grafana-write-off-ai-batch?batch=<batch id>&reason=<why>`, records
  `written_off_at` and `write_off_reason` on the batch, and the batch leaves
  the panel and can't be billed after. A batch that is already charged
  can't be written off. The cost
  coverage report's unbilled list (`getUnbilledAIBatches`) still lists it,
  with its reason, since the platform paid for it all the same.

A batch charged only in part isn't in this list: it has a charge. Its
shortfall is the charge's `unpaid_credits` in `credit_charge_costs`.

### A batch OpenRouter lists with no record

**Find it.** The _OpenRouter batches with no record_ panel lists the
unresolved `unrecorded_ai_batches` rows. Each was logged and sent to Sentry
once, as `OpenRouter batch <id> has no ai_batches row, so nothing bills it`.

**Staging and production share one OpenRouter workspace.** Both
environments' batch system keys are the same OpenRouter key, and
OpenRouter's batch list covers every batch in the key's workspace, with no
field saying which key or environment submitted it. So each environment's
settle job lists the other's batches too, and records each one as having no
row about 30 minutes after it is submitted. Expect one report per batch the
other environment submits.

**Check both environments at once.** An operator can hold read-only
connections to staging and production at the same time (the `aws-access`
skill: one tunnel per environment, each on its own local port). Look the
reported batch ids up in both:

```sql
-- Run in each environment, with the ids from the reporting environment's
-- unrecorded_ai_batches.
SELECT batch_id, run_id, acts_as, settled_at, billed_usd
FROM ai_batches WHERE batch_id IN ('<batch id>', '<batch id>');
```

**Act.**

- **The other environment has the row.** That environment bills it.
  Dismiss it here: the panel's _Dismiss_ action, or
  `POST /_grafana-dismiss-unrecorded-ai-batch?batch=<batch id>&reason=<why>`,
  with a reason such as `production ai_batches row`. It records
  `resolved_at` and the reason as `resolution`.
- **Neither environment has the row.** This environment's submit may have
  reached OpenRouter with its outcome unknown. Find its Sentry event in the
  reporting environment: every report of such a submit carries the tag
  `ai-batch-submit` (`outcome-unknown`, or `not-recorded` when OpenRouter
  named the batch and the insert failed), whatever its title, so search
  `ai-batch-submit:*` near the batch's `created_at` for the same model and
  request count. A `not-recorded` event names the batch in `batchId`. Record
  the batch from the event's extras:
  `POST /_grafana-record-ai-batch?batch=<batch id>&run=<runId>&estimate=<estimatedUsd>&reservation=<runAIReservation>`.
  That writes the `ai_batches` row the submit didn't, with the payer, realm
  and automation from the run's row, and the model, request count, status
  and submit time OpenRouter listed. The settle job then bills it like any
  batch (its reported cost, or the estimate given), and settles the
  reservation on the run's AI cap. Until then it holds what that
  reservation holds (`reserved_credits`) against its payer's balance and
  caps, like any unsettled batch. The reservation must be one the run still
  holds and no other batch names, since a submit holds one reservation, so
  an event matched to the wrong batch is refused with a `400`. When the run's row is
  gone with its realm, also pass `acts_as`, `realm` and `automation` from the
  event. The unrecorded row resolves as `recorded`.
- **Neither environment has it, and no Sentry event matches.** Something
  else in the workspace submitted it, such as someone using the key by hand.
  Investigate who before dismissing it. The platform pays for it either way,
  and nothing here can bill it.

A batch reported less than 30 minutes after its submit isn't reported at all
(the reconciliation's grace period), and one whose row lands after it was
reported resolves on the next pass, so neither needs an operator.

## The daily storage charge

An automation's payer pays, every day the automation is active, for the
files the automation's runs created and for the files' rows in the index.
Boxel prices each day at what existed that day:

```
file GB-months     = Σ over the days charged of that day's file bytes  / BYTES_PER_GB / (1461/48)
database GB-months = Σ over the days charged of that day's index bytes / BYTES_PER_GB / (1461/48)
credits = (file GB-months × PRICING_USD_PER_FILE_STORAGE_GB_MONTH
           + database GB-months × PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH)
          × PRICING_MARGIN × 1000, rounded up
```

A month is the average month the estimate uses, 1461/48 days. The charge is
written through the worker's `MeteredCharges` (see "Writing a metered
charge").

**Which files.** `automation_files` holds one row per file an automation's
run created: the realm's URL and the file's path, spelled as
`realm_file_meta` spells them, plus the automation and the run. The realm
writes the row in the same transaction as the file's `realm_file_meta` row,
when the run's batch commits (`WriteOptions.automationRun`), whether or not
the realm keeps history. A file the run only changed was created by someone
else and has no row. Every write forgets the files it deletes or creates in
that transaction before recording any, so a deleted file stops counting,
and a file someone else later creates at the same path is not the
automation's. Deleting a realm deletes its rows.

**How big.** `getAutomationStorage` (`packages/runtime-common/automation-files.ts`)
measures an automation's files that still exist. A file's bytes are
`realm_file_meta.content_size`, the size its write recorded. Its index bytes
are every `boxel_index` and `prerendered_html` row for it, as Postgres stores
them (`pg_column_size`): a card's `instance` rows and every file's `file`
rows. The console's storage view reads the same function.

**When.** A cron on every worker manager enqueues an
`automation-storage-charge` job at 00:15 UTC. `AUTOMATION_STORAGE_CHARGE_CRON_SCHEDULE`
and `AUTOMATION_STORAGE_CHARGE_CRON_TZ` override the schedule. The job names
the UTC day that just ended and runs at the system tier. A backlog only
delays it, since the day is in its arguments. Its task
(`packages/runtime-common/automation-storage-charge.ts`) handles every
automation switched on before that day ended, and charges only the days the
automation was active.

**When the charge stops.** The job charges a day only when the automation was
`active` at some point in the day. A day the automation spends wholly paused
(for any pause reason), waiting for credits, waiting for key approval or done
is neither measured nor charged, and the job counts the automation as
`stopped` for that day. A day with both states counts as active: an
automation paused at 20:00 is charged for that day, and the charge stops from
the next day. The files stay in the realm, and readers keep the files; only
the charge stops. Resuming, the last key approval landing, the next run
admitted once the payer's balance covers the run (a top-up alone changes no
state), or a new trigger on a done automation makes the automation active
again, and the charge starts again from that day. Removing an automation deletes the
automation's `automations` row, so the job no longer measures or charges the
automation, and deleting a file stops that file counting.

**The state history.** `automation_state_changes` holds one row each time an
automation is switched on, and one each time the automation's `state` or
`pause_reason` changes, with `changed_at`. A trigger on `automations` writes
the rows, so every writer of the state is recorded alike, and removing the
automation removes the history. The job reads the state in effect when the
day began, and every change during the day, to decide whether the automation
was active. The storage route (`GET /_automation-storage`) answers
`chargeStopped` from the same history: null while the automation is active,
otherwise the current state, the pause reason and `since`, the time the
automation last left `active`, or the switch-on time for an automation that
was never active (`storageChargeStopped`). The charge stops from the first day
the automation spends wholly stopped: the day after `since` when the
automation was active earlier that day, otherwise `since`'s own day.

**A day is measured once.** For each automation, the job first records the
day's measurement as an `automation_storage_days` row (automation, day, file
bytes, index bytes). The first measurement of a day stands. A day the job
never measured, because no job ran for the day or the automation wasn't active
that day, is not charged.

**A charge covers a span of days.** A day of a few small files costs a tiny
fraction of a credit, and credits are whole numbers. So a charge covers every
measured day since the automation's last storage charge, or since it was
switched on when that is later, and is written only once those days cost at
least one whole credit. Until then the job counts the automation as
`under-a-credit` and charges nothing. The charge is named by the span's last
day (`charge_day`), so an automation is charged at most once a day, and a
duplicate or retried job finds the day already charged and writes nothing.
Its usage rows hold the GB-months of every day it covers. Switching an
automation on again after removing it starts a new span on that day. A span
can reach back across stopped days, but those days have no measurement, so the
charge covers only the active days in the span.

The job logs one line per day on the worker: `automation-storage-charge
through <day>: N charged, N not charged, N failed`. It logs each failure with
its automation. A failed automation is charged by the next day's job, whose
span still starts after its last charge.

```sql
-- The files an automation's runs created that still exist, with their sizes.
SELECT f.file_path, f.run_id, m.content_size
FROM automation_files f
JOIN realm_file_meta m ON m.realm_url = f.realm_url AND m.file_path = f.file_path
WHERE f.automation_id = '<automation identifier>'
ORDER BY f.file_path;

-- An automation's daily measurements, and the charge each day fell under.
SELECT d.day, d.file_bytes, d.index_bytes,
  (SELECT MIN(l.charge_day) FROM credits_ledger l
   WHERE l.charge_kind = 'storage' AND l.run_id IS NULL AND l.batch_id IS NULL
     AND l.automation_id = d.automation_id AND l.charge_day >= d.day) AS charged_by
FROM automation_storage_days d
WHERE d.automation_id = '<automation identifier>'
ORDER BY d.day DESC;

-- An automation's state history, newest first: the days the automation was
-- active are the days the job charges.
SELECT state, pause_reason, changed_at
FROM automation_state_changes
WHERE automation_id = '<automation identifier>'
ORDER BY changed_at DESC, id DESC;
```

## Reading the ledger by kind and reference

Every charge lands in `credits_ledger`, one row per credit bucket it draws
on (`plan_allowance_used`, `daily_credit_used`, `extra_credit_used`), and
each row says what it paid for (ADR 029 §1.6):

| Column            | Holds                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `charge_kind`     | `run`, `run_indexing`, `storage`, `ai`, `batched_ai`, `grant`, `purchase` or `expiry`                |
| `realm`           | the realm's canonical identifier, on consumption rows (an `ai` row has one only when its caller did) |
| `run_id`          | the `automation_runs` id, for `run`, `run_indexing`, `batched_ai`, and `ai` made by a run            |
| `batch_id`        | the AI provider's batch id, for `batched_ai`                                                         |
| `automation_id`   | the automation card's identifier, for `storage`                                                      |
| `charge_day`      | the UTC day, for `storage`                                                                           |
| `pricing_version` | the pricing version: what priced a `run`, `run_indexing` or `storage` row; the writer's for AI rows  |

The `credits_ledger_charge_reference_check` constraint holds each kind to
the reference it needs, so a `run` row without a run or a pricing version,
or a grant with a realm, is refused. A run's charges can outlive its
`automation_runs` row (deleting a realm deletes its runs), so read them by
`run_id` without joining the run.

**Rows without a kind.** A row has a null `charge_kind` when it was written
before the column was added to the table, or by a process without the column
during a rolling deploy. Such a row reads the kind its credit
type implies: a `*_used` row is `ai`, `plan_allowance` and `daily_credit`
are `grant`, `extra_credit` is `purchase`, and `plan_allowance_expired` is
`expiry`. A query that spans those rows (a user's spend by kind, say) must
read the kind through that mapping, not the raw column, or every historical
AI spend lands in a null group:

```sql
COALESCE(charge_kind, CASE credit_type
  WHEN 'plan_allowance_used' THEN 'ai'
  WHEN 'extra_credit_used' THEN 'ai'
  WHEN 'daily_credit_used' THEN 'ai'
  WHEN 'plan_allowance' THEN 'grant'
  WHEN 'daily_credit' THEN 'grant'
  WHEN 'extra_credit' THEN 'purchase'
  WHEN 'plan_allowance_expired' THEN 'expiry'
END) AS kind
```

In code, `getLedgerEntries` (`packages/billing/billing-queries.ts`) applies
it and filters by user, kind, realm, run, batch, automation and day.
`chargeKindForCreditType` (runtime-common) is the same mapping in
TypeScript, the `credit_charge_costs` view (see "The cost coverage report") repeats it in SQL, and so do the Users dashboard's _Credits by charge kind_ and _Credit ledger_ panels (see "Where to see a user's charges"); all of them change together.

A row with a `run_id`, `realm` or `automation_id` always carries its kind,
since those columns are only written with one, so a query filtered on any of
them may read `charge_kind` directly. Credits are negative on a spend, so a
charge's cost in credits is `-SUM(credit_amount)`. For example, against the
read-only database:

```sql
-- Everything one run cost, by kind.
SELECT charge_kind, -SUM(credit_amount) AS credits, MAX(pricing_version) AS pricing_version
FROM credits_ledger WHERE run_id = '<run id>' GROUP BY charge_kind;

-- A realm's spend by kind over the last 30 days (created_at is epoch seconds).
SELECT charge_kind, -SUM(credit_amount) AS credits
FROM credits_ledger
WHERE realm = '<realm identifier>'
  AND created_at > EXTRACT(EPOCH FROM now() - interval '30 days')
GROUP BY 1;

-- A user's spend by kind, across rows with and without a kind.
SELECT COALESCE(charge_kind, CASE credit_type
         WHEN 'plan_allowance_used' THEN 'ai' WHEN 'extra_credit_used' THEN 'ai'
         WHEN 'daily_credit_used' THEN 'ai' END) AS kind,
       -SUM(credit_amount) AS credits
FROM credits_ledger
WHERE user_id = '<users.id>' AND credit_type IN ('plan_allowance_used', 'extra_credit_used', 'daily_credit_used')
GROUP BY 1;

-- An automation's storage charges, each named by the last day it covers.
SELECT charge_day, -SUM(credit_amount) AS credits, MAX(pricing_version) AS pricing_version
FROM credits_ledger
WHERE charge_kind = 'storage' AND automation_id = '<automation identifier>'
GROUP BY charge_day ORDER BY charge_day DESC;
```

**A charge writes once.** A `run`, `run_indexing`, `storage` or `batched_ai`
charge is identified by its kind and reference: a run's compute is charged
once per run, its indexing once, a batch once per batch, and storage once
per automation per day. `spendCredits` writes a charge's rows in one
transaction, holding an advisory lock on that identity, and writes nothing
when the identity is already in the ledger, so a retried job can call it
again safely. It returns `charged`, `already-charged`, or
`nothing-to-charge` when the user's buckets held nothing to draw on. In
that last case no row carries the identity, so a later call can still charge
it. The unique index
`credits_ledger_charge_once_idx` (identity plus credit type) backs that up in
the database. An `ai` charge is one per call and a run makes many, so AI
rows have no identity and every call writes.

Two charges with the same reference but different amounts or pricing
versions are the same charge: the first one written stands. So are two
charges against different payers. A run, batch or storage day is charged once,
to whoever pays when it is first charged, so a retry after an automation's
payer changes bills no one again. Charge writers hold the payer's
`withUserCostLock` around `spendCredits`, since the balance it draws on has no
lock of its own.

**Where a kind comes from.** `spendCredits(dbAdapter, userId, credits,
charge)` takes the kind and reference; it defaults to `{ kind: 'ai' }`.
`spendUsageCost` charges an AI provider's cost as `ai` or `batched_ai`; a
billable call (`withBillableCall`) passes the `ai` charge its caller gives,
which names the run for a run's request (see [A run's AI requests](#a-runs-ai-requests)).
`addToCreditsLedger` defaults a row's kind from its credit type, so the
Stripe handlers record purchases, plan allowances and expiries without naming
a kind. An operator's top-up (`handle-add-credit`) and the daily grant task
are grants.

## Where to see a user's charges

Grafana's Users and Realms dashboards (Boxel Status folder, operators only)
read the ledger above for the dashboard's time range. An operator answers
"what did Boxel charge this user for, and why" there without SQL:

- **Users** (`/d/boxelusers0001`, pick the user's Matrix id):
  - _Automations paid by_ the user: each automation's state now, and the
    runs the automation started and the credits the automation's charges
    drew from the user in the time range. State reads "switched off" when
    someone has since switched the automation off, and "paid by" another
    user when that user pays for the automation now.
  - _Credits by charge kind_: the credits each kind charged to the user's
    balance and the credits each kind added. The panel reads an entry with
    no kind through the mapping in "Rows without a kind".
  - _Credit ledger_: every charge, newest first, one row per charge however
    many credit buckets the charge drew on. Each row shows the credits the
    charge charged or added, the bucket split, the reference (realm,
    automation and trigger, run, batch or storage day, pricing version),
    and the usage the charge priced, from `credit_charge_usage`.
- **Realms** (`/d/boxelrealms001`, pick the realm): the same three panels
  for the charges that name the realm, with the payer of each charge. Only
  consumption charges name a realm, so grants, purchases, expiries and AI
  calls that named no realm appear only on the Users dashboard.

The panels show every amount as a positive number. The ledger stores a
charge as a negative `credit_amount`, and the panels show the amount under
Credits charged; grants and purchases appear under Credits added. A realm or payer cell
links to the realm's or user's dashboard with the same time range. Each
table shows at most 500 rows, so widen or move the time range to find older
charges.

The ledger and `automations` name a prefix-mapped system realm (catalog,
skills, openrouter) by the realm's prefix form, `@cardstack/<name>/`, while
the Realms dashboard picks realms by served URL from `realm_registry`. The
panels match a bootstrap realm under both spellings, taking the prefix form
from the URL's last path segment, the same convention the dev stack's
`--fromUrl` / `--toUrl` mappings follow.

## Auditing usage, not only cost

Every spend also records how much of each unit it priced, in
`credit_charge_usage`, one row per unit (ADR 029 §1.6):

| `unit`                       | Quantity                                   | Priced by                                   |
| ---------------------------- | ------------------------------------------ | ------------------------------------------- |
| `prerender_tab_seconds`      | seconds of a prerender tab                 | `prerenderTabUsdPerSecond`                  |
| `worker_process_seconds`     | seconds of a worker process                | `workerProcessUsdPerSecond`                 |
| `downloaded_gb`              | GB (2^30 bytes) downloaded                 | `PRICING_USD_PER_DOWNLOADED_GB`             |
| `file_storage_gb_months`     | GB-months of files                         | `PRICING_USD_PER_FILE_STORAGE_GB_MONTH`     |
| `database_storage_gb_months` | GB-months of index rows                    | `PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH` |
| `ai_provider_usd`            | the AI provider's reported cost, in USD    | itself, at `CREDITS_PER_USD`, no margin     |
| `ai_estimated_usd`           | a batch's estimate, when billed at it      | itself, at `CREDITS_PER_USD`, no margin     |
| `ai_input_tokens`            | input tokens, when the caller passes them  | not priced directly; recorded for audit     |
| `ai_output_tokens`           | output tokens, when the caller passes them | not priced directly; recorded for audit     |

A usage row is keyed by `charge_id`, the id every ledger row of one spend
shares, and carries the `user_id`. A charge's rows and its usage are written
in one statement, so usage exists exactly when the charge does: a charge that
was `already-charged` or `nothing-to-charge` records none. Pass usage as the
last argument of `spendCredits`; `spendUsageCost` records `ai_provider_usd`
itself, plus any token counts it is given.

`getLedgerUsage(dbAdapter, filter)` sums usage by charge kind and unit over
the same filters as `getLedgerEntries`. In SQL, make the charges distinct
before joining, since one charge spans several ledger rows:

```sql
-- A user's usage by kind and unit over the last 30 days.
SELECT charges.charge_kind, u.unit, SUM(u.quantity) AS quantity
FROM credit_charge_usage u
JOIN (SELECT DISTINCT charge_id, charge_kind FROM credits_ledger
      WHERE user_id = '<users.id>' AND charge_id IS NOT NULL) charges
  ON charges.charge_id = u.charge_id
WHERE u.created_at > EXTRACT(EPOCH FROM now() - interval '30 days')
GROUP BY 1, 2 ORDER BY 1, 2;

-- Check a metered charge: its credits beside its usage and pricing version.
SELECT l.charge_id, l.charge_kind, l.pricing_version,
       -SUM(l.credit_amount) AS credits,
       (SELECT json_object_agg(unit, quantity) FROM credit_charge_usage u
        WHERE u.charge_id = l.charge_id) AS usage
FROM credits_ledger l WHERE l.run_id = '<run id>'
GROUP BY l.charge_id, l.charge_kind, l.pricing_version;
```

To check a metered charge, take the rate for each unit and the margin from
its pricing version's record (`pricing_version_rates`, `pricing_versions`), or
from the `pricing check passed … pricing version <hash>` line on the `pricing`
channel for a version no process recorded, and compare
Σ quantity × rate × margin × 1000 with its credits. `credit_charge_costs`
(below) does that for every charge. A spend written without usage (any written
before `credit_charge_usage` was added), and every grant, purchase and expiry,
has no usage rows.

## The cost coverage report

The report answers, for a period, whether what we charge covers what the
usage costs us: for each charge kind (run, run indexing, storage, AI, batched
AI) and pricing version, the credits the charges drew beside the hosting cost
of the usage they priced. It checks our formulas, not the AWS bill: the cost
is each charge's recorded usage at the unit rates of its own pricing version,
the same rates that priced it, and an AI charge's cost is the provider's
reported cost.

**Where it runs.** `credit_charge_costs` is a view with one row per
consumption charge: `charge_id`, `charge_kind`, `pricing_version`, `user_id`,
`realm`, `created_at`, `credits` (what it drew, across every credit bucket),
`cost_usd`, `margin`, `full_credits`, `unpaid_credits` and `cost_estimated`. `full_credits` is
what the charge draws when the balance covers it: its cost at the margin
rounded up to a whole credit, or for AI its cost rounded to the nearest
credit. `unpaid_credits` is how far short of that the charge fell, never
below 0. The view is plain SQL over the ledger, so a Grafana panel on the
Postgres data source can group it the same way. In code,
`getCostCoverage(dbAdapter, { from, to })` (`packages/billing/billing-queries.ts`)
groups it for charges written from `from` (inclusive) to `to` (exclusive).
Against the read-only database:

```sql
-- Cost coverage for November 2026, by kind and pricing version.
SELECT charge_kind, pricing_version,
       COUNT(*) AS charges,
       SUM(credits) AS credits,
       COUNT(*) FILTER (WHERE cost_usd IS NOT NULL) AS priced_charges,
       SUM(credits) FILTER (WHERE cost_usd IS NOT NULL) AS priced_credits,
       SUM(cost_usd) * 1000 AS cost_credits,
       SUM(cost_usd * margin) * 1000 AS cost_at_margin_credits,
       SUM(full_credits) AS full_credits,
       SUM(credits) FILTER (WHERE cost_usd IS NOT NULL)
         / NULLIF(SUM(cost_usd) * 1000, 0) AS coverage,
       SUM(unpaid_credits) AS shortfall_credits,
       COUNT(*) FILTER (WHERE unpaid_credits > 0) AS short_charged_charges
FROM credit_charge_costs
WHERE created_at >= EXTRACT(EPOCH FROM timestamptz '2026-11-01 00:00Z')
  AND created_at <  EXTRACT(EPOCH FROM timestamptz '2026-12-01 00:00Z')
GROUP BY 1, 2 ORDER BY 1, 2 NULLS FIRST;
```

**How to read a line.**

- `coverage` is how many times its cost a kind recovered. A fully paid
  metered kind (run, run indexing, storage) reads at least its pricing
  version's margin. How far above depends on charge size: every metered
  charge rounds up to a whole credit, and run and run-indexing charges are
  often well under one, so rounding alone can put coverage at twice the
  margin or more. Storage reads close to its margin, since its charge waits
  until its days cost a whole credit. An AI kind carries no margin and reads
  about 1; each AI charge rounds to the nearest credit, so a kind of many
  tiny calls can read a little either side.
- To tell rounding from a wrong rate, compare `full_credits` with
  `cost_at_margin_credits`: the difference is what rounding adds. A fully
  paid line's `priced_credits` equals its `full_credits`. A coverage above
  the margin that rounding doesn't explain means the formula over-charges for
  what was used, often a unit priced at the wrong rate for its task shape.
- `shortfall_credits` is credits the priced charges should have drawn and
  didn't, summed per charge, so a charge that rounded up never hides one that
  went unpaid; `short_charged_charges` counts the charges behind it. A charge
  falls short when the balance it draws on can't cover it. That's expected
  of `run_indexing`, charged against whatever the balance holds when the
  index pass completes (see "The indexing a run's writes cause"). It also
  happens to `run`, when an earlier run's index pass drew down the balance
  the run was admitted against (ADR 029 §2), and to `storage`, which the
  minimum balance doesn't cover. Find the charges with `unpaid_credits > 0`
  in the view to see which runs or automations they were.
- `charges` above `priced_charges` means some charges couldn't be priced and
  are left out of the cost, coverage and shortfall: a charge with no usage
  rows, one at a pricing version no process recorded, or one using a unit
  that has no rate at its version. Read their versions from the line and look
  for the `pricing check passed` line that named them.
- A null `pricing_version` is an AI line: the ledger requires a version on
  every run, run-indexing and storage charge. An AI or batched AI charge
  records the version of the process that wrote it, so its line sits beside
  the metered lines of the same prices, and has none when that process had no
  prices (the AI bot's charges, a process whose check failed) or when the
  charge was written without one. Either way it is priced at its provider's
  cost, which needs no rate from the version.
- **The batched AI gap.** A batch that ended with no reported cost is billed
  at its estimate, the most it could cost. Its charge is priced at that
  estimate and marked `cost_estimated` in the view; `getCostCoverage` counts
  them as `estimatedCharges` and `estimatedCredits`. What OpenRouter
  actually charged for those batches is unknown, so a batched AI line whose
  credits are mostly estimated says little about whether batches pay for
  themselves. Compare its estimated batches with OpenRouter's activity for
  the period to close it.
- **Unbilled batches.** A settled batch that wrote no charge although it
  cost a credit or more (its payer's balance held nothing, or it has no
  payer) is in no line, since the view only has charges that were written.
  `getUnbilledAIBatches(dbAdapter, { from, to })` lists them by when they
  were settled, each with `writtenOffAt` and `writeOffReason` when an
  operator wrote it off (_Batches the settle job reports_):

  ```sql
  SELECT b.batch_id, b.run_id, b.acts_as, b.billed_usd, b.billed_at_estimate
  FROM ai_batches b
  WHERE b.settled_at >= '2026-11-01' AND b.settled_at < '2026-12-01'
    AND ROUND(b.billed_usd * 1000) >= 1
    AND NOT EXISTS (SELECT 1 FROM credits_ledger l
                    WHERE l.charge_kind = 'batched_ai' AND l.batch_id = b.batch_id);
  ```

The usage a charge records is the usage it priced, so a charge that the
balance couldn't cover at all wrote nothing and appears nowhere: the report
can't see indexing that went entirely unpaid.
