---
name: pricing
description: The cost model metered usage is charged by (hosting unit cost times one margin, at 1,000 credits to the dollar, ADR 029), the `PRICING_*` environment variables that carry the unit rates, task shapes, margin and minimum-balance floor to the realm-server, worker and prerender processes, the startup check and pricing version each process logs on the `pricing` log channel, and how to change a price (an SSM edit under `/${env}/boxel/` and a redeploy). Use when changing a price, the margin or the floor, when a process logs `pricing check failed`, when a pricing alert fires, when asking which prices a charge used or why two processes report different pricing versions, when adding a pricing value, or when changing `packages/realm-server/lib/pricing.ts`.
---

# Pricing (operators and boxel developers)

Read ADR 029 for the rules. This skill is the operating procedure.

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
