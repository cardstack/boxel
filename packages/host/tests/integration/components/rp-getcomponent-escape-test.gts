import 'ses';

import { waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CardRenderer from '@cardstack/host/components/card-renderer';

import {
  testRealmURL,
  testRRI,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef, Format } from '@cardstack/base/card-api';

// Regression for finding #1: an authored user-realm module can override the
// `static getComponent` class method it inherits from CardDef. That override
// method, but trusted-Base fallback must bind to the trusted ancestor's static
// rather than dispatch through that authored override.
//
// If the regression returns, the escape component appears in the Host
// document even though the requested format is owned by trusted Base. Keep the
// fixture Capsule-safe: ambient browser authority would correctly promote the
// module to Sandbox, where RP-6.5 intentionally refuses to de-escalate it to a
// Direct Base fallback (covered separately in rp-sandbox-test).
//
// The trigger is the trusted-base fallback: the card authors NO template for
// the requested format, so the renderer asks for a trusted Base slot.

const escapeSource = `
  import {
    CardDef,
    Component,
    contains,
    field,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import GlimmerComponent from '@glimmer/component';

  class HostEscapeComponent extends GlimmerComponent {
    get hostReach() {
      return 'authored-override-ran';
    }
    <template>
      <div data-test-getcomponent-escape data-test-owner={{this.hostReach}}>
        authored getComponent override executed in the Host document
      </div>
    </template>
  }

  export class Escape extends CardDef {
    static displayName = 'Escape';
    @field name = contains(StringField);

    // The card authors NO template for any format, so the renderer takes the
    // trusted-base fallback and calls this override to get the Base slot.
    static getComponent(_card, _field, _opts) {
      return HostEscapeComponent;
    }
  }
`;

async function renderThroughExecutionRenderer(card: BaseDef, format?: Format) {
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardRenderer @card={{card}} @format={{format}} @execution='auto' />
      </template>
    },
  );
}

module('Integration | rp-getcomponent-escape', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'escape.gts': escapeSource,
          'Escape/one.json': {
            data: {
              attributes: { name: 'pwned' },
              meta: {
                adoptsFrom: { module: testRRI('escape'), name: 'Escape' },
              },
            },
          },
        },
      }),
    );
  });

  test('RP-6.5: an authored static getComponent override cannot choose a Direct component', async function (assert) {
    let store = getService('store');
    let card = (await store.get(`${testRealmURL}Escape/one`)) as BaseDef;
    await renderThroughExecutionRenderer(card, 'isolated');
    await waitUntil(() =>
      document.querySelector('[data-boxel-execution="direct"]'),
    );

    assert
      .dom('[data-test-getcomponent-escape]')
      .doesNotExist(
        'the authored override never supplies the trusted Base component',
      );
    assert
      .dom('[data-boxel-execution="direct"]')
      .exists('the legitimate trusted Base fallback still renders in the Host');
  });
});
