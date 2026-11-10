---
name: automations
description: Developer guide to the automations system. Covers how an automation run reaches a worker — the automation priority tier (`automationInitiatedPriority = 5` in runtime-common's queue.ts), the automation worker lane (`--automationCount` on the worker manager, `WORKER_AUTOMATION_PRIORITY_COUNT` in the start scripts and the dev stack), which lanes claim a run and which never do, and how the tier meets the prerender server's high-priority tab tier. Use when enqueueing the job that runs an automation (from its schedule, reconcile, an automation's webhook trigger, a batch follow-up, Preview or Run now), when a run waits in the queue longer than expected, when sizing or adding the automation lane in a deployment, or when changing the priority tiers, `lib/worker-lanes.ts` or `worker-manager.ts`.
---

# Automations

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

The run-command job that runs an automation goes at `automationInitiatedPriority`, whatever started the run: its schedule, reconcile, one of its webhook triggers, a batch follow-up, Preview, or Run now. Import the constant from `@cardstack/runtime-common`. Don't write the number. A webhook command that is not an automation (`handlers/handle-webhook-receiver.ts`) is ordinary user work and enqueues at `userInitiatedPriority`.

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
