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

  test('useNonConflictingFilename writes to a new file when content exists', async function (assert) {
    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await cardService.saveSource(
      new URL('test.txt', testRealmURL),
      'Already here',
      'create-file',
    );

    let result = await writeTextFileCommand.execute({
      path: 'test.txt',
      content: 'Hello!',
      realm: testRealmURL,
      useNonConflictingFilename: true,
    });

    assert.strictEqual(result.fileUrl, `${testRealmURL}test-1.txt`);

    let originalResponse = await fetch(new URL('test.txt', testRealmURL));
    let originalContent = await originalResponse.text();
    assert.strictEqual(originalContent, 'Already here');

    let newResponse = await fetch(new URL('test-1.txt', testRealmURL));
    let newContent = await newResponse.text();
    assert.strictEqual(newContent, 'Hello!');
  });

  test('useNonConflictingFilename reuses an existing blank file', async function (assert) {
    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await cardService.saveSource(
      new URL('empty.txt', testRealmURL),
      '',
      'create-file',
    );

    let result = await writeTextFileCommand.execute({
      path: 'empty.txt',
      content: '',
      realm: testRealmURL,
      useNonConflictingFilename: true,
    });

    assert.strictEqual(result.fileUrl, `${testRealmURL}empty.txt`);

    let { status, content } = await cardService.getSource(
      new URL('empty.txt', testRealmURL),
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(content, '');

    let nonConflicting = await cardService.getSource(
      new URL('empty-1.txt', testRealmURL),
    );
    assert.strictEqual(nonConflicting.status, 404);
  });

  test('useNonConflictingFilename writes into an existing blank file when content is provided', async function (assert) {
    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let writeTextFileCommand = new WriteTextFileCommand(
      commandService.commandContext,
    );
    await cardService.saveSource(
      new URL('empty.txt', testRealmURL),
      '',
      'create-file',
    );

    let result = await writeTextFileCommand.execute({
      path: 'empty.txt',
      content: 'Now filled',
      realm: testRealmURL,
      useNonConflictingFilename: true,
    });

    assert.strictEqual(result.fileUrl, `${testRealmURL}empty.txt`);

    let { status, content } = await cardService.getSource(
      new URL('empty.txt', testRealmURL),
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(content, 'Now filled');
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
