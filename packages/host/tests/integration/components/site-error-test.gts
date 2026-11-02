import { render, waitFor } from '@ember/test-helpers';

import { CardDef, Component } from '@cardstack/base/card-api';
import { module, test } from 'qunit';

import type { HostRouteSnapshot } from '@cardstack/runtime-common';

import SiteError from '@cardstack/host/components/host-mode/site-error';
import ENV from '@cardstack/host/config/environment';

import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class ErrorPage extends CardDef {
  static displayName = 'Error Page';
  static isolated = class Isolated extends Component<typeof ErrorPage> {
    <template>
      <p data-test-site-error-page>Something went wrong</p>
    </template>
  };
}

const failure = {
  id: `${testRealmURL}Product/broken`,
  status: 500,
  title: 'Render failed',
  message: 'this card cannot render',
  realm: testRealmURL,
  meta: {
    lastKnownGoodHtml: null,
    cardTitle: null,
    scopedCssUrls: [],
    stack: null,
  },
} as unknown as CardErrorJSONAPI;

module('Integration | site error', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let config = ENV as { hostRouteSnapshot?: HostRouteSnapshot };

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'error-page.gts': { ErrorPage },
        'ErrorPage/site.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}error-page`,
                name: 'ErrorPage',
              },
            },
          },
        },
      },
    });
  });

  hooks.afterEach(function () {
    delete config.hostRouteSnapshot;
  });

  test('a failed page shows the site’s error card', async function (assert) {
    config.hostRouteSnapshot = {
      realm: testRealmURL,
      mount: '/',
      pages: [],
      listings: [],
      errorCard: `${testRealmURL}ErrorPage/site`,
    };
    await render(<template><SiteError @error={{failure}} /></template>);
    await waitFor('[data-test-site-error-page]');
    assert.dom('[data-test-site-error-page]').hasText('Something went wrong');
    assert.dom('[data-test-card-error]').doesNotExist();
  });

  test('without an error card, a failed page shows its error', async function (assert) {
    await render(<template><SiteError @error={{failure}} /></template>);
    assert.dom('[data-test-site-error-page]').doesNotExist();
    assert.dom('[data-test-card-error]').exists();
  });
});
