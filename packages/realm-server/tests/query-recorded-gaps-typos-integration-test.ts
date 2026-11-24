import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { type Q, setupRecordedGaps } from './helpers/recorded-gaps.ts';

// Recorded gaps and focused cases for typos, patterns and type-ahead. See
// query-recorded-gaps-integration-test.ts for the rule each test holds the
// engine to; the fixtures are written as helpers/recorded-gaps.ts says.

module(basename(import.meta.filename), function (hooks) {
  const { fixture, run } = setupRecordedGaps(hooks);

  // ==========================================================================
  module('recorded gaps still open', function () {
    // Recorded: typos miss two swapped letters. docs/search-intent.md: "a
    // swapped pair of letters is one edit", and a six-letter word has one.
    const swapped = fixture('swapped', {
      Item: { A: { title: 'closed' }, B: { title: 'window' } },
    });
    test('typos corrects two swapped letters, as it corrects a dropped one', async function (assert) {
      let find = async (term: string) =>
        (
          await run(swapped, {
            type: swapped.Item,
            filter: { matches: term, typos: true },
          })
        ).names;
      assert.deepEqual(await find('closd'), ['A'], 'a dropped letter');
      assert.deepEqual(await find('clsoed'), ['A'], 'two swapped letters');
    });

    // Recorded: with `typos: true` an excluded word is no longer excluded,
    // and the result inverts. docs/search-intent.md: typos "widens each
    // word"; the term's syntax (`"phrase"`, `-excluded`) is docs/search.md's.
    const excluded = fixture('excluded', {
      Item: {
        A: { title: 'closed toe flat' },
        B: { title: 'closed toe heel' },
      },
    });
    test('with typos on, an excluded word is still excluded', async function (assert) {
      let find = async (filter: Q) =>
        (await run(excluded, { type: excluded.Item, filter })).names;
      assert.deepEqual(
        await find({ matches: '"closed toe" -heel' }),
        ['A'],
        'spelled right, without typos: the card with "heel" is left out',
      );
      assert.deepEqual(
        await find({ matches: '"closed toe" -heel', typos: true }),
        ['A'],
        'spelled right, with typos',
      );
      assert.deepEqual(
        await find({ matches: '"closd toe" -heel', typos: true }),
        ['A'],
        'misspelled, with typos',
      );
    });

    // Recorded: `prefix: true` with `or` returns nothing, though each word
    // alone finds rows. docs/search.md: `or` takes either word, and with
    // `prefix` the last word matches any word that starts with it.
    const either = fixture('either', {
      Item: {
        A: { title: 'Café cups' },
        B: { title: 'Crème tea' },
        C: { title: 'Mug' },
      },
    });
    test('prefix with "or" is the union, the last word a prefix', async function (assert) {
      let find = async (term: string) =>
        (
          await run(either, {
            type: either.Item,
            filter: { matches: term, prefix: true },
          })
        ).names.sort();
      assert.deepEqual(await find('cafe'), ['A'], 'the first word alone');
      assert.deepEqual(await find('crem'), ['B'], 'the unfinished word alone');
      assert.deepEqual(await find('cafe or crem'), ['A', 'B'], 'either');
    });

    // Recorded: the same with `scope: 'title'` (type-ahead) returns nothing,
    // since every type-ahead word had to match and `or` was one of them.
    // docs/search.md: `or` takes either word, binding the words beside it.
    test('type-ahead with "or" is the union, every word a prefix', async function (assert) {
      let find = async (term: string) =>
        (
          await run(either, {
            type: either.Item,
            filter: { matches: term, prefix: true, scope: 'title' },
          })
        ).names.sort();
      assert.deepEqual(await find('cafe or crem'), ['A', 'B'], 'either');
      assert.deepEqual(
        await find('cafe or creme or mug'),
        ['A', 'B', 'C'],
        'any of three',
      );
      assert.deepEqual(
        await find('crem or cafe tea'),
        ['B'],
        'or binds the words beside it: (crem or cafe) and tea',
      );
      assert.deepEqual(await find('cafe crem'), [], 'without or, both words');
    });
  });

  // ==========================================================================
  // What the engine does today where docs/search.md does not give the rule.
  module('pinned, rule not yet decided', function () {
    const titled = fixture('titled', {
      Item: {
        A: { title: 'recliner', body: 'a chair' },
        B: { title: 'rocker', body: 'not a recliner' },
      },
    });
    // docs/search.md says which options `fields` excludes, and nothing of
    // `typos` beside `scope`.
    test("typos with scope: 'title' corrects the word and still reads only the title", async function (assert) {
      // pins current behavior; rule not yet decided
      let { names } = await run(titled, {
        type: titled.Item,
        filter: { matches: 'reclinr', typos: true, scope: 'title' },
      });
      assert.deepEqual(names, ['A']);
    });
  });
});
