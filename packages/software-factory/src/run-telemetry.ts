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

interface IssueSummaryAttrs {
  issueId: string;
  title: string;
  iterationCount: number;
  validationStepsRun: number;
  validationPassed: boolean;
}

/** The run configuration the writer knows up front (not in the trace). */
export interface RunTelemetryConfig {
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
  private live:
    | {
        turnType: string;
        issueTitle?: string;
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
  private finalWallClockSeconds: number | undefined;

  constructor(config: RunTelemetryConfig) {
    this.config = config;
  }

  markFinished(outcome: string, endedAtMs: number): void {
    this.outcome = outcome;
    this.endedAtMs = endedAtMs;
    this.live = undefined;
  }

  /** Fold one trace record into the aggregate. Never throws. */
  consume(record: Record<string, unknown>): void {
    let c = str(record.c);
    let n = str(record.n);
    let d = typeof record.d === 'number' ? record.d : undefined;
    if (!c || !n) return;

    if (c === 'inference') {
      if (n === 'turn-start') {
        this.live = {
          turnType: str(record.turnType) ?? 'turn',
          issueTitle: str(record.issue),
          model: str(record.model) ?? 'inherit',
          effort: str(record.effort) ?? 'inherit',
          startedAtMs: num(record.t) || Date.now(),
        };
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
        issueTitle: str(record.issue),
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
      this.pendingUsage = undefined;
      this.nextCompacted = false;
      if (this.live?.turnType === n) this.live = undefined;
      return;
    }

    if (c === 'validation' && n === 'pipeline' && d !== undefined) {
      this.validationSeconds += d / 1000;
      return;
    }
    if (c === 'render-gate' && d !== undefined) {
      this.renderGateSeconds += d / 1000;
      return;
    }
    if (c === 'sync' && n === 'workspace' && d !== undefined) {
      this.syncSeconds += d / 1000;
      this.syncCallCount += 1;
      return;
    }
    if (c === 'startup' && d !== undefined) {
      this.startupSeconds += d / 1000;
      return;
    }
    if (c === 'run' && n === 'issue-loop' && d !== undefined) {
      this.finalWallClockSeconds = Math.round(d / 1000);
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
            issueTitle: this.live.issueTitle,
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

    let wallClockSeconds =
      this.finalWallClockSeconds ??
      Math.max(0, Math.round((nowMs - this.config.startedAtMs) / 1000));

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
      title: 'Run Telemetry',
      config: {
        briefUrl: this.config.briefUrl,
        targetRealmUrl: this.config.targetRealmUrl,
        controlRealmUrl: this.config.controlRealmUrl,
        targetPhase: this.config.targetPhase,
        factoryCommit: this.config.factoryCommit,
        startedAt: new Date(this.config.startedAtMs).toISOString(),
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
      issues: this.issueSummaries(),
    };
  }

  private issueSummaries(): IssueSummaryAttrs[] {
    let byTitle = new Map<string, IssueSummaryAttrs>();
    for (let t of this.turns) {
      if (!t.issueTitle) continue;
      let existing = byTitle.get(t.issueTitle);
      if (existing) {
        existing.iterationCount += 1;
      } else {
        byTitle.set(t.issueTitle, {
          issueId: t.issueTitle,
          title: t.issueTitle,
          iterationCount: 1,
          validationStepsRun: 0,
          validationPassed: true,
        });
      }
    }
    return [...byTitle.values()];
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
  /** Raw-write straight to the control realm (bypasses the atomic sync). */
  rawWriteFile: (relativePath: string, content: string) => Promise<void>;
  debounceMs?: number;
}

export class RunTelemetryWriter {
  private opts: RunTelemetryWriterOptions;
  private agg: RunTelemetryAggregator;
  private instanceRelPath: string;
  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private started = false;

  constructor(opts: RunTelemetryWriterOptions) {
    this.opts = opts;
    this.agg = new RunTelemetryAggregator(opts.config);
    this.instanceRelPath = `Runs/${opts.slug}-telemetry.json`;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Write the CardDef into the workspace and subscribe to the trace. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let modulePath = join(this.opts.workspaceDir, CARD_MODULE_FILENAME);
    try {
      await writeFile(modulePath, readCardSource(), 'utf8');
    } catch (err) {
      log.warn(
        `Failed to write RunTelemetry CardDef — telemetry disabled: ${String(err)}`,
      );
      return;
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
    // Single-flight: coalesce concurrent flushes.
    if (this.flushing) {
      await this.flushing;
      return;
    }
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
      .catch((err) => {
        log.warn(`Telemetry flush failed (non-fatal): ${String(err)}`);
      })
      .finally(() => {
        this.flushing = undefined;
      });
    await this.flushing;
  }

  /** Final write with the settled outcome; unsubscribes from the trace. */
  async finish(outcome: string): Promise<void> {
    if (!this.started) return;
    setTraceObserver(undefined);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.agg.markFinished(outcome, Date.now());
    await this.flush();
  }

  /** Ensure the instance directory exists (control realm mirror). */
  async ensureDir(): Promise<void> {
    await mkdir(join(this.opts.workspaceDir, dirname(this.instanceRelPath)), {
      recursive: true,
    });
  }
}
