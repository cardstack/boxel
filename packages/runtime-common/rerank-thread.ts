// Entry point of a rerank thread. The pool sends one `{ id, expr, docs,
// deadline }` request at a time and gets back `{ id, scores }`, or
// `{ id, error, compile }` when scoring threw.
import { parentPort } from 'node:worker_threads';

import { RerankFormulaError, scoreRerankFormula } from './rerank-score.ts';
import type { RerankScores } from './rerank-score.ts';

export interface RerankThreadRequest {
  id: number;
  expr: string;
  docs: Record<string, unknown>[];
  deadline: number;
}

export type RerankThreadResponse =
  | { id: number; scores: RerankScores }
  | { id: number; error: string; compile: boolean };

parentPort?.on(
  'message',
  async ({ id, expr, docs, deadline }: RerankThreadRequest) => {
    let response: RerankThreadResponse;
    try {
      response = {
        id,
        scores: await scoreRerankFormula(expr, docs, deadline),
      };
    } catch (e) {
      response = {
        id,
        error: e instanceof Error ? e.message : String(e),
        compile: e instanceof RerankFormulaError,
      };
    }
    parentPort!.postMessage(response);
  },
);
