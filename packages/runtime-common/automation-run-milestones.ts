// An automation run's milestones, and the notable tasks inside each. The
// script is their only source: it declares the milestones up front with
// `realm.progress.plan([...names])`, marks each as it reaches it with
// `realm.progress.milestone(name)`, and reports each notable task inside one
// with `realm.progress.task(text)`, such as "Grouped the bug label". The
// automation card holds no list of them, since a list kept on the card drifts
// from what the code does.
//
// Those calls reach the realm server as the run's log lines (`/_run-log`),
// and `appendRunLog` hands them here under the run row's lock, before the
// log's cap is checked, so a run whose log is full still records where it
// got to. The plan is `automation_runs.milestone_plan`; each milestone the
// run reaches is one `automation_run_milestones` row, in the order reached,
// and each task one `automation_run_tasks` row, under the milestone the run
// was in. A milestone lasts until the next one starts, or until the run ends.
//
// When a run ends, each of its milestones is written once to the
// `boxel:automation-milestones` telemetry channel with the time spent in it
// and how many tasks the script reported in it, tagged with the run's
// automation, run and queue job.

import type { AutomationRun, AutomationRunState } from './automation-runs.ts';
import type { RunLogLine } from './automation-run-log.ts';
import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  param,
  query,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
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

// The longest task `realm.progress.task` takes: the automation surface's
// `MAX_TASK_CHARS` (host `lib/realm-runner/surfaces.ts`).
export const RUN_TASK_MAX_CHARS = 200;

// The most tasks one run records. A script that reports one per item of a
// long loop would otherwise write a row per item, and the card would list
// them all; past this, tasks are counted in `tasks_dropped`.
export const RUN_MAX_TASKS = 200;

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
  // The notable tasks the script reported inside the milestone, in order.
  tasks: RunTask[];
}

export interface RunTask {
  text: string;
  // ISO time the script reported the task.
  at: string;
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
  // Tasks not recorded: reported past `RUN_MAX_TASKS`, or inside a milestone
  // marked past `RUN_MAX_MILESTONES`.
  tasksDropped: number;
}

export interface RecordedRunProgress {
  // The milestones the lines marked that the run recorded.
  milestones: number;
  // The tasks the lines reported that the run recorded.
  tasks: number;
}

// Records the plan, milestone and task lines among `lines`, in order, for
// the run whose row the caller's transaction has locked. Every other line is
// ignored, as is a task before the run's first milestone and anything the
// automation surface would have refused.
export async function recordRunMilestones(
  txQuery: Querier,
  runId: string,
  lines: readonly RunLogLine[],
): Promise<RecordedRunProgress> {
  let progress = lines.filter(
    (line) =>
      line.source === 'script' &&
      (line.kind === 'plan' ||
        line.kind === 'milestone' ||
        line.kind === 'task'),
  );
  if (progress.length === 0) {
    return { milestones: 0, tasks: 0 };
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
  let nextTaskPosition = 0;
  if (progress.some((line) => line.kind === 'task')) {
    let [lastTask] = (await txQuery([
      'SELECT position FROM automation_run_tasks WHERE run_id =',
      param(runId),
      'ORDER BY position DESC LIMIT 1',
    ])) as { position: number }[];
    nextTaskPosition = lastTask ? Number(lastTask.position) + 1 : 0;
  }
  // The milestone the run is in, by position, or none before its first.
  let milestonePosition: number | undefined = last
    ? Number(last.position)
    : undefined;
  let plan: string[] | undefined;
  let reached: { position: number; name: string; at: number }[] = [];
  let tasks: {
    position: number;
    milestonePosition: number;
    text: string;
    at: number;
  }[] = [];
  let dropped = 0;
  let tasksDropped = 0;
  // Whether the milestone the run is in went unrecorded. Once one mark is
  // past the cap every later one is too, so a run that has dropped a mark is
  // in an unrecorded milestone, and its tasks belong to none.
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
      milestonePosition = nextPosition;
      reached.push({ position: nextPosition++, name, at: line.at });
    } else {
      let text = taskText(data.text);
      if (text === undefined || milestonePosition === undefined) {
        continue;
      }
      if (inDropped || nextTaskPosition >= RUN_MAX_TASKS) {
        tasksDropped++;
        continue;
      }
      tasks.push({
        position: nextTaskPosition++,
        milestonePosition,
        text,
        at: line.at,
      });
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
        '::timestamptz)',
      );
    }
    await txQuery([
      'INSERT INTO automation_run_milestones (run_id, position, name, started_at) VALUES',
      ...values,
    ]);
  }
  if (tasks.length > 0) {
    let values: Expression = [];
    for (let [index, task] of tasks.entries()) {
      values.push(
        index === 0 ? '(' : ', (',
        param(runId),
        ',',
        param(task.position),
        ',',
        param(task.milestonePosition),
        ',',
        param(task.text),
        ',',
        param(new Date(task.at).toISOString()),
        '::timestamptz)',
      );
    }
    await txQuery([
      'INSERT INTO automation_run_tasks (run_id, position, milestone_position, text, reported_at) VALUES',
      ...values,
    ]);
  }
  if (dropped > 0 || tasksDropped > 0) {
    await txQuery([
      'UPDATE automation_runs SET milestones_dropped = milestones_dropped +',
      param(dropped),
      ', tasks_dropped = tasks_dropped +',
      param(tasksDropped),
      'WHERE id =',
      param(runId),
    ]);
  }
  return { milestones: reached.length, tasks: tasks.length };
}

// Clears a run's milestones and their tasks, inside the caller's
// transaction, for an attempt that runs the script again from its start.
export async function clearRunMilestones(
  txQuery: Querier,
  runId: string,
): Promise<void> {
  await txQuery([
    'DELETE FROM automation_run_tasks WHERE run_id =',
    param(runId),
  ]);
  await txQuery([
    'DELETE FROM automation_run_milestones WHERE run_id =',
    param(runId),
  ]);
  await txQuery([
    'UPDATE automation_runs SET milestone_plan = NULL, milestones_dropped = 0, tasks_dropped = 0 WHERE id =',
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
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped, tasks_dropped FROM automation_runs WHERE id =',
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
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped, tasks_dropped FROM automation_runs WHERE automation_id =',
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
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped, tasks_dropped FROM automation_runs WHERE automation_id =',
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
        tasks: milestone.tasks.length,
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
  // How many tasks the script reported inside the milestone that the run
  // recorded.
  tasks: number;
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
  tasks_dropped: number;
}

interface MilestoneRow {
  position: number;
  name: string;
  started_at: string | Date;
}

interface TaskRow {
  milestone_position: number;
  text: string;
  reported_at: string | Date;
}

async function milestonesOf(
  dbAdapter: DBAdapter,
  run: RunRow,
  now: number,
): Promise<RunMilestones> {
  let rows = (await query(dbAdapter, [
    'SELECT position, name, started_at FROM automation_run_milestones WHERE run_id =',
    param(String(run.id)),
    'ORDER BY position',
  ])) as unknown as MilestoneRow[];
  let tasks = (await query(dbAdapter, [
    'SELECT milestone_position, text, reported_at FROM automation_run_tasks WHERE run_id =',
    param(String(run.id)),
    'ORDER BY position',
  ])) as unknown as TaskRow[];
  return milestonesFrom(run, rows, tasks, now);
}

// Many runs' milestones at once, by run id, as `readRunMilestones` reads each
// one: three queries however many runs, for a page of runs. A run id that
// names no run is left out.
export async function readRunMilestonesFor(
  dbAdapter: DBAdapter,
  runIds: string[],
  { now = Date.now() }: { now?: number } = {},
): Promise<Map<string, RunMilestones>> {
  let found = new Map<string, RunMilestones>();
  if (runIds.length === 0) {
    return found;
  }
  let ids = separatedByCommas(runIds.map((id) => [param(id)]));
  let runs = (await query(dbAdapter, [
    'SELECT id, state, started_at, finished_at, milestone_plan, milestones_dropped, tasks_dropped FROM automation_runs WHERE id IN',
    ...(addExplicitParens(ids) as Expression),
  ])) as unknown as RunRow[];
  let rows = (await query(dbAdapter, [
    'SELECT run_id, position, name, started_at FROM automation_run_milestones WHERE run_id IN',
    ...(addExplicitParens(ids) as Expression),
    'ORDER BY run_id, position',
  ])) as unknown as (MilestoneRow & { run_id: string })[];
  let taskRows = (await query(dbAdapter, [
    'SELECT run_id, milestone_position, text, reported_at FROM automation_run_tasks WHERE run_id IN',
    ...(addExplicitParens(ids) as Expression),
    'ORDER BY run_id, position',
  ])) as unknown as (TaskRow & { run_id: string })[];
  let byRun = groupByRun(rows);
  let tasksByRun = groupByRun(taskRows);
  for (let run of runs) {
    found.set(
      String(run.id),
      milestonesFrom(
        run,
        byRun.get(String(run.id)) ?? [],
        tasksByRun.get(String(run.id)) ?? [],
        now,
      ),
    );
  }
  return found;
}

function groupByRun<Row extends { run_id: string }>(
  rows: Row[],
): Map<string, Row[]> {
  let byRun = new Map<string, Row[]>();
  for (let row of rows) {
    let list = byRun.get(String(row.run_id)) ?? [];
    list.push(row);
    byRun.set(String(row.run_id), list);
  }
  return byRun;
}

function milestonesFrom(
  run: RunRow,
  rows: MilestoneRow[],
  taskRows: TaskRow[],
  now: number,
): RunMilestones {
  let plan = planOf(run.milestone_plan);
  let tasksByMilestone = new Map<number, RunTask[]>();
  for (let row of taskRows) {
    let position = Number(row.milestone_position);
    let list = tasksByMilestone.get(position) ?? [];
    list.push({
      text: row.text,
      at: new Date(row.reported_at).toISOString(),
    });
    tasksByMilestone.set(position, list);
  }
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
      tasks: tasksByMilestone.get(Number(row.position)) ?? [],
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
    tasksDropped: Number(run.tasks_dropped),
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

function taskText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  // The tab's limit holds the script to `RUN_TASK_MAX_CHARS`; redaction can
  // lengthen a task past it, and the cut keeps the task.
  let text = value.trim();
  return text ? text.slice(0, RUN_TASK_MAX_CHARS) : undefined;
}
