import {
  type RenderingTestContext,
  render,
  settled,
  triggerEvent,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  CardContextName,
  GetCardContextName,
  isCardInstance,
  isFileDefInstance,
  type Realm,
} from '@cardstack/runtime-common';

import HydratableCard from '@cardstack/host/components/card-search/hydratable-card';
import { htmlComponent } from '@cardstack/host/lib/html-component';
import { getCard } from '@cardstack/host/resources/card-resource';
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

// Provides the contexts HydratableCard consumes: `getCard` (always, the way the
// route does) and — only when a tracker is passed — the operator-mode
// `cardComponentModifier` via CardContext. Host mode / published views render
// with no overlay, modeled by omitting the tracker (CardContext stays absent).
interface TestContextSignature {
  Args: { tracker?: ElementTracker };
  Blocks: { default: [] };
}
class TestContext extends GlimmerComponent<TestContextSignature> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }
  @provide(CardContextName)
  get cardContext() {
    return this.args.tracker
      ? { cardComponentModifier: this.args.tracker.trackElement }
      : undefined;
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

const HASSAN = `${testRealmURL}Person/hassan`;
const INERT_HTML = `<div class='inert' data-test-inert-card>Inert</div>`;

// Drives a mount/unmount toggle so a teardown test can destroy the rendered
// HydratableCard and assert it releases its Store reference.
class Toggle {
  @tracked show = true;
}

module('Integration | Component | hydratable-card', function (hooks) {
  let storeService: StoreService;
  let testRealm: Realm;

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

    ({ realm: testRealm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'Person/hassan.json': new Person({ name: 'Hassan' }),
      },
    }));
    await getService('realm').login(testRealmURL);
  });

  // (a) Host mode (no overlay): hover fetches links.self once, deposits the
  // card in the Store, and swaps the inert HTML for a live CardRenderer.
  test('host mode — hover hydrates the inert HTML into a live card', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
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
    assert
      .dom('[data-hydration="hydrated"]')
      .exists(
        'the diagnostic flips to hydrated on the live render (lands on the card container, no wrapper needed)',
      );
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'the card entered the Store',
    );
  });

  // Hover mode treats keyboard focus the same as pointer hover: a `focusin`
  // hydrates exactly like `mouseenter`, so keyboard users reach the live card
  // too. (`focusin` bubbles, so focus landing inside the card subtree counts.)
  test('host mode — keyboard focus hydrates the inert HTML, same as hover', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
      </template>,
    );

    assert.dom('[data-test-inert-card]').exists('starts inert');
    assert.dom('[data-test-live-card]').doesNotExist('no live card yet');

    await triggerEvent('[data-test-hydratable-card]', 'focusin');

    assert
      .dom('[data-test-live-card]')
      .hasText('Live: Hassan', 'focus hydrates the same as hover');
    assert.dom('[data-test-inert-card]').doesNotExist('inert HTML is gone');
    assert
      .dom('[data-hydration="hydrated"]')
      .exists('the diagnostic flips to hydrated on focus');
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'the card entered the Store',
    );
  });

  // (b) Operator mode (overlay present): hydration and the overlay coexist —
  // the inert HTML registers with the ElementTracker, and the inert→live swap
  // re-registers the new element so the overlay re-anchors to the live card.
  test('operator mode — the swap re-registers the new element with the ElementTracker', async function (assert) {
    let tracker = new ElementTracker();
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext @tracker={{tracker}}>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
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
    // The live CardRenderer registers itself through the card context, so the
    // re-registered entry carries the live card instance.
    assert.ok(
      isCardInstance(tracker.elements[0].meta.card),
      'the re-registered live element carries the live card instance',
    );
    assert.strictEqual(
      tracker.elements[0].meta.card?.id,
      HASSAN,
      'and it is the same card',
    );
  });

  // (c) `@overlays={{false}}`: even with the operator-mode tracker present, the
  // row opts out of the overlay — it never registers, so no chip / options menu
  // / selection toggle can anchor to it. Hydration is unaffected: the inert HTML
  // still swaps to a live card, the swap just never registers either element.
  test('overlays=false — never registers with the tracker, even in operator mode', async function (assert) {
    let tracker = new ElementTracker();
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext @tracker={{tracker}}>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
            @overlays={{false}}
          />
        </TestContext>
      </template>,
    );

    assert.strictEqual(
      tracker.elements.length,
      0,
      'the inert element opts out of the overlay tracker',
    );

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert
      .dom('[data-test-live-card]')
      .hasText(
        'Live: Hassan',
        'still hydrates — overlays opt-out is independent',
      );
    assert.strictEqual(
      tracker.elements.length,
      0,
      'the live element stays out of the tracker too',
    );
  });

  // `none` stays inert with the diagnostic attribute and never fetches.
  test('none — stays inert, marks data-hydration=none, and never fetches', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='none'
          />
        </TestContext>
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
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @isError={{true}}
            @mode='hover'
          />
        </TestContext>
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

  // A file-meta row hydrates like a card row, but resolves a FileDef. `@type`
  // carries the resource kind through to the Store read.
  test('file-meta — hover hydrates the inert row into a live FileDef', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;
    let inert = htmlComponent(
      `<div class='inert' data-test-inert-file>hero.png</div>`,
    );
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{fileUrl}}
            @component={{inert}}
            @type='file-meta'
            @mode='hover'
          />
        </TestContext>
      </template>,
    );

    assert.dom('[data-test-inert-file]').exists('starts inert');
    assert.notOk(
      storeService.peek(fileUrl, { type: 'file-meta' }),
      'the file is not in the Store before the gesture',
    );

    await triggerEvent('[data-test-hydratable-card]', 'mouseenter');

    assert
      .dom('[data-test-inert-file]')
      .doesNotExist('inert file HTML is gone');
    assert.ok(
      isFileDefInstance(storeService.peek(fileUrl, { type: 'file-meta' })),
      'the live FileDef entered the Store',
    );
  });

  // --- Residency-driven hydration ------------------------------------------
  // A prerendered (inert) row whose instance is already resident in the Store
  // renders the live instance immediately, with no hydration gesture. Residency
  // is observed reactively (the Store's identity map is a TrackedMap) and never
  // triggers a load, so it costs nothing the user hasn't already paid.
  test('residency — an already-resident instance renders live immediately, no gesture', async function (assert) {
    await storeService.get(HASSAN); // resident by some other means (e.g. navigation)
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'precondition: the instance is resident in the Store',
    );

    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
      </template>,
    );

    assert
      .dom('[data-test-live-card]')
      .hasText('Live: Hassan', 'renders live with no gesture');
    assert
      .dom('[data-test-inert-card]')
      .doesNotExist(
        'the inert HTML is not shown when the instance is resident',
      );
    assert
      .dom('[data-hydration="hydrated"]')
      .exists('the diagnostic reflects the live render');
  });

  // An inert row that is NOT resident stays inert (no GET); when the instance
  // later lands in the Store by any means, the row flips to live on its own —
  // no gesture — proving the residency read is reactive.
  test('residency — an inert row flips to live when its instance lands later', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
      </template>,
    );

    assert.dom('[data-test-inert-card]').exists('starts inert (not resident)');
    assert.dom('[data-test-live-card]').doesNotExist('no live card yet');
    assert.notOk(
      isCardInstance(storeService.peek(HASSAN)),
      'precondition: not resident, and no GET was triggered',
    );

    await storeService.get(HASSAN); // lands in the Store out of band
    await settled();

    assert
      .dom('[data-test-live-card]')
      .hasText('Live: Hassan', 'flips to live with no gesture');
    assert.dom('[data-test-inert-card]').doesNotExist('the inert HTML is gone');
  });

  // Residency-driven hydration is SPA-only: inside a prerender render
  // (`__boxelRenderContext`) a resident instance must NOT flip a row to live —
  // a prerender emits prerendered HTML deterministically, and instances land in
  // the Store constantly during indexing.
  test('residency — never flips a row to live inside a prerender render', async function (assert) {
    await storeService.get(HASSAN);
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'precondition: resident',
    );

    let inert = htmlComponent(INERT_HTML);
    (globalThis as any).__boxelRenderContext = true;
    try {
      await render(
        <template>
          <TestContext>
            <HydratableCard
              @cardId={{HASSAN}}
              @component={{inert}}
              @mode='hover'
            />
          </TestContext>
        </template>,
      );

      assert
        .dom('[data-test-inert-card]')
        .exists('stays inert in a prerender render despite residency');
      assert
        .dom('[data-test-live-card]')
        .doesNotExist('residency does not flip to live during prerender');
    } finally {
      (globalThis as any).__boxelRenderContext = undefined;
    }
  });

  // `none` is an explicit "stay inert" opt-out (e.g. create-listing-modal's
  // deliberately cheap prerendered atoms), so residency must NOT flip a `none`
  // row to live even when its instance is already resident — residency only
  // brings forward the hydration a gesture mode would have performed anyway.
  test('residency — a none-mode row stays inert even when its instance is resident', async function (assert) {
    await storeService.get(HASSAN);
    assert.ok(
      isCardInstance(storeService.peek(HASSAN)),
      'precondition: resident',
    );
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='none'
          />
        </TestContext>
      </template>,
    );

    assert
      .dom('[data-test-inert-card]')
      .exists('a none row stays inert despite residency (explicit opt-out)');
    assert
      .dom('[data-test-live-card]')
      .doesNotExist('residency does not override the none opt-out');
  });

  // No leak: residency hydration adds no subscription — it reads the Store's
  // TrackedMap reactively, torn down with the component. The only Store
  // reference is the lazily-created `getCard` resource, which must release on
  // teardown. Assert the reference count returns to its pre-render baseline once
  // the component is destroyed.
  test('teardown — a residency-hydrated row releases its Store reference', async function (assert) {
    await storeService.get(HASSAN);
    storeService.addReference(HASSAN); // pin resident across the test (no GC)
    try {
      let baseline = storeService.getReferenceCount(HASSAN);
      let inert = htmlComponent(INERT_HTML);
      let toggle = new Toggle();

      await render(
        <template>
          {{#if toggle.show}}
            <TestContext>
              <HydratableCard
                @cardId={{HASSAN}}
                @component={{inert}}
                @mode='hover'
              />
            </TestContext>
          {{/if}}
        </template>,
      );

      assert
        .dom('[data-test-live-card]')
        .exists('the resident row rendered live');
      assert.true(
        storeService.getReferenceCount(HASSAN) > baseline,
        'the live row holds a Store reference while mounted',
      );

      toggle.show = false;
      await settled();

      assert.strictEqual(
        storeService.getReferenceCount(HASSAN),
        baseline,
        'teardown releases exactly the reference the row added (no leak)',
      );
    } finally {
      storeService.dropReference(HASSAN);
    }
  });

  // A never-resident inert row creates no resource and holds no Store reference
  // — residency observation does no eager work.
  test('residency — a non-resident inert row holds no Store reference', async function (assert) {
    let inert = htmlComponent(INERT_HTML);
    await render(
      <template>
        <TestContext>
          <HydratableCard
            @cardId={{HASSAN}}
            @component={{inert}}
            @mode='hover'
          />
        </TestContext>
      </template>,
    );

    assert.dom('[data-test-inert-card]').exists('stays inert');
    assert.strictEqual(
      storeService.getReferenceCount(HASSAN),
      0,
      'no resource, no Store reference for a never-resident row',
    );
  });

  hooks.afterEach(function () {
    getService('network').virtualNetwork.removeRealmMapping('@test-prefix/');
  });
});
