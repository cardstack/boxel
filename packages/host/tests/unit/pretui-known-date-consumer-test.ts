import { module, test } from 'qunit';

import {
  knownDatePhrase,
  parseKnownDate,
} from '@cardstack/host/lib/pretui-known-date';

module('Unit | generated PretUI Known Date consumer', function () {
  test('uses deterministic parsing from the syndicated exact Version', function (assert) {
    let parsed = parseKnownDate(
      { day: '15', month: 'April', year: '90' },
      { locale: 'en-GB', pivotYear: 2026 },
    );

    assert.deepEqual(parsed, { empty: false, iso: '1990-04-15' });
    assert.strictEqual(
      knownDatePhrase('1990-04-15', '2026-08-23'),
      '36 years ago',
    );
  });
});
