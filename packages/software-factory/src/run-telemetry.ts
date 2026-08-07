/**
 * Run telemetry — a live RunTelemetry card written into the control realm.
 *
 * Mirrors the run-log pattern: the factory ships a `RunTelemetry` CardDef
 * (its source is the `assets/run-telemetry.gts.txt` asset, written into the
 * workspace as `run-telemetry.gts` and synced to the control realm as a
 * control-plane root file), plus one instance at
 * `Runs/<slug>-telemetry.json` that is rewritten in place as the run
 * progresses.
 *
 * The instance renders entirely from its own attributes — the card never
 * fetches or parses anything. Those attributes are produced by folding the
 * run trace (see run-trace.ts) into the card's field shape as spans close.
 * The fold is subscribed via `setTraceObserver`, so there is no second pass
 * over the NDJSON file; a debounced flush keeps control-realm write volume
 * to one small card every few seconds (the same budget the run log uses),
 * never one write per span.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { logger } from './logger.ts';
import { setTraceObserver } from './run-trace.ts';

const log = logger('run-telemetry');

const CARD_MODULE_FILENAME = 'run-telemetry.gts';
const DEFAULT_DEBOUNCE_MS = 3000;

/** The CardDef source, shipped as a lint-excluded asset. */
function readCardSource(): string {
  let assetPath = resolve(
    import.meta.dirname,
    '..',
    'assets',
    'run-telemetry.gts.txt',
  );
  return readFileSync(assetPath, 'utf8');
}

// ---------------------------------------------------------------------------
// Card attribute shape (matches assets/run-telemetry.gts.txt field defs)
// ---------------------------------------------------------------------------

interface TurnAttrs {
  issueId?: string;
  issueTitle?: string;
  /** Inner-loop pass this turn belonged to; absent for meta turns. */
  iteration?: number;
  turnType: string;
  model: string;
  effort: string;
  startedAt: string;
  durationSeconds?: number;
  outputTokens: number;
  freshInputTokens: number;
  cacheReadTokens: number;
  compacted: boolean;
}

interface EventAttrs {
  timestamp: string;
  kind: string;
  detail: string;
}

interface SkillContextAttrs {
  name: string;
  phase: string;
  /** Turn types that carried it, in first-seen order: "design, build". */
  turnTypes: string;
  turnCount: number;
  /** Peak context weight in characters (body + references). */
  characters: number;
  referenceCount: number;
  /**
   * How the skill reached the model: `injected` (a fresh session paid to
   * send it), `inherited` (the turn forked a session that already carried
   * it), or `mixed` when both happened within the phase.
   */
  delivery: string;
}

interface BoardIssueAttrs {
  issueId: string;
  title: string;
  /** backlog | in_progress | blocked | review | done | running */
  status: string;
  /** False for a ticket the run has not taken a turn on yet. */
  started: boolean;
}

interface IssueSummaryAttrs {
  issueId: string;
  title: string;
  /** Board status, upgraded to `running` while a turn is in flight. */
  status: string;
  iterationCount: number;
  validationStepsRun: number;
  validationPassed: boolean;
  /** Machinery wall clock attributed to this ticket (seconds). */
  validationSeconds: number;
  renderGateSeconds: number;
  syncSeconds: number;
  syncCallCount: number;
}

/** Per-ticket machinery, attributed to whichever ticket's turn ran last. */
interface IssueMachinery {
  validationSeconds: number;
  renderGateSeconds: number;
  syncSeconds: number;
  syncCallCount: number;
  validationStepsRun: number;
  /** Verdict of the ticket's most recent validation pipeline. */
  validationPassed: boolean | undefined;
}

/** The run configuration the writer knows up front (not in the trace). */
export interface RunTelemetryConfig {
  /** Human-facing run name, used for the card's title. */
  runTitle: string;
  briefUrl: string;
  targetRealmUrl: string;
  controlRealmUrl: string;
  targetPhase: string;
  factoryCommit: string;
  startedAtMs: number;
}

// ---------------------------------------------------------------------------
// Aggregator — folds trace records into the card's attributes
// ---------------------------------------------------------------------------

const PHASE_OF_TURN: Record<string, string> = {
  bootstrap: 'bootstrap',
  'design-foundation': 'design',
  design: 'design',
  build: 'implementation',
  implement: 'implementation',
  fix: 'implementation',
  review: 'implementation',
  harden: 'hardening',
};

function turnTypePhase(turnType: string): string {
  return PHASE_OF_TURN[turnType] ?? 'implementation';
}

/**
 * The card renders one of `running | completed | stopped | failed`; the issue
 * loop speaks its own vocabulary. Translate rather than pass through, or the
 * badge reads "All_issues_done" with no styling.
 */
const CARD_OUTCOME_OF_LOOP_OUTCOME: Record<string, string> = {
  all_issues_done: 'completed',
  // Work remains that this run could not start or finish — a stop, not a
  // failure: nothing went wrong, the loop just ran out of eligible work.
  no_unblocked_issues: 'stopped',
  max_outer_cycles: 'stopped',
};

const CARD_OUTCOMES = ['running', 'completed', 'stopped', 'failed'];

function cardOutcome(outcome: string): string {
  if (CARD_OUTCOMES.includes(outcome)) return outcome;
  return CARD_OUTCOME_OF_LOOP_OUTCOME[outcome] ?? 'stopped';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export class RunTelemetryAggregator {
  private config: RunTelemetryConfig;
  private turns: TurnAttrs[] = [];
  private events: EventAttrs[] = [];
  /** Keyed `"<phase> <skill name>"` — one row per skill per phase. */
  private skillsInContext = new Map<
    string,
    SkillContextAttrs & { turnTypeSet: Set<string> }
  >();
  /**
   * Machinery keyed the same way issue summaries are. Validation, render
   * captures and syncs carry no ticket of their own in the trace, so they
   * are attributed to the ticket whose turn most recently started — which
   * is what the loop actually ran them for.
   */
  private machineryByIssue = new Map<string, IssueMachinery>();
  private currentIssueKey: string | undefined;
  /** Latest board snapshot, keyed the same way issue summaries are. */
  private board = new Map<string, { title: string; status: string }>();
  private live:
    | {
        turnType: string;
        issueId?: string;
        issueTitle?: string;
        iteration?: number;
        model: string;
        effort: string;
        startedAtMs: number;
      }
    | undefined;
  private pendingUsage:
    | { out: number; freshIn: number; cacheRead: number }
    | undefined;
  private nextCompacted = false;
  private outcome = 'running';
  private endedAtMs: number | undefined;

  // Machinery accumulators (seconds unless noted).
  private inferenceSeconds = 0;
  private validationSeconds = 0;
  private renderGateSeconds = 0;
  private syncSeconds = 0;
  private syncCallCount = 0;
  private startupSeconds = 0;
  /** Earliest span start seen in the trace; Infinity until the first one. */
  private earliestRecordMs = Number.POSITIVE_INFINITY;

  constructor(config: RunTelemetryConfig) {
    this.config = config;
  }

  /**
   * Settle the run. First call wins: the loop reports its real outcome on
   * the way out and the caller's cleanup path then reports a generic stop,
   * so a later call must never overwrite a settled verdict.
   */
  markFinished(outcome: string, endedAtMs: number): void {
    if (this.endedAtMs !== undefined) return;
    this.outcome = cardOutcome(outcome);
    this.endedAtMs = endedAtMs;
    this.live = undefined;
  }

  /** Fold one trace record into the aggregate. Never throws. */
  consume(record: Record<string, unknown>): void {
    let c = str(record.c);
    let n = str(record.n);
    let d = typeof record.d === 'number' ? record.d : undefined;
    if (!c || !n) return;

    // The writer is constructed after startup, so its own clock would start
    // the run somewhere in the middle. The earliest record — replayed from
    // the trace on subscribe — is the real beginning. `t` is already the
    // span's start, so it needs no adjustment for `d`.
    let t = num(record.t);
    if (t > 0 && t < this.earliestRecordMs) this.earliestRecordMs = t;

    if (c === 'inference') {
      if (n === 'turn-start') {
        this.live = {
          turnType: str(record.turnType) ?? 'turn',
          issueId: str(record.issueId),
          issueTitle: str(record.issue),
          iteration:
            typeof record.iteration === 'number' ? record.iteration : undefined,
          model: str(record.model) ?? 'inherit',
          effort: str(record.effort) ?? 'inherit',
          startedAtMs: num(record.t) || Date.now(),
        };
        this.currentIssueKey =
          str(record.issueId) ?? str(record.issue) ?? this.currentIssueKey;
        return;
      }
      if (n === 'usage') {
        this.pendingUsage = {
          out: num(record.sumOut),
          freshIn: num(record.sumIn),
          cacheRead: num(record.sumCacheRead),
        };
        return;
      }
      if (n === 'sdk-compact_boundary') {
        this.nextCompacted = true;
        this.events.push({
          timestamp: new Date(num(record.t) || Date.now()).toISOString(),
          kind: 'compaction',
          detail: 'context window compacted — prefix re-ingested',
        });
        return;
      }
      if (n.startsWith('sdk-')) return;
      // A closed inference turn (turnType span with a duration).
      if (d === undefined) return;
      let usage = this.pendingUsage ?? { out: 0, freshIn: 0, cacheRead: 0 };
      this.turns.push({
        issueId: str(record.issueId),
        issueTitle: str(record.issue),
        iteration:
          typeof record.iteration === 'number' ? record.iteration : undefined,
        turnType: n,
        model: str(record.model) ?? 'inherit',
        effort: str(record.effort) ?? 'inherit',
        startedAt: new Date(num(record.t)).toISOString(),
        durationSeconds: Math.round(d / 1000),
        outputTokens: usage.out,
        freshInputTokens: usage.freshIn,
        cacheReadTokens: usage.cacheRead,
        compacted: this.nextCompacted,
      });
      this.inferenceSeconds += d / 1000;
      this.currentIssueKey =
        str(record.issueId) ?? str(record.issue) ?? this.currentIssueKey;
      this.pendingUsage = undefined;
      this.nextCompacted = false;
      if (this.live?.turnType === n) this.live = undefined;
      return;
    }

    if (c === 'skills' && n === 'in-context') {
      let name = str(record.skill);
      if (!name) return;
      let turnType = str(record.turnType) ?? 'turn';
      let phase = turnTypePhase(turnType);
      let key = `${phase} ${name}`;
      let existing = this.skillsInContext.get(key);
      if (!existing) {
        existing = {
          name,
          phase,
          turnTypes: turnType,
          turnCount: 0,
          characters: 0,
          referenceCount: 0,
          delivery: 'injected',
          turnTypeSet: new Set(),
        };
        this.skillsInContext.set(key, existing);
      }
      existing.turnCount += 1;
      existing.turnTypeSet.add(turnType);
      existing.turnTypes = [...existing.turnTypeSet].join(', ');
      let delivery = record.resumed === true ? 'inherited' : 'injected';
      existing.delivery =
        existing.turnCount === 1 || existing.delivery === delivery
          ? delivery
          : 'mixed';
      // Peak, not sum: the same skill re-sent on the next turn is the same
      // body. turnCount is what tells the reader how often it was resent.
      existing.characters = Math.max(existing.characters, num(record.chars));
      existing.referenceCount = Math.max(
        existing.referenceCount,
        num(record.refs),
      );
      return;
    }

    if (c === 'validation' && n === 'pipeline' && d !== undefined) {
      this.validationSeconds += d / 1000;
      let m = this.machineryForCurrentIssue();
      if (m) {
        m.validationSeconds += d / 1000;
        m.validationStepsRun += num(record.steps);
        // The latest pipeline is the ticket's standing verdict.
        m.validationPassed = record.passed === true;
      }
      return;
    }
    if (c === 'render-gate' && d !== undefined) {
      this.renderGateSeconds += d / 1000;
      let m = this.machineryForCurrentIssue();
      if (m) m.renderGateSeconds += d / 1000;
      return;
    }
    if (c === 'sync' && n === 'workspace' && d !== undefined) {
      this.syncSeconds += d / 1000;
      this.syncCallCount += 1;
      let m = this.machineryForCurrentIssue();
      if (m) {
        m.syncSeconds += d / 1000;
        m.syncCallCount += 1;
      }
      return;
    }
    if (c === 'startup' && d !== undefined) {
      this.startupSeconds += d / 1000;
      return;
    }
    if (c === 'run' && n === 'issue-loop') {
      // The loop's own span no longer drives wall clock — the run started
      // before it, at the first trace record. Consumed so it isn't mistaken
      // for an unhandled record.
      return;
    }
    if (c === 'scheduler' && n === 'board') {
      // Board snapshots are state, not timeline events: pushing them into
      // `events` would bury the real markers under one tick per issue per
      // reload.
      let key = str(record.issueId);
      if (!key) return;
      this.board.set(key, {
        title: str(record.issue) ?? key,
        status: str(record.status) ?? '',
      });
      return;
    }

    if (c === 'scheduler') {
      this.events.push({
        timestamp: new Date(num(record.t) || Date.now()).toISOString(),
        kind: n,
        detail:
          str(record.issue) ??
          (typeof record.count === 'number' ? `${record.count} issue(s)` : n),
      });
      return;
    }
  }

  /** Build the card's attributes at the current moment. */
  toCardAttributes(nowMs: number = Date.now()): Record<string, unknown> {
    let liveTurns: TurnAttrs[] = this.live
      ? [
          {
            issueId: this.live.issueId,
            issueTitle: this.live.issueTitle,
            iteration: this.live.iteration,
            turnType: this.live.turnType,
            model: this.live.model,
            effort: this.live.effort,
            startedAt: new Date(this.live.startedAtMs).toISOString(),
            durationSeconds: undefined, // live: no duration
            outputTokens: 0,
            freshInputTokens: 0,
            cacheReadTokens: 0,
            compacted: false,
          },
        ]
      : [];
    let turns = [...this.turns, ...liveTurns];
    let issueSummaries = this.issueSummaries(turns);

    // Wall clock spans the whole run, startup included: the issue-loop span
    // covers only the loop, so using it would leave the startup phase the
    // card itemizes outside the total it is measured against.
    let startedAtMs = this.startedAtMs();
    let wallClockSeconds = Math.max(
      0,
      Math.round(((this.endedAtMs ?? nowMs) - startedAtMs) / 1000),
    );

    // Phase subtotals from closed-turn durations.
    let phaseSeconds = new Map<string, number>();
    for (let t of this.turns) {
      let p = turnTypePhase(t.turnType);
      phaseSeconds.set(
        p,
        (phaseSeconds.get(p) ?? 0) + (t.durationSeconds ?? 0),
      );
    }

    let totals = {
      wallClockSeconds,
      inferenceSeconds: Math.round(this.inferenceSeconds),
      outputTokens: this.turns.reduce((s, t) => s + t.outputTokens, 0),
      freshInputTokens: this.turns.reduce((s, t) => s + t.freshInputTokens, 0),
      cacheReadTokens: this.turns.reduce((s, t) => s + t.cacheReadTokens, 0),
      validationSeconds: Math.round(this.validationSeconds),
      renderGateSeconds: Math.round(this.renderGateSeconds),
      syncSeconds: Math.round(this.syncSeconds),
      syncCallCount: this.syncCallCount,
      startupSeconds: Math.round(this.startupSeconds),
    };

    return {
      // `title` on a CardDef is computed from cardInfo.name — writing it
      // directly is a no-op that renders as "Untitled Run Telemetry".
      cardInfo: { name: `Run telemetry — ${this.config.runTitle}` },
      config: {
        briefUrl: this.config.briefUrl,
        targetRealmUrl: this.config.targetRealmUrl,
        controlRealmUrl: this.config.controlRealmUrl,
        targetPhase: this.config.targetPhase,
        factoryCommit: this.config.factoryCommit,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: this.endedAtMs ? new Date(this.endedAtMs).toISOString() : null,
        outcome: this.outcome,
      },
      totals,
      phases: [...phaseSeconds.entries()].map(([name, wall]) => ({
        name,
        wallClockSeconds: Math.round(wall),
      })),
      turns,
      events: this.events,
      // Includes the in-flight turn's ticket: the card counts issues from
      // this list, and a ticket working right now is one the run started.
      issues: issueSummaries,
      // The whole board, so the card can show tickets the run has not
      // reached yet — they produce no turns and appear nowhere else.
      board: this.boardRows(
        new Set(issueSummaries.map((summary) => summary.issueId)),
      ),
      skills: this.skillContextRows(),
    };
  }

  /**
   * Skills that reached the model's context, one row per skill per phase,
   * ordered by lifecycle phase then by weight within the phase.
   */
  private skillContextRows(): SkillContextAttrs[] {
    let phaseOrder = [
      'bootstrap',
      'design',
      'implementation',
      'hardening',
      'polishing',
    ];
    let rank = (phase: string) => {
      let i = phaseOrder.indexOf(phase);
      return i === -1 ? phaseOrder.length : i;
    };
    return [...this.skillsInContext.values()]
      .map(({ turnTypeSet: _turnTypeSet, ...row }) => row)
      .sort(
        (a, b) =>
          rank(a.phase) - rank(b.phase) ||
          b.characters - a.characters ||
          a.name.localeCompare(b.name),
      );
  }

  /**
   * When the run actually began. The writer is constructed inside the issue
   * loop, well after the brief load and realm pulls, so its own timestamp
   * would cut the startup phase out of the run.
   */
  private startedAtMs(): number {
    return Number.isFinite(this.earliestRecordMs)
      ? Math.min(this.earliestRecordMs, this.config.startedAtMs)
      : this.config.startedAtMs;
  }

  /** Machinery bucket for the ticket whose turn ran most recently. */
  private machineryForCurrentIssue(): IssueMachinery | undefined {
    let key = this.currentIssueKey;
    if (!key) return undefined; // pre-first-turn startup work
    let m = this.machineryByIssue.get(key);
    if (!m) {
      m = {
        validationSeconds: 0,
        renderGateSeconds: 0,
        syncSeconds: 0,
        syncCallCount: 0,
        validationStepsRun: 0,
        validationPassed: undefined,
      };
      this.machineryByIssue.set(key, m);
    }
    return m;
  }

  private issueSummaries(turns: TurnAttrs[]): IssueSummaryAttrs[] {
    let byKey = new Map<string, IssueSummaryAttrs>();
    let liveKeys = new Set<string>();
    // An iteration is one inner-loop pass, and a single pass can run several
    // turns (design + build under phase-split, then review). Counting turns
    // reported first-pass work as three iterations, which the card
    // emphasizes as a struggling ticket.
    let iterationsByKey = new Map<string, Set<number>>();
    for (let t of turns) {
      // Same key the card groups turns by: the board key when the turn
      // carried one, the title otherwise. Keying these two differently is
      // what left every per-ticket row without its summary.
      let key = t.issueId ?? t.issueTitle;
      if (!key) continue;
      if (t.durationSeconds === undefined) liveKeys.add(key);
      if (t.iteration !== undefined) {
        let seen = iterationsByKey.get(key);
        if (!seen) {
          seen = new Set();
          iterationsByKey.set(key, seen);
        }
        seen.add(t.iteration);
      }
      let existing = byKey.get(key);
      if (existing) continue;
      let m = this.machineryByIssue.get(key);
      byKey.set(key, {
        issueId: key,
        title: t.issueTitle ?? key,
        status: '',
        iterationCount: 0,
        validationStepsRun: m?.validationStepsRun ?? 0,
        // No pipeline ran → not a pass. The card reads this as a verdict,
        // so defaulting it to true reported success that never happened.
        validationPassed: m?.validationPassed === true,
        validationSeconds: Math.round(m?.validationSeconds ?? 0),
        renderGateSeconds: Math.round(m?.renderGateSeconds ?? 0),
        syncSeconds: Math.round(m?.syncSeconds ?? 0),
        syncCallCount: m?.syncCallCount ?? 0,
      });
    }
    // Status and iteration count last: both depend on every turn of the
    // ticket, which the per-turn loop above cannot know until it ends.
    for (let [key, summary] of byKey) {
      summary.status = this.statusFor(key, liveKeys.has(key));
      // Meta turns (bootstrap, design foundation, review) carry no iteration
      // tag; they are one pass by construction.
      summary.iterationCount = iterationsByKey.get(key)?.size || 1;
    }
    return [...byKey.values()];
  }

  /**
   * A ticket's status. A turn in flight beats the board, which lags: the
   * index still reads `backlog` for an issue the loop picked seconds ago.
   * With no board snapshot at all (an older trace), a ticket that produced
   * turns reports nothing rather than guessing at `done`.
   */
  private statusFor(key: string, hasLiveTurn: boolean): string {
    if (hasLiveTurn) return 'running';
    return this.board.get(key)?.status ?? '';
  }

  /** Every ticket the board has shown, including ones never worked on. */
  private boardRows(started: Set<string>): BoardIssueAttrs[] {
    return [...this.board.entries()].map(([issueId, entry]) => ({
      issueId,
      title: entry.title,
      status: this.statusFor(issueId, false),
      started: started.has(issueId),
    }));
  }
}

// ---------------------------------------------------------------------------
// Writer — ships the def + rewrites the instance on a debounce
// ---------------------------------------------------------------------------

export interface RunTelemetryWriterOptions {
  workspaceDir: string;
  controlRealm: string;
  /** Run slug — the instance is `Runs/<slug>-telemetry.json`. */
  slug: string;
  config: RunTelemetryConfig;
  /**
   * Raw-write straight to the control realm (bypasses the atomic sync).
   * Returns the realm's result rather than throwing — `client.write`
   * resolves `{ok: false}` for auth and HTTP failures, so a void-returning
   * wrapper would report every failed upload as a success.
   */
  rawWriteFile: (
    relativePath: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  debounceMs?: number;
}

export class RunTelemetryWriter {
  private opts: RunTelemetryWriterOptions;
  private agg: RunTelemetryAggregator;
  private instanceRelPath: string;
  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  /** A flush arrived mid-write; re-run once the active write settles. */
  private pendingFlush = false;
  private writeError: string | undefined;
  private started = false;
  private finished = false;

  constructor(opts: RunTelemetryWriterOptions) {
    this.opts = opts;
    this.agg = new RunTelemetryAggregator(opts.config);
    this.instanceRelPath = `Runs/${opts.slug}-telemetry.json`;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Publish the CardDef and subscribe to the trace. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let source: string;
    let modulePath = join(this.opts.workspaceDir, CARD_MODULE_FILENAME);
    try {
      source = readCardSource();
      await writeFile(modulePath, source, 'utf8');
    } catch (err) {
      log.warn(
        `Failed to write RunTelemetry CardDef — telemetry disabled: ${String(err)}`,
      );
      return;
    }
    // Raw-write the definition to the realm as well, not just the
    // workspace. The workspace copy reaches the realm only on the next
    // sync, and a run that exits immediately (empty board, everything
    // blocked) never syncs — leaving an instance whose `adoptsFrom` points
    // at a module the realm doesn't have, which cannot index or render.
    let defWrite = await this.opts.rawWriteFile(CARD_MODULE_FILENAME, source);
    if (!defWrite.ok) {
      this.writeError = defWrite.error ?? 'unknown error';
      log.warn(
        `RunTelemetry CardDef raw-write failed: ${defWrite.error ?? 'unknown error'} — the card renders once a workspace sync lands it`,
      );
    }
    setTraceObserver((record) => {
      this.agg.consume(record);
      this.scheduleFlush();
    });
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    // Coalesce, but never drop: a flush that arrives while a write is in
    // flight marks the aggregate dirty and re-runs afterwards. Returning
    // early instead would discard the newer state — including `finish()`'s
    // settled outcome, leaving a completed run displayed as running.
    if (this.flushing) {
      this.pendingFlush = true;
      await this.flushing;
      if (this.pendingFlush) await this.flush();
      return;
    }
    this.pendingFlush = false;
    let doc = JSON.stringify(
      {
        data: {
          type: 'card',
          attributes: this.agg.toCardAttributes(),
          meta: {
            adoptsFrom: { module: '../run-telemetry', name: 'RunTelemetry' },
          },
        },
      },
      null,
      2,
    );
    this.flushing = this.opts
      .rawWriteFile(this.instanceRelPath, doc)
      .then((result) => {
        if (result.ok) {
          this.writeError = undefined;
          return;
        }
        this.writeError = result.error ?? 'unknown error';
        log.warn(`Telemetry flush failed (non-fatal): ${this.writeError}`);
      })
      .catch((err) => {
        this.writeError = String(err);
        log.warn(`Telemetry flush failed (non-fatal): ${this.writeError}`);
      })
      .finally(() => {
        this.flushing = undefined;
      });
    await this.flushing;
  }

  /**
   * Final write with the settled outcome; unsubscribes from the trace.
   * Idempotent — the first outcome sticks, so a caller's cleanup path can
   * call this unconditionally without erasing the real verdict.
   */
  async finish(outcome: string): Promise<void> {
    if (!this.started || this.finished) return;
    this.finished = true;
    setTraceObserver(undefined);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.agg.markFinished(outcome, Date.now());
    await this.flush();
  }

  /**
   * Why the most recent realm write failed, if it did. A telemetry failure
   * never interrupts a run, so this is how a caller learns the card on the
   * realm is stale rather than merely quiet.
   */
  get lastWriteError(): string | undefined {
    return this.writeError;
  }

  /** Ensure the instance directory exists (control realm mirror). */
  async ensureDir(): Promise<void> {
    await mkdir(join(this.opts.workspaceDir, dirname(this.instanceRelPath)), {
      recursive: true,
    });
  }
}
