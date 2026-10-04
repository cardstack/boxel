import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ViewVisuallyTool from '@cardstack/host/tools/view-visually';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
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

// A 1×1 PNG, so the capture the endpoint answers with decodes as an image.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

module('Integration | tools | view-visually', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let requests: any[];
  let respondWith: () => Response;
  // The capture the endpoint answers with; a test may swap in another image.
  let captureBase64 = PNG_BASE64;

  setupRealmServerEndpoints(hooks, [
    {
      route: '_capture',
      getResponse: async (req: Request) => {
        requests.push(await req.clone().json());
        return respondWith();
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  function ready(): Response {
    return new Response(
      JSON.stringify({
        data: {
          type: 'capture-result',
          attributes: {
            status: 'ready',
            base64: captureBase64,
            width: 1,
            height: 1,
            contentType: 'image/png',
            captures: [
              {
                name: null,
                url: null,
                width: 1,
                height: 1,
                deviceScaleFactor: null,
                base64: captureBase64,
              },
            ],
          },
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/vnd.api+json' },
      },
    );
  }

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    requests = [];
    respondWith = ready;
    captureBase64 = PNG_BASE64;
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'brand.html': '<!doctype html><h1>Brand</h1>',
          'config.json': '{ "theme": "dark" }',
          'pet.gts': `
            import { contains, field, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";
            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field firstName = contains(StringField);
            }
          `,
          'Pet/mango.json': {
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
        },
      }),
    );
    await getService('realm').login(testRealmURL);
  });

  function tool() {
    return new ViewVisuallyTool(getService('tool-service').toolContext);
  }

  test('a card is captured by its id, as an image attached to the result', async function (assert) {
    let result = await tool().execute({ url: `${testRealmURL}Pet/mango` });

    assert.strictEqual(requests.length, 1, 'one capture request');
    let attrs = requests[0].data.attributes;
    assert.strictEqual(attrs.cardId, `${testRealmURL}Pet/mango`);
    assert.strictEqual(attrs.fileURL, undefined);
    assert.strictEqual(attrs.realmURL, testRealmURL);
    assert.true(attrs.includeBase64, 'asks for the bytes');
    assert.deepEqual(attrs.captureSpec, {
      viewport: { width: 1280, height: 800 },
    });

    assert.strictEqual(result.kind, 'card');
    assert.strictEqual(result.format, 'isolated');
    assert.strictEqual(result.attachedImages.length, 1);
    let [image] = result.attachedImages;
    assert.strictEqual(image.contentType, 'image/png');
    assert.ok(image.url, 'the image is uploaded to the room');
    assert.notStrictEqual(
      image.url,
      image.sourceUrl,
      'the attachment points at the uploaded media, not its source',
    );
    assert.true((image.contentSize ?? 0) > 0, 'the image carries its size');
  });

  test('a workspace file is captured as a file', async function (assert) {
    let result = await tool().execute({
      url: `${testRealmURL}brand.html`,
      format: 'embedded',
      viewportWidth: 640,
      viewportHeight: 480,
    });

    let attrs = requests[0].data.attributes;
    assert.strictEqual(attrs.fileURL, `${testRealmURL}brand.html`);
    assert.strictEqual(attrs.cardId, undefined);
    assert.strictEqual(attrs.format, 'embedded');
    assert.deepEqual(attrs.captureSpec, {
      viewport: { width: 640, height: 480 },
    });
    assert.strictEqual(result.kind, 'file');
  });

  test("a card's .json is captured as the card, a plain JSON file as a file", async function (assert) {
    let card = await tool().execute({ url: `${testRealmURL}Pet/mango.json` });
    let file = await tool().execute({ url: `${testRealmURL}config.json` });

    assert.strictEqual(card.kind, 'card');
    assert.strictEqual(
      requests[0].data.attributes.cardId,
      `${testRealmURL}Pet/mango.json`,
    );
    assert.strictEqual(file.kind, 'file');
    assert.strictEqual(
      requests[1].data.attributes.fileURL,
      `${testRealmURL}config.json`,
    );
  });

  test('a capture taller than the edge bound keeps its width and is cut to its top', async function (assert) {
    let canvas = new OffscreenCanvas(1000, 9000);
    let context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(200, 40, 40)';
    context.fillRect(0, 0, 1000, 9000);
    let bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    captureBase64 = btoa(binary);

    let result = await tool().execute({
      url: `${testRealmURL}Pet/mango`,
      fullPage: true,
    });

    let [image] = result.attachedImages;
    assert.strictEqual(image.width, 1000, 'the width is kept');
    assert.strictEqual(image.height, 4096, 'the height is cut to the bound');
    assert.true(
      (image.contentSize ?? 0) <= 3.75 * 1024 * 1024,
      'the image fits what the prompt sends',
    );
    assert.strictEqual(
      result.note,
      'Only the top 4096px of the 9000px-tall capture is shown.',
    );
  });

  test('something outside every workspace is refused with what to do instead', async function (assert) {
    await assert.rejects(
      tool().execute({ url: 'https://example.com/page.html' }),
      /not in a workspace the user can read.*upload the file into a workspace/,
    );
    assert.strictEqual(requests.length, 0, 'no capture is attempted');
  });

  test('a file attached to the chat is refused with what to do instead', async function (assert) {
    await assert.rejects(
      tool().execute({ url: 'boxel-local://upload/brand.html' }),
      /attached image is visible to you in the turn it was sent.*attach a screenshot/,
    );
    assert.strictEqual(requests.length, 0, 'no capture is attempted');
  });

  test('a capture still rendering is retried after the server says when', async function (assert) {
    let calls = 0;
    respondWith = () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 503, headers: { 'retry-after': '1' } })
        : ready();
    };

    let result = await tool().execute({ url: `${testRealmURL}Pet/mango` });

    assert.strictEqual(requests.length, 2, 'retried once');
    assert.strictEqual(result.attachedImages.length, 1);
  });
});
