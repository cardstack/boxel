import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

module('Unit | Service | animations', function (hooks) {
  setupTest(hooks);

  // TODO: Replace this with your real tests.
  test('it exists', function (assert) {
    let service = this.owner.lookup('service:animations');
    assert.ok(service);
  });
});
