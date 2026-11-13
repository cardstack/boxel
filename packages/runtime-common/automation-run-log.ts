// An automation run's log (ADR 025 §1.1): the script's console lines,
// activity lines, run milestones and uncaught error, beside the platform's
// own lines for what the realm server did on the run's behalf. Each line is
// stored in `automation_run_log` for the console, and written once to the
// realm server's own log as an `[automation-run-log]` line, which reaches
// Loki tagged with the automation, the run and the run's queue job.
//
// Every text is redacted as it is stored, whoever sent it: the tab redacts
// the script's lines before they leave it, and this is the second pass, so a
// credential that reached a line by any path never reaches the log.
//
// A run's log is capped at `RUN_LOG_MAX_LINES` lines and `RUN_LOG_MAX_CHARS`
// characters of messages and data together. Past either, lines are dropped
// and counted on the run row (`log_dropped`), and the log ends with one line
// saying how many (`readRunLog`).

import type { DBAdapter } from './db.ts';
import { param, query, type Expression } from './expression.ts';
import { logger } from './log.ts';
import { redactSecrets } from './redact-secrets.ts';

const log = logger('automation-run-log');

// Where a run's tab sends the script's lines, with the run's token.
export const RUN_LOG_PATH = '/_run-log';

export const RUN_LOG_MAX_LINES = 10_000;
export const RUN_LOG_MAX_CHARS = 5_000_000;

// One line's message is cut past this, and says how much it lost.
export const RUN_LOG_MAX_MESSAGE_CHARS = 10_000;

// The most lines the tab sends in one request, and the most bytes one
// request may carry.
export const RUN_LOG_MAX_BATCH_LINES = 500;
export const RUN_LOG_MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export type RunLogSource = 'script' | 'platform';

export const RUN_LOG_SCRIPT_KINDS = [
  'console',
  'activity',
  'plan',
  'milestone',
  'count',
  'error',
] as const;

export const RUN_LOG_PLATFORM_KINDS = [
  'call-api',
  'resolve',
  'commit',
  'finish',
] as const;

export type RunLogKind =
  | (typeof RUN_LOG_SCRIPT_KINDS)[number]
  | (typeof RUN_LOG_PLATFORM_KINDS)[number];

export type RunLogLevel = 'log' | 'info' | 'warn' | 'error';

type RunLogData = Record<
  string,
  string | number | boolean | null | string[] | undefined
>;

export interface RunLogLine {
  // ms since the epoch
  at: number;
  source: RunLogSource;
  kind: RunLogKind;
  level?: RunLogLevel;
  message: string;
  // The line of the script it came from, when known.
  scriptLine?: number;
  // What the kind adds: a call's status, time and size, a count's total, a
  // milestone plan's names, an error's stack.
  data?: RunLogData;
}

export interface StoredRunLogLine extends RunLogLine {
  seq: number;
}

export interface RunLogAppendResult {
  // The lines stored.
  stored: number;
  // The lines refused past the run's cap.
  dropped: number;
  // The run has no row.
  missing?: true;
}

// Stores `lines` at the end of the run's log, in order, each redacted (with
// `secrets` too, such as the token the lines arrived with). The run's row is
// locked while the cap is checked, so lines sent at once from the tab and the
// realm server keep one order and never pass the cap together. A run in any
// state takes lines: the realm server logs what happened after a run ended,
// such as the cap that ended it, and who may send is the caller's to check.
export async function appendRunLog(
  dbAdapter: DBAdapter,
  runId: string,
  lines: RunLogLine[],
  {
    secrets = [],
    maxLines = RUN_LOG_MAX_LINES,
    maxChars = RUN_LOG_MAX_CHARS,
  }: {
    secrets?: readonly string[];
    // The run's cap, which only tests change.
    maxLines?: number;
    maxChars?: number;
  } = {},
): Promise<RunLogAppendResult> {
  if (lines.length === 0) {
    return { stored: 0, dropped: 0 };
  }
  let redacted = lines.map((line) => redactLine(line, secrets));
  let result = await dbAdapter.withTransaction(async (txQuery) => {
    let [run] = (await txQuery([
      'SELECT r.automation_id, r.attempt, r.log_lines, r.log_chars, r.log_dropped, jr.job_id',
      'FROM automation_runs r LEFT JOIN job_reservations jr ON jr.id = r.attempt',
      'WHERE r.id =',
      param(runId),
      'FOR UPDATE OF r',
    ])) as {
      automation_id: string;
      attempt: number | string | null;
      log_lines: number;
      log_chars: number | string;
      log_dropped: number;
      job_id: number | string | null;
    }[];
    if (!run) {
      return undefined;
    }
    let seq = Number(run.log_lines);
    let chars = Number(run.log_chars);
    let stored: StoredRunLogLine[] = [];
    let dropped = 0;
    for (let line of redacted) {
      let size = lineChars(line);
      if (seq >= maxLines || chars + size > maxChars) {
        dropped++;
        continue;
      }
      stored.push({ ...line, seq });
      seq++;
      chars += size;
    }
    if (stored.length > 0) {
      let values: Expression = [];
      for (let [index, line] of stored.entries()) {
        values.push(
          index === 0 ? '(' : ', (',
          param(runId),
          ',',
          param(line.seq),
          ',',
          param(new Date(line.at).toISOString()),
          '::timestamptz,',
          param(line.source),
          ',',
          param(line.kind),
          ',',
          param(line.level ?? null),
          ',',
          param(line.message),
          ',',
          param(line.scriptLine ?? null),
          ',',
          param(line.data ? JSON.stringify(line.data) : null),
          '::jsonb)',
        );
      }
      await txQuery([
        'INSERT INTO automation_run_log (run_id, seq, at, source, kind, level, message, script_line, data) VALUES',
        ...values,
      ]);
    }
    await txQuery([
      'UPDATE automation_runs SET log_lines =',
      param(seq),
      ', log_chars =',
      param(chars),
      ', log_dropped = log_dropped +',
      param(dropped),
      'WHERE id =',
      param(runId),
    ]);
    return {
      automationId: run.automation_id,
      jobId: run.job_id == null ? undefined : Number(run.job_id),
      stored,
      dropped,
      firstDrop: dropped > 0 && Number(run.log_dropped) === 0,
    };
  });
  if (!result) {
    log.warn(`run ${runId} has no row; ${lines.length} log lines not stored`);
    return { stored: 0, dropped: 0, missing: true };
  }
  let tags = runLogTags({
    automationId: result.automationId,
    runId,
    jobId: result.jobId,
  });
  for (let line of result.stored) {
    log.info(runLogLokiLine(tags, line));
  }
  if (result.firstDrop) {
    log.warn(
      `[automation-run-log] ${tags} reached its cap of ${maxLines} lines or ${maxChars} characters; later lines are dropped`,
    );
  }
  return { stored: result.stored.length, dropped: result.dropped };
}

export interface RunLog {
  lines: StoredRunLogLine[];
  // Lines refused past the run's cap.
  dropped: number;
}

// A run's log in order. A log that reached its cap ends with a platform
// line saying how many lines were dropped.
export async function readRunLog(
  dbAdapter: DBAdapter,
  runId: string,
): Promise<RunLog | undefined> {
  let [run] = await query(dbAdapter, [
    'SELECT log_lines, log_dropped FROM automation_runs WHERE id =',
    param(runId),
  ]);
  if (!run) {
    return undefined;
  }
  let rows = (await query(dbAdapter, [
    'SELECT seq, at, source, kind, level, message, script_line, data FROM automation_run_log WHERE run_id =',
    param(runId),
    'ORDER BY seq',
  ])) as {
    seq: number;
    at: string | Date;
    source: RunLogSource;
    kind: RunLogKind;
    level: RunLogLevel | null;
    message: string;
    script_line: number | null;
    data: RunLogData | string | null;
  }[];
  let lines: StoredRunLogLine[] = rows.map((row) => ({
    seq: Number(row.seq),
    at: new Date(row.at).getTime(),
    source: row.source,
    kind: row.kind,
    ...(row.level ? { level: row.level } : {}),
    message: row.message,
    ...(row.script_line != null ? { scriptLine: Number(row.script_line) } : {}),
    ...(row.data != null
      ? {
          data:
            typeof row.data === 'string'
              ? (JSON.parse(row.data) as RunLogData)
              : row.data,
        }
      : {}),
  }));
  let dropped = Number(run.log_dropped);
  if (dropped > 0) {
    lines.push({
      seq: lines.length,
      at: lines.at(-1)?.at ?? Date.now(),
      source: 'platform',
      kind: 'console',
      level: 'warn',
      message: droppedLinesMessage(dropped),
    });
  }
  return { lines, dropped };
}

export function droppedLinesMessage(dropped: number): string {
  return `${dropped} more log ${dropped === 1 ? 'line was' : 'lines were'} dropped: a run's log holds at most ${RUN_LOG_MAX_LINES} lines, of ${RUN_LOG_MAX_CHARS} characters together`;
}

// Logs a platform line for a run, never failing the work it describes: a log
// that can't be written costs the line, not the call.
export async function logRunPlatformLine(
  dbAdapter: DBAdapter,
  runId: string,
  line: Omit<RunLogLine, 'source' | 'at'> & { at?: number },
): Promise<void> {
  try {
    await appendRunLog(dbAdapter, runId, [
      { at: Date.now(), ...line, source: 'platform' },
    ]);
  } catch (error) {
    log.error(
      `could not write run ${runId}'s ${line.kind} log line: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// A URL as a run's log shows it: its origin and path, and each query
// parameter's name with its value masked, since a query value can carry
// anything the script put there.
export function maskedRunLogURL(url: string): string {
  try {
    let parsed = new URL(url);
    let names = [...parsed.searchParams.keys()];
    let query =
      names.length > 0 ? `?${names.map((name) => `${name}=…`).join('&')}` : '';
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch {
    return '(invalid URL)';
  }
}

function redactLine(line: RunLogLine, secrets: readonly string[]): RunLogLine {
  let message = redactSecrets(line.message, secrets);
  if (message.length > RUN_LOG_MAX_MESSAGE_CHARS) {
    let lost = message.length - RUN_LOG_MAX_MESSAGE_CHARS;
    message = `${message.slice(0, RUN_LOG_MAX_MESSAGE_CHARS)}… (${lost} more characters)`;
  }
  let data: RunLogData | undefined;
  if (line.data) {
    data = {};
    for (let [name, value] of Object.entries(line.data)) {
      if (value === undefined) {
        continue;
      }
      data[name] =
        typeof value === 'string'
          ? redactSecrets(value, secrets).slice(0, RUN_LOG_MAX_MESSAGE_CHARS)
          : Array.isArray(value)
            ? value.map((item) =>
                redactSecrets(String(item), secrets).slice(
                  0,
                  RUN_LOG_MAX_MESSAGE_CHARS,
                ),
              )
            : value;
    }
  }
  return {
    at: Number.isFinite(line.at) ? line.at : Date.now(),
    source: line.source,
    kind: line.kind,
    ...(line.level ? { level: line.level } : {}),
    message,
    ...(line.scriptLine !== undefined ? { scriptLine: line.scriptLine } : {}),
    ...(data ? { data } : {}),
  };
}

function lineChars(line: RunLogLine): number {
  return (
    line.message.length + (line.data ? JSON.stringify(line.data).length : 0)
  );
}

// The tags every line of a run carries in Loki.
export function runLogTags({
  automationId,
  runId,
  jobId,
}: {
  automationId: string;
  runId: string;
  jobId?: number;
}): string {
  return `automation=${automationId} run=${runId}${jobId !== undefined ? ` job=${jobId}` : ''}`;
}

// One run log line as the realm server logs it for Loki: the tags right after
// the prefix, then the line's fields as `key=value`, the message last and
// JSON-quoted. A query that anchors on the prefix and the tags
// (`\[automation-run-log\] automation=\S+ run=<id> `) reads the tags the
// platform wrote; a plain substring match can also find a message that
// quotes them.
export function runLogLokiLine(tags: string, line: StoredRunLogLine): string {
  return `[automation-run-log] ${tags} ${describeForLoki(line)}`;
}

function describeForLoki(line: StoredRunLogLine): string {
  let fields = [
    `seq=${line.seq}`,
    `source=${line.source}`,
    `kind=${line.kind}`,
    ...(line.level ? [`level=${line.level}`] : []),
    ...(line.scriptLine !== undefined
      ? [`script_line=${line.scriptLine}`]
      : []),
  ];
  for (let [name, value] of Object.entries(line.data ?? {})) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      fields.push(`${name}=${value}`);
    }
  }
  return `${fields.join(' ')} msg=${JSON.stringify(line.message)}`;
}

// The script's lines as a run's tab sends them to `RUN_LOG_PATH`: the
// progress events of the automation surface, in order. Each becomes a
// `script` line; nothing the tab sends can claim to be the platform's.
export function scriptRunLogLines(
  body: unknown,
): { ok: true; lines: RunLogLine[] } | { ok: false; error: string } {
  let events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) {
    return { ok: false, error: 'the body must be { "events": [...] }' };
  }
  if (events.length > RUN_LOG_MAX_BATCH_LINES) {
    return {
      ok: false,
      error: `a request carries at most ${RUN_LOG_MAX_BATCH_LINES} events, not ${events.length}`,
    };
  }
  let lines: RunLogLine[] = [];
  for (let [index, event] of events.entries()) {
    let line = scriptLine(event);
    if (!line) {
      return { ok: false, error: `event ${index} is not a run progress event` };
    }
    lines.push(line);
  }
  return { ok: true, lines };
}

// The furthest from the epoch a `Date` reaches, in ms.
const MAX_DATE_MS = 8.64e15;
const MAX_SCRIPT_LINE = 2 ** 31 - 1;

const LEVELS: readonly RunLogLevel[] = ['log', 'info', 'warn', 'error'];

function scriptLine(event: unknown): RunLogLine | undefined {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  let e = event as Record<string, unknown>;
  if (typeof e.at !== 'number' || !Number.isFinite(e.at)) {
    return undefined;
  }
  // A time no `Date` can hold is the tab's mistake, not a reason to lose the
  // batch: the line is stored at the time it arrived.
  let at = Math.abs(e.at) <= MAX_DATE_MS ? e.at : Date.now();
  // Only a line Postgres's integer can hold is kept.
  let line =
    typeof e.line === 'number' &&
    Number.isInteger(e.line) &&
    e.line > 0 &&
    e.line <= MAX_SCRIPT_LINE
      ? { scriptLine: e.line }
      : {};
  let text = (value: unknown) =>
    typeof value === 'string' ? value : undefined;
  switch (e.kind) {
    case 'activity': {
      let message = text(e.line);
      return message === undefined
        ? undefined
        : { at, source: 'script', kind: 'activity', message };
    }
    case 'plan': {
      if (
        !Array.isArray(e.milestones) ||
        !e.milestones.every((name) => typeof name === 'string')
      ) {
        return undefined;
      }
      let milestones = e.milestones as string[];
      return {
        at,
        source: 'script',
        kind: 'plan',
        message: `Plan: ${milestones.join(' → ')}`,
        data: { milestones },
      };
    }
    case 'milestone': {
      let name = text(e.name);
      return name === undefined
        ? undefined
        : {
            at,
            source: 'script',
            kind: 'milestone',
            message: `Milestone: ${name}`,
            data: { name },
          };
    }
    case 'count': {
      let done = e.done;
      let total = e.total;
      if (
        typeof done !== 'number' ||
        !Number.isFinite(done) ||
        (total !== undefined &&
          (typeof total !== 'number' || !Number.isFinite(total)))
      ) {
        return undefined;
      }
      return {
        at,
        source: 'script',
        kind: 'count',
        message: total === undefined ? `${done}` : `${done} of ${total}`,
        data: { done, ...(total !== undefined ? { total } : {}) },
      };
    }
    case 'console': {
      let message = text(e.message);
      let level = LEVELS.find((l) => l === e.level);
      return message === undefined || !level
        ? undefined
        : {
            at,
            source: 'script',
            kind: 'console',
            level,
            message,
            ...(typeof e.line === 'number' ? line : {}),
          };
    }
    case 'error': {
      let message = text(e.message);
      let stack = text(e.stack);
      return message === undefined
        ? undefined
        : {
            at,
            source: 'script',
            kind: 'error',
            level: 'error',
            message,
            ...line,
            ...(stack ? { data: { stack } } : {}),
          };
    }
    default:
      return undefined;
  }
}
