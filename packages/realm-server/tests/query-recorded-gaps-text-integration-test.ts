import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for text search. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, brand, run } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: a value like "Grey/Copper" is one word to a `fields` match.
    // docs/search.md: `fields` is "the same stemmed, case-insensitive word
    // match"; a slash is not part of a word.
    const slashed = fixture('slashed', {
      Item: {
        A: { title: 'kettle', color: 'Grey/Copper' },
        B: { title: 'pan', color: 'Grey' },
        C: { title: 'pot', color: 'Blue' },
      },
    });
    test('words joined by a slash are separate words to a fields match', async function (assert) {
      let find = async (term: string) =>
        (
          await run(slashed, {
            type: slashed.Item,
            filter: { matches: term, fields: ['color'] },
          })
        ).names.sort();
      assert.deepEqual(await find('copper'), ['A'], 'the word after the slash');
      assert.deepEqual(
        await find('grey'),
        ['A', 'B'],
        'the word before the slash',
      );
    });
  });

  // ==========================================================================
  module('focused cases', function () {
    // ---- text -------------------------------------------------------------
    const makers = fixture('makers', {
      Brand: {
        solo: { name: 'Solo' },
        works: { name: 'Solo Works' },
        other: { name: 'Other' },
      },
      Item: {
        A: { title: 'cup', brand: brand('makers', 'Solo') },
        B: { title: 'bowl', brand: brand('makers', 'Solo Works') },
        // the word is in its title, not its brand
        C: { title: 'Solo cup', brand: brand('makers', 'Other') },
      },
    });
    test('matches with fields reads a field through a link', async function (assert) {
      let { names } = await run(makers, {
        type: makers.Item,
        filter: { matches: 'solo', fields: ['brand.name'] },
      });
      assert.deepEqual(names.sort(), ['A', 'B']);
    });
  });
});
