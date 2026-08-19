import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';

import WorkspaceChooser from '@cardstack/host/components/operator-mode/workspace-chooser';
import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setRealmAuthFailure,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);

// The workspace chooser surfaces an unobtrusive notice naming any trusted
// realm server that couldn't be reached during boot assembly, so the user
// understands some workspaces may be missing. The notice clears once a retry
// recovers the server.
module(
  'Integration | workspace-chooser | unreachable realm server notice',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
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

    test('shows a notice naming the unreachable server, then clears it after a successful retry', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <WorkspaceChooser @topBarCenterElement={{null}} />
          </template>
        },
      );

      assert
        .dom('[data-test-unreachable-realm-servers-notice]')
        .exists('the notice is shown while the trusted server is unreachable');
      assert
        .dom('[data-test-unreachable-realm-servers-notice]')
        .containsText(
          new URL(testRealmServerURL).host,
          'the notice names the server',
        );

      // The server recovers; retrying assembly clears the notice.
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
