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

// The federated route reads Query V2's grammar (row 24a) while the host's live
// search still holds main's matcher. What keeps the two from disagreeing is
// that a member main's grammar does not have never reaches the matcher with a
// server answer computed from it: the host's store sends a live search through
// `searchEntryWireQueryFromQuery` (store.ts, `fetchSearchDocUncoalesced`),
// which carries only filter, sort and page, and refuses a filter member it
// cannot spell; and a live search whose filter the matcher cannot evaluate is
// passed through from the server untouched (`isClientEvaluable`, search.ts
// `isClientFilterEligible`). These pin each half, so a host change that starts
// sending the newer members has to bring the matcher along.

const PERSON = { module: 'http://example.test/person', name: 'Person' };

module(basename(import.meta.filename), function () {
  test('query members main’s grammar does not have are not sent', function (assert) {
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
    let wire = searchEntryWireQueryFromQuery(query, { fields: ['item'] });
    assert.deepEqual(
      Object.keys(wire).sort(),
      ['fields', 'filter', 'page', 'sort'],
      'only the members both grammars share go on the wire',
    );
  });

  test('a filter member main’s grammar does not have is refused before the request', function (assert) {
    for (let filter of [
      { exists: { name: true } },
      { linkedFrom: { card: 'http://example.test/a', field: 'items' } },
      { near: [0.1, 0.2] },
    ]) {
      assert.throws(
        () => wireFilterFromFilter(filter as unknown as Filter),
        /cannot translate filter member/,
        `${Object.keys(filter)[0]} is refused, not sent`,
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
