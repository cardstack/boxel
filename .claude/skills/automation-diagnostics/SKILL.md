---
name: automation-diagnostics
description: >-
  Operator runbook for an automation that didn't run, ran late, failed, ran
  slowly or cost more than expected, in a deployed environment or locally.
  Takes Claude from a report like "my automation didn't run last night" to the
  automation's row, its runs, each run's `run-command` queue job and
  reservation, its run log (Postgres and Loki), its milestones, the index
  passes its commit caused, its timings at every boundary and its charges.
  Covers the `boxel:automation-runs` telemetry channel (one JSON line per
  boundary a run crosses: enqueued, claimed, admitted, script, commit,
  finished, index-pass, charged, and the prerender server's run `capacity`),
  the ids every line of a run carries (automation, run, job, attempt), and
  queue wait and prerender capacity for automation runs. Use when an operator
  or a person asks why an automation didn't run, ran twice, ran late, failed,
  was slow, paused itself or charged what it did, or when automation runs'
  queue wait or prerender capacity is in question.
allowed-tools: Read, Grep, Glob, Bash
---

# Automation diagnostics

An automation is a card. Its server half is one `automations` row; each time
it runs there is one `automation_runs` row, run by one `run-command` queue job.
This skill walks from the report to the evidence, in the order the run
happened. The `automations` skill explains how each piece works; read it when
a step below needs the why.

**Access.** Postgres in staging and production goes through the `aws-access`
skill (SSM port-forward, `claude_readonly_user`); every table below is
readable there. Loki goes through the `tail-logs` skill. Keep Loki windows
short (`--since` as small as the question allows): a day of realm-server and
worker lines is gigabytes for the hosted Loki to scan.

## The ids

Every line about a run carries the same ids, so one id reaches the rest:

| id           | What it is                                                     | Where it lives                                                                 |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `automation` | the automation card's id, as rows hold it (an RRI)             | `automations.automation_id`, `automation_runs.automation_id`                   |
| `run`        | the run's uuid                                                 | `automation_runs.id`; `credits_ledger.run_id`; `runIndexing.runId` in job args |
| `job`        | the run's `run-command` queue job                              | `jobs.id`, with `concurrency_group = 'automation:<automation>'`                |
| `attempt`    | the job reservation that owns the run (one per try of the job) | `automation_runs.attempt` = `job_reservations.id`                              |

The job's `args` carry the run too: `args->'commandInput'->>'runId'`, and
`args->>'dedupeKey'` is `automation:<automation>:<trigger>:<slot>`.

The log forms:

- worker lines: `[automation-run] automation=<id> run=<id> job=<n> attempt=<n> …`
- run log lines: `[automation-run-log] automation=<id> run=<id> job=<n> seq=… kind=… msg="…"`
- telemetry: `{"channel":"boxel:automation-runs","kind":"…","automation":"…","run":"…","job":…,"attempt":…}`
  and `{"channel":"boxel:automation-milestones",…,"job":…}`

A run log line written before a worker claimed the run (the trigger's line)
carries the job the trigger enqueued; a line with no `job=` belongs to a run
that never had one.

## "My automation didn't run last night"

Work down until a step explains it.

### 1. Find the automation

From the card's URL, match on its path; the stored id is the canonical form,
not the served URL:

```sql
SELECT automation_id, realm, payer, state, pause_reason, paused_by,
       next_run, last_enqueued_at, last_started_at, last_finished_at, last_result,
       trigger_runs, switched_on_at
  FROM automations WHERE automation_id LIKE '%<card path>';
```

- **No row**: the automation isn't switched on, or was removed (by a person,
  by deleting the realm, or because the card was deleted or stopped being an
  automation). Nothing ran it.
- **`paused`**: `pause_reason` says why. The `automations` skill's _Inspecting
  an automation_ lists each reason and who can resume it.
- **`waiting-for-credits`**: the payer's balance was under the minimum when
  the run came due. Check the payer's ledger (step 7).
- **`done`**: every trigger is spent (past `until`, or `count` reached).
- **`active` with `next_run` in the future, past last night**: the schedule
  placed no run last night. Read the card's triggers (cron, time zone, `until`,
  `count`); the `automations` skill's _Trigger timing_ covers how the next run
  is computed.
- **`active` with `next_run` long in the past**: the tick isn't claiming it.
  Go to step 2.

### 2. Is the tick running?

The tick is a system cron job that enqueues due runs every minute.

```sql
SELECT id, status, created_at, finished_at
  FROM jobs WHERE job_type = 'automation-tick'
 ORDER BY created_at DESC LIMIT 5;
```

No recent tick jobs means the scheduler stopped enqueueing them (look for
`automation-tick cron failed to enqueue job` on the realm-server). Recent tick
jobs that are `rejected`, or never `resolved`, point at the worker. The tick
records what it did on the row: `last_enqueued_at` moves each time it enqueues
a run.

### 3. Find the runs

```sql
SELECT id, trigger, slot, state, dry_run, attempt, error_reason, error_message,
       canceled_by, created_at, started_at, admitted_at, commit_started_at,
       committed_at, finished_at, prerender_tab_ms, call_api_calls, writes
  FROM automation_runs
 WHERE automation_id = '<automation>'
 ORDER BY created_at DESC LIMIT 20;
```

`slot` is the scheduled instant for a cron or one-time trigger (the click's
id for Preview and Run now, labelled `manual`). A run for last night's slot
that is:

- **missing**: nothing enqueued it. Steps 1 and 2.
- **`pending`**: enqueued, never claimed. Step 4 (queue wait).
- **`running`** long after its time limit: the attempt died. If the job has
  a reservation left, its next try takes the run over; otherwise the reconcile
  pass closes it. The `automations` skill's _Diagnosing a run_ covers it.
- **`error`**: `error_reason` says why. A run admission refused ends before
  its script runs, and its log has an `admission` line naming the code (the
  `automations` skill's _Admission_ lists them). `timed-out`, `run-failed` and
  `script-error` after the script started are the script's own. Read the run
  log (step 5).
- **`canceled`**: `canceled_by` names the person; empty means an automatic
  pause or a remove, and `error_reason` names which.
- **`complete`**: it ran. The question is what it did: steps 5 and 6.

### 4. The run's queue job

```sql
SELECT j.id, j.status, j.priority, j.concurrency_group, j.created_at,
       j.finished_at, jr.id AS reservation, jr.worker_id, jr.created_at AS claimed_at,
       jr.locked_until, jr.completed_at
  FROM jobs j LEFT JOIN job_reservations jr ON jr.job_id = j.id
 WHERE j.concurrency_group = 'automation:<automation>'
   AND j.args->'commandInput'->>'runId' = '<run>'
 ORDER BY jr.id;
```

- Claim minus `created_at` is the run's queue wait. Automation runs are
  priority 5 and run one at a time per automation (`concurrency_group`), so a
  long wait is either a backlog on the automation worker lane or the same
  automation's previous run still holding the group.
- Several reservations are retries; `automation_runs.attempt` names the one
  that owns the run.
- `worker_id` names the worker process; its own lines are in the worker logs
  (`tail-logs --service worker --worker-id <id>`).

### 5. The run's log and milestones

Postgres holds the run's log as the console shows it:

```sql
SELECT seq, at, source, kind, level, script_line, message, data
  FROM automation_run_log WHERE run_id = '<run>' ORDER BY seq;

SELECT position, name, started_at, count_done, count_total
  FROM automation_run_milestones WHERE run_id = '<run>' ORDER BY position;
```

Platform lines are the trigger, admission, each `callApi` call (status, ms,
bytes), each `resolve` call (model, status, ms, cost), the commit (files, ms)
and the finish. Script lines are its console, activity, plan, milestones,
counts, each `realm.transform` call (`kind = 'transform'`, `data.ms`) and its
uncaught error. A log past its cap ends with how many lines were dropped.

The same lines reach Loki, anchored on their tags:

```bash
packages/observability/scripts/tail-logs.sh --env staging --service realm-server \
  --regex '\[automation-run-log\] automation=\S+ run=<run> ' --since 1h --no-follow
```

The worker's own lines for the attempt (claim, refusal, finish):

```bash
packages/observability/scripts/tail-logs.sh --env staging --service worker \
  --regex '\[automation-run\] automation=\S+ run=<run> ' --since 1h --no-follow
```

### 6. Timings at every boundary

The `boxel:automation-runs` channel has one line per boundary. All timestamps
are ISO; every duration is in ms.

| `kind`       | Written by                                            | Carries                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enqueued`   | realm-server (tick, Preview, Run now)                 | `realm`, `trigger`, `triggerKind`, `dryRun`, `scheduledAt`, `enqueuedAt`, `scheduleLagMs` (how late the enqueue was)                                                                                                                                                                                                             |
| `claimed`    | worker                                                | `claimedAt`, `queueWaitMs` (enqueue → claim, by the database clock), `lane`, `priority`                                                                                                                                                                                                                                          |
| `admitted`   | worker                                                | `admitted`, `reason` (a refusal's code), `at`, `admissionMs` (claim → answer)                                                                                                                                                                                                                                                    |
| `script`     | worker                                                | `tabRequestedAt`, `tabAssignedAt`, `tabAnsweredAt`, `scriptStartedAt`, `scriptEndedAt` (the tab's clock), `scriptMs`, `tabWaitMs`, `tabQueueMs`, `tabStartupMs`, `tabReused`, `tabMs` (what compute is charged on), `prerenderRequestId`, `tabJsHeapUsedMB`, `tabJsHeapTotalMB`, `tabDomMB`, `tabBuffersMB`, `outcome`, `reason` |
| `commit`     | worker                                                | `outcome` (`committed`, `refused`, `failed`), `code`, `status`, `commitSentAt`, `answeredAt`, `ms`, `tries`                                                                                                                                                                                                                      |
| `finished`   | whoever ended the run                                 | `state`, `errorReason`, `canceledBy`, every row timestamp, `totalMs` (created → finished), `runMs` (started → finished), `prerenderTabMs`, `callApiCalls`, `callApiResponseBytes`, `resolveCalls`, `writes`, `aiCreditsSpent`                                                                                                    |
| `index-pass` | worker (the last index or render job)                 | `indexJob`, `completedAt`, `workerProcessSeconds`, `prerenderTabSeconds`                                                                                                                                                                                                                                                         |
| `charged`    | worker                                                | `chargeKind` (`run`, `run_indexing`), `result` (`charged`, `already-charged`, `nothing-to-charge`, `no-payer`, `no-prices`), `credits`, the usage it priced                                                                                                                                                                      |
| `capacity`   | prerender server, every 30 s while it holds a run tab | `runTabs`, `runningRuns`, `queuedRuns`, `totalTabs`, `maxTabs`                                                                                                                                                                                                                                                                   |

One run, every boundary:

```bash
for service in realm-server worker; do
  packages/observability/scripts/tail-logs.sh --env staging --service $service \
    --regex '"channel":"boxel:automation-runs".*"run":"<run>"' --since 1d --no-follow
done
```

Reading the gaps:

- `enqueued.scheduleLagMs` large: the tick ran late (step 2).
- `claimed.queueWaitMs` large: the automation lane was backed up, or the
  automation's previous run held its concurrency group.
- `script.tabWaitMs` large with `tabQueueMs` large: the run waited for its
  affinity's tab, which another run of the same realm and identity held. With
  `tabStartupMs` large: a cold tab. Follow `prerenderRequestId` into the
  prerender server's lines for the call.
- `scriptMs` near the run's `seconds` cap: the script ran out of time. The
  run log's `callApi` and `resolve` lines say which calls took it, and the
  milestone telemetry says which stage.
- `commit.tries` above 1: a write was staged while the commit started
  (`overlay-changed`), or the answer was lost.

Milestones, as each run ends, on their own channel with `ms` per milestone:

```bash
for service in realm-server worker; do
  packages/observability/scripts/tail-logs.sh --env staging --service $service \
    --regex '"channel":"boxel:automation-milestones".*"run":"<run>"' --since 1d --no-follow
done
```

### 7. Index passes and charges

The run's commit is indexed by jobs that carry the run in their args:

```sql
SELECT id, job_type, status, created_at, finished_at,
       args->'runIndexing' AS run_indexing, result->'chargedRunIndexing' AS charged
  FROM jobs WHERE args->'runIndexing'->>'runId' = '<run>' ORDER BY id;
```

The last of them charges the run's indexing (`index-pass` and `charged` with
`chargeKind: "run_indexing"` on the channel). The `indexing-diagnostics` skill
explains what those passes measured.

Charges referencing the run:

```sql
SELECT id, charge_kind, credit_amount, pricing_version, created_at
  FROM credits_ledger WHERE run_id = '<run>' ORDER BY created_at;
```

- `run`: the run's compute (`prerender_tab_ms`) and network
  (`call_api_response_bytes`), written when the run ends.
- `run_indexing`: the indexing its commit caused, written when the last index
  or render job is done.
- AI: each `resolve` call, as it is made; `ai_credits_spent` on the run row is
  their sum.
- Storage is charged daily per automation, not per run.

A `charged` event with `result: "no-prices"` means the process's pricing check
failed and nothing was written; `no-payer` means the payer has no `users` row.

## Capacity

The prerender server reports its run capacity on the same channel while it
holds any run tab. A run holds one tab of its affinity (its realm and
identity) for its whole script, so `runningRuns` is the runs that server runs
at once, and `queuedRuns` the runs waiting for a tab one of them holds.

```logql
max by (instance) (max_over_time({service="prerender", env="$env"} |= "boxel:automation-runs"
  | json | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:automation-runs" | kind="capacity" | unwrap runningRuns [5m]))
```

Queue wait for automation runs, across runs:

```logql
quantile_over_time(0.95, {service="worker", env="$env"} |= "boxel:automation-runs"
  | json | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json
  | channel="boxel:automation-runs" | kind="claimed" | unwrap queueWaitMs [15m])
```

A run's tab memory is on its `script` event (`tabJsHeapUsedMB`,
`tabDomMB`, `tabBuffersMB`), read as its script ended. The prerender server's
own memory lines (`prerender-heap`, `prerender-chrome-memory`) cover the
whole task.

## Locally

The same tables are in the dev database (`psql` against the local stack), and
`tail-logs.sh --env local` reads the local Loki when the observability stack
is up. `packages/realm-server/scripts/run-automation.ts` starts one run by
hand; the `automations` skill's _Running one automation by hand in
development_ covers it.
