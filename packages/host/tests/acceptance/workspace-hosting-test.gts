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

  test('a site that is unpublished stops being listed as live', async function (assert) {
    await visitWorkspaceSettings();

    await click(`[data-test-unpublish-site="${publishedRealmURL}"]`);

    assert
      .dom(`[data-test-unpublish-site="${publishedRealmURL}"]`)
      .doesNotExist('the row for the unpublished destination is gone');
    assert
      .dom('[data-test-republish]')
      .doesNotExist('Republish goes away with the last destination');
    assert
      .dom('[data-test-hosting-error]')
      .doesNotExist('no error is reported');
    assert
      .dom('.settings')
      .containsText(
        'Not published',
        'the section falls back to its not-published copy',
      );
  });

  test('an unpublish the server rejects keeps the row and says so', async function (assert) {
    let realmServer = getService('realm-server');
    realmServer.unpublishRealm = async () => {
      throw new Error('destination is locked');
    };

    await visitWorkspaceSettings();
    await click(`[data-test-unpublish-site="${publishedRealmURL}"]`);

    assert
      .dom('[data-test-hosting-error]')
      .hasText(
        'Could not unpublish testuser.localhost: destination is locked',
        'the failure the tool reported is surfaced',
      );
    assert
      .dom(`[data-test-unpublish-site="${publishedRealmURL}"]`)
      .exists('the site is still listed, because it is still published');
  });

  test('Republish reaches the publish-realm tool', async function (assert) {
    await visitWorkspaceSettings();

    await click('[data-test-republish]');
    await waitUntil(() => publishCalls.length > 0);

    assert.deepEqual(
      publishCalls,
      [{ sourceRealmURL: testRealmURL, publishedRealmURL }],
      'the tool republished the existing destination',
    );
    assert
      .dom(`[data-test-unpublish-site="${publishedRealmURL}"]`)
      .exists('the destination is still listed after a republish');
  });

  test('either hosting action disables the other while it runs', async function (assert) {
    let releaseUnpublish: (() => void) | undefined;
    let realmServer = getService('realm-server');
    let stalledUnpublish = realmServer.unpublishRealm;
    realmServer.unpublishRealm = async (publishedURL: string) => {
      await new Promise<void>((resolve) => (releaseUnpublish = resolve));
      return stalledUnpublish.call(realmServer, publishedURL);
    };

    await visitWorkspaceSettings();

    // Not awaited yet: the buttons have to be inspected while the request is
    // still in flight, which is exactly what settling would wait past.
    let clicked = click(`[data-test-unpublish-site="${publishedRealmURL}"]`);
    await waitUntil(() => releaseUnpublish !== undefined);
    await waitFor('[data-test-republish]:disabled');

    assert
      .dom('[data-test-republish]')
      .isDisabled('Republish cannot put the site back mid-unpublish');
    assert
      .dom(`[data-test-unpublish-site="${publishedRealmURL}"]`)
      .isDisabled('the in-flight destination cannot be unpublished twice');

    releaseUnpublish!();
    await clicked;
    assert.deepEqual(
      unpublishCalls,
      [publishedRealmURL],
      'the unpublish completed once released',
    );
  });
});
