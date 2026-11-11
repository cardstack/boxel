import { module, test } from 'qunit';

import {
  searchEntryWireQueryFromQuery,
  type CodeRef,
  type Query,
} from '@cardstack/runtime-common';

import { searchEntrySummaries } from '@cardstack/host/tools/search-entries';
import { lowerForWire } from '@cardstack/host/utils/search/lower-for-wire';

const listing = {
  module: '@cardstack/catalog/catalog-app/listing/listing',
  name: 'Listing',
} as unknown as CodeRef;

// What the AI search tools send: the query the model wrote, lowered, then
// wired. The wire translator reads only the older spelling.
function wire(query: unknown) {
  return searchEntryWireQueryFromQuery(lowerForWire(query as Query));
}

module('Unit | lower-for-wire', function () {
  // ADR 022 §1.7: a V2 member makes the query the newer spelling, whose type
  // goes at the top. The server cannot tell an author's mixed query from the
  // engine's own form, so the authoring surfaces refuse it.
  const mixed = {
    filter: { on: listing, eq: { name: 'Pasta' } },
    facets: [{ by: 'name' }],
  };
  const rewritten = {
    type: listing,
    filter: { eq: { name: 'Pasta' } },
    facets: [{ by: 'name' }],
  };

  test('an on anchor beside facets is refused with the rewrite', function (assert) {
    assert.throws(
      () => lowerForWire(mixed as unknown as Query),
      (err: any) =>
        err?.code === 'mixed-spelling' &&
        /filter\.on/.test(err.message) &&
        /"facets"/.test(err.message) &&
        err.message.includes(`{ "type": ${JSON.stringify(listing)}`),
    );
  });

  test('the same query with its type at the top is accepted', function (assert) {
    let lowered = lowerForWire(rewritten as unknown as Query) as any;
    assert.deepEqual(lowered.filter, {
      on: listing,
      every: [{ eq: { name: 'Pasta' } }],
    });
    assert.deepEqual(lowered.facets, [{ by: 'name' }]);
  });

  test('an on anchoring one node, or a whole older query, is not refused', function (assert) {
    lowerForWire({
      type: listing,
      filter: { any: [{ on: listing, eq: { name: 'a' } }] },
      facets: [{ by: 'name' }],
    } as unknown as Query);
    lowerForWire({
      filter: { every: [{ on: listing, eq: { name: 'a' } }] },
      page: { size: 1, total: 'none' },
    } as unknown as Query);
    lowerForWire({
      filter: { on: listing, eq: { name: 'a' } },
    } as unknown as Query);
    assert.ok(true, 'accepted');
  });

  test('the AI search tools refuse the mixed query before anything is sent', async function (assert) {
    let sent = 0;
    let searchEntries = async () => {
      sent++;
      return { data: [], meta: { page: { total: 0 } } } as any;
    };
    await assert.rejects(
      searchEntrySummaries(searchEntries, mixed as unknown as Query, {
        scope: 'cards',
        limit: 5,
      }),
      (err: any) => err?.code === 'mixed-spelling',
    );
    assert.strictEqual(sent, 0, 'nothing was sent');
    await searchEntrySummaries(searchEntries, rewritten as unknown as Query, {
      scope: 'cards',
      limit: 5,
    });
    assert.strictEqual(sent, 1, 'the rewrite is searched');
  });

  test('a query in the older spelling is returned as it is', function (assert) {
    let query = {
      filter: { on: listing, eq: { name: 'Pasta' } },
      sort: [{ by: 'name', on: listing }],
    } as unknown as Query;
    assert.strictEqual(lowerForWire(query), query);
  });

  test('a top-level type anchors the filter instead of being dropped', function (assert) {
    let wired = wire({ type: listing, filter: { eq: { name: 'Pasta' } } });
    assert.deepEqual(wired.filter as unknown, {
      'item.on': listing,
      every: [{ eq: { 'item.name': 'Pasta' } }],
    });
  });

  test('a top-level type in the shorthand spelling anchors the filter and facets', function (assert) {
    // the AI query schema offers `type` as "<module>#<Name>" or { module, name }
    let wired = wire({
      type: '@cardstack/catalog/catalog-app/listing/listing#Listing',
      filter: { eq: { name: 'Pasta' } },
      facets: [{ by: 'name' }],
    });
    assert.deepEqual(wired.filter as unknown, {
      'item.on': listing,
      every: [{ eq: { 'item.name': 'Pasta' } }],
    });
    assert.deepEqual(wired.facets as unknown, [{ by: 'item.name' }]);
  });

  test('a top-level type with no filter is a type filter', function (assert) {
    let wired = wire({ type: listing });
    assert.deepEqual(wired.filter as unknown, { 'item.on': listing });
  });

  test('exists and missing are wired as eq on null instead of throwing', function (assert) {
    let missing = wire({ type: listing, filter: { missing: 'name' } });
    assert.deepEqual(missing.filter as unknown, {
      'item.on': listing,
      every: [{ eq: { 'item.name': null } }],
    });
    let exists = wire({ type: listing, filter: { exists: 'name' } });
    assert.deepEqual(exists.filter as unknown, {
      'item.on': listing,
      every: [{ not: { eq: { 'item.name': null } } }],
    });
  });

  test('an expression sort is carried to the wire', function (assert) {
    let wired = wire({
      type: listing,
      sort: [{ expression: 'item.price * 2', direction: 'desc' }],
    });
    assert.strictEqual(wired.sort?.length, 1);
    assert.strictEqual(
      (wired.sort?.[0] as unknown as { expression?: string }).expression,
      'item.price * 2',
    );
  });
});
