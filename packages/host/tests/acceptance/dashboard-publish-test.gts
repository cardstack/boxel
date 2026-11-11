import { click, find, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';
import {
  realmURL,
  markPublishable,
  ownedRealmURL,
  pressKey,
  setupDashboardTest,
  setupMoreWorkspaces,
  sharedRealmURL,
} from '../helpers/dashboard';

const PUBLISH_MODAL = '[data-test-publish-realm-modal]';

function tile(name: string) {
  return `[data-test-workspace-list] [data-test-workspace="${name}"]`;
}

async function openMenu(name: string) {
  await click(`${tile(name)} [data-test-workspace-menu-trigger]`);
}

module('Acceptance | dashboard publish', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks);
  setupMoreWorkspaces(hooks, mockMatrixUtils);

  test("a publishable workspace's Publish opens it in host mode, with the publish dialog open", async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor(tile('Workspace B'));
    markPublishable(ownedRealmURL);
    await settled();

    await openMenu('Workspace B');
    await click('[data-test-boxel-menu-item-text="Publish"]');
    await waitFor(PUBLISH_MODAL);

    assert.dom('[data-test-dashboard]').doesNotExist('the dashboard closes');
    assert.dom('[data-test-host-submode]').exists();
    assert.dom(PUBLISH_MODAL).containsText('workspace-b/');
    assert.dom(PUBLISH_MODAL).hasAttribute('aria-label', 'Publish Workspace B');

    // The dialog takes focus, and Escape closes it. The focus trap moves
    // focus after a timeout that settled() doesn't track.
    await waitUntil(
      () => find(PUBLISH_MODAL)?.contains(document.activeElement),
      { timeoutMessage: 'focus never moved into the dialog' },
    );
    await pressKey('Escape');
    assert.dom(PUBLISH_MODAL).doesNotExist();
    assert.dom('[data-test-host-submode]').exists('host mode stays');
    await waitUntil(
      () => document.activeElement === find('[data-test-publish-realm-button]'),
      { timeoutMessage: 'focus never moved to the publish button' },
    );
    assert
      .dom('[data-test-publish-realm-button]')
      .isFocused("focus lands on host mode's publish button");
  });

  test('Publish opens the chosen workspace, even when host mode had another one open', async function (assert) {
    await visitOperatorMode({
      submode: 'host',
      trail: [`${realmURL}index`],
      workspaceChooserOpened: true,
    });
    await waitFor(tile('Workspace B'));
    markPublishable(ownedRealmURL);
    await settled();

    await openMenu('Workspace B');
    await click('[data-test-boxel-menu-item-text="Publish"]');
    await waitFor(PUBLISH_MODAL);

    assert.dom(PUBLISH_MODAL).containsText('workspace-b/');
    assert
      .dom(PUBLISH_MODAL)
      .doesNotContainText('workspace-a/', "not the earlier workspace's");
  });

  test("a workspace that isn't publishable has no Publish", async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor(tile('Workspace B'));
    markPublishable(realmURL);
    await settled();

    await openMenu('Workspace B');

    assert.dom('[data-test-boxel-menu-item-text="Realm Settings"]').exists();
    assert.dom('[data-test-boxel-menu-item-text="Publish"]').doesNotExist();
  });

  test('a publishable workspace shared with the user with write offers Publish, though someone else owns it', async function (assert) {
    const sharedWriteRealmURL = 'http://test-realm/otheruser/workspace-d/';
    await setupAcceptanceTestRealm({
      realmURL: sharedWriteRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write'],
        '@otheruser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace D' }),
      },
    });
    mockMatrixUtils.setRealmSessionPermissions(sharedWriteRealmURL, [
      'read',
      'write',
    ]);
    mockMatrixUtils.setActiveRealms([
      realmURL,
      ownedRealmURL,
      sharedRealmURL,
      sharedWriteRealmURL,
    ]);
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor(tile('Workspace D'));
    markPublishable(sharedWriteRealmURL);
    await settled();

    await openMenu('Workspace D');

    assert.dom('[data-test-boxel-menu-item-text="Publish"]').exists();
  });

  test('a publishable workspace the user may only read has no Publish', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await waitFor(tile('Workspace C'));
    markPublishable(sharedRealmURL);
    await settled();

    await openMenu('Workspace C');

    assert.dom('[data-test-boxel-menu-item-text="Realm Settings"]').exists();
    assert.dom('[data-test-boxel-menu-item-text="Publish"]').doesNotExist();
  });
});
