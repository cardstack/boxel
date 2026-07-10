import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ReadFileForAiAssistantCommand from '@cardstack/host/tools/read-file-for-ai-assistant';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
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

module('Integration | tools | read-file-for-ai-assistant', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'files/test.txt': 'This is a test file for AI assistant.',
        },
      }),
    );
  });

  test('read file', async function (assert) {
    let toolService = getService('tool-service');

    let command = new ReadFileForAiAssistantCommand(toolService.commandContext);
    let result = await command.execute({
      fileIdentifier: `${testRealmURL}files/test.txt`,
    });
    assert.true(!!result.fileForAttachment.contentHash);
    assert.strictEqual(result.fileForAttachment.contentType, 'text/plain');
    assert.strictEqual(result.fileForAttachment.name, 'test.txt');
    assert.strictEqual(
      result.fileForAttachment.sourceUrl,
      `${testRealmURL}files/test.txt`,
    );
    assert.true(!!result.fileForAttachment.url);
  });
});
