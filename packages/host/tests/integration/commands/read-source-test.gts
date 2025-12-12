import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ReadSourceCommand from '@cardstack/host/commands/read-source';

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

module('Integration | commands | read-source', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  let readSourceCommand: ReadSourceCommand;
  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'component.gts': `import Component from '@glimmer/component';\n\nexport default class TestComponent extends Component {}`,
      },
    });
    let commandService = getService('command-service');
    readSourceCommand = new ReadSourceCommand(commandService.commandContext);
  });

  test('reads a GTS file as card source', async function (assert) {
    let result = await readSourceCommand.execute({
      path: 'component.gts',
      realm: testRealmURL,
    });

    assert.strictEqual(
      result.content,
      `import Component from '@glimmer/component';\n\nexport default class TestComponent extends Component {}`,
    );
  });

  test('uses card source accept header for requests', async function (assert) {
    let targetUrl = `${testRealmURL}component.gts`;
    let network = getService('network');
    let originalFetch = network.virtualNetwork.fetch;
    let acceptHeader: string | null = null;
    let stubFetch: typeof originalFetch = async (input, init) => {
      let request = input instanceof Request ? input : new Request(input, init);
      if (request.url === targetUrl) {
        acceptHeader = request.headers.get('Accept');
        return new Response('stubbed source', { status: 200 });
      }
      return originalFetch(input, init);
    };
    network.virtualNetwork.fetch = stubFetch;
    try {
      await readSourceCommand.execute({
        path: 'component.gts',
        realm: testRealmURL,
      });
    } finally {
      network.virtualNetwork.fetch = originalFetch;
    }
    assert.strictEqual(acceptHeader, 'application/vnd.card+source');
  });
});
