// Seed scripts: cards and JSON files an evaluation starts from, built in code
// when a run starts instead of committed under eval-realm/. An EvaluationCard names one
// in `seedScript`; the runner copies its contents into the test workspace
// with the evaluation's own initial cards and files.

import type { CardDocument } from '../realm-api.ts';

import { apiOrdersSeed } from './api-orders.ts';
import { bulkRecordsSeed } from './bulk-records.ts';

export interface EvaluationSeed {
  // Card documents by path from the realm root, e.g.
  // `bulk-operations/store/Product/<slug>.json`, and plain JSON files that
  // are data rather than cards, such as a saved API response.
  contents: Record<string, CardDocument | JsonFile>;
  // Card paths from the realm root, without `.json`, added to the
  // evaluation's fields of the same name. They live here, not as links on
  // the EvaluationCard, because these cards never exist in the workspace the
  // evaluation lives in.
  initialCards: string[];
  promptCards: string[];
  expectedChangedCards: string[];
}

// A `.json` file that is not a card document: the realm serves it as a file,
// and the runner does not wait for it to index as a card.
export type JsonFile = Record<string, unknown>;

const SEEDS: Record<string, () => EvaluationSeed> = {
  'api-orders': apiOrdersSeed,
  'bulk-records': bulkRecordsSeed,
};

export function evaluationSeed(name: string): EvaluationSeed {
  let build = SEEDS[name];
  if (!build) {
    throw new Error(
      `unknown seedScript "${name}"; known: ${Object.keys(SEEDS).join(', ')}`,
    );
  }
  return build();
}
