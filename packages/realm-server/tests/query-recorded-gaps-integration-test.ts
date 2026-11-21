import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// What a shop's gallery of saved searches recorded as going wrong without an
// error, each pinned to the behavior docs/search.md describes, and the
// focused cases that gallery suggested.
//
// The rule every test here holds the engine to: a query either returns the
// right rows and values, or is refused with a coded error that names what it
// cannot do. An empty or blank answer to a query the engine accepted is never
// right.
//
// - 'recorded gaps still open': the recorded failure still happens. These
//   tests fail, and stay failing until the engine is fixed.
// - 'recorded gaps now closed': the recorded failure no longer happens.
// - 'focused cases': one rule each, on the smallest rows that tell a right
//   answer from a wrong one.
// - 'pinned, rule not yet decided': what the engine does where the docs say
//   nothing.
//
// Each fixture is a realm of its own, declared above the test that reads it
// and written through the index writer with the text a render would stamp
// for the declarations below (role-weighted words, the typo word list,
// pattern values), so full text, typos, patterns, vectors and links are the
// writer's own. No card is rendered and no server runs. A query goes in as a
// client sends it: in the newer spelling, through the search wire's parser.
//
// Every expectation is worked out here from the rows: a filter, a count, a
// cosine, reciprocal rank fusion as the docs state it.
//
// These need pgvector in the test Postgres, and fail without it.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run, outcome, isCodedRefusal } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: a range on a field declared `search: false` runs and returns
    // nothing. The index never holds such a field, so no row can match and
    // the empty answer says nothing about the cards.
    const unindexed = fixture('unindexed', {
      // `dims` is declared `search: false`, so the search doc has no `dims`
      Item: { A: { title: 'wide shelf', price: 10 } },
    });
    test('a range on a field declared search: false is refused, not answered with nothing', async function (assert) {
      let { answer, refused } = await outcome(() =>
        run(unindexed, {
          type: unindexed.Item,
          filter: { range: { 'dims.width': { lte: 80 } } },
        }),
      );
      isCodedRefusal(
        assert,
        refused,
        /dims/,
        `a range on dims.width (answered with ${JSON.stringify(answer?.names)})`,
      );
    });
  });

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const flags = fixture('flags', {
      Item: {
        A: { title: 'one', inStock: true, onSale: true },
        B: { title: 'two', inStock: true, onSale: false },
        C: { title: 'three', inStock: false, onSale: true },
      },
    });
    // docs/search.md shows several fields in one clause for `range` only.
    test('several fields in one eq are all required', async function (assert) {
      // pins current behavior; rule not yet decided
      let { names } = await run(flags, {
        type: flags.Item,
        filter: { eq: { inStock: true, onSale: true } },
      });
      assert.deepEqual(names, ['A']);
    });
  });
});
