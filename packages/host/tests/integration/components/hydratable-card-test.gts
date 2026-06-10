import {
  type RenderingTestContext,
  render,
  triggerEvent,
  click,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import { CardContextName, isCardInstance } from '@cardstack/runtime-common';

import HydratableCard from '@cardstack/host/components/card-search/hydratable-card';
import { htmlComponent } from '@cardstack/host/lib/html-component';
import ElementTracker from '@cardstack/host/resources/element-tracker';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../../helpers';
import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// Stands in for the operator-mode card context, publishing a real
// ElementTracker as the cardComponentModifier so a test can assert what the
// overlay would anchor to. Host mode / published views render HydratableCard
// with no such context.
interface OverlayContextSignature {
  Args: { tracker: ElementTracker };
  Blocks: { default: [] };
}
class OverlayContext extends GlimmerComponent<OverlayContextSignature> {
  @provide(CardContextName)
  get context() {
    return { cardComponentModifier: this.args.tracker.trackElement };
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

const HASSAN = `${testRealmURL}Person/hassan`;
const INERT_HTML = `<div class='inert' data-test-inert-card>Inert</div>`;

module('Integration | Component | hydratable-card', function (hooks) {
  let storeService: StoreService;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div class='live' data-test-live-card>
            Live:
            <@fields.name />
          </div>
        </template>
      };
    }

    storeService = getService('store');

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'Person/hassan.json': new Person({ name: 'Hassan' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  // (a) Host mode (no overlay): hover fetches links.self once, deposits the
  // card in the Store, and swaps the inert HTML for a live CardRenderer.
  test('host mode — hover hydrates the inert HTML into a live card', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <HydratableCard @cardId={{HASSAN}} @component={{inert}} @mode='hover' />
      </template>,
    );

    assert.dom('[data-test-inert-card]').exists('starts inert');
    assert.dom('[data-hydration="hover"]').exists('carries the hover gesture');
    assert.dom('[data-test-live-card]').doesNotExist('no live card yet');
    assert.notOk(
      isCardInstance(storeService.peek(HASSAN)),
      'the card is not in the Store before the gesture',
    );

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert.dom('[data-test-live-card]').hasText('Live: Hassan', 'now live');
    assert.dom('[data-test-inert-card]').doesNotExist('inert HTML is gone');
    assert
      .dom('[data-hydration="hover"]')
      .doesNotExist('the inert diagnostic is gone after the swap');
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'the card entered the Store',
    );
  });

  // (b) Published view (no overlay): the click gesture hydrates the same way,
  // with no operator-mode machinery present.
  test('published view — click hydrates the inert HTML into a live card', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <HydratableCard @cardId={{HASSAN}} @component={{inert}} @mode='click' />
      </template>,
    );

    assert.dom('[data-hydration="click"]').exists('carries the click gesture');
    assert.dom('[data-test-live-card]').doesNotExist('no live card yet');

    await click('[data-test-hydratable-card]');

    assert.dom('[data-test-live-card]').hasText('Live: Hassan', 'now live');
    assert.dom('[data-test-inert-card]').doesNotExist('inert HTML is gone');
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'the card entered the Store',
    );
  });

  // (c) Operator mode (overlay present): hydration and the overlay coexist —
  // the inert HTML registers with the ElementTracker, and the inert→live swap
  // re-registers the new element so the overlay re-anchors to the live card.
  test('operator mode — the swap re-registers the new element with the ElementTracker', async function (assert) {
    let tracker = new ElementTracker();
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <OverlayContext @tracker={{tracker}}>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </OverlayContext>
      </template>,
    );

    assert.strictEqual(
      tracker.elements.length,
      1,
      'the inert element is registered with the overlay tracker',
    );
    assert.strictEqual(
      tracker.elements[0].meta.cardId,
      HASSAN,
      'tracked by its card id',
    );
    let inertElement = tracker.elements[0].element;
    assert.dom(inertElement).hasClass('inert', 'the inert element is tracked');

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert.dom('[data-test-live-card]').hasText('Live: Hassan', 'hydrated');
    assert.strictEqual(
      tracker.elements.length,
      1,
      'still exactly one tracked element — re-registered, not doubled',
    );
    assert.notStrictEqual(
      tracker.elements[0].element,
      inertElement,
      'the tracked element is the new live element, not the discarded inert one',
    );
    assert.ok(
      isCardInstance(tracker.elements[0].meta.card),
      'the live card instance rides on the re-registered entry',
    );
  });

  // `none` stays inert with the diagnostic attribute and never fetches.
  test('none — stays inert, marks data-hydration=none, and never fetches', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <HydratableCard @cardId={{HASSAN}} @component={{inert}} @mode='none' />
      </template>,
    );

    assert.dom('[data-hydration="none"]').exists('marked none');

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert.dom('[data-test-inert-card]').exists('still inert after hover');
    assert.dom('[data-test-live-card]').doesNotExist('never went live');
    assert.notOk(
      isCardInstance(storeService.peek(HASSAN)),
      'no links.self fetch — the card never entered the Store',
    );
  });

  // An error rendering never hydrates, regardless of the requested gesture.
  test('error rows never hydrate', async function (assert) {
    let inert = htmlComponent(
      `<div class='inert' data-test-inert-card data-is-error='true'>Error</div>`,
    );
    await render(
      <template>
        <HydratableCard
          @cardId={{HASSAN}}
          @component={{inert}}
          @isError={{true}}
          @mode='hover'
        />
      </template>,
    );

    assert
      .dom('[data-hydration="none"]')
      .exists('an error row is forced to none regardless of @mode');

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert.dom('[data-test-inert-card]').exists('error rendering stays inert');
    assert.notOk(
      isCardInstance(storeService.peek(HASSAN)),
      'no fetch for an error row',
    );
  });

  hooks.afterEach(function () {
    getService('network').virtualNetwork.removeRealmMapping('@test-prefix/');
  });
});
