import { module, test } from 'qunit';

import { nestTopLevelAttributes } from '@cardstack/host/lib/matrix-classes/message-tool';

module('Unit | nest tool attributes', function () {
  test('nests fields a model sent at the top level', function (assert) {
    assert.deepEqual(
      nestTopLevelAttributes({
        description: 'Create the card',
        realm: 'https://localhost:4201/user/r/',
        roomId: '!room:localhost',
        code: 'return 1;',
      }),
      {
        description: 'Create the card',
        attributes: {
          realm: 'https://localhost:4201/user/r/',
          roomId: '!room:localhost',
          code: 'return 1;',
        },
      },
    );
  });

  test('leaves correctly nested and empty arguments alone', function (assert) {
    let nested = { description: 'x', attributes: { code: 'return 1;' } };
    assert.strictEqual(nestTopLevelAttributes(nested), nested);
    let onlyDescription = { description: 'x' };
    assert.strictEqual(
      nestTopLevelAttributes(onlyDescription),
      onlyDescription,
    );
    assert.strictEqual(nestTopLevelAttributes(undefined), undefined);
  });
});
