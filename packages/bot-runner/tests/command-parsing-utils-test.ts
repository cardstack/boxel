import { module, test } from 'qunit';
import { commandUrlToCodeRef } from '../lib/command-parsing-utils';

module('command parsing utils', () => {
  test('parses cardstack/boxel-host command specifier', async function (assert) {
    assert.deepEqual(commandUrlToCodeRef('cardstack/boxel-host/commands/show-card', undefined), {
      module: '@cardstack/boxel-host/commands/show-card',
      name: 'default',
    });
  });

  test('parses cardstack/boxel-host command specifier with explicit export', async function (assert) {
    assert.deepEqual(commandUrlToCodeRef('@cardstack/boxel-host/commands/show-card/execute', undefined), {
      module: '@cardstack/boxel-host/commands/show-card',
      name: 'execute',
    });
  });

  test('parses absolute /commands URL into realm code ref', async function (assert) {
    assert.deepEqual(
      commandUrlToCodeRef(
        'http://localhost:4200/commands/create-listing-pr/default',
        'http://localhost:4201/test/',
      ),
      {
        module: 'http://localhost:4201/test/commands/create-listing-pr',
        name: 'default',
      },
    );
  });

  test('returns undefined for unknown command formats', async function (assert) {
    assert.strictEqual(
      commandUrlToCodeRef('https://example.com/not-commands/create-listing-pr', 'http://localhost:4201/test/'),
      undefined,
    );
  });
});
