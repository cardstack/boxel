import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  assertQuery,
  parseSearchEntryQueryFromPayload,
} from '@cardstack/runtime-common';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for near search, on a corpus of talks seeded fresh for each
// test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, refusal } = shared;

  test('a blend or a near sort refuses a member it does not have', function (assert) {
    let refused = (payload: Record<string, unknown>, pattern: RegExp) => {
      let got = refusal(() => parseSearchEntryQueryFromPayload(payload));
      assert.strictEqual(
        got.code,
        'unknown-key',
        `${pattern.source}: ${got.message}`,
      );
      assert.true(
        pattern.test(got.message),
        `${pattern.source}: ${got.message}`,
      );
    };
    let signals = [{ by: 'item.hnScore', 'item.on': on }];
    refused(
      {
        filter: { 'item.on': on },
        sort: [{ blend: signals, fusion: 'linear' }],
      },
      /unknown blend member "fusion"; did you mean "method"\?/,
    );
    refused(
      { filter: { 'item.on': on }, sort: [{ blend: signals, zzz: 1 }] },
      /unknown blend member "zzz" \(a blend takes blend, method, k, direction\)/,
    );
    refused(
      { filter: { 'item.on': on }, sort: [{ blend: signals, metod: 'rrf' }] },
      /did you mean "method"/,
    );
    let near = { by: 'embedding', on, near: [1, 0] };
    let nearSort = refusal(() =>
      assertQuery({ sort: [{ ...near, directon: 'asc' }] }),
    );
    assert.strictEqual(
      nearSort.code,
      'unknown-key',
      `a near sort entry: ${nearSort.message}`,
    );
    assert.true(
      /did you mean "direction"/.test(nearSort.message),
      nearSort.message,
    );
    let nearSignal = refusal(() =>
      assertQuery({
        sort: [{ by: '_blend', of: [{ ...near, zzz: 1 }] }],
      }),
    );
    assert.strictEqual(
      nearSignal.code,
      'unknown-key',
      `a near signal in a blend: ${nearSignal.message}`,
    );
    assertQuery({ sort: [{ ...near, direction: 'asc' }] });
    assertQuery({
      sort: [{ by: '_blend', of: [{ ...near, weight: 2 }], k: 60 }],
    });
    assert.ok(true, 'the members they have still pass');
  });
});
