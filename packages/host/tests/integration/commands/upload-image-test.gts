import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type UploadImageCommand from '@cardstack/catalog/commands/upload-image';

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
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
        },
        loader,
      });
      return {};
    },
  });

  let lastForwardPayload: any;
  let forwardPayloads: any[] = [];
  let lastDirectUploadRequest:
    | {
        url: string;
        formData: FormData;
      }
    | undefined;
  let networkService: NetworkService;
  let directUploadFetchHandler:
    | ((request: Request) => Promise<Response | null>)
    | undefined;

  const directUploadResponse = {
    success: true,
    errors: [],
    result: {
      id: 'direct-upload-id',
      uploadURL: 'https://upload.imagedelivery.net/direct-upload-url',
    },
  };

  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (request: Request) => {
        const body = await request.json();
        lastForwardPayload = body;
        forwardPayloads.push(body);

        let responsePayload;
        if (
          body.url ===
          'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload'
        ) {
          responsePayload = directUploadResponse;
        } else {
          responsePayload = {
            success: true,
            errors: [],
            result: {
              id: 'cloudflare-image-id',
            },
          };
        }

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ]);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    snapshot.get();
    getOwner(this)!.register('service:realm', StubRealmService);
    lastForwardPayload = undefined;
    forwardPayloads = [];
    lastDirectUploadRequest = undefined;
    directUploadFetchHandler = async (request: Request) => {
      if (
        request.url === 'https://upload.imagedelivery.net/direct-upload-url'
      ) {
        const formData = await request.formData();
        lastDirectUploadRequest = {
          url: request.url,
          formData,
        };
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: {
              id: 'cloudflare-direct-upload-id',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return null;
    };
    networkService = getService('network');
    networkService.virtualNetwork.mount(directUploadFetchHandler, {
      prepend: true,
    });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
      },
    });
  });

  hooks.afterEach(function () {
    if (directUploadFetchHandler) {
      networkService.virtualNetwork.unmount(directUploadFetchHandler);
      directUploadFetchHandler = undefined;
    }
  });

  test('uploads image via Cloudflare and saves CloudflareImage card', async function (assert) {
    assert.expect(7);

    const commandService = getService('command-service');
    const loaderService = getService('loader-service');
    const loader = loaderService.loader;
    const UploadImageCommandClass: typeof UploadImageCommand = (
      (await loader.import('@cardstack/catalog/commands/upload-image')) as {
        default: typeof UploadImageCommand;
      }
    ).default;
    const command = new UploadImageCommandClass(commandService.commandContext);

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

  test('performs direct upload when source is a blob URL', async function (assert) {
    assert.expect(12);

    const commandService = getService('command-service');
    const loaderService = getService('loader-service');
    const loader = loaderService.loader;
    const UploadImageCommandClass: typeof UploadImageCommand = (
      (await loader.import('@cardstack/catalog/commands/upload-image')) as {
        default: typeof UploadImageCommand;
      }
    ).default;
    const command = new UploadImageCommandClass(commandService.commandContext);

    const fileBlob = new Blob(['fake image bytes'], { type: 'image/png' });
    const file =
      typeof File === 'function'
        ? new File([fileBlob], 'photo.png', { type: 'image/png' })
        : (Object.assign(fileBlob, { name: 'photo.png' }) as Blob & {
            name: string;
          });
    const objectUrl = URL.createObjectURL(file);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      } else {
        url = String(input);
      }

      if (url.startsWith('blob:')) {
        return new Response(file, {
          status: 200,
          headers: {
            'Content-Type': file.type,
          },
        });
      }

      return originalFetch(input as RequestInfo, init);
    };

    try {
      const result = await command.execute({
        sourceImageUrl: objectUrl,
        targetRealmUrl: testRealmURL,
      });

      assert.ok(result, 'command returns a result');
      assert.ok(result.cardId, 'result card contains an id');

      assert.strictEqual(
        forwardPayloads.length,
        1,
        'proxy invoked only for direct upload URL request',
      );

      const [directUploadCall] = forwardPayloads;
      assert.strictEqual(
        directUploadCall.url,
        'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload',
        'first proxy call requests direct upload URL',
      );
      assert.true(
        directUploadCall.multipart,
        'direct upload URL request is sent as multipart form-data',
      );

      assert.ok(lastDirectUploadRequest, 'direct upload performed via fetch');
      assert.strictEqual(
        lastDirectUploadRequest?.url,
        'https://upload.imagedelivery.net/direct-upload-url',
        'direct upload posts to provided upload URL',
      );

      const fileEntry = lastDirectUploadRequest?.formData.get('file');
      assert.ok(fileEntry, 'form data includes file field');
      const uploadedFile = fileEntry as Blob;
      assert.strictEqual(uploadedFile.type, 'image/png');

      const directUploadPayload = JSON.parse(directUploadCall.requestBody);
      assert.false(
        directUploadPayload.requireSignedURLs,
        'direct upload request specifies default signing behaviour',
      );

      const expectedBytes = new Uint8Array(await file.arrayBuffer());
      const uploadedBytes = new Uint8Array(await uploadedFile.arrayBuffer());
      assert.deepEqual(
        Array.from(uploadedBytes),
        Array.from(expectedBytes),
        'uploaded file contents match source blob',
      );

      const store = getService('store');
      const savedCard = store.peek(result.cardId!);
      assert.strictEqual(
        (savedCard as any).cloudflareId,
        'cloudflare-direct-upload-id',
        'saved card uses id returned by direct upload',
      );
    } finally {
      globalThis.fetch = originalFetch;
      URL.revokeObjectURL(objectUrl);
    }
  });

  test('performs direct upload when source is a data URI', async function (assert) {
    assert.expect(12);

    const commandService = getService('command-service');
    const loaderService = getService('loader-service');
    const loader = loaderService.loader;
    const UploadImageCommandClass: typeof UploadImageCommand = (
      (await loader.import('@cardstack/catalog/commands/upload-image')) as {
        default: typeof UploadImageCommand;
      }
    ).default;
    const command = new UploadImageCommandClass(commandService.commandContext);

    const payloadString = 'fake image bytes';
    const nodeBuffer = (globalThis as any).Buffer as
      | {
          from(
            input: string,
            encoding?: string,
          ): { toString(encoding: string): string };
        }
      | undefined;
    const base64Payload = nodeBuffer
      ? nodeBuffer.from(payloadString, 'utf-8').toString('base64')
      : btoa(payloadString);
    const dataUri = `data:image/png;base64,${base64Payload}`;

    const result = await command.execute({
      sourceImageUrl: dataUri,
      targetRealmUrl: testRealmURL,
    });

    assert.ok(result, 'command returns a result');
    assert.ok(result.cardId, 'result card contains an id');

    assert.strictEqual(
      forwardPayloads.length,
      1,
      'proxy invoked only for direct upload URL request',
    );

    const [directUploadCall] = forwardPayloads;
    assert.strictEqual(
      directUploadCall.url,
      'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload',
      'proxy call requests direct upload URL',
    );
    assert.true(
      directUploadCall.multipart,
      'direct upload URL request is sent as multipart form-data',
    );

    assert.ok(lastDirectUploadRequest, 'direct upload performed via fetch');
    assert.strictEqual(
      lastDirectUploadRequest?.url,
      'https://upload.imagedelivery.net/direct-upload-url',
      'direct upload posts to provided upload URL',
    );

    const fileEntry = lastDirectUploadRequest?.formData.get('file');
    assert.ok(fileEntry, 'form data includes file field');
    const uploadedFile = fileEntry as File;
    assert.strictEqual(uploadedFile.type, 'image/png');
    assert.strictEqual(uploadedFile.name, 'upload.png');

    const expectedBytes = nodeBuffer
      ? new Uint8Array(nodeBuffer.from(payloadString, 'utf-8') as any)
      : Uint8Array.from(payloadString, (char) => char.charCodeAt(0));
    const uploadedBytes = new Uint8Array(await uploadedFile.arrayBuffer());
    assert.deepEqual(
      Array.from(uploadedBytes),
      Array.from(expectedBytes),
      'uploaded file contents match data URI payload',
    );

    const store = getService('store');
    const savedCard = store.peek(result.cardId!);
    assert.strictEqual(
      (savedCard as any).cloudflareId,
      'cloudflare-direct-upload-id',
      'saved card uses id returned by direct upload',
    );
  });
});
