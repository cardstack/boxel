import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import OpenSecureWindowTool from '@cardstack/host/tools/open-secure-window';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  getRealmServerRoute,
  OAUTH_DISCOVERY_PATH,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { setupApplicationTest } from '../helpers/setup';
import { stubWindowOpen } from '../helpers/window-open';

const ME = '@testuser:localhost';

// How the realm server answers its OAuth provider's discovery document: the
// document while the provider's flag is on, and 404 while it's off. Each
// answer is given in turn, the last one from then on.
type DiscoveryAnswer =
  | 'on'
  | 'off'
  | 'html'
  | 'other-issuer'
  | 'unavailable'
  | 'throttled';

function answer(kind: DiscoveryAnswer): Response {
  let issuer = new URL(ENV.realmServerURL).origin;
  switch (kind) {
    case 'on':
      return Response.json({
        issuer,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      });
    case 'other-issuer':
      return Response.json({ issuer: 'https://elsewhere.example' });
    case 'html':
      return new Response('<!doctype html><title>Boxel</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    case 'unavailable':
      return new Response(null, { status: 503 });
    case 'throttled':
      return new Response(null, { status: 429 });
    case 'off':
      return new Response(null, { status: 404 });
  }
}

function stubDiscovery(...answers: DiscoveryAnswer[]) {
  let reads = 0;
  // The mock's own route (provider off), put back when the test is done.
  let standing = getRealmServerRoute(
    new URL(OAUTH_DISCOVERY_PATH, 'http://mock/'),
  )!;
  registerRealmServerRoute({
    path: OAUTH_DISCOVERY_PATH,
    handler: async (req) => {
      if (req.method !== 'GET') {
        return null;
      }
      let kind = answers[Math.min(reads, answers.length - 1)];
      reads++;
      return answer(kind);
    },
  });
  return {
    get reads() {
      return reads;
    },
    restore: () => registerRealmServerRoute(standing),
  };
}

module('Acceptance | Connected apps', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: ME,
    activeRealms: [testRealmURL],
  });

  let discovery: ReturnType<typeof stubDiscovery> | undefined;
  let connectedAppsPage = new URL(
    'connected-apps',
    `${ENV.secureOriginURL.replace(/\/+$/, '')}/`,
  ).href;

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'realm.json': realmConfigCardJSON({ name: 'Research Notes' }),
      },
    });
  });

  hooks.afterEach(function () {
    discovery?.restore();
    discovery = undefined;
  });

  async function openProfileMenu() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await click('[data-test-profile-icon-button]');
    await waitFor('[data-test-profile-popover]');
  }

  async function closeProfileMenu() {
    await click('[data-test-profile-icon-button]');
  }

  test('with the provider flag on, the profile menu opens Connected apps in the secure window', async function (assert) {
    discovery = stubDiscovery('on');
    let windowOpen = stubWindowOpen(window);
    await openProfileMenu();
    await waitFor('[data-test-profile-connected-apps-button]');
    assert
      .dom('[data-test-profile-connected-apps-button]')
      .hasText('Connected apps');
    assert
      .dom('[data-test-profile-api-keys-button]')
      .exists('the menu’s other items stay');

    await click('[data-test-profile-connected-apps-button]');
    assert.deepEqual(
      windowOpen.calls.map((call) => call.url),
      [connectedAppsPage],
      'the secure origin’s Connected apps page opens, told nothing',
    );
  });

  test('with the provider flag off, the profile menu has no Connected apps', async function (assert) {
    discovery = stubDiscovery('off');
    await openProfileMenu();
    await waitUntil(() => discovery!.reads > 0);
    await waitUntil(() => getService('oauth-provider').isOn !== undefined);
    assert.dom('[data-test-profile-connected-apps-button]').doesNotExist();
    assert.dom('[data-test-profile-api-keys-button]').exists();
  });

  test('an answer that isn’t this realm server’s discovery document leaves Connected apps out', async function (assert) {
    for (let kind of ['html', 'other-issuer'] as const) {
      discovery?.restore();
      discovery = stubDiscovery(kind);
      getService('oauth-provider').isOn = undefined;
      await openProfileMenu();
      await waitUntil(() => discovery!.reads > 0);
      await waitUntil(() => getService('oauth-provider').isOn !== undefined);
      assert
        .dom('[data-test-profile-connected-apps-button]')
        .doesNotExist(`no item when the answer is ${kind}`);
      await closeProfileMenu();
    }
  });

  test('the item is in the profile menu as soon as it opens', async function (assert) {
    discovery = stubDiscovery('on');
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await waitUntil(() => getService('oauth-provider').isOn !== undefined);
    assert.strictEqual(discovery.reads, 1, 'asked before the menu opened');

    await click('[data-test-profile-icon-button]');
    assert
      .dom('[data-test-profile-connected-apps-button]')
      .exists('no wait for the realm server once the menu is open');
  });

  for (let kind of ['unavailable', 'throttled'] as const) {
    test(`a realm server that can’t answer (${kind}) is asked again when the menu opens`, async function (assert) {
      discovery = stubDiscovery(kind, 'on');
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
      });
      await waitUntil(() => discovery!.reads === 1);
      assert.strictEqual(
        getService('oauth-provider').isOn,
        undefined,
        'nothing is remembered from an answer that isn’t definite',
      );

      await click('[data-test-profile-icon-button]');
      await waitFor('[data-test-profile-connected-apps-button]');
      assert.strictEqual(discovery.reads, 2, 'asked again');

      await closeProfileMenu();
      await click('[data-test-profile-icon-button]');
      await waitFor('[data-test-profile-connected-apps-button]');
      assert.strictEqual(discovery.reads, 2, 'a definite answer is kept');
    });
  }

  test('the tool opens Connected apps only while the provider flag is on', async function (assert) {
    discovery = stubDiscovery('off');
    let windowOpen = stubWindowOpen(window);
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    let { toolContext } = getService('tool-service');
    let tool = new OpenSecureWindowTool(toolContext);
    await assert.rejects(
      tool.execute({ mode: 'connected-apps' }),
      /Connected apps is not available/,
      'refused while the provider is off',
    );
    assert.strictEqual(windowOpen.calls.length, 0, 'no window opened');

    discovery.restore();
    discovery = stubDiscovery('on');
    getService('oauth-provider').isOn = undefined;
    let result = await tool.execute({
      mode: 'connected-apps',
      reason: 'Disconnect the old laptop',
      realm: testRealmURL,
    });
    assert.strictEqual(result.status, 'opened');
    assert.deepEqual(
      windowOpen.calls.map((call) => call.url),
      [connectedAppsPage],
      'opened with nothing the caller wrote, and no reason',
    );
  });

  test('the tool asks for another try when the realm server can’t answer', async function (assert) {
    discovery = stubDiscovery('unavailable');
    let windowOpen = stubWindowOpen(window);
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await waitUntil(() => discovery!.reads > 0);
    let { toolContext } = getService('tool-service');
    let tool = new OpenSecureWindowTool(toolContext);
    await assert.rejects(
      tool.execute({ mode: 'connected-apps' }),
      /Could not check whether Connected apps is available.*Try again/,
      'told to try again, not that the server has no Connected apps',
    );
    assert.strictEqual(windowOpen.calls.length, 0, 'no window opened');

    discovery.restore();
    discovery = stubDiscovery('on');
    let result = await tool.execute({ mode: 'connected-apps' });
    assert.strictEqual(result.status, 'opened', 'the next try asks again');
    assert.deepEqual(
      windowOpen.calls.map((call) => call.url),
      [connectedAppsPage],
    );
  });

  test('the tool opens Connected apps without asking the realm server when the answer is known', async function (assert) {
    discovery = stubDiscovery('on');
    let windowOpen = stubWindowOpen(window);
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await waitUntil(() => getService('oauth-provider').isOn === true);
    let readsBefore = discovery.reads;
    let { toolContext } = getService('tool-service');
    let tool = new OpenSecureWindowTool(toolContext);
    let result = await tool.execute({ mode: 'connected-apps' });
    assert.strictEqual(result.status, 'opened');
    assert.strictEqual(
      discovery.reads,
      readsBefore,
      'the realm server is not asked again',
    );
    assert.deepEqual(
      windowOpen.calls.map((call) => call.url),
      [connectedAppsPage],
    );
  });
});
