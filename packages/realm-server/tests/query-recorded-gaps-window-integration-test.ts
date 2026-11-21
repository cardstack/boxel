import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for expression windows. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run, outcome, isCodedRefusal, rerankOf } =
    setupRecordedGaps(hooks);

  // ==========================================================================
  module('focused cases', function () {
    const blanks = fixture('blanks', {
      Item: {
        R5: { title: 'one', rating: 5 },
        R4: { title: 'two', rating: 4 },
        R3: { title: 'three', rating: 3 },
        R2: { title: 'four', rating: 2 },
      },
    });
    for (let blank of ['NA()']) {
      test(`a row whose window value is ${blank} keeps its place after the scored rows`, async function (assert) {
        let answer = await run(blanks, {
          type: blanks.Item,
          sort: [
            { expression: `IF(rating <= 3, 10 - rating, ${blank})`, top: 100 },
            { by: 'rating', direction: 'desc' },
          ],
        });
        // 10 - 2 and 10 - 3 first, then the unscored rows in the query's
        // order (rating, highest first)
        assert.deepEqual(answer.names, ['R2', 'R3', 'R5', 'R4']);
        assert.deepEqual(rerankOf(answer), {
          R2: 8,
          R3: 7,
          R5: null,
          R4: null,
        });
        assert.strictEqual(answer.meta.window?.scored, 2, 'two rows scored');
      });
    }
    // Text is no score: an expression whose value can be text ("") is
    // outside the score profile, and refused.
    test('an expression whose value can be text is refused', async function (assert) {
      let { refused } = await outcome(() =>
        run(blanks, {
          type: blanks.Item,
          sort: [
            { expression: 'IF(rating <= 3, 10 - rating, "")', top: 100 },
            { by: 'rating', direction: 'desc' },
          ],
        }),
      );
      isCodedRefusal(
        assert,
        refused!,
        /text/,
        'a text value',
        'expression-unsupported',
      );
    });

    const unsorted = fixture('unsorted', {
      Item: {
        A: { title: 'one', price: 20 },
        B: { title: 'two', price: 30 },
        C: { title: 'three', price: 10 },
      },
    });
    test('a window with no other sort orders the rows by its value, and pages cover each row once', async function (assert) {
      let query = {
        type: unsorted.Item,
        sort: [{ expression: 'price', top: 100 }],
      };
      assert.deepEqual((await run(unsorted, query)).names, ['B', 'A', 'C']);
      let paged: string[] = [];
      for (let number of [0, 1, 2]) {
        let { names } = await run(unsorted, {
          ...query,
          page: { size: 1, number },
        });
        paged.push(...names);
      }
      assert.deepEqual(paged, ['B', 'A', 'C'], 'one row a page, in order');
    });
  });
});
