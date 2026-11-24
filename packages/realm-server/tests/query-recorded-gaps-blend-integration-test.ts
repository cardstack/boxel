import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  type Q,
  RRF_K,
  idOf,
  setupRecordedGaps,
} from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for blends and boosts. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, link, nameOf, run, close } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('focused cases', function () {
    const lifted = fixture('lifted', {
      Item: {
        A: { title: 'vase', material: 'stone', sku: 'ab-1' },
        B: { title: 'metal pot', material: 'steel', sku: 'cd-2' },
        C: { title: 'bowl', material: 'wood', sku: 'ef-3' },
        D: { title: 'tray', material: 'cork', sku: 'gh-4' },
      },
      List: {
        L: {
          items: [link('lifted', 'Item', 'C'), link('lifted', 'Item', 'D')],
        },
      },
    });
    // docs/search.md: every card a boost's filter admits gains
    // weight / (k + 1), and a card it does not admit gains nothing.
    for (let [what, boost, liftedNames] of [
      [
        'a union of a field value and a title word',
        {
          any: [
            { eq: { material: 'stone' } },
            { matches: 'metal', scope: 'title' },
          ],
        },
        ['A', 'B'],
      ],
      ['a glob', { pattern: { sku: 'ab*' } }, ['A']],
      [
        'a saved list',
        { linkedFrom: { card: idOf('lifted', 'List', 'L'), field: 'items' } },
        ['C', 'D'],
      ],
    ] as [string, Q, string[]][]) {
      test(`a boost takes any filter: ${what}`, async function (assert) {
        let { rows } = await run(lifted, {
          type: lifted.Item,
          sort: [{ blend: [{ boost, weight: 1 }] }],
        });
        for (let r of rows) {
          let name = nameOf(r.url);
          let expected = liftedNames.includes(name) ? 1 / (RRF_K + 1) : 0;
          assert.true(
            close(r._blendScore, expected),
            `${name}: ${r._blendScore} is ${expected}`,
          );
        }
        assert.strictEqual(rows.length, 4, 'no card is dropped');
      });
    }
  });
});
