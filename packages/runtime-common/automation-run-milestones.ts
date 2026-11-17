// An automation run's milestones. The script is their only source: it
// declares them up front with `realm.progress.plan([...names])`, marks each
// as it reaches it with `realm.progress.milestone(name)`, and reports how far
// it is inside one with `realm.progress.count(done, total)`. The automation
// card holds no list of them, since a list kept on the card drifts from what
// the code does.
//
// Those calls reach the realm server as the run's log lines (`/_run-log`),
// and `appendRunLog` hands them here under the run row's lock, before the
// log's cap is checked, so a run whose log is full still records where it
// got to. The plan is `automation_runs.milestone_plan`; each milestone the
// run reaches is one `automation_run_milestones` row, in the order reached.
// A milestone lasts until the next one starts, or until the run ends.
//
// When a run ends, each of its milestones is written once to the
// `boxel:automation-milestones` telemetry channel with the time spent in it,
// tagged with the run's automation, run and queue job.

import type { AutomationRun, AutomationRunState } from './automation-runs.ts';
import type { RunLogLine } from './automation-run-log.ts';
import type { DBAdapter } from './db.ts';
import { param, query, type Expression, type Querier } from './expression.ts';
import { logger } from './log.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// The most milestones a plan names, and the longest a milestone's name may
// be: the automation surface's `MAX_MILESTONES` and `MAX_MILESTONE_CHARS`
// (host `lib/realm-runner/surfaces.ts`), which refuse a plan or a name past
// them in the script. The realm server holds a run's tab to them too.
export const RUN_MILESTONE_MAX_PLAN = 50;
export const RUN_MILESTONE_MAX_NAME_CHARS = 80;

// The most milestones one run records. A script that marks one per item of a
// long loop would otherwise write a row per item; past this, marks are
// counted in `milestones_dropped` and the run's last recorded milestone
// lasts until the run ends.
export const RUN_MAX_MILESTONES = 200;

// The largest count Postgres's `integer` holds.
const MAX_COUNT = 2 ** 31 - 1;

export const AUTOMATION_MILESTONES_CHANNEL = 'boxel:automation-milestones';

export interface RunMilestone {
  name: string;
  // The plan the script declared names this milestone.
  planned: boolean;
  // ISO times. `endedAt` is null for the milestone a running run is in.
  startedAt: string;
  endedAt: string | null;
  // Time spent in the milestone: to its end, or, while the run is in it, to
  // now.
  ms: number;
  // The last count the script reported inside the milestone.
  done?: number;
  total?: number;
}

export interface RunMilestones {
  runId: string;
  state: AutomationRunState;
  // ISO times of the run's start and end, when it has them.
  startedAt: string | null;
  finishedAt: string | null;
  // The plan the script declared last, in order; empty when it declared none.
  plan: string[];
  // The milestones the run reached, in the order it reached them.
  milestones: RunMilestone[];
  // The milestone a running run is in.
  current: string | null;
  // The plan's milestones the run hasn't reached.
  ahead: string[];
  // For a run that ended with an error, the milestone it was in.
  failedIn: string | null;
  // Milestones marked past `RUN_MAX_MILESTONES`, not recorded.
  dropped: number;
}

// Records the plan, milestone and count lines among `lines`, in order, for
// the run whose row the caller's transaction has locked. Every other line is
// ignored, as is a count before the run's first milestone and anything the
// automation surface would have refused.
export async function recordRunMilestones(
  txQuery: Querier,
  runId: string,
  lines: readonly RunLogLine[],
): Promise<void> {
  let progress = lines.filter(
    (line) =>
      line.source === 'script' &&
      (line.kind === 'plan' ||
        line.kind === 'milestone' ||
        line.kind === 'count'),
  );
  if (progress.length === 0) {
    return;
  }
  let [run] = (await txQuery([
    'SELECT milestones_dropped FROM automation_runs WHERE id =',
    param(runId),
  ])) as { milestones_dropped: number }[];
  let [last] = (await txQuery([
    'SELECT position FROM automation_run_milestones WHERE run_id =',
    param(runId),
    'ORDER BY position DESC LIMIT 1',
  ])) as { position: number }[];
  let nextPosition = last ? Number(last.position) + 1 : 0;
  let plan: string[] | undefined;
  let reached: {
    position: number;
    name: string;
    at: number;
    done?: number;
    total?: number;
  }[] = [];
  // A count for the milestone the run was in before this batch.
  let earlierCount: { done: number; total?: number } | undefined;
  let dropped = 0;
  // Whether the milestone the run is in went unrecorded. Once one mark is
  // past the cap every later one is too, so a run that has dropped a mark is
  // in an unrecorded milestone, and its counts belong to none.
  let inDropped = Number(run?.milestones_dropped ?? 0) > 0;
  for (let line of progress) {
    let data = line.data ?? {};
    if (line.kind === 'plan') {
      let names = Array.isArray(data.milestones) ? data.milestones : [];
      plan = names
        .slice(0, RUN_MILESTONE_MAX_PLAN)
        .map((name) => milestoneName(name))
        .filter((name): name is string => name !== undefined);
    } else if (line.kind === 'milestone') {
      let name = milestoneName(data.name);
      if (name === undefined) {
        continue;
      }
      if (nextPosition >= RUN_MAX_MILESTONES) {
        dropped++;
        inDropped = true;
        continue;
      }
      inDropped = false;
      reached.push({ position: nextPosition++, name, at: line.at });
    } else {
      let done = countValue(data.done);
      let total = data.total === undefined ? undefined : countValue(data.total);
      if (
        done === undefined ||
        (data.total !== undefined && total === undefined) ||
        inDropped
      ) {
        continue;
      }
      let current = reached.at(-1);
      if (current) {
        current.done = done;
        current.total = total;
      } else if (last) {
        earlierCount = { done, total };
      }
    }
  }
  if (plan) {
    await txQuery([
      'UPDATE automation_runs SET milestone_plan = ARRAY(SELECT jsonb_array_elements_text(',
      param(JSON.stringify(plan)),
      '::jsonb)) WHERE id =',
      param(runId),
    ]);
  }
  if (earlierCount && last) {
    await txQuery([
      'UPDATE automation_run_milestones SET count_done =',
      param(earlierCount.done),
      ', count_total =',
      param(earlierCount.total ?? null),
      'WHERE run_id =',
      param(runId),
      'AND position =',
      param(Number(last.position)),
    ]);
  }
  if (reached.length > 0) {
    let values: Expression = [];
    for (let [index, milestone] of reached.entries()) {
      values.push(
        index === 0 ? '(' : ', (',
        param(runId),
        ',',
        param(milestone.position),
        ',',
        param(milestone.name),
        ',',
        param(new Date(milestone.at).toISOString()),
        '::timestamptz,',
        param(milestone.done ?? null),
        ',',
        param(milestone.total ?? null),
        ')',
      );
    }
    await txQuery([
      'INSERT INTO automation_run_milestones (run_id, position, name, started_at, count_done, count_total) VALUES',
      ...values,
    ]);
  }
  if (dropped > 0) {
    await txQuery([
      'UPDATE automation_runs SET milestones_dropped = milestones_dropped +',
      param(dropped),
      'WHERE id =',
      param(runId),
    ]);
  }
}

// Clears a run's milestones, inside the caller's transaction, for an attempt
// that runs the script again from its start.
export async function clearRunMilestones(
  txQuery: Querier,
  runId: string,
): Promise<void> {
  await txQuery([
    'DELETE FROM automation_run_milestones WHERE run_id =',
    param(runId),
  ]);
  await txQuery([
    'UPDATE automation_runs SET milestone_plan = NULL, milestones_dropped = 0 WHERE id =',
    param(runId),
  ]);
}

// A run's milestones as its row and milestone rows hold them, or undefined
// when there is no such run.
export async function readRunMilestones(
  dbAdapter: DBAdapter,
  runId: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<RunMilestones | undefined> {
  let [run] = (await query(dbAdapter, [
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped FROM automation_runs WHERE id =',
    param(runId),
  ])) as unknown as RunRow[];
  return run ? await milestonesOf(dbAdapter, run, now) : undefined;
}

// The automation's last run that started and has ended, with its milestones:
// what the automation card shows. A Preview is a test of the script, not one
// of the automation's runs, so it is left out. Undefined when no run has
// ended.
export async function readLastRunMilestones(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
): Promise<RunMilestones | undefined> {
  let [run] = (await query(dbAdapter, [
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped FROM automation_runs WHERE automation_id =',
    param(automationId),
    'AND finished_at IS NOT NULL AND started_at IS NOT NULL AND NOT dry_run',
    'ORDER BY finished_at DESC, id LIMIT 1',
  ])) as unknown as RunRow[];
  return run ? await milestonesOf(dbAdapter, run, Date.now()) : undefined;
}

// The automation's run in progress, if one is running, with its milestones so
// far: the one it is in reads as `current`, with the time spent in it so far.
// A Preview in progress is left out, as in `readLastRunMilestones`.
export async function readCurrentRunMilestones(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  { now = Date.now() }: { now?: number } = {},
): Promise<RunMilestones | undefined> {
  let [run] = (await query(dbAdapter, [
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped FROM automation_runs WHERE automation_id =',
    param(automationId),
    "AND state = 'running' AND NOT dry_run",
    'ORDER BY started_at DESC NULLS LAST, id LIMIT 1',
  ])) as unknown as RunRow[];
  return run ? await milestonesOf(dbAdapter, run, now) : undefined;
}

// Writes each milestone of a run that has ended to telemetry, once, with the
// time spent in it. Called as the run ends; it never fails the run, so a
// telemetry write that throws costs the record, not the finish. `outcome` is
// the run's state as it ended: a run that ended as `commit-interrupted` and
// whose batch landed afterwards reads `complete` on its row, and `error` here.
export async function closeRunMilestones(
  dbAdapter: DBAdapter,
  run: AutomationRun,
  // The queue job that owned the run's last attempt, when it had one.
  job?: number,
): Promise<void> {
  try {
    let milestones = await readRunMilestones(dbAdapter, run.id);
    if (!milestones) {
      return;
    }
    for (let [position, milestone] of milestones.milestones.entries()) {
      emitAutomationMilestone({
        automation: run.automationId,
        realm: run.realm,
        run: run.id,
        ...(job !== undefined ? { job } : {}),
        outcome: run.state,
        ...(run.errorReason ? { errorReason: run.errorReason } : {}),
        milestone: milestone.name,
        position,
        planned: milestone.planned,
        ms: milestone.ms,
        ...(milestone.done !== undefined ? { done: milestone.done } : {}),
        ...(milestone.total !== undefined ? { total: milestone.total } : {}),
        failedHere:
          milestones.failedIn !== null &&
          position === milestones.milestones.length - 1,
      });
    }
  } catch (error) {
    log.error(
      `could not record run ${run.id}'s milestones in telemetry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// One milestone of an ended run, as the telemetry line carries it. The
// numbers are flat top-level fields, so LogQL's `| json` can `unwrap` them.
export interface AutomationMilestoneEvent {
  automation: string;
  realm: string;
  run: string;
  // The run's queue job, when it had one.
  job?: number;
  outcome: AutomationRunState;
  errorReason?: string;
  milestone: string;
  // The milestone's place in the order the run reached them, from 0.
  position: number;
  planned: boolean;
  ms: number;
  done?: number;
  total?: number;
  // The run ended with an error while in this milestone.
  failedHere: boolean;
}

// Test seam: when set, events go to the sink instead of the logger.
let milestoneSink: ((event: AutomationMilestoneEvent) => void) | undefined;

export function setAutomationMilestoneSink(
  sink: ((event: AutomationMilestoneEvent) => void) | undefined,
): void {
  milestoneSink = sink;
}

const log = logger('automation-run-milestones');

// Created lazily, as the other telemetry channels are: a module-scope
// `logger()` for a channel can race the import that installs the log
// definitions.
let milestoneLog: ReturnType<typeof logger> | undefined;

function emitAutomationMilestone(event: AutomationMilestoneEvent): void {
  if (milestoneSink) {
    milestoneSink(event);
    return;
  }
  (milestoneLog ??= logger(AUTOMATION_MILESTONES_CHANNEL)).info(
    JSON.stringify({ channel: AUTOMATION_MILESTONES_CHANNEL, ...event }),
  );
}

interface RunRow {
  id: string;
  state: AutomationRunState;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  milestone_plan: string[] | null;
  milestones_dropped: number;
}

async function milestonesOf(
  dbAdapter: DBAdapter,
  run: RunRow,
  now: number,
): Promise<RunMilestones> {
  let rows = (await query(dbAdapter, [
    'SELECT name, started_at, count_done, count_total FROM automation_run_milestones WHERE run_id =',
    param(String(run.id)),
    'ORDER BY position',
  ])) as {
    name: string;
    started_at: string | Date;
    count_done: number | null;
    count_total: number | null;
  }[];
  let plan = planOf(run.milestone_plan);
  let planned = new Set(plan);
  let finishedAt = run.finished_at ? new Date(run.finished_at) : undefined;
  let milestones: RunMilestone[] = rows.map((row, index) => {
    let startedAt = new Date(row.started_at);
    let next = rows[index + 1];
    let endedAt = next ? new Date(next.started_at) : finishedAt;
    return {
      name: row.name,
      planned: planned.has(row.name),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt ? endedAt.toISOString() : null,
      // The tab stamps a milestone's start and the realm server stamps the
      // run's end, so the two clocks can disagree by a little.
      ms: Math.max(0, (endedAt?.getTime() ?? now) - startedAt.getTime()),
      ...(row.count_done != null ? { done: Number(row.count_done) } : {}),
      ...(row.count_total != null ? { total: Number(row.count_total) } : {}),
    };
  });
  // A plan may name a milestone more than once, so each one reached accounts
  // for one occurrence of its name, in plan order.
  let reachedCounts = new Map<string, number>();
  for (let { name } of milestones) {
    reachedCounts.set(name, (reachedCounts.get(name) ?? 0) + 1);
  }
  let ahead = plan.filter((name) => {
    let left = reachedCounts.get(name) ?? 0;
    if (left > 0) {
      reachedCounts.set(name, left - 1);
      return false;
    }
    return true;
  });
  let last = milestones.at(-1);
  return {
    runId: String(run.id),
    state: run.state,
    startedAt: run.started_at ? new Date(run.started_at).toISOString() : null,
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    plan,
    milestones,
    current: run.state === 'running' && last ? last.name : null,
    ahead,
    failedIn: run.state === 'error' && last ? last.name : null,
    dropped: Number(run.milestones_dropped),
  };
}

function planOf(value: string[] | null): string[] {
  return Array.isArray(value) ? value : [];
}

function milestoneName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let name = value.trim();
  return name && name.length <= RUN_MILESTONE_MAX_NAME_CHARS ? name : undefined;
}

function countValue(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_COUNT
    ? value
    : undefined;
}
