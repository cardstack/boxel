import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ReadFileForAiAssistantCommand from '@cardstack/host/commands/read-file-for-ai-assistant';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | read-file-for-ai-assistant', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'files/test.txt': 'This is a test file for AI assistant.',
      },
    });
  });

  test('read file', async function (assert) {
    let commandService = getService('command-service');

    let command = new ReadFileForAiAssistantCommand(
      commandService.commandContext,
    );
    let result = await command.execute({
      fileUrl: `${testRealmURL}files/test.txt`,
    });
    assert.true(!!result.fileForAttachment.contentHash);
    assert.strictEqual(
      result.fileForAttachment.contentType,
      'text/plain; charset=utf-8',
    );
    assert.strictEqual(result.fileForAttachment.name, 'test.txt');
    assert.strictEqual(
      result.fileForAttachment.sourceUrl,
      `${testRealmURL}files/test.txt`,
    );
    assert.true(!!result.fileForAttachment.url);
  });
});
