import type { SharedTests } from '../helpers/index.ts';
import {
  buildCommandFunctionNameFromResolvedRef,
  moduleForFunctionNameHash,
} from '../commands.ts';

const tests = Object.freeze({
  'a host tool ref hashes to the same functionName under either module spelling':
    async (assert) => {
      let legacy = buildCommandFunctionNameFromResolvedRef({
        module: '@cardstack/boxel-host/commands/switch-submode',
        name: 'default',
      });
      let renamed = buildCommandFunctionNameFromResolvedRef({
        module: '@cardstack/boxel-host/tools/switch-submode',
        name: 'default',
      });
      // The concrete value is asserted (not just equality) because it is
      // persisted: room-state tool definitions and skill content carry these
      // names, so a hash-input change is a breaking change, not a refactor.
      assert.strictEqual(legacy, 'switch-submode_dd88');
      assert.strictEqual(renamed, legacy);
    },

  'named exports also produce identical functionNames across spellings': async (
    assert,
  ) => {
    let legacy = buildCommandFunctionNameFromResolvedRef({
      module: '@cardstack/boxel-host/commands/realm-sync',
      name: 'SyncCommand',
    });
    let renamed = buildCommandFunctionNameFromResolvedRef({
      module: '@cardstack/boxel-host/tools/realm-sync',
      name: 'SyncCommand',
    });
    assert.strictEqual(renamed, legacy);
    assert.true(legacy.startsWith('SyncCommand_'));
  },

  'non-host modules hash verbatim': async (assert) => {
    assert.strictEqual(
      moduleForFunctionNameHash('https://realm/commands/my-command'),
      'https://realm/commands/my-command',
    );
    assert.strictEqual(
      moduleForFunctionNameHash('@cardstack/boxel-host/components/whatever'),
      '@cardstack/boxel-host/components/whatever',
    );
  },

  'a tools path that merely contains the prefix mid-string is not mapped':
    async (assert) => {
      assert.strictEqual(
        moduleForFunctionNameHash(
          'https://realm/@cardstack/boxel-host/tools/x',
        ),
        'https://realm/@cardstack/boxel-host/tools/x',
      );
    },
} as SharedTests<{}>);

export default tests;
