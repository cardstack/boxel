/**
 * Run-trace telemetry: tagged timing spans for every significant phase of a
 * factory run, written as NDJSON so a visualization can consume the file
 * with one JSON.parse per line — no framing, no post-processing, append-only
 * and therefore crash-safe (a killed run keeps every span that finished).
 *
 * File location: `<workspaceDir>/.factory-trace/run-<startedAt>.ndjson`.
 * Dot-directories are excluded from every realm sync path, so traces never
 * leave the machine.
 *
 * Line schema (all fields flat primitives, compact keys):
 *   header  {"v":1,"c":"run","n":"meta","t":<epoch-ms>, ...run metadata}
 *   span    {"t":<epoch-ms start>,"d":<duration-ms>,"c":<category>,
 *            "n":<name>, ...tags}
 *   instant {"t":<epoch-ms>,"c":<category>,"n":<name>, ...tags}   (no "d")
 *
 * Categories ("c") — the aggregation axis for the visualization:
 *   run         whole issue-loop lifetime
 *   startup     realm bootstrap, brief load, workspace pulls
 *   seed        seed-issue creation
 *   skills      workspace materialization + per-issue skill resolution
 *   manifest    host-import manifest derivation
 *   scheduler   issue load/pick/index-settle polling
 *   context     agent context building
 *   inference   agent turns (n = turn type: design, build, fix, review, …)
 *   tool        factory MCP tool executions inside agent turns
 *   sync        workspace→realm syncs (n = workspace | product | control)
 *   validation  the pipeline (n = pipeline) and each step (n = step name)
 *   render-gate host-render captures
 *   issue       one outer cycle working a single issue
 *   iteration   one inner loop pass (agent turn + validation + syncs)
 *
 * Spans are self-contained (start + duration on one line): the consumer
 * never has to pair begin/end records, and nesting is recoverable from
 * containment of [t, t+d] intervals. Durations use the monotonic clock;
 * `t` is wall-clock for cross-referencing with the debug log.
 *
 * The module is a no-op until `initRunTrace` is called; spans recorded
 * before init (early startup) are buffered and flushed on init so the
 * pre-workspace phases are not lost.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { logger } from './logger.ts';

const log = logger('run-trace');

/** Flat primitive tags only — keeps every line cheap to parse and index. */
export type TraceTags = Record<string, string | number | boolean | undefined>;

let tracePath: string | undefined;
let preInitBuffer: string[] = [];
let disabled = false;

function writeLine(record: Record<string, unknown>): void {
  if (disabled) return;
  let line = JSON.stringify(record);
  if (!tracePath) {
    preInitBuffer.push(line);
    return;
  }
  try {
    appendFileSync(tracePath, line + '\n');
  } catch (error) {
    // Tracing must never take down a run. Disable on the first write
    // failure (disk full, path removed) instead of failing every span.
    disabled = true;
    log.warn(`Trace disabled — write failed: ${String(error)}`);
  }
}

function cleanTags(tags?: TraceTags): TraceTags {
  if (!tags) return {};
  let out: TraceTags = {};
  for (let [key, value] of Object.entries(tags)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Open the trace file and flush any spans buffered before init. Returns the
 * trace file path. Safe to call once per process; later calls are ignored
 * (the first workspace wins — one factory run per process).
 */
export function initRunTrace(opts: {
  workspaceDir: string;
  tags?: TraceTags;
}): string | undefined {
  if (tracePath || disabled) return tracePath;
  try {
    let dir = join(opts.workspaceDir, '.factory-trace');
    mkdirSync(dir, { recursive: true });
    let startedAt = new Date().toISOString().replace(/[:.]/g, '-');
    tracePath = join(dir, `run-${startedAt}.ndjson`);
    appendFileSync(
      tracePath,
      JSON.stringify({
        v: 1,
        c: 'run',
        n: 'meta',
        t: Date.now(),
        pid: process.pid,
        ...cleanTags(opts.tags),
      }) + '\n',
    );
    if (preInitBuffer.length > 0) {
      appendFileSync(tracePath, preInitBuffer.join('\n') + '\n');
      preInitBuffer = [];
    }
    log.info(`Run trace: ${tracePath}`);
    return tracePath;
  } catch (error) {
    disabled = true;
    log.warn(`Trace disabled — init failed: ${String(error)}`);
    return undefined;
  }
}

/** Record an instantaneous event (no duration). */
export function traceEvent(cat: string, name: string, tags?: TraceTags): void {
  writeLine({ t: Date.now(), c: cat, n: name, ...cleanTags(tags) });
}

/**
 * Start a span; the returned closer writes the line. Closing twice is a
 * no-op, and an unclosed span writes nothing — a crashed phase is visible
 * in the trace as a gap rather than a fabricated duration.
 */
export function startSpan(
  cat: string,
  name: string,
  tags?: TraceTags,
): (endTags?: TraceTags) => void {
  let t = Date.now();
  let started = performance.now();
  let closed = false;
  return (endTags?: TraceTags) => {
    if (closed) return;
    closed = true;
    writeLine({
      t,
      d: Math.round(performance.now() - started),
      c: cat,
      n: name,
      ...cleanTags(tags),
      ...cleanTags(endTags),
    });
  };
}

/** Run `fn` inside a span; the span closes on resolve OR reject. */
export async function withSpan<T>(
  cat: string,
  name: string,
  tags: TraceTags | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  let end = startSpan(cat, name, tags);
  try {
    let result = await fn();
    end();
    return result;
  } catch (error) {
    end({ error: true });
    throw error;
  }
}

/** Test seam: reset module state so unit tests get isolated trace files. */
export function resetRunTraceForTesting(): void {
  tracePath = undefined;
  preInitBuffer = [];
  disabled = false;
}
