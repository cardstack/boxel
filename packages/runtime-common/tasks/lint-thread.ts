// Entry point of the lint thread. The worker process sends one
// `{ id, source, filename }` request at a time and gets back
// `{ id, result }`, or `{ id, error }` when the engines threw. While a lint
// runs, the thread also posts `{ id, progress }` as each of its passes
// completes, and `{ progress }` with no id as each engine finishes loading,
// since every lint waiting on that engine is making progress.
import { parentPort } from 'node:worker_threads';

import { lintOne, onEngineStage, type LintStage } from './lint-engines.ts';

export interface LintThreadRequest {
  id: number;
  source: string;
  filename: string;
}

// When the stage completed (epoch ms), and the CPU time this thread had used
// by then. Over a stage, CPU time well below wall time means the thread was
// waiting (on disk, say) rather than working; the two close together on a
// slow stage means it was short of CPU.
export interface LintThreadProgress {
  stage: LintStage;
  at: number;
  cpuMs: number;
}

export type LintThreadResponse =
  | { id: number; result: Awaited<ReturnType<typeof lintOne>> }
  | { id: number; error: string }
  | { id?: number; progress: LintThreadProgress };

function progress(stage: LintStage): LintThreadProgress {
  let { user, system } = process.threadCpuUsage();
  return {
    stage,
    at: Date.now(),
    cpuMs: Math.round((user + system) / 1000),
  };
}

onEngineStage((stage) => {
  parentPort!.postMessage({
    progress: progress(stage),
  } satisfies LintThreadResponse);
});

parentPort?.on(
  'message',
  async ({ id, source, filename }: LintThreadRequest) => {
    let response: LintThreadResponse;
    try {
      response = {
        id,
        result: await lintOne(source, filename, (stage) => {
          parentPort!.postMessage({
            id,
            progress: progress(stage),
          } satisfies LintThreadResponse);
        }),
      };
    } catch (e) {
      response = {
        id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    parentPort!.postMessage(response);
  },
);
