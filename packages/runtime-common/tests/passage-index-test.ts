import type { SharedTests } from '../helpers/index.ts';
import { collectSearchDocPassages } from '../passage-index.ts';

const tests = Object.freeze({
  'collects the items of the fields _passages names, by position': async (
    assert,
  ) => {
    assert.deepEqual(
      collectSearchDocPassages({
        _passages: ['segments'],
        segments: [
          { start: 0, end: 60, text: 'hello there' },
          { start: 60, end: 120, text: '' },
          { start: 120, text: 'logical clocks' },
        ],
        notes: [{ text: 'not a passage list' }],
      }),
      [
        {
          fieldPath: 'segments',
          ordinal: 0,
          start: 0,
          end: 60,
          text: 'hello there',
        },
        {
          fieldPath: 'segments',
          ordinal: 2,
          start: 120,
          end: null,
          text: 'logical clocks',
        },
      ],
      'empty items are skipped but keep their numbers; only named fields count',
    );
  },

  'a search doc without _passages has no passages': async (assert) => {
    assert.deepEqual(
      collectSearchDocPassages({ segments: [{ text: 'x' }] }),
      [],
    );
    assert.deepEqual(collectSearchDocPassages(null), []);
  },
} as SharedTests<{}>);

export default tests;
