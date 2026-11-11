import { module, test } from 'qunit';

import { indexCardReindexed } from '@cardstack/host/components/operator-mode/dashboard/workspace-pins';

const realmURL = 'http://test-realm/test/';

module('Unit | workspace pins', function () {
  test('a listed index event moves pins only when it names the index card', function (assert) {
    assert.true(
      indexCardReindexed(
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${realmURL}index`],
          realmURL,
        },
        realmURL,
      ),
    );
    assert.false(
      indexCardReindexed(
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${realmURL}Person/1`],
          realmURL,
        },
        realmURL,
      ),
    );
  });

  test('a realm-wide index event may have moved the index card', function (assert) {
    assert.true(
      indexCardReindexed(
        {
          eventName: 'index',
          indexType: 'incremental',
          realmWide: true,
          realmURL,
        },
        realmURL,
      ),
      'a pass too large to list what it moved is treated as reindexing the index card',
    );
  });
});
