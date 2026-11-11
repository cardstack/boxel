---
name: pricing
description: The cost model metered usage is charged by (hosting unit cost times one margin, at 1,000 credits to the dollar, ADR 029), the `PRICING_*` environment variables that carry the unit rates, task shapes, margin and minimum-balance floor to the realm-server, worker and prerender processes, the startup check and pricing version each process logs on the `pricing` log channel, how to change a price (an SSM edit under `/${env}/boxel/` and a redeploy), and how to read the credits ledger by charge kind (run, run indexing, storage, AI, batched AI, grant, purchase, expiry) and reference (realm, run, batch, automation and day), including entries with no kind and the write-once rule for a charge, and auditing the usage each charge priced (tab-seconds, worker-seconds, GB downloaded, GB-months, AI cost and tokens). Use when changing a price, the margin or the floor, when a process logs `pricing check failed`, when a pricing alert fires, when asking which prices a charge used or why two processes report different pricing versions, when adding a pricing value, when working on the monthly estimate the switch-on screen shows (the per-run ceiling under an automation's caps times the runs its triggers start in a month), when asking what a run, realm or automation was charged or how much it used or why a charge didn't write twice, or when changing `packages/realm-server/lib/pricing.ts`, `packages/realm-server/lib/automation-estimate.ts` or the ledger functions in `packages/billing/billing-queries.ts`.
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
  `WORKER_HIGH_PRIORITY_COUNT`, plus the worker manager's `--userIndexCount`
  when its start script passes one. When a task definition is resized or its
  pool or worker counts change, change its shape values in the same deploy,
  or a tab's or process's share of the task is wrong.
- **Values are plain decimals**: digits, optionally a `.` and more digits.
  A sign, an exponent, a thousands separator or surrounding spaces fail the
  check rather than being guessed at.
- **The floor is a floor.** An automation's minimum balance is computed from
  its caps at the current prices, and is never lower than
  `PRICING_MINIMUM_BALANCE_FLOOR_CREDITS` (ADR 029 §1.5).

## The startup check and the pricing version

Each process checks the set once, at startup, in `checkPricingAtStartup`
(`packages/realm-server/lib/pricing.ts`), and logs on the `pricing` channel.

- **Passing**: one info line, `pricing check passed in <process>: pricing
version <hash>; PRICING_…=… …`, with every value. The version is the first
  16 hex characters of a SHA-256 over the parsed values, so `1.5` and `1.50`
  give the same version. Every metered charge records it (ADR 029 §1.4).
- **Failing**: one error line, `pricing check failed in <process>: …`, naming
  every bad variable and what is wrong with it, and the same message sent to
  Sentry tagged `pricingCheck: failed` and `process: <name>`. That is the
  signal pricing alerts fire on. One bad value fails the whole set:
  `currentPricing()` then returns undefined, and the process admits no new
  run and submits no new batch until it restarts with good values (ADR 029
  §1.3). Interactive work and runs already going are unaffected.

To read either line in a deployed environment, use the `tail-logs` skill, for
example:

```sh
packages/observability/scripts/tail-logs.sh --env staging --service worker \
  --regex 'pricing check' --since 1h --no-follow
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
```

A GB is 2^30 bytes (`BYTES_PER_GB` in `pricing.ts`), the unit AWS bills
transfer and storage in. Every per-GB quantity in this skill, `downloaded_gb`
and the GB-months included, is in that unit, and code that meters bytes into
GB divides by `BYTES_PER_GB` rather than its own constant, or the estimate and
the charge disagree by about 7%. Two charges the payer also pays are outside the
estimate, and the result lists them in `uncountedChargeKinds`: run indexing,
which no cap bounds, and storage, which depends on what the realm keeps
rather than on any one run.

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
| `pricing_version` | the pricing version that priced it, on `run`, `run_indexing` and `storage`                           |

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
TypeScript, and the two change together.

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

-- An automation's storage charges, a day at a time.
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
`spendUsageCost` charges an AI provider's cost as `ai` or `batched_ai`.
`addToCreditsLedger` defaults a row's kind from its credit type, so the
Stripe handlers record purchases, plan allowances and expiries without naming
a kind. An operator's top-up (`handle-add-credit`) and the daily grant task
are grants.

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

To check a metered charge, find the process that logged its pricing version
(`pricing check passed … pricing version <hash>` on the `pricing` channel),
take the rate for each unit and the margin from that line, and compare
Σ quantity × rate × margin × 1000 with its credits. A spend written without
usage (any written before `credit_charge_usage` was added), and every grant,
purchase and expiry, has no usage rows.
