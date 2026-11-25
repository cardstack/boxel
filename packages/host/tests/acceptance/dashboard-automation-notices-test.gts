import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { SupportedMimeType, testRealmInfo } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import { visitOperatorMode } from '../helpers';
import { setupDashboardTest } from '../helpers/dashboard';
import {
  getRealmServerRoute,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';

const realmAURL = 'http://test-realm/testuser/workspace-a/';
const realmBURL = 'http://test-realm/testuser/workspace-b/';
const NOTICES_PATH = '/_automation-notices';

const cardsGridIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      },
    },
  },
};

// A notice as the realm server lists it to the user: the automation, its
// realm and why the automation needs the user.
function notice(realm: string, name: string, reason: string) {
  return {
    type: 'automation-notice',
    id: `${realm}automations/${name}`,
    attributes: {
      realm,
      reason,
      audience: 'payer',
      forViewer: true,
      run: null,
      operation: null,
      credential: null,
    },
  };
}

module('Acceptance | dashboard automation notices', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks, {
    matrix: {
      loggedInAs: '@testuser:localhost',
      activeRealms: [realmAURL, realmBURL],
    },
    realms: [
      {
        url: realmAURL,
        name: 'Workspace A',
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: realmBURL,
        name: 'Workspace B',
        contents: { 'index.json': cardsGridIndex },
      },
    ],
  });

  let listed: ReturnType<typeof notice>[] = [];
  let reads = 0;
  let standing: ReturnType<typeof getRealmServerRoute>;

  hooks.beforeEach(function () {
    listed = [];
    reads = 0;
    standing = getRealmServerRoute(new URL(NOTICES_PATH, 'http://mock/'));
    registerRealmServerRoute({
      path: NOTICES_PATH,
      handler: async (req) => {
        if (req.method !== 'GET') {
          return null;
        }
        reads++;
        return new Response(
          JSON.stringify({ data: listed, meta: { total: listed.length } }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
      },
    });
  });

  hooks.afterEach(function () {
    if (standing) {
      registerRealmServerRoute(standing);
    }
  });

  const tileOf = (realm: string) =>
    `[data-test-workspace-list] [data-test-workspace-menu-trigger="${realm}"]`;

  test('a workspace with automations that need the user carries the count on its options button and on Realm Settings', async function (assert) {
    listed = [
      notice(realmAURL, 'nightly', 'repeated-failures'),
      notice(realmAURL, 'weekly', 'waiting-for-credits'),
    ];
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor('[data-test-workspace-automation-notices="2"]');

    let badged = [
      ...document.querySelectorAll('[data-test-workspace-automation-notices]'),
    ];
    assert.ok(badged.length > 0, 'a workspace is badged');
    for (let element of badged) {
      assert.strictEqual(
        element
          .closest('[data-test-workspace]')
          ?.getAttribute('data-test-workspace'),
        'Workspace A',
        'only Workspace A is badged',
      );
    }
    let badge = badged[0];
    assert
      .dom(badge.querySelector('[data-test-pretui-badge-mark]'))
      .hasText('2', 'the workspace icon shows the count');
    assert
      .dom(badge.querySelector('[data-test-pretui-badge-spoken]'))
      .hasText(
        '2 automations need attention',
        'the count says what the count means',
      );

    await click(tileOf(realmAURL));
    assert
      .dom('[data-test-realm-settings-automation-notices]')
      .hasAttribute('data-test-realm-settings-automation-notices', '2')
      .containsText('automations need attention');
  });

  test('a workspace with no automation notices is not badged', async function (assert) {
    listed = [notice(realmAURL, 'nightly', 'waiting-for-key-approval')];
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor('[data-test-workspace-automation-notices="1"]');
    await click(tileOf(realmBURL));
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('Workspace B’s menu has Realm Settings');
    assert
      .dom('[data-test-realm-settings-automation-notices]')
      .doesNotExist('with no count after it');
  });

  test('an automation realm event reads the notices again, and a fixed problem clears the badges', async function (assert) {
    listed = [notice(realmAURL, 'nightly', 'payer-lost-access')];
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor('[data-test-workspace-automation-notices="1"]');
    let before = reads;

    listed = [];
    mockMatrixUtils.simulateRemoteMessage(
      mockMatrixUtils.getRoomIdForRealmAndUser(
        realmAURL,
        '@testuser:localhost',
      ),
      testRealmInfo.realmUserId!,
      {
        eventName: 'automation',
        automation: `${realmAURL}automations/nightly`,
        realmURL: realmAURL,
      },
      { type: APP_BOXEL_REALM_EVENT_TYPE },
    );
    await waitUntil(() => reads > before);
    await settled();
    assert
      .dom('[data-test-workspace-automation-notices]')
      .doesNotExist('the badge goes once the notice ends');
  });
});
