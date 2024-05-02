import { module, test } from 'qunit';

import { convertToClassName } from '@cardstack/host/components/operator-mode/create-file-modal';

module('Unit | convertToClassName', function () {
  test('it removes invalid characters and provides a fallback', function (assert) {
    assert.strictEqual(convertToClassName('hey'), 'Hey');
    assert.strictEqual(convertToClassName('hey there'), 'HeyThere');

    assert.strictEqual(convertToClassName('hey!'), 'Hey');
    assert.strictEqual(convertToClassName('hé'), 'Hé');
    assert.strictEqual(convertToClassName('hey 😀'), 'Hey');

    assert.strictEqual(convertToClassName('123hey'), 'Hey');
    assert.strictEqual(convertToClassName('123'), 'Class123');
  });
});
