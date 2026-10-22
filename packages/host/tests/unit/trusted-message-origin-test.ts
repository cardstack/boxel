import { module, test } from 'qunit';

import { isTrustedMessageOrigin } from '@cardstack/host/utils/trusted-message-origin';

module('Unit | trusted-message-origin', function () {
  const realmServerURL = 'https://realms.cardstack.com/';

  test('accepts the exact realm server origin', function (assert) {
    assert.true(
      isTrustedMessageOrigin('https://realms.cardstack.com', realmServerURL),
    );
    assert.true(
      isTrustedMessageOrigin(
        'https://realms.cardstack.com',
        'https://realms.cardstack.com/some/realm/',
      ),
    );
  });

  test('rejects origins that are a string prefix of the realm server URL', function (assert) {
    assert.false(
      isTrustedMessageOrigin('https://realms.cardstack.co', realmServerURL),
    );
    assert.false(
      isTrustedMessageOrigin('https://realms.cardstack', realmServerURL),
    );
    assert.false(isTrustedMessageOrigin('https://realms', realmServerURL));
    assert.false(isTrustedMessageOrigin('https:', realmServerURL));
    assert.false(isTrustedMessageOrigin('', realmServerURL));
  });

  test('rejects look-alike and differing origins', function (assert) {
    assert.false(
      isTrustedMessageOrigin(
        'https://realms.cardstack.com.evil.example',
        realmServerURL,
      ),
    );
    assert.false(
      isTrustedMessageOrigin('http://realms.cardstack.com', realmServerURL),
    );
    assert.false(
      isTrustedMessageOrigin(
        'https://realms.cardstack.com:8443',
        realmServerURL,
      ),
    );
    assert.false(isTrustedMessageOrigin('null', realmServerURL));
  });

  test('rejects everything when the trusted URL is unusable', function (assert) {
    assert.false(isTrustedMessageOrigin('null', 'file:///tmp/realm/'));
    assert.false(isTrustedMessageOrigin('https://realms.cardstack.com', ''));
  });
});
