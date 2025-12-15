import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import WriteTextFileCommand from '@cardstack/host/commands/write-text-file';
import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let fetch: NetworkService['fetch'];

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }

  realmOfURL(url: URL) {
    // Recognize only the test realm URL as valid
    if (url.href === testRealmURL) {
      return url;
    }
    return undefined;
  }
}

module('Integration | commands | write-text-file', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    fetch = getService('network').fetch;
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
  });

  test('writes a text file', async function (assert) {
    let commandService = getService('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await writeTextFileCommand.execute({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello!');
  });

  test('fails if the file already exists', async function (assert) {
    let commandService = getService('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await writeTextFileCommand.execute({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    try {
      await writeTextFileCommand.execute({
        path: 'test.txt',
        content: 'Hello again!',
        realm: testRealmURL,
      });
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
    let commandService = getService('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await writeTextFileCommand.execute({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
    });
    await writeTextFileCommand.execute({
      path: 'test.txt',
      content: 'Hello again!',
      realm: testRealmURL,
      overwrite: true,
    });
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello again!');
  });

  test('handles a leading slash in the path', async function (assert) {
    let commandService = getService('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await writeTextFileCommand.execute({
      path: '/test.txt',
      content: 'Hello with slash!',
      realm: testRealmURL,
    });
    let response = await fetch(new URL('test.txt', testRealmURL));
    let content = await response.text();
    assert.strictEqual(content, 'Hello with slash!');
  });

  test('throws an error when an invalid realm is provided', async function (assert) {
    let commandService = getService('command-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    try {
      await writeTextFileCommand.execute({
        path: 'bad.txt',
        content: 'Nope',
        realm: 'https://not-a-known-realm.example/',
      });
      assert.notOk(true, 'Should have thrown an error for invalid realm');
    } catch (error: any) {
      assert.ok(
        error.message.includes('Invalid or unknown realm provided'),
        'Error message should mention invalid realm',
      );
    }
  });
});
