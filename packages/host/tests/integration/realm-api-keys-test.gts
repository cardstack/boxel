import { settled, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, SupportedMimeType } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  realmConfigCardJSON,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  registerRealmServerRoute,
  unregisterRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

const CONFIG = `${testRealmURL}realm`;
const noop = () => {};

// The API Keys entry asks for a realm's shares only in a live render. The
// indexer's render is prerendered HTML that everyone who can read the realm is
// served, so it must neither ask for nor draw a direct writer's view of them.
module('Integration | realm config | API Keys render', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  let listings = 0;

  hooks.beforeEach(function () {
    listings = 0;
    registerRealmServerRoute({
      path: '/_key-shares',
      handler: async (req) => {
        if (req.method !== 'GET') {
          return null;
        }
        listings++;
        return new Response(
          JSON.stringify({
            data: [
              {
                type: 'key-share',
                id: '00000000-0000-4000-8000-000000000001',
                attributes: {
                  realm: testRealmURL,
                  label: 'OpenAI',
                  owner: '@testuser:localhost',
                  state: 'active',
                  suspensionReason: null,
                  suspendedBy: null,
                  suspendedAt: null,
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
        );
      },
    });
  });

  hooks.afterEach(function () {
    unregisterRealmServerRoute('/_key-shares');
  });

  async function renderConfig() {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Research Notes' }),
      },
    });
    await getService('realm').login(testRealmURL);
    getService('operator-mode-state-service').restore({
      stacks: [[{ id: CONFIG, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${CONFIG}"]`);
  }

  test('a live render asks for the shares and draws them', async function (assert) {
    await renderConfig();
    await waitFor(
      '[data-test-realm-api-keys-section] [data-test-realm-key-share]',
    );
    assert.true(listings > 0, 'the listing was asked for');
    assert.dom('[data-test-realm-key-share="OpenAI"]').exists();
  });

  test('a view inside the element the indexer renders into asks nothing', async function (assert) {
    // The same render context, naming the element this test renders into, so
    // the config card is the indexer's render.
    let context = globalThis as {
      __boxelRenderContext?: unknown;
      __boxelRenderContextScope?: unknown;
    };
    context.__boxelRenderContext = true;
    context.__boxelRenderContextScope = 'ember-testing';
    try {
      await renderConfig();
      await settled();
      assert
        .dom('[data-test-realm-config-isolated]')
        .exists('the config card rendered');
      assert.strictEqual(listings, 0, 'but the shares were not asked for');
      assert.dom('[data-test-realm-api-keys-section]').doesNotExist();
      assert.dom('[data-test-realm-key-share]').doesNotExist();
    } finally {
      delete context.__boxelRenderContext;
      delete context.__boxelRenderContextScope;
    }
  });
});
