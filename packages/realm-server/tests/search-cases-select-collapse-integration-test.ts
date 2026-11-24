import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import { InvalidQueryError } from '@cardstack/runtime-common';
import { assertQuery } from '@cardstack/runtime-common/query-v2/query-check';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';
import { testRealm } from './helpers/index.ts';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for select and collapse, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search, byScore } = shared;
  let engine: IndexQueryEngine;
  hooks.beforeEach(function () {
    ({ engine } = shared);
  });

  test('collapse keeps several per group, and pages over the groups', async function (assert) {
    let { titles, meta } = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on, keep: 2 },
      page: { number: 0, size: 3 },
    });
    assert.deepEqual(titles, ['d', 'e', 'b']);
    assert.strictEqual(meta.page.total, 6);
    let next = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on, keep: 2 },
      page: { number: 1, size: 3 },
    });
    assert.deepEqual(next.titles, ['c', 'f', 'g']);
    let past = await search({
      filter: { type: on },
      sort: byScore,
      collapse: { by: 'channel', on },
      page: { number: 5, size: 3 },
    });
    assert.deepEqual(past.titles, []);
    assert.strictEqual(
      past.meta.page.total,
      4,
      'a page past the end still counts',
    );
  });

  test("each kept row carries its group's size", async function (assert) {
    let sizes = async (keep: number) =>
      (
        await engine.search(
          new URL(testRealm),
          {
            filter: { type: on },
            sort: byScore,
            collapse: { by: 'channel', on, keep },
          },
          {},
          { kind: 'renderSet' },
        )
      ).results.map((r: any) => [
        r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        Number(r._collapseSize),
      ]);
    assert.deepEqual(
      await sizes(1),
      [
        ['d', 2],
        ['b', 3],
        ['f', 1],
        ['g', 1],
      ],
      'GOTO holds 2, Strange Loop 3, a card with no channel stands alone',
    );
    assert.deepEqual(
      (await sizes(2)).slice(0, 2),
      [
        ['d', 2],
        ['e', 2],
      ],
      'every kept row of a group carries the same size',
    );
  });

  test('the wire grammar checks collapse and measure', function (assert) {
    let bad = (query: Record<string, unknown>, pattern: RegExp) =>
      assert.throws(
        () => assertQuery(query),
        (err: unknown) =>
          err instanceof InvalidQueryError && pattern.test(err.message),
      );
    bad({ collapse: 3 }, /collapse must be a field path/);
    bad({ collapse: { by: 'x', keep: 0 } }, /keep must be an integer/);
    bad({ collapse: { by: 'x', group: true } }, /unknown collapse member/);
    bad(
      { facets: [{ by: 'x', measure: { median: 'y' } }] },
      /measure must be one of/,
    );
    bad(
      { facets: [{ by: 'x', measure: { avg: 'y', max: 'y' } }] },
      /measure must be one of/,
    );
    bad({ facets: [{ by: 'x', order: 'measure' }] }, /needs a measure/);
    bad(
      { facets: [{ by: 'x', measure: { avg: 'y' }, interval: 'day' }] },
      /no ranges or interval/,
    );
  });

  test('the entry wire grammar carries collapse through item.', function (assert) {
    let parsed = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, eq: { 'item.channel': 'GOTO' } },
      collapse: 'item.channel',
    });
    assert.deepEqual(parsed.itemQuery.collapse, { by: 'channel', on });
    let scoped = parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, matches: 'metal', fields: ['item.channel'] },
    });
    assert.deepEqual(scoped.itemQuery.filter, {
      on,
      matches: 'metal',
      fields: ['channel'],
    });
    assert.throws(
      () => assertQuery({ filter: { on, matches: 'x', fields: [] } } as any),
      /fields must list 1 to 8 field paths/,
    );
    assert.throws(
      () =>
        assertQuery({
          filter: { on, matches: 'x', fields: ['a'], scope: 'title' },
        } as any),
      /takes no scope, within or prefix/,
    );
    let wire = searchEntryWireQueryFromQuery({
      collapse: { by: 'channel', on, keep: 2 },
    });
    assert.deepEqual(wire.collapse, {
      by: 'item.channel',
      'item.on': on,
      keep: 2,
    });
  });
});
