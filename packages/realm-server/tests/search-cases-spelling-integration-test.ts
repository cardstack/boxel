import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  assertQuery,
  parseSearchEntryQueryFromPayload,
} from '@cardstack/runtime-common';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for the newer spelling, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, refusal } = shared;

  test('unknown members are refused with a code and the nearest name', function (assert) {
    let refused = (
      run: () => unknown,
      code: string,
      pattern: RegExp | undefined,
      label: string,
    ) => {
      let got = refusal(run);
      assert.strictEqual(got.code, code, `${label}: ${got.message}`);
      if (pattern) {
        assert.true(pattern.test(got.message), `${label}: ${got.message}`);
      }
    };
    let accepted = (run: () => unknown, label: string) => {
      let got = refusal(run);
      assert.strictEqual(got.message, 'accepted', label);
    };
    let typed = (q: Record<string, unknown>) => () =>
      assertQuery({ type: on, ...q });
    // an unknown top-level member is refused in both spellings
    refused(
      () => assertQuery({ fliter: { type: on } }),
      'unknown-key',
      /did you mean "filter"/,
      'the top level, older spelling',
    );
    refused(
      typed({ fliter: { eq: { title: 'A' } } }),
      'unknown-key',
      /did you mean "filter"/,
      'the top level, newer spelling',
    );
    // the newer spelling refuses an unknown member of a sort entry, a
    // filter node and the page, naming the nearest real one
    refused(
      typed({ sort: [{ by: 'hnScore', order: 'desc' }] }),
      'unknown-key',
      /order/,
      'a sort entry',
    );
    refused(
      typed({ sort: [{ by: 'hnScore', directon: 'desc' }] }),
      'unknown-key',
      /did you mean "direction"/,
      'a misspelled direction',
    );
    refused(
      typed({ filter: { eq: { title: 'A' }, colour: 'red' } }),
      'unknown-key',
      /colour/,
      'a filter node',
    );
    refused(
      typed({ page: { size: 10, cursor: 'x' } }),
      'unknown-key',
      /cursor/,
      'the page',
    );
    refused(
      typed({ page: { size: -1 } }),
      'invalid-page',
      undefined,
      'a negative size, newer spelling',
    );
    // the older spelling reads them as it always did: ignored
    accepted(
      () => assertQuery({ sort: [{ on, by: 'hnScore', order: 'desc' }] }),
      'a sort entry, older spelling',
    );
    accepted(
      () => assertQuery({ sort: [{ on, by: 'hnScore', directon: 'desc' }] }),
      'a misspelled direction, older spelling',
    );
    accepted(
      () => assertQuery({ filter: { on, eq: { title: 'A' }, colour: 'red' } }),
      'a filter node, older spelling',
    );
    accepted(
      () =>
        assertQuery({ filter: { type: on }, page: { size: 10, cursor: 'x' } }),
      'the page, older spelling',
    );
    accepted(
      () => assertQuery({ filter: { type: on }, page: { size: -1 } }),
      'a negative size is read as the default, older spelling',
    );
    refused(
      () =>
        assertQuery({ filter: { type: on }, page: { size: 10, number: -1 } }),
      'invalid-page',
      undefined,
      'a negative page number',
    );
    accepted(
      () => assertQuery({ filter: { type: on }, page: { size: 0 } }),
      'size 0 still asks for counts only',
    );
    // the wire refuses an unknown sort member in both spellings, as it
    // always has
    refused(
      () =>
        parseSearchEntryQueryFromPayload({
          filter: { 'item.on': on },
          sort: [{ by: 'item.hnScore', 'item.on': on, ordr: 'desc' }],
        }),
      'unknown-key',
      /ordr/,
      'the wire, older spelling',
    );
    refused(
      () =>
        parseSearchEntryQueryFromPayload({
          type: on,
          sort: [{ by: 'item.hnScore', ordr: 'desc' }],
        }),
      'unknown-key',
      /did you mean "order"|ordr/,
      'the wire, newer spelling',
    );
  });
});
