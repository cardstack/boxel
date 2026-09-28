import type { RoomAnalysis } from './room-analysis.ts';

// The shape of one run's JSON in the results directory, and the grade read
// off it. Shared by the spec that writes it and run-eval.ts that turns it
// into an EvaluationResultCard.

export type Verdict =
  | 'pass'
  | 'model-failure'
  | 'host-failure'
  | 'bot-failure'
  | 'runner-failure';

export interface RunResult {
  requestedModel: string;
  // The picker option that was chosen, as the picker shows it.
  modelName: string | undefined;
  modelId: string | undefined;
  reasoningEffort: string | null | undefined;
  roomId: string | undefined;
  realmUrl: string | undefined;
  verdict: Verdict;
  reasons: string[];
  cardRendered: string | undefined;
  renderedIn: 'stack' | 'preview' | undefined;
  durationSeconds: number;
  startedAt: string;
  endedAt: string | undefined;
  prompts: string[];
  // How many of the prompts were sent before the run ended.
  promptsSent: number;
  evalCardUrl: string | undefined;
  sessionId: string | undefined;
  // Cards and files copied into the workspace before the first prompt.
  initialCards: string[];
  initialFiles: string[];
  // Source URLs of the skill files the room had enabled.
  skillsUsed: string[];
  username: string;
  stoppedBy:
    | 'idle'
    | 'wall-clock'
    | 'stuck'
    | 'stalled'
    | 'no-reply'
    | 'irregularity'
    | 'error';
  irregularities: string[];
  // File name, next to this result, of what the workspace held when the run
  // ended: every source file and every indexed card document.
  workspaceSnapshot?: string;
  analysis: RoomAnalysis | undefined;
  screenshot: string | undefined;
  consoleErrors: string[];
  error?: string;
}

// The one-word answer per model. GOOD: passed and inside every benchmark.
// ROUGH: passed, but a benchmark was missed (more turns, switches, or time
// than a good run needs). FAIL: no card, or the run had to be stopped. Cost is
// reported in its own column but does not grade: it tracks the model's price
// class more than its behaviour, and an Opus run would be ROUGH for doing the
// same work as a Sonnet run.
export type Grade = '✅ GOOD' | '🟡 ROUGH' | '❌ FAIL';

export const BENCHMARKS = {
  maxTurns: 8,
  maxModeSwitches: 1,
  maxSeconds: 120,
};

export function grade(result: RunResult): { grade: Grade; misses: string[] } {
  if (result.verdict !== 'pass' || !result.analysis) {
    return { grade: '❌ FAIL', misses: [] };
  }
  let a = result.analysis;
  let misses: string[] = [];
  // Every prompt after the first gets the same turn and time budget again.
  let prompts = Math.max(1, result.prompts.length);
  let maxTurns = BENCHMARKS.maxTurns * prompts;
  let maxSeconds = BENCHMARKS.maxSeconds * prompts;
  if (a.turns > maxTurns) {
    misses.push(`${a.turns} turns (target ≤ ${maxTurns})`);
  }
  let switches = Object.entries(a.toolCalls)
    .filter(([name]) => name.startsWith('switch-submode'))
    .reduce((sum, [, count]) => sum + count, 0);
  if (switches > BENCHMARKS.maxModeSwitches) {
    misses.push(
      `${switches} mode switches (target ≤ ${BENCHMARKS.maxModeSwitches})`,
    );
  }
  if (result.durationSeconds > maxSeconds) {
    misses.push(`${result.durationSeconds}s (target ≤ ${maxSeconds}s)`);
  }
  if (a.patchResults.failed > 0 || a.failedToolCalls.length > 0) {
    misses.push('a patch or tool call failed along the way');
  }
  if (a.cacheMisses > 0) {
    misses.push(`${a.cacheMisses} turn(s) missed the prompt cache`);
  }
  return { grade: misses.length ? '🟡 ROUGH' : '✅ GOOD', misses };
}
