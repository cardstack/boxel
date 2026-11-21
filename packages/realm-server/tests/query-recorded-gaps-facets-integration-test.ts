import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for facet counts. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run, facetOf } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('focused cases', function () {
    const five = fixture('five', {
      Item: {
        A: { title: 'one', kind: 'k', price: 1 },
        B: { title: 'two', kind: 'k', price: 2 },
        C: { title: 'three', kind: 'k', price: 3 },
        D: { title: 'four', kind: 'j', price: 4 },
        E: { title: 'five', kind: 'j', price: 5 },
      },
    });
    test('facets count every match while a window reorders and a page cuts', async function (assert) {
      let answer = await run(five, {
        type: five.Item,
        sort: [{ expression: 'price', top: 2 }, { by: 'price' }],
        page: { size: 2 },
        facets: [{ by: 'kind' }],
      });
      // the window is the two cheapest, dearest of them first
      assert.deepEqual(answer.names, ['B', 'A'], 'the page');
      assert.deepEqual(facetOf(answer, 'kind'), { k: 3, j: 2 }, 'every match');
      assert.strictEqual(answer.meta.page.total, 5, 'the total');
    });
  });
});
