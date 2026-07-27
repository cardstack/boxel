import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  testRealmInfo,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// The Workspace edit format drives hosting through the registered
// publish-realm / unpublish-realm host tools, imported from card code as
// `@cardstack/boxel-host/tools/*`. These tests are the end-to-end check on that
// wiring: a click in a base-realm card has to reach the realm-server service.
const publishedRealmURL = 'https://testuser.localhost/published-workspace/';

const workspaceIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/workspace',
        name: 'Workspace',
      },
    },
  },
};

module('Acceptance | workspace hosting', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupBaseRealm(hooks);

  let publishCalls: { sourceRealmURL: string; publishedRealmURL: string }[];
  let unpublishCalls: string[];

  hooks.beforeEach(async function () {
    setupUserSubscription();
    publishCalls = [];
    unpublishCalls = [];

    let { realm } = await setupAcceptanceTestRealm({
      realmURL: testRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Hosted Workspace' }),
        'index.json': workspaceIndex,
      },
    });

    // `publishedSites` reads the card's own `meta.realmInfo`, which the realm
    // injects at request time from the realm_registry publish rows. There are
    // none in this harness, so serve the published state directly.
    realm.getRealmInfo = async () => ({
      ...testRealmInfo,
      name: 'Hosted Workspace',
      publishable: true,
      lastPublishedAt: { [publishedRealmURL]: String(Date.now()) },
    });

    let realmServer = getService('realm-server');
    realmServer.publishRealm = async (
      sourceRealmURL: string,
      publishedURL: string,
    ) => {
      publishCalls.push({ sourceRealmURL, publishedRealmURL: publishedURL });
      return {
        sourceRealmURL,
        publishedRealmURL: publishedURL,
        publishedRealmId: '1',
        lastPublishedAt: String(Date.now()),
        status: 'published',
      };
    };
    realmServer.unpublishRealm = async (publishedURL: string) => {
      unpublishCalls.push(publishedURL);
      return {
        sourceRealmURL: null,
        publishedRealmURL: publishedURL,
        lastPublishedAt: null,
      };
    };
    // publish() polls readiness after the 202; nothing here depends on the
    // wait, so report ready immediately.
    realmServer.waitForRealmReady = async () => {};
  });

  async function visitWorkspaceSettings() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'edit' }]],
    });
    await waitFor('.settings-title');
  }

  test('the hosting section lists each published site', async function (assert) {
    await visitWorkspaceSettings();

    assert
      .dom(`[data-test-unpublish-site="${publishedRealmURL}"]`)
      .exists('the published site offers an unpublish action')
      .hasText('Unpublish');
  });

  test('Unpublish reaches the unpublish-realm tool', async function (assert) {
    await visitWorkspaceSettings();

    await click(`[data-test-unpublish-site="${publishedRealmURL}"]`);
    await waitUntil(() => unpublishCalls.length > 0);

    assert.deepEqual(
      unpublishCalls,
      [publishedRealmURL],
      'the tool unpublished exactly the clicked destination',
    );
  });

  test('Republish reaches the publish-realm tool', async function (assert) {
    await visitWorkspaceSettings();

    await click('.publish-btn:not(.unpublish-btn)');
    await waitUntil(() => publishCalls.length > 0);

    assert.deepEqual(
      publishCalls,
      [{ sourceRealmURL: testRealmURL, publishedRealmURL }],
      'the tool republished the existing destination',
    );
  });
});
