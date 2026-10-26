// Entry point of the lint thread. The worker process sends one
// `{ id, source, filename }` request at a time and gets back
// `{ id, result }`, or `{ id, error }` when the engines threw.
import { parentPort } from 'node:worker_threads';

import { lintOne } from './lint-engines.ts';

export interface LintThreadRequest {
  id: number;
  source: string;
  filename: string;
}

export type LintThreadResponse =
  | { id: number; result: Awaited<ReturnType<typeof lintOne>> }
  | { id: number; error: string };

parentPort?.on(
  'message',
  async ({ id, source, filename }: LintThreadRequest) => {
    let response: LintThreadResponse;
    try {
      response = { id, result: await lintOne(source, filename) };
    } catch (e) {
      response = {
        id,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    parentPort!.postMessage(response);
  },
);
