import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { logSearchResponse } from '@cardstack/runtime-common';
import { realm, setupRefusalIndex } from './helpers/query-refusals.ts';

// What a malformed query is refused with, for log queries. See
// query-refusals-test.ts for how a row is read.

module(basename(import.meta.filename), function () {
  // ---- refused only when the query runs -----------------------------------

  module('refused when run (Postgres)', function (hooks) {
    const shared = setupRefusalIndex(hooks);
    let adapter: PgAdapter;
    hooks.before(function () {
      ({ adapter } = shared);
    });

    test('[run] a log query is refused with the card grammar’s codes', async function (assert) {
      for (let [payload, code] of [
        [{ from: { log: 'Listing/history.jsonl' }, fliter: {} }, 'unknown-key'],
        [{ from: { log: 'Listing/history.jsonl', file: 'x' } }, 'unknown-key'],
        [
          { from: { log: 'Listing/history.jsonl' }, select: 'at' },
          'invalid-value',
        ],
        [
          {
            from: { log: 'Listing/history.jsonl' },
            select: ['at'],
            group: { by: 'actor', count: true },
          },
          'conflicting-members',
        ],
      ] as [Record<string, unknown>, string][]) {
        let { status, body } = await logSearchResponse(
          adapter,
          realm,
          payload as any,
        );
        assert.strictEqual(status, 400, JSON.stringify(payload).slice(0, 80));
        assert.strictEqual((body as any)?.errors?.[0]?.code, code, 'the code');
      }
    });
  });
});
