import { module, test } from 'qunit';

import { leadWith } from '@cardstack/host/lib/utils';

module('Unit | workspace chooser | leadWith', function () {
  const catalog = 'https://example.test/catalog/';
  const newer = 'https://example.test/newer/';
  const older = 'https://example.test/older/';

  test('moves the Boxel catalog ahead of newer catalogs, keeping the rest in order', function (assert) {
    assert.deepEqual(leadWith([newer, catalog, older], catalog), [
      catalog,
      newer,
      older,
    ]);
    assert.deepEqual(leadWith([newer, older, catalog], catalog), [
      catalog,
      newer,
      older,
    ]);
  });

  test('leaves the order alone when the catalog is already first, absent, or unset', function (assert) {
    assert.deepEqual(leadWith([catalog, newer], catalog), [catalog, newer]);
    assert.deepEqual(leadWith([newer, older], catalog), [newer, older]);
    assert.deepEqual(leadWith([newer, older], null), [newer, older]);
  });
});
