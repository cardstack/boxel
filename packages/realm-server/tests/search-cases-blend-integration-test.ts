import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  assertQuery,
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for blends and boosts, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search, refusal } = shared;

  test('a _when signal lifts matching cards without dropping the rest', async function (assert) {
    let plain = await search({
      filter: { type: on },
      sort: [{ by: '_blend', of: [{ on, by: 'hnScore' }] }],
    });
    assert.deepEqual(plain.titles, ['d', 'e', 'b', 'c', 'a', 'f', 'g']);
    let lifted = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            {
              by: '_when',
              when: { on, eq: { channel: 'Strange Loop' } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.deepEqual(
      lifted.titles,
      ['b', 'c', 'a', 'd', 'e', 'f', 'g'],
      'Strange Loop talks rise, and every card is still there',
    );
    assert.strictEqual(lifted.meta.page.total, 7);
  });

  test('a _when signal on a list field keeps cards whose list is empty', async function (assert) {
    let { titles } = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            {
              by: '_when',
              when: { on, eq: { speakers: 'Kleppmann' } },
              weight: 3,
            },
          ],
        },
      ],
    });
    assert.strictEqual(titles[0], 'a', 'the speaker match leads');
    assert.strictEqual(titles.length, 7, 'no card dropped');
  });

  test('a negative blend weight inverts its signal', async function (assert) {
    let { titles } = await search({
      filter: { type: on },
      sort: [{ by: '_blend', of: [{ on, by: 'hnScore', weight: -1 }] }],
    });
    assert.deepEqual(
      titles,
      ['g', 'f', 'a', 'c', 'b', 'e', 'd'],
      'lowest score first',
    );
    let unless = await search({
      filter: { type: on },
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            { by: '_when', when: { on, eq: { channel: 'GOTO' } }, weight: -3 },
          ],
        },
      ],
    });
    assert.deepEqual(
      unless.titles,
      ['b', 'c', 'a', 'f', 'g', 'd', 'e'],
      'a negative _when lifts the cards that do not match',
    );
  });

  test('the entry wire grammar carries boost filters through item.', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on },
      sort: [
        {
          blend: [
            { by: 'item.hnScore' },
            { boost: { eq: { 'item.channel': 'GOTO' } }, weight: 2 },
          ],
        },
      ],
    });
    assert.deepEqual((parsed.itemQuery.sort as any)[0].of[1], {
      by: '_when',
      when: { on, eq: { channel: 'GOTO' } },
      weight: 2,
    });
    assert.throws(
      () => assertQuery({ sort: [{ by: '_when', when: { type: on } }] }),
      /a boost ranks only inside a blend/,
    );
  });
  test('relevance and textRelevance are the request names; the engine names are not', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      type: on,
      filter: { matches: 'talk' },
      sort: [
        { relevance: { text: 1, popularity: 0 } },
        { blend: [{ by: 'item.textRelevance' }, { by: 'item.hnScore' }] },
      ],
    });
    let [rel, blend] = parsed.itemQuery.sort as any[];
    assert.strictEqual(rel.by, '_relevance');
    assert.deepEqual(rel.weights, { text: 1, popularity: 0 });
    assert.strictEqual(blend.of[0].by, '_matchRelevance');
    let wire = searchEntryWireQueryFromQuery(parsed.itemQuery) as any;
    assert.deepEqual(wire.sort[0].relevance, { text: 1, popularity: 0 });
    assert.strictEqual(wire.sort[1].blend[0].by, 'item.textRelevance');
    let internal = refusal(() =>
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, matches: 'talk' },
        sort: [{ by: 'item._relevance', 'item.on': on }],
      }),
    );
    assert.strictEqual(internal.code, 'unknown-key', internal.message);
    assert.true(/is not a sort key/.test(internal.message), internal.message);
    // `_matchRelevance` was the text-relevance key before `textRelevance`,
    // and queries saved in realms name it: an older spelling still read
    let older = refusal(() =>
      parseSearchEntryQueryFromPayload({
        filter: { 'item.on': on, matches: 'talk' },
        sort: [{ by: 'item._matchRelevance', 'item.on': on }],
      }),
    );
    assert.strictEqual(older.message, 'accepted', 'item._matchRelevance');
  });
});
