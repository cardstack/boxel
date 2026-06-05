import { module, test } from 'qunit';

import { VirtualNetwork, isRealmIndexCardId } from '@cardstack/runtime-common';

const virtualNetwork = new VirtualNetwork();

module('Unit | isRealmIndexCardId', function () {
  test('it recognizes the realm root index card when realm is missing trailing slash', function (assert) {
    assert.true(
      isRealmIndexCardId(
        'https://cardstack.com/test-realm/index',
        'https://cardstack.com/test-realm',
        virtualNetwork,
      ),
    );
  });

  test('it does not match non-index cards', function (assert) {
    assert.false(
      isRealmIndexCardId(
        'https://cardstack.com/test-realm/person',
        'https://cardstack.com/test-realm',
        virtualNetwork,
      ),
    );
  });

  test('it does not match index cards nested in a directory', function (assert) {
    assert.false(
      isRealmIndexCardId(
        'https://cardstack.com/test-realm/dir/index',
        'https://cardstack.com/test-realm',
        virtualNetwork,
      ),
    );
  });
});
