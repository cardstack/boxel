import { module, test } from 'qunit';
import { getService } from '@universal-ember/test-support';

// Realm `.test.gts` files reach for `@universal-ember/test-support`
// (e.g. `getService`), a direct dependency of the CLI. parse type-checks
// every discovered `.test.gts`, so the package must resolve in the parse
// workspace or these tests fail with "Cannot find module".
module('test-support', function () {
  test('resolves @universal-ember/test-support', function (assert) {
    assert.ok(typeof getService === 'function');
  });
});
