import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import WriteTextFileCommand from '@cardstack/host/commands/write-text-file';
import type CommandService from '@cardstack/host/services/command-service';
import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupNetworkService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;
let fetch: NetworkService['fetch'];

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | write-text-file', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = lookupLoaderService().loader;
    fetch = lookupNetworkService().fetch;
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      loader,
      contents: {},
    });
  });

  test('writes a text file', async function (assert) {
    let commandService = lookupService<CommandService>('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    const InputType = await writeTextFileCommand.getInputType();
    let input = new InputType({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    await writeTextFileCommand.execute(input);
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello!');
  });

  test('fails if the file already exists', async function (assert) {
    let commandService = lookupService<CommandService>('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    const InputType = await writeTextFileCommand.getInputType();

    let firstContents = new InputType({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    await writeTextFileCommand.execute(firstContents);
    let secondContents = new InputType({
      path: 'test.txt',
      content: 'Hello again!',
      realm: testRealmURL,
    });
    try {
      await writeTextFileCommand.execute(secondContents);
      assert.notOk(true, 'Should have thrown an error');
    } catch (error: any) {
      assert.ok(
        error.message.includes('File already exists'),
        'Error message should mention file exists',
      );
    }
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello!');
  });

  test('is able to overwrite a file', async function (assert) {
    let commandService = lookupService<CommandService>('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    const InputType = await writeTextFileCommand.getInputType();

    let firstContents = new InputType({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    await writeTextFileCommand.execute(firstContents);
    let secondContents = new InputType({
      path: 'test.txt',
      content: 'Hello again!',
      realm: testRealmURL,
      overwrite: true,
    });
    await writeTextFileCommand.execute(secondContents);
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello again!');
  });
});
