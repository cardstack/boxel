/**
 * RunMonitor — the orchestrator's own voice on the run log.
 *
 * V2's live blog gave the EXECUTOR a voice (post_update, streamed writes,
 * failed checks). The operator's side — "is anything happening?", "what did
 * that turn cost?", "why is the log silent?" — was hand-typed during the
 * wardrobe run. This class owns it:
 *
 * - **Stall narration**: a timer reset by every stream event. When a turn
 *   goes quiet past the threshold, post what we know (the model is
 *   generating; last visible activity and when). Long model turns are the
 *   single biggest run-log UX failure — 88% of wall clock is generation,
 *   and an unnarrated 14-minute gap reads as a hang.
 * - **Turn telemetry**: per-turn entry with model/effort budget, duration,
 *   tool-call count, files touched, and token usage when the backend
 *   reports it. The data was previously discarded.
 * - **Scheduler + watchdog notes**: queue state and sync failures routed
 *   onto the run log instead of terminal-only logging.
 *
 * All entries post with `who: 'orchestrator'` via the run-log writer's
 * streaming (raw-write) path, so the monitor never triggers a workspace
 * sync and never blocks the loop. Everything is level-gated
 * (quiet | normal | verbose) and rate-limited per event class.
 */

import type { RunLogWriter, RunLogEntryInput } from './run-log.ts';
import { logger } from './logger.ts';

const log = logger('run-monitor');

export type MonitorLevel = 'quiet' | 'normal' | 'verbose';

export interface RunMonitorOptions {
  runLog: RunLogWriter;
  /** quiet = stalls + failures only; normal (default) = + turn telemetry
   *  and scheduler notes; verbose = + turn starts, heals, sync successes. */
  level?: MonitorLevel;
  /** Silence (no stream events) before the first stall post. Default 90s. */
  stallAfterMs?: number;
  /** Minimum gap between repeated stall posts while still silent. Default 4m. */
  stallRepeatMs?: number;
  /** Stall-check timer resolution. Default 15s. */
  checkIntervalMs?: number;
}

export interface TurnInfo {
  issueTitle: string;
  /** prime | bootstrap | design | build | fix | implement | acceptance */
  turnType: string;
  iteration?: number;
  maxIterations?: number;
  /** Budget the orchestrator chose; undefined = session default. */
  model?: string;
  effort?: string;
}

export interface TurnOutcome {
  status: string;
  durationMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
  };
}

/** Minimum gap between posts of the same watchdog event class. */
const WATCHDOG_MIN_INTERVAL_MS = 60_000;

export class RunMonitor {
  private runLog: RunLogWriter;
  private level: MonitorLevel;
  private stallAfterMs: number;
  private stallRepeatMs: number;
  private checkIntervalMs: number;

  private timer: ReturnType<typeof setInterval> | undefined;
  private turn: (TurnInfo & { startedAt: number }) | undefined;
  private lastActivityAt = Date.now();
  private lastActivityDesc = '';
  private lastStallPostAt = 0;
  private lastWatchdogPostAt = new Map<string, number>();
  // Per-turn accumulators, reset by beginTurn().
  private turnToolEvents = 0;
  private turnFilesTouched = new Set<string>();

  constructor(opts: RunMonitorOptions) {
    this.runLog = opts.runLog;
    this.level = opts.level ?? 'normal';
    this.stallAfterMs = opts.stallAfterMs ?? 90_000;
    this.stallRepeatMs = opts.stallRepeatMs ?? 240_000;
    this.checkIntervalMs = opts.checkIntervalMs ?? 15_000;
  }

  start(): void {
    if (this.timer || this.level === 'quiet') {
      // quiet still gets stall posts — they're the whole point — so only
      // skip the timer when one is already running.
      if (this.timer) return;
    }
    this.timer = setInterval(() => this.checkStall(), this.checkIntervalMs);
    // Never hold the process open for the monitor.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Every stream event (tool call, assistant message) lands here. Cheap:
   * updates the stall clock and per-turn stats, never posts.
   */
  noteActivity(desc: string): void {
    this.lastActivityAt = Date.now();
    if (desc) this.lastActivityDesc = desc;
  }

  /**
   * Activity variant for tool-call stream entries — also accumulates the
   * per-turn stats (tool count, files touched) used by turn telemetry.
   */
  noteToolEvent(entry: { tool: string; args: Record<string, unknown> }): void {
    this.turnToolEvents++;
    let tool = entry.tool.replace(/^mcp__[^_]+__/, '');
    if (tool === 'Write' || tool === 'Edit') {
      let filePath = String(entry.args.file_path ?? entry.args.path ?? '');
      if (filePath) {
        this.turnFilesTouched.add(filePath);
      }
    }
    this.noteActivity(describeToolEvent(tool, entry.args));
  }

  beginTurn(info: TurnInfo): void {
    this.turn = { ...info, startedAt: Date.now() };
    this.turnToolEvents = 0;
    this.turnFilesTouched = new Set();
    this.lastActivityAt = Date.now();
    this.lastActivityDesc = 'turn started';
    this.lastStallPostAt = 0;
    if (this.level === 'verbose') {
      this.post({
        kind: 'monitor',
        headline: `Turn starting: ${turnLabel(info)}`,
        body: budgetLabel(info),
      });
    }
  }

  endTurn(outcome: TurnOutcome): void {
    let info = this.turn;
    this.turn = undefined;
    if (!info || this.level === 'quiet') return;

    let parts: string[] = [turnLabel(info), budgetLabel(info)];
    if (this.turnFilesTouched.size > 0) {
      parts.push(
        `${this.turnFilesTouched.size} file${this.turnFilesTouched.size === 1 ? '' : 's'} touched`,
      );
    }
    let usage = outcome.usage;
    if (usage && (usage.inputTokens || usage.outputTokens)) {
      let tokens = `tokens ${fmtCount(usage.inputTokens)} in / ${fmtCount(usage.outputTokens)} out`;
      if (usage.cacheReadTokens) {
        tokens += ` (${fmtCount(usage.cacheReadTokens)} cached)`;
      }
      parts.push(tokens);
    }
    if (usage?.costUsd != null) {
      parts.push(`$${usage.costUsd.toFixed(2)}`);
    }
    this.post({
      kind: 'telemetry',
      headline: `Turn ${outcome.status === 'blocked' ? 'blocked' : 'finished'} in ${fmtDuration(outcome.durationMs)} — ${this.turnToolEvents} tool event${this.turnToolEvents === 1 ? '' : 's'}`,
      body: parts.join(' · '),
    });
  }

  /** Scheduler state — queue depth, pickup rationale. Posts at normal+. */
  noteScheduler(headline: string, body?: string): void {
    if (this.level === 'quiet') return;
    this.post({ kind: 'monitor', headline, body });
  }

  /**
   * Watchdog events — sync failures, heals, realm health. Failure classes
   * post at normal+; success/heal classes at verbose. Rate-limited to one
   * post per class per minute so a retry storm doesn't flood the log.
   */
  noteWatchdog(
    eventClass: string,
    headline: string,
    opts?: { body?: string; failure?: boolean },
  ): void {
    let failure = opts?.failure === true;
    if (this.level === 'quiet' && !failure) return;
    if (this.level === 'normal' && !failure) return;
    let now = Date.now();
    let last = this.lastWatchdogPostAt.get(eventClass) ?? 0;
    if (now - last < WATCHDOG_MIN_INTERVAL_MS) return;
    this.lastWatchdogPostAt.set(eventClass, now);
    this.post({
      kind: failure ? 'blocked' : 'monitor',
      headline,
      body: opts?.body,
    });
  }

  private checkStall(): void {
    if (!this.turn) return;
    let now = Date.now();
    let silentMs = now - this.lastActivityAt;
    if (silentMs < this.stallAfterMs) return;
    // First post when the threshold is crossed; repeats at stallRepeatMs
    // while the silence continues.
    if (
      this.lastStallPostAt > this.lastActivityAt &&
      now - this.lastStallPostAt < this.stallRepeatMs
    ) {
      return;
    }
    this.lastStallPostAt = now;
    let turnElapsed = fmtDuration(now - this.turn.startedAt);
    this.post({
      kind: 'monitor',
      headline: `Still working — ${fmtDuration(silentMs)} since the last visible step`,
      body: [
        `The model is generating (${turnLabel(this.turn)}, ${turnElapsed} into the turn).`,
        `Long silences are normal here: extended thinking and large file emission produce no stream events.`,
        this.lastActivityDesc
          ? `Last visible activity: ${this.lastActivityDesc}.`
          : undefined,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }

  private post(entry: {
    kind: RunLogEntryInput['kind'];
    headline: string;
    body?: string;
  }): void {
    void this.runLog
      .append(
        [{ ...entry, who: 'orchestrator' }],
        undefined,
        // Raw-write streaming only — the monitor must never trigger a
        // workspace sync (control-plane churn is what V3 is eliminating).
        { stream: true },
      )
      .catch((error) => {
        log.warn(`monitor post failed: ${String(error)}`);
      });
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function turnLabel(info: TurnInfo): string {
  let iter =
    info.iteration != null && info.maxIterations != null
      ? ` (iteration ${info.iteration}/${info.maxIterations})`
      : '';
  return `${info.turnType} turn for "${info.issueTitle}"${iter}`;
}

function budgetLabel(info: TurnInfo): string {
  let model = info.model ?? 'session default';
  let effort = info.effort ? ` @ ${info.effort}` : '';
  return `model ${model}${effort}`;
}

function describeToolEvent(
  tool: string,
  args: Record<string, unknown>,
): string {
  if (tool === 'Write' || tool === 'Edit') {
    let filePath = String(args.file_path ?? args.path ?? '');
    let name = filePath.split('/').pop() ?? filePath;
    return name ? `${tool} ${name}` : tool;
  }
  if (tool === 'post_update' || tool.endsWith('post_update')) {
    let headline = String(args.headline ?? '').trim();
    return headline ? `posted "${headline}"` : 'posted an update';
  }
  if (tool === 'screenshot_html' || tool.endsWith('screenshot_html')) {
    let path = String(args.path ?? '');
    return path ? `screenshot of ${path}` : 'design screenshot';
  }
  return tool;
}

export function fmtDuration(ms: number): string {
  let secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  let mins = Math.floor(secs / 60);
  let rem = secs % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  let hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function fmtCount(value: number | undefined): string {
  if (value == null) return '?';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
