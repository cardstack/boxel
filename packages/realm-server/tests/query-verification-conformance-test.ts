import QUnit from 'qunit';
const { module, test } = QUnit;
import { appendFileSync } from 'fs';
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import {
  readVectors,
  VECTOR_FILES,
} from '@cardstack/query-verification/conformance';
import {
  describe,
  runVectors,
  seededEngine,
} from '@cardstack/query-verification/engine-fixture';

import { setupDB } from './helpers/index.ts';

// Holds the Postgres engine to the Lean model of the filter language
// (packages/query-verification). The model's cards are seeded straight into
// boxel_index, and every case the model generated is searched in both
// spellings: the older one as written, the newer one through `lowerQuery`.
// The model's answer for a card is one of three truth values; the engine's is
// read from whether the card is returned by the filter and by its `not`.

module(basename(import.meta.filename), function () {
  for (let file of VECTOR_FILES) {
    module(
      `query verification conformance: ${file} (Postgres)`,
      function (hooks) {
        let vectors = readVectors(file);
        let engine: IndexQueryEngine;

        setupDB(hooks, {
          before: async (dbAdapter) => {
            engine = await seededEngine(dbAdapter, vectors);
          },
        });

        test('the engine answers every case as the model does, in both spellings', async function (assert) {
          let result = await runVectors(engine, 'postgres', file, vectors);
          if (process.env.QV_REPORT) {
            appendFileSync(
              process.env.QV_REPORT,
              `${describe(file, result)}\n`,
            );
          }
          assert.false(result.stale, result.known.join('\n'));
          assert.deepEqual(
            result.failures,
            [],
            'the engine fails on a valid query',
          );
          assert.strictEqual(
            result.disagreements.length,
            0,
            `the engine disagrees with the model:\n${describe(file, result)}`,
          );
          assert.deepEqual(
            result.answered,
            [],
            'the engine answers what it must refuse',
          );
        });
      },
    );
  }
});
