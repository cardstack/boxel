import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
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

module('Integration | commands | upload-image', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let lastForwardPayload: any;

  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (request: Request) => {
        const body = await request.json();
        lastForwardPayload = body;

        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: {
              id: 'cloudflare-image-id',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    lastForwardPayload = undefined;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
      },
    });
  });

  test('uploads image via Cloudflare and saves CloudflareImage card', async function (assert) {
    assert.expect(7);

    const commandService = getService('command-service');
    const loaderService = getService('loader-service');
    const loader = loaderService.loader;
    const UploadImageCommand = (
      await loader.import('@cardstack/catalog/commands/upload-image')
    ).default;
    const command = new UploadImageCommand(commandService.commandContext);

    const result = await command.execute({
      sourceImageUrl: 'https://example.com/photo.jpg',
      targetRealmUrl: testRealmURL,
    });

    assert.ok(result, 'command returns a result card');
    assert.ok(result.cardId, 'result card contains a card id');

    assert.strictEqual(
      lastForwardPayload.url,
      'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v1',
      'requests are forwarded to Cloudflare upload endpoint',
    );
    assert.true(lastForwardPayload.multipart, 'request is sent as multipart');

    const store = getService('store');
    const savedCard = store.peek(result.cardId!);
    assert.ok(savedCard, 'saved card can be retrieved from the store');
    assert.strictEqual(
      (savedCard as any).cloudflareId,
      'cloudflare-image-id',
      'saved card has expected Cloudflare id',
    );
    assert.strictEqual(
      (savedCard as any).url,
      'https://imagedelivery.net/TB1OM65i5Go9UkT2wcBzeA/cloudflare-image-id/public',
      'computed URL uses expected Cloudflare delivery format',
    );
  });
});
