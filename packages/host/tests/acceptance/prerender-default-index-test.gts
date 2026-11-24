import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { RenderRouteOptions } from '@cardstack/runtime-common';

import type { Model as HtmlRouteModel } from '@cardstack/host/routes/render/html';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// The render route stores a placeholder for a realm's default index card
// (CardsGrid or Workspace) unless something asks for the full render. The
// index visits ask with `prerenderDefaultIndex` when the realm has a host URL.
module('Acceptance | prerender | default index card', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const renderPath = (options: RenderRouteOptions) =>
    `/render/${encodeURIComponent(
      `${testRealmURL}index.json`,
    )}/0/${encodeURIComponent(JSON.stringify(options))}/html/isolated/0`;

  function usesPlaceholder(): boolean | undefined {
    let route = getService('router').currentRoute;
    let model =
      route && 'attributes' in route
        ? (route.attributes as HtmlRouteModel | undefined)
        : undefined;
    return model?.useRealmIndexBoilerplate;
  }

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
  });

  test('the default index card renders as a placeholder when the render options do not ask for it in full', async function (assert) {
    await visit(renderPath({ clearCache: true }));
    assert.true(usesPlaceholder(), 'the route asks for the placeholder');
  });

  test('the default index card renders in full when the render options ask for it', async function (assert) {
    await visit(renderPath({ clearCache: true, prerenderDefaultIndex: true }));
    assert.false(usesPlaceholder(), 'the route asks for the full render');
  });
});
