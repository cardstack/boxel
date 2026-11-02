import { render, waitFor } from '@ember/test-helpers';

import { CardDef, contains, field } from '@cardstack/base/card-api';
import SiteRoutesPanel from '@cardstack/base/site-routes-panel';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class Product extends CardDef {
  static displayName = 'Product';
  @field handle = contains(StringField);
}

class Bundle extends CardDef {
  static displayName = 'Bundle';
  @field handle = contains(StringField);
}

function product(handle: string, name: string) {
  return {
    data: {
      attributes: { handle, cardInfo: { name } },
      meta: {
        adoptsFrom: { module: `${testRealmURL}product`, name: 'Product' },
      },
    },
  };
}

module('Integration | site routes panel', function (hooks) {
  let loader: Loader;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'product.gts': { Product, Bundle },
        'Bundle/kit.json': {
          data: {
            attributes: { handle: 'driver', cardInfo: { name: 'Driver kit' } },
            meta: {
              adoptsFrom: { module: `${testRealmURL}product`, name: 'Bundle' },
            },
          },
        },
        'Product/a.json': product('driver', 'Driver'),
        'Product/b.json': product('putter', 'Putter'),
        'Product/c.json': product('putter', 'Putter, left-handed'),
        'Product/d.json': product('', 'Unnamed thing'),
      },
    });
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  function pageType(path: string, name = 'Product') {
    return {
      name: `${name}s`,
      sourceRealm: testRealmURL,
      cardType: { module: `${testRealmURL}product`, name },
      path,
      sort: JSON.stringify([{ by: 'cardTitle', direction: 'asc' }]),
    };
  }

  async function renderPanel(
    site: Record<string, unknown>,
    routingRules: Record<string, unknown>[] = [],
  ) {
    let store = getService('store');
    let context = { getCards: store.getSearchResource.bind(store) };
    await render(
      <template>
        <SiteRoutesPanel
          @site={{site}}
          @routingRules={{routingRules}}
          @realmURL={{testRealmURL}}
          @context={{context}}
        />
      </template>,
    );
  }

  test('each page type shows the addresses its cards get', async function (assert) {
    await renderPanel({ pageTypes: [pageType('/shop/{handle}')] });
    await waitFor('[data-test-site-routes-example]');
    let examples = [
      ...document.querySelectorAll('[data-test-site-routes-example]'),
    ].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    assert.deepEqual(examples, [
      'Driver /shop/driver',
      'Putter /shop/putter',
      'Putter, left-handed /shop/putter',
      'Unnamed thing no address',
    ]);
    assert
      .dom('[data-test-site-routes-template]')
      .hasText('/shop/{handle}', 'the template is shown');
  });

  test('it says which cards share an address and which have none', async function (assert) {
    await renderPanel({ pageTypes: [pageType('/shop/{handle}')] });
    await waitFor('[data-test-site-routes-shared]');
    assert
      .dom('[data-test-site-routes-shared]')
      .includesText('/shop/putter is the address of 2 cards')
      .includesText('Putter, Putter, left-handed');
    assert
      .dom('[data-test-site-routes-without-address]')
      .includesText('1 of the first 4 cards have no address');
  });

  test('a problem with the settings shows as the owner edits', async function (assert) {
    await renderPanel({ pageTypes: [pageType('/shop/{handle')] });
    assert
      .dom('[data-test-site-routes-problems]')
      .includesText('page type "Products": path:');
    assert
      .dom('[data-test-site-routes-example]')
      .doesNotExist('a page type with no valid template has no addresses');
    assert
      .dom('[data-test-site-routes-invalid-path]')
      .includesText('keeps serving these cards at their previous path');
  });

  test('an address an earlier page type serves is that one’s', async function (assert) {
    await renderPanel({
      pageTypes: [
        pageType('/shop/{handle}'),
        pageType('/shop/{handle}', 'Bundle'),
      ],
    });
    await waitFor('[data-test-site-routes-taken]');
    assert
      .dom(
        '[data-test-site-routes-page-type="Bundles"] [data-test-site-routes-taken]',
      )
      .includesText(
        "Driver kit isn't served: /shop/driver is Driver, from Products",
      );
    assert
      .dom(
        '[data-test-site-routes-page-type="Products"] [data-test-site-routes-taken]',
      )
      .doesNotExist('the page type the site tries first keeps its addresses');
  });

  test('realm.json’s fixed pages are listed, and come before page types', async function (assert) {
    await renderPanel({ pageTypes: [pageType('/shop/{handle}')] }, [
      {
        path: '/shop/driver/',
        instance: {
          id: `${testRealmURL}Landing/1`,
          cardTitle: 'Driver launch',
        },
      },
    ]);
    await waitFor('[data-test-site-routes-taken]');
    assert
      .dom('[data-test-site-routes-fixed]')
      .includesText('Driver launch')
      .includesText('/shop/driver');
    assert
      .dom('[data-test-site-routes-taken]')
      .includesText(
        "Driver isn't served: /shop/driver is Driver launch, from the fixed pages",
      );
  });
});
