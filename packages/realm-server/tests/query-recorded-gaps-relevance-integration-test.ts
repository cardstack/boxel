import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for relevance and explain. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run, outcome } = setupRecordedGaps(hooks);

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const typed = fixture('typed', {
      Item: {
        A: { title: 'Storage Ottoman', sold: 3 },
        B: { title: 'Ottoman', sold: 9 },
      },
    });
    // docs/search.md says a `textRelevance` signal "needs a positive
    // `matches` term in the filter" (`matches-required`); it also says a
    // type-ahead (`matches`, `prefix`, `scope: 'title'`) is "sorted by text relevance", and docs/search-intent.md
    // makes `textRelevance` the search pane's sort "whenever there is a
    // term". Whether a type-ahead term counts is not said.
    test('a textRelevance signal beside a type-ahead term (matches, prefix, title scope) is accepted', async function (assert) {
      // pins current behavior; rule not yet decided
      let { answer, refused } = await outcome(() =>
        run(typed, {
          type: typed.Item,
          filter: { prefix: true, scope: 'title', matches: 'otto stor' },
          sort: [
            { blend: [{ by: 'textRelevance' }, { by: 'sold', weight: 0.5 }] },
          ],
        }),
      );
      assert.strictEqual(refused, undefined, 'not refused');
      assert.deepEqual(answer?.names, ['A'], 'the type-ahead still filters');
    });
  });
});
