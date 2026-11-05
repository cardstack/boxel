import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';

import Dashboard from '@cardstack/host/components/operator-mode/dashboard';
import DashboardSections from '@cardstack/host/components/operator-mode/dashboard/sections';
import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setRealmAuthFailure,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);

// The dashboard names any trusted realm server it couldn't reach while
// assembling the realm list at boot, so the user knows some workspaces may be
// missing. The notice clears once a retry reaches the server.
module(
  'Integration | dashboard | unreachable realm server notice',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      // The trusted server is unreachable while boot assembles the realm list.
      setRealmAuthFailure(true);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('names the unreachable server, and clears once a retry reaches it', async function (assert) {
      let sections = new DashboardSections();
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><Dashboard @sections={{sections}} /></template>
        },
      );

      assert
        .dom('[data-test-unreachable-realm-servers-notice]')
        .exists('the notice shows while the trusted server is unreachable');
      assert
        .dom('[data-test-unreachable-realm-servers-notice]')
        .containsText(
          new URL(testRealmServerURL).host,
          'the notice names the server',
        );

      setRealmAuthFailure(false);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.retryUnreachableRealmServers();
      await settled();

      assert
        .dom('[data-test-unreachable-realm-servers-notice]')
        .doesNotExist('the notice clears once the server is reachable again');
    });
  },
);
