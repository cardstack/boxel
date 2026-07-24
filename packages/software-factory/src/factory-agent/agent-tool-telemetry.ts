/**
 * Always-on, lightweight audit trail of an agent turn's tool usage.
 *
 * The orchestrator otherwise logs only "Agent returned N tool calls" — which
 * hides exactly the waste we care about (re-reading the same file, rewriting
 * a whole `.gts` instead of an `Edit`, screenshot thrash, mutating Bash). The
 * per-tool detail existed only behind `--debug`. This records every tool_use
 * block as it streams, prints one terse line per call, and emits a
 * per-turn waste summary — without needing `--debug`.
 *
 * It is observation only: it never blocks, mutates, or fails a run. Every
 * heuristic is a flag for a human, not a gate.
 */

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { logger } from '../logger.ts';

let log = logger('agent-tools');

/**
 * Bash is meant to be read-only inspection in the factory loop (ls, grep,
 * boxel search, read-transpiled). Anything that writes, deletes, moves, or
 * pushes is a smell — the agent should mutate via native Write/Edit (synced
 * by the loop), never shell out around the sync path.
 */
const MUTATING_BASH =
  /(^|\s)(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|dd|truncate|ln)\s|>>?[^&]|\b(boxel)\s+(file\s+)?(write|delete|push|ingest-card|realm)\b/;

function strOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One short, human-scannable descriptor of a tool call's primary argument. */
export function describeToolArg(
  tool: string,
  input: Record<string, unknown>,
): string | undefined {
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit') {
    let p = strOf(input.file_path);
    return p ? basename(p) : undefined;
  }
  if (tool === 'Bash') {
    let cmd = strOf(input.command);
    return cmd ? cmd.slice(0, 60) : undefined;
  }
  if (tool === 'Glob' || tool === 'Grep') {
    return strOf(input.pattern);
  }
  if (tool.endsWith('screenshot_html')) {
    let p = strOf(input.path);
    return p ? basename(p) : undefined;
  }
  // MCP factory tools (run_lint, get_card_schema, …) — surface a path/name
  // if one is present, else nothing.
  return strOf(input.path) ?? strOf(input.name) ?? strOf(input.module);
}

export interface TurnWasteSummary {
  totalCalls: number;
  breakdown: string;
  concerns: string[];
}

export class TurnToolTelemetry {
  private counts = new Map<string, number>();
  private reads = new Map<string, number>();
  private wholeFileRewrites: string[] = [];
  private screenshots = 0;
  private mutatingBash: string[] = [];
  private workspaceDir: string | undefined;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Record one streamed tool_use block. Prints a terse per-call line. */
  record(tool: string, input: Record<string, unknown>): void {
    this.counts.set(tool, (this.counts.get(tool) ?? 0) + 1);
    let arg = describeToolArg(tool, input);
    log.info(`tool_use(${tool})${arg ? ` ${arg}` : ''}`);

    if (tool === 'Read') {
      let p = strOf(input.file_path);
      if (p) this.reads.set(p, (this.reads.get(p) ?? 0) + 1);
    } else if (tool === 'Write') {
      // A Write whose target already exists on disk is a whole-file rewrite —
      // the single biggest time sink in a build turn (1–2 min of regeneration
      // vs seconds for an Edit). tool_use streams before the SDK executes the
      // write, so existsSync here reflects the pre-write state.
      let p = strOf(input.file_path);
      if (p && this.fileExists(p)) this.wholeFileRewrites.push(basename(p));
    } else if (tool === 'Bash') {
      let cmd = strOf(input.command);
      if (cmd && MUTATING_BASH.test(cmd)) {
        this.mutatingBash.push(cmd.slice(0, 60));
      }
    } else if (tool.endsWith('screenshot_html')) {
      this.screenshots += 1;
    }
  }

  private fileExists(rel: string): boolean {
    if (!this.workspaceDir) return false;
    try {
      return existsSync(join(this.workspaceDir, rel));
    } catch {
      return false;
    }
  }

  /**
   * Build the end-of-turn summary and log it — a `warn` with the concern
   * list when anything is flagged, an `info` "no waste flags" otherwise.
   * Returns the structured summary (for tests / callers).
   */
  finish(): TurnWasteSummary {
    let totalCalls = 0;
    for (let n of this.counts.values()) totalCalls += n;
    let breakdown = [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}:${n}`)
      .join(' ');

    let concerns: string[] = [];
    let dupReads = [...this.reads.entries()].filter(([, n]) => n > 1);
    if (dupReads.length > 0) {
      concerns.push(
        `${dupReads.length} file(s) re-read (${dupReads
          .map(([p, n]) => `${basename(p)}×${n}`)
          .join(', ')})`,
      );
    }
    if (this.wholeFileRewrites.length > 0) {
      concerns.push(
        `${this.wholeFileRewrites.length} whole-file Write over an existing file — prefer Edit (${this.wholeFileRewrites.join(', ')})`,
      );
    }
    if (this.screenshots > 4) {
      concerns.push(`${this.screenshots} screenshots in one turn`);
    }
    if (this.mutatingBash.length > 0) {
      concerns.push(
        `${this.mutatingBash.length} mutating Bash call(s) — Bash should be read-only inspection`,
      );
    }

    if (concerns.length > 0) {
      log.warn(
        `turn waste check — ${totalCalls} tool calls [${breakdown}] · ⚠ ${concerns.join('; ')}`,
      );
    } else if (totalCalls > 0) {
      log.info(
        `turn tool summary — ${totalCalls} tool calls [${breakdown}] · no waste flags`,
      );
    }
    return { totalCalls, breakdown, concerns };
  }
}
