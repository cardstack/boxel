import { module, test } from 'qunit';

import {
  createSandboxToolContext,
  installSandboxToolCompatibilityModules,
} from '@cardstack/host/lib/sandbox-tool-compatibility';

interface ShimTarget {
  shimModule(identifier: string, value: Record<string, unknown>): void;
}

module('Unit | Sandbox tool compatibility', function () {
  test('SaveCardCommand delegates only with the projected token', async function (assert) {
    let modules = new Map<string, Record<string, unknown>>();
    let loader: ShimTarget = {
      shimModule(identifier: string, value: Record<string, unknown>) {
        modules.set(identifier, value);
      },
    };
    let calls: { card: unknown; realm?: string }[] = [];
    let compatibility = installSandboxToolCompatibilityModules(loader, {
      async saveCard(card, realm) {
        calls.push({ card, ...(realm ? { realm } : {}) });
        return card;
      },
    });
    let saveModule = modules.get('@cardstack/boxel-host/tools/save-card')!;
    let SaveCardCommand = saveModule.SaveCardCommand as new (
      context: object,
    ) => { execute(input: unknown): Promise<unknown> };
    let card = { id: 'https://realm.example/Example/one' };

    let command = new SaveCardCommand(compatibility.toolContext);
    assert.strictEqual(
      await command.execute({ card, realm: 'https://realm.example/' }),
      card,
      'the compatibility command returns the saved child instance',
    );
    assert.deepEqual(calls, [{ card, realm: 'https://realm.example/' }]);

    let unauthorized = new SaveCardCommand({});
    await assert.rejects(
      unauthorized.execute({ card }),
      /requires the projected Boxel tool context/,
      'inventing a context does not grant the save capability',
    );
  });

  test('both deployed Host tool spellings resolve to the same facade', function (assert) {
    let modules = new Map<string, Record<string, unknown>>();
    let loader: ShimTarget = {
      shimModule(identifier: string, value: Record<string, unknown>) {
        modules.set(identifier, value);
      },
    };
    installSandboxToolCompatibilityModules(loader, {
      async saveCard(card) {
        return card;
      },
    });

    assert.strictEqual(
      modules.get('@cardstack/boxel-host/tools/save-card'),
      modules.get('@cardstack/boxel-host/commands/save-card'),
      'tools and commands imports receive one trusted facade',
    );
    assert.strictEqual(
      modules.get('https://packages/@cardstack/boxel-host/tools/save-card'),
      modules.get('@cardstack/boxel-host/tools/save-card'),
      'the Loader-resolved package URL is covered too',
    );
  });

  test('the facade overrides both the Loader and its package transport', function (assert) {
    let loaderModules = new Map<string, Record<string, unknown>>();
    let transportModules = new Map<string, Record<string, unknown>>();
    let loader: ShimTarget = {
      shimModule(identifier, value) {
        loaderModules.set(identifier, value);
      },
    };
    let transport: ShimTarget = {
      shimModule(identifier, value) {
        transportModules.set(identifier, value);
      },
    };

    installSandboxToolCompatibilityModules([transport, loader], {
      async saveCard(card) {
        return card;
      },
    });

    let identifier = '@cardstack/boxel-host/tools/save-card';
    assert.strictEqual(
      transportModules.get(identifier),
      loaderModules.get(identifier),
      'a pre-existing Host package shim cannot bypass the Sandbox facade',
    );
  });

  test('a context token created before bootstrap remains the facade identity', async function (assert) {
    let modules = new Map<string, Record<string, unknown>>();
    let loader: ShimTarget = {
      shimModule(identifier, value) {
        modules.set(identifier, value);
      },
    };
    let toolContext = createSandboxToolContext();
    let card = { id: 'https://realm.example/Example/one' };

    let compatibility = installSandboxToolCompatibilityModules(
      loader,
      {
        async saveCard(value) {
          return value;
        },
      },
      toolContext,
    );
    let SaveCardCommand = modules.get('@cardstack/boxel-host/tools/save-card')!
      .default as new (context: object) => {
      execute(input: unknown): Promise<unknown>;
    };

    assert.strictEqual(
      compatibility.toolContext,
      toolContext,
      'the provider and facade share the pre-bootstrap token',
    );
    assert.strictEqual(
      await new SaveCardCommand(toolContext).execute({ card }),
      card,
      'the synchronous provider token authorizes the installed facade',
    );
  });
});
