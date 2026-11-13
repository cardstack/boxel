// Entry point of the lint thread. On start the thread loads every engine,
// posting `{ engineStage }` as each step completes and `{ ready }` once all
// are loaded. The worker process sends one `{ id, source, filename }` request
// at a time and gets back `{ id, result }`, or `{ id, error }` when the
// engines threw. While a lint runs, the thread posts `{ id, pass }` as each of
// its passes completes.
import { parentPort } from 'node:worker_threads';

import {
  lintOne,
  loadEngines,
  type EngineStage,
  type LintPass,
} from './lint-engines.ts';

export interface LintThreadRequest {
  id: number;
  source: string;
  filename: string;
}

// A step of the thread's start: when it completed (epoch ms), and the CPU time
// the thread had used by then. Over a step, CPU time well below wall time
// means the thread was waiting (on disk, say) rather than working; the two
// close together on a slow step means it was short of CPU.
export interface EngineStageTiming {
  stage: EngineStage;
  at: number;
  cpuMs: number;
}

export type LintThreadResponse =
  | { id: number; result: Awaited<ReturnType<typeof lintOne>> }
  | { id: number; error: string }
  | { id: number; pass: LintPass }
  | { engineStage: EngineStageTiming }
  | { ready: true };

function post(response: LintThreadResponse) {
  parentPort!.postMessage(response);
}

// A failed load is not reported here: each lint that needs the engine meets
// the same rejection and returns it as its own error.
let enginesLoaded = loadEngines((stage) => {
  let { user, system } = process.threadCpuUsage();
  post({
    engineStage: {
      stage,
      at: Date.now(),
      cpuMs: Math.round((user + system) / 1000),
    },
  });
})
  .catch(() => {})
  .finally(() => post({ ready: true }));

parentPort?.on(
  'message',
  async ({ id, source, filename }: LintThreadRequest) => {
    let response: LintThreadResponse;
    try {
      await enginesLoaded;
      response = {
        id,
        result: await lintOne(source, filename, (pass) => post({ id, pass })),
      };
    } catch (e) {
      response = {
        id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    post(response);
  },
);
