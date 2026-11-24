import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  isClientEvaluable,
  searchEntryWireQueryFromQuery,
  wireFilterFromFilter,
  type Filter,
  type Query,
} from '@cardstack/runtime-common';

// Both search routes read Query V2's grammar, and since row 25c the host's
// matcher answers as Query V2 does. The host's store, search panel, card lists
// and card operations translate a `Query` through `searchEntryWireQueryFromQuery`
// (store.ts, `fetchSearchDocUncoalesced`), which now sends every member the
// wire grammar has and refuses, before the request, a filter member it cannot
// spell: a member is never dropped without a word. A live search whose filter
// or sort the matcher cannot reproduce is answered by the server alone
// (`isClientEvaluable`, search.ts `isClientFilterEligible`).

const PERSON = { module: 'http://example.test/person', name: 'Person' };

module(basename(import.meta.filename), function () {
  test('the newer query members are sent, not dropped', function (assert) {
    let query = {
      filter: { on: PERSON, eq: { name: 'Ada' } },
      sort: [{ by: 'name', on: PERSON }],
      page: { size: 10 },
      let: { $liked: { from: { log: 'likes.jsonl' }, select: 'what.post' } },
      facets: [{ by: 'name' }],
      collapse: 'name',
      rerank: { expression: 'rating', top: 5 },
      explain: true,
      timeZone: 'Europe/Berlin',
    } as unknown as Query;
    let wire = searchEntryWireQueryFromQuery(query, {
      fields: ['item'],
    }) as Record<string, unknown>;
    for (let member of [
      'filter',
      'sort',
      'page',
      'let',
      'facets',
      'collapse',
      'explain',
      'timeZone',
    ]) {
      assert.ok(member in wire, `${member} is on the wire`);
    }
    assert.deepEqual(wire.facets, [{ by: 'item.name' }], 'facets by item path');
    assert.true(wire.explain, 'explain is sent');
    assert.strictEqual(wire.timeZone, 'Europe/Berlin', 'timeZone is sent');
    let rerank =
      'rerank' in wire ||
      ((wire.sort as Record<string, unknown>[]) ?? []).some(
        (s) => 'expression' in s,
      );
    assert.true(rerank, 'rerank is sent');
  });

  test('a filter member is sent, or refused before the request, never dropped', function (assert) {
    assert.ok(
      'linkedFrom' in
        wireFilterFromFilter({
          linkedFrom: { card: 'http://example.test/a', field: 'items' },
        } as unknown as Filter),
      'linkedFrom is sent',
    );
    for (let filter of [{ exists: { name: true } }, { nope: { name: 1 } }]) {
      let key = Object.keys(filter)[0];
      assert.throws(
        () => wireFilterFromFilter(filter as unknown as Filter),
        new RegExp(`cannot translate filter member "${key}"`),
        `${key} is refused, not dropped`,
      );
    }
  });

  test('a live search whose filter the matcher cannot evaluate is answered by the server alone', function (assert) {
    for (let filter of [
      { exists: { name: true } },
      { linkedFrom: { card: 'http://example.test/a', field: 'items' } },
      {
        every: [
          { on: PERSON, eq: { name: 'Ada' } },
          { exists: { name: true } },
        ],
      },
      { not: { near: [0.1, 0.2] } },
    ]) {
      assert.false(
        isClientEvaluable(filter as unknown as Filter),
        `${JSON.stringify(filter)} is not evaluated locally`,
      );
    }
    assert.true(
      isClientEvaluable({
        on: PERSON,
        eq: { name: 'Ada' },
      } as unknown as Filter),
      'the control: a filter both grammars share is evaluated locally',
    );
  });
});
