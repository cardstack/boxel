import { module, test } from 'qunit';

import { assertURLWithinRealm } from '@cardstack/host/lib/realm-sandbox-url-policy';

module('Unit | realm sandbox URL policy', function () {
  test('accepts only URLs beneath the declared realm root', function (assert) {
    assert.strictEqual(
      assertURLWithinRealm(
        'https://realm.example/owner/workspace/',
        'https://realm.example/owner/workspace/cards/example.gts',
      ).href,
      'https://realm.example/owner/workspace/cards/example.gts',
    );

    assert.throws(
      () =>
        assertURLWithinRealm(
          'https://realm.example/owner/workspace/',
          'https://realm.example/owner/other/private.gts',
        ),
      /Denied cross-realm access/,
      'a sibling path is outside the realm',
    );
    assert.throws(
      () =>
        assertURLWithinRealm(
          'https://realm.example/owner/workspace/',
          'https://attacker.example/owner/workspace/private.gts',
        ),
      /Denied cross-realm access/,
      'an identical path on another origin is outside the realm',
    );
  });
});
