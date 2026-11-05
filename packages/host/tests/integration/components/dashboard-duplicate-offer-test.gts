import { click, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { ri, SKILLS_REALM_PREFIX } from '@cardstack/runtime-common';

import Workspace from '@cardstack/host/components/operator-mode/dashboard/workspace';

import {
  realmConfigCardJSON,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  skillsRealmURL,
  testRealmURL,
} from '../../helpers';
import { setupFeatureFlag } from '../../helpers/feature-flags';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const DUPLICATE = '[data-test-boxel-menu-item-text="Duplicate Workspace"]';

// A workspace receives its realm in whichever form the caller holds, so the
// skills realm is recognized by its prefix as well as by its URL.
module('Integration | dashboard | Duplicate Workspace offer', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupFeatureFlag(hooks, 'DASHBOARD_V2');

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: skillsRealmURL,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Boxel Skills' }),
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
      },
    });
  });

  async function openMenuFor(realmIdentifier: string) {
    let id = ri(realmIdentifier);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Workspace @realmIdentifier={{id}} @variant='tile' />
        </template>
      },
    );
    let trigger = `[data-test-workspace-menu-trigger="${realmIdentifier}"]`;
    await waitFor(trigger);
    await click(trigger);
  }

  test('the skills realm named by its prefix offers Duplicate Workspace', async function (assert) {
    await openMenuFor(SKILLS_REALM_PREFIX);
    assert.dom(DUPLICATE).exists();
  });

  test('another realm does not offer Duplicate Workspace', async function (assert) {
    await openMenuFor(testRealmURL);
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the menu is open');
    assert.dom(DUPLICATE).doesNotExist();
  });
});
