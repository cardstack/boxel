import { module, test } from 'qunit';

import {
  VirtualNetwork,
  isRealmIndexCardId,
  ri,
  rri,
} from '@cardstack/runtime-common';

const virtualNetwork = new VirtualNetwork();
const mappedNetwork = new VirtualNetwork();
mappedNetwork.addRealmMapping(
  '@test/cards/',
  'https://cardstack.com/test-realm/',
);

module('Unit | isRealmIndexCardId', function () {
  test('it recognizes the realm root index card when realm is missing trailing slash', function (assert) {
    assert.true(
      isRealmIndexCardId(
        rri('https://cardstack.com/test-realm/index'),
        ri('https://cardstack.com/test-realm'),
        virtualNetwork,
      ),
    );
  });

  test('it does not match non-index cards', function (assert) {
    assert.false(
      isRealmIndexCardId(
        rri('https://cardstack.com/test-realm/person'),
        ri('https://cardstack.com/test-realm'),
        virtualNetwork,
      ),
    );
  });

  test('it does not match index cards nested in a directory', function (assert) {
    assert.false(
      isRealmIndexCardId(
        rri('https://cardstack.com/test-realm/dir/index'),
        ri('https://cardstack.com/test-realm'),
        virtualNetwork,
      ),
    );
  });

  test('it recognizes a prefix-form index card against the realm in prefix form', function (assert) {
    assert.true(
      isRealmIndexCardId(rri('@test/cards/index'), ri('@test/cards/')),
    );
  });

  test('it recognizes a prefix-form index card against the realm URL through the network', function (assert) {
    assert.true(
      isRealmIndexCardId(
        rri('@test/cards/index'),
        new URL('https://cardstack.com/test-realm/'),
        mappedNetwork,
      ),
    );
    assert.false(
      isRealmIndexCardId(
        rri('@test/cards/person'),
        new URL('https://cardstack.com/test-realm/'),
        mappedNetwork,
      ),
    );
  });

  test('it does not match a prefix-form index card nested in a directory', function (assert) {
    assert.false(
      isRealmIndexCardId(rri('@test/cards/dir/index'), ri('@test/cards/')),
    );
  });
});
