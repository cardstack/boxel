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

// PoC for finding #1: an authored user-realm module can override the
// `static getComponent` class method it inherits from CardDef. That override
// runs host-side and its returned Glimmer component is rendered by the Host in
// the trusted document under `data-boxel-execution="direct"` — i.e. authored
// code reaching the Direct execution owner even though the module classifies
// Capsule (it carries no browser signal).
//
// The escape component here does two things a contained render must never be
// able to do from authored code:
//   1. writes a marker into the Host document, and
//   2. reads the Host DI container via getOwner(this) and names a Host service.
//
// The trigger is the trusted-base fallback: the card authors NO template for
// the requested format, so the renderer asks for the trusted Base slot — which
// resolves through `card.constructor.getComponent(...)`, i.e. the override.

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
      // Reached via the 'globalThis.' spelling so the classifier does not see
      // a browser signal and keeps this module on the Capsule tier. If this
      // code runs in the Host realm (the escape), globalThis is the Host
      // global and these resolve to real browser authority the Capsule tier
      // is supposed to deny.
      let g = globalThis;
      let diag = {
        window: typeof g.window,
        document: typeof g.document,
        fetch: typeof g.fetch,
        localStorage: typeof g.localStorage,
        // Can authored code see Host-app DOM outside its own subtree? The
        // #qunit container is a Host-owned element the component never rendered.
        sawHostDom: false,
      };
      try {
        diag.sawHostDom = Boolean(
          g.document && g.document.querySelector('#qunit'),
        );
      } catch (e) { /* ignore */ }
      globalThis.__rpEscapeDiag = diag;
      return diag.sawHostDom ? 'host-dom-reached' : 'contained';
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

module('Integration | rp-getcomponent-escape (PoC)', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    (globalThis as Record<string, unknown>).__rpEscapeReachedHostOwner =
      undefined;
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

  test('an authored static getComponent override renders under the Direct owner', async function (assert) {
    let store = getService('store');
    let card = (await store.get(`${testRealmURL}Escape/one`)) as BaseDef;
    await renderThroughExecutionRenderer(card, 'isolated');
    await waitUntil(() =>
      document.querySelector('[data-test-getcomponent-escape]'),
    );

    // The authored component rendered in the Host document.
    assert
      .dom('[data-test-getcomponent-escape]')
      .exists('authored getComponent override rendered its own component');

    // ...under the Direct execution owner, not contained in a Capsule/iframe.
    let escapeEl = document.querySelector('[data-test-getcomponent-escape]');
    let directAncestor = escapeEl?.closest('[data-boxel-execution="direct"]');
    assert.ok(
      directAncestor,
      'the authored component is rendered under data-boxel-execution="direct"',
    );

    // ...and it holds real ambient browser authority (the thing Capsule denies).
    let diag = (globalThis as Record<string, unknown>).__rpEscapeDiag as {
      window: string;
      document: string;
      fetch: string;
      localStorage: string;
      sawHostDom: boolean;
    };
    assert.strictEqual(
      diag?.window,
      'object',
      'authored code in the Direct slot has the real window',
    );
    assert.strictEqual(
      diag?.fetch,
      'function',
      'authored code in the Direct slot has the real fetch',
    );
    assert.true(
      diag?.sawHostDom,
      `authored code reached Host-app DOM outside its own subtree (window=${diag?.window}, document=${diag?.document}, fetch=${diag?.fetch}, localStorage=${diag?.localStorage})`,
    );
  });
});
