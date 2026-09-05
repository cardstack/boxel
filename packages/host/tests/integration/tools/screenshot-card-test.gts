import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ScreenshotCardTool from '@cardstack/host/tools/screenshot-card';

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

import type { CardDef } from '@cardstack/base/card-api';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

// The served URL a persisted (canonical) capture answers with.
const servedURL = `${testRealmURL}_screenshot/Pet/mango`;

interface CapturedRequest {
  authorization: string | null;
  method: string | null;
  pathname: string | null;
  body: any;
}

module('Integration | tools | screenshot-card', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let captured: CapturedRequest;
  // Each test sets the response the mocked endpoint should return.
  let respondWith: (req: Request) => Promise<Response>;

  setupRealmServerEndpoints(hooks, [
    {
      route: '_screenshot-card',
      getResponse: async (req: Request) => {
        captured.authorization = req.headers.get('Authorization');
        captured.method = req.method;
        captured.pathname = new URL(req.url).pathname;
        captured.body = await req.clone().json();
        return respondWith(req);
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  function readyResponse(attributes: Record<string, unknown>): Response {
    return new Response(
      JSON.stringify({
        data: { type: 'screenshot-card-result', attributes },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/vnd.api+json' },
      },
    );
  }

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    captured = {
      authorization: null,
      method: null,
      pathname: null,
      body: undefined,
    };
    respondWith = async () =>
      readyResponse({
        status: 'ready',
        width: 800,
        height: 600,
        contentType: 'image/png',
        captures: [
          {
            name: null,
            url: servedURL,
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
          },
        ],
      });

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
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

  async function getPet(): Promise<CardDef> {
    let store = getService('store');
    return (await store.get(`${testRealmURL}Pet/mango`)) as CardDef;
  }

  test('canonical capture posts format-only body with a realm-scoped JWT and returns the served URL', async function (assert) {
    let toolService = getService('tool-service');
    let realmServer = getService('realm-server');
    let command = new ScreenshotCardTool(toolService.toolContext);

    let result = await command.execute({
      card: await getPet(),
      format: 'isolated',
    });

    assert.strictEqual(captured.method, 'POST', 'uses POST');
    assert.strictEqual(
      captured.pathname,
      '/_screenshot-card',
      'hits the realm-server endpoint',
    );

    let attrs = captured.body?.data?.attributes;
    assert.strictEqual(
      attrs?.cardId,
      `${testRealmURL}Pet/mango`,
      'sends cardId',
    );
    assert.strictEqual(attrs?.realmURL, testRealmURL, 'sends realmURL');
    assert.strictEqual(attrs?.format, 'isolated', 'sends format');
    assert.false(
      attrs?.includeBase64,
      'a canonical capture opts out of base64 — it will get a served URL',
    );
    assert.strictEqual(
      attrs?.captureSpec,
      undefined,
      'no captureSpec is sent for a format-only capture',
    );

    // Realm-JWT auth: a realm-scoped token, not the realm-server session token.
    assert.ok(
      captured.authorization?.startsWith('Bearer '),
      'authorization uses Bearer scheme',
    );
    let payload = JSON.parse(
      atob(captured.authorization!.replace('Bearer ', '').split('.')[1]),
    ) as { realm?: string; permissions?: string[] };
    // A realm session token carries realm + permissions claims; a realm-server
    // session token carries neither.
    assert.ok(payload.realm, 'token is scoped to a realm');
    assert.ok(
      payload.permissions?.includes('read'),
      'token carries realm permissions',
    );
    assert.notStrictEqual(
      captured.authorization,
      `Bearer ${realmServer.token}`,
      'does not use the realm-server session token',
    );

    assert.strictEqual(result.captures.length, 1, 'one capture returned');
    assert.strictEqual(result.captures[0].url, servedURL, 'carries served URL');
    // The endpoint reports canonical captures unnamed; the tool synthesizes a
    // name (the rendered image's alt text) from the card title and format.
    assert.strictEqual(
      result.captures[0].name,
      'Untitled Pet (isolated)',
      'an unnamed capture gets a synthesized title + format name',
    );
  });

  test('capture-geometry primitives are folded into a nested captureSpec and still resolve to a served URL', async function (assert) {
    // A geometry capture persists under its own spec hash and serves on its
    // own durable URL — the query string carries the geometry.
    let geometryURL = `${servedURL}?dsf=2&viewport=800x600`;
    respondWith = async () =>
      readyResponse({
        status: 'ready',
        width: 1600,
        height: 1200,
        contentType: 'image/png',
        captures: [
          {
            name: null,
            url: geometryURL,
            width: 1600,
            height: 1200,
            deviceScaleFactor: 2,
          },
        ],
      });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    let result = await command.execute({
      card: await getPet(),
      format: 'embedded',
      viewportWidth: 800,
      viewportHeight: 600,
      deviceScaleFactor: 2,
    });

    let attrs = captured.body?.data?.attributes;
    assert.false(
      attrs?.includeBase64,
      'the tool never asks for bytes — only the served URL',
    );
    assert.deepEqual(
      attrs?.captureSpec,
      {
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 2,
      },
      'flat primitives are reassembled into the nested captureSpec',
    );

    assert.strictEqual(
      result.captures[0].url,
      geometryURL,
      'a geometry capture returns its own durable served URL',
    );
  });

  test('a clip region is sent only when all four edges are provided', async function (assert) {
    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await command.execute({
      card: await getPet(),
      format: 'isolated',
      clipX: 0,
      clipY: 10,
      clipWidth: 400,
      clipHeight: 300,
    });
    assert.deepEqual(
      captured.body?.data?.attributes?.captureSpec,
      { clip: { x: 0, y: 10, width: 400, height: 300 } },
      'the clip is assembled from the four edge primitives',
    );
  });

  test('a half-specified viewport is rejected before any request', async function (assert) {
    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({
        card: await getPet(),
        format: 'isolated',
        viewportWidth: 800,
      }),
      /viewportWidth and viewportHeight must be provided together/,
    );
    assert.strictEqual(captured.method, null, 'no request was made');
  });

  test('a partial clip region is rejected before any request', async function (assert) {
    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({
        card: await getPet(),
        format: 'isolated',
        clipX: 0,
        clipWidth: 400,
      }),
      /clipX, clipY, clipWidth, and clipHeight must be provided together/,
    );
    assert.strictEqual(captured.method, null, 'no request was made');
  });

  test('an invalid format is rejected before any request', async function (assert) {
    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card: await getPet(), format: 'fitted' }),
      /Format must be "isolated" or "embedded"/,
    );
    assert.strictEqual(captured.method, null, 'no request was made');
  });

  // A publicly-readable realm can pass the read guard (public reads need no
  // auth) while holding no session token — the tool must mint one, since the
  // endpoint rejects an unauthenticated POST.
  test('a missing realm session is minted before the request', async function (assert) {
    let realm = getService('realm');
    let realToken = realm.token;
    let loginCalls: string[] = [];
    let minted = false;
    let card = await getPet();
    realm.token = (url: string) => (minted ? realToken(url) : undefined);
    realm.login = async (realmURL: string) => {
      loginCalls.push(realmURL);
      minted = true;
    };
    // The mint is gated on a Matrix client being available; pin the gate
    // open so this test exercises the mint independent of harness wiring.
    Object.defineProperty(getService('realm-server'), 'hasClient', {
      value: true,
    });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    let result = await command.execute({ card, format: 'isolated' });

    assert.deepEqual(
      loginCalls,
      [testRealmURL],
      'the card realm session is minted',
    );
    assert.ok(
      captured.authorization?.startsWith('Bearer '),
      'the request carries the minted bearer',
    );
    assert.strictEqual(
      result.captures[0].url,
      servedURL,
      'capture succeeds after the mint',
    );
  });

  test('a realm session that cannot be minted fails clearly before any request', async function (assert) {
    let realm = getService('realm');
    let card = await getPet();
    realm.token = () => undefined;
    // A login that resolves without minting — the login task swallows its
    // failure and leaves the token unset.
    realm.login = async () => {};
    Object.defineProperty(getService('realm-server'), 'hasClient', {
      value: true,
    });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card, format: 'isolated' }),
      /no session for realm/,
    );
    assert.strictEqual(captured.method, null, 'no request was made');
  });

  // Minting a session awaits the Matrix client, so on a page that never
  // starts one the login would wait indefinitely — the tool must skip the
  // mint entirely and fail with the clear no-session error instead.
  test('with no Matrix client, no mint is attempted and the failure is clear', async function (assert) {
    let realm = getService('realm');
    let realmServer = getService('realm-server');
    let card = await getPet();
    realm.token = () => undefined;
    let loginCalls = 0;
    realm.login = async () => {
      loginCalls++;
    };
    Object.defineProperty(realmServer, 'hasClient', { value: false });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card, format: 'isolated' }),
      /no session for realm/,
    );
    assert.strictEqual(loginCalls, 0, 'no mint was attempted');
    assert.strictEqual(captured.method, null, 'no request was made');
  });

  test('a job that resolves un-ready surfaces its error detail', async function (assert) {
    respondWith = async () =>
      readyResponse({
        status: 'error',
        error: 'render failed: card threw during isolated render',
        captures: [],
      });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card: await getPet(), format: 'isolated' }),
      /Screenshot job did not produce a PNG: render failed: card threw during isolated render/,
    );
  });

  test('a capture that could not persist fails with the unpersisted message', async function (assert) {
    respondWith = async () =>
      readyResponse({
        status: 'ready',
        width: 800,
        height: 600,
        contentType: 'image/png',
        captures: [
          {
            name: null,
            url: null,
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
          },
        ],
      });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card: await getPet(), format: 'isolated' }),
      /could not be persisted .*retry once indexing completes/,
    );
  });

  test('a 503 timeout surfaces as a retryable error', async function (assert) {
    respondWith = async () =>
      new Response(null, { status: 503, headers: { 'retry-after': '3' } });

    let command = new ScreenshotCardTool(
      getService('tool-service').toolContext,
    );
    await assert.rejects(
      command.execute({ card: await getPet(), format: 'isolated' }),
      /still rendering; retry after 3s/,
    );
  });
});
