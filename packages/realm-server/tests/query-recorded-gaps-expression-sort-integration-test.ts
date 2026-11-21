import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for expression sorts. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('focused cases', function () {
    // ---- blends and boosts ------------------------------------------------
    const cover = fixture('cover', {
      Item: {
        A: { title: 'one', stock: 5, sold: 1 },
        B: { title: 'two', stock: 1, sold: 1 },
      },
    });
    // docs/search.md, Blended ranking: "Each signal ranks best first,
    // meaning highest value first unless the entry says `direction: 'asc'`",
    // and an expression is one of the entries the list takes.
    test("an expression signal in a blend honors direction: 'asc'", async function (assert) {
      let ask = async (direction?: string) =>
        (
          await run(cover, {
            type: cover.Item,
            sort: [
              {
                blend: [
                  {
                    expression: 'stock / sold',
                    ...(direction ? { direction } : {}),
                  },
                ],
              },
            ],
          })
        ).names;
      assert.deepEqual(await ask(), ['A', 'B'], 'highest first by default');
      assert.deepEqual(await ask('asc'), ['B', 'A'], 'lowest first when asked');
    });
  });
});
