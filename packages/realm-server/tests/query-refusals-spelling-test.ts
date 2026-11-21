import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common';
import {
  type Mistake,
  type Outcome,
  type Q,
  T,
  describeError,
  isRefusedWith,
  keyed,
  kind,
  setupRefusalIndex,
  table,
  viaWire,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for the newer spelling. See
// query-refusals-test.ts for how a row is read.

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    name: 'a field sort with no type anywhere, beside a newer spelling',
    query: { filter: { exists: 'price' }, sort: [{ by: 'price' }] },
    code: 'sort-needs-type',
  },
];

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  ...[
    'Listing',
    3,
    null,
    {},
    [],
    { module: '', name: '' },
    { name: 'Listing' },
  ].map((v) => ({
    name: `type: ${JSON.stringify(v)}`,
    query: { type: v, filter: kind },
    code: 'invalid-type',
  })),
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);

    test('[validation] an unknown member of a saved page is still ignored over the wire', function (assert) {
      // The docs' own example: `page.cursor`, in a query with no newer
      // spelling, as a request carries it.
      let got = viaWire({
        filter: { 'item.on': T, eq: { 'item.kind': 'lamp' } },
        page: { size: 10, cursor: 'abc' },
      });
      assert.strictEqual(got.kind, 'accepted', got.message);
    });
  });

  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    const { realmURL, run } = shared;
    let engine: IndexQueryEngine;
    hooks.before(function () {
      ({ engine } = shared);
    });

    test('[run] a `[]` path is unknown-field in the newer spelling; the older spelling runs it as it always has', async function (assert) {
      // Compatibility rule: the older spelling has always accepted `[]` in a
      // path, so a saved query keeps running and keeps its answer. Its path
      // walk (unchanged from origin/main) looks the field up without the `[]`
      // and reads the path as a list: on this scalar field there is no list
      // element, so no card matches. The newer spelling has no `[]` path
      // syntax and refuses it.
      for (let [place, filter] of [
        ['eq', { eq: keyed('kind[]', 'lamp') }],
        ['in', { in: keyed('kind[]', ['lamp']) }],
      ] as [string, Q][]) {
        // As written: the engine lowers it itself, so it sees the `[]`.
        let newer: Outcome;
        try {
          await engine.searchCards(realmURL, { type: T, filter } as Query);
          newer = { refused: false, kind: 'ran', code: undefined, message: '' };
        } catch (e) {
          newer = describeError(e);
        }
        isRefusedWith(
          assert,
          newer,
          'unknown-field',
          `newer spelling, ${place}`,
        );
        let older = await run({ filter: { on: T, ...filter } });
        assert.false(
          older.refused,
          `older spelling, ${place}: runs (${older.message})`,
        );
        assert.deepEqual(
          older.names,
          [],
          `older spelling, ${place}: a list path over a scalar matches no card`,
        );
      }
    });
  });
});
