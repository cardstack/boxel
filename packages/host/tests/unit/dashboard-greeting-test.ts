import { module, test } from 'qunit';

import { greetingFor } from '@cardstack/host/components/operator-mode/dashboard/greeting';

module('Unit | dashboard greeting', function () {
  test('changes with the time of day', function (assert) {
    assert.strictEqual(greetingFor(0, 'Ada'), 'Good morning, Ada');
    assert.strictEqual(greetingFor(11, 'Ada'), 'Good morning, Ada');
    assert.strictEqual(greetingFor(12, 'Ada'), 'Good afternoon, Ada');
    assert.strictEqual(greetingFor(17, 'Ada'), 'Good afternoon, Ada');
    assert.strictEqual(greetingFor(18, 'Ada'), 'Good evening, Ada');
    assert.strictEqual(greetingFor(23, 'Ada'), 'Good evening, Ada');
  });

  test('uses only the first name', function (assert) {
    assert.strictEqual(
      greetingFor(9, '  Ada   Lovelace '),
      'Good morning, Ada',
    );
  });

  test('leaves the name out while the profile has none', function (assert) {
    assert.strictEqual(greetingFor(9, undefined), 'Good morning');
    assert.strictEqual(greetingFor(9, '   '), 'Good morning');
  });
});
