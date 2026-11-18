import {
  resetOnerror,
  setupOnerror,
  visit,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  serializeRenderRouteOptions,
  type RenderRouteOptions,
} from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// Covers the prerender driver's pre-model failure contract: the driver sits
// on a FRESH standby page (no prior renders in the app) and enters the render
// app via a NAMED transition (globalThis.boxelTransitionTo ->
// router.transitionTo with positional string params). When beforeModel
// throws, no model state exists, yet the error doc's deps must still name the
// card — including when the window error listeners write the payload LAST and
// would otherwise clobber the deps the route derived (the production failure
// mode: outside tests those listeners are attached and fire on the unhandled
// rejection after the route's own error handling has written its payload).
module('Acceptance | prerender | pre-model error', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  hooks.beforeEach(function () {
    (globalThis as any).__doNotSuppressRenderRouteError = true;
    // The pre-model throw rejects the transition promise nothing awaits;
    // swallow just that error so it doesn't fail the test as a global error.
    setupOnerror((error: any) => {
      if (!/boom before model/.test(error?.message ?? '')) {
        throw error;
      }
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__doNotSuppressRenderRouteError;
    resetOnerror();
  });

  function readErrorPayload(): { deps: string[]; message?: string } {
    let payloadText = document
      .querySelector('[data-prerender-error]')!
      .textContent!.trim();
    let payload = JSON.parse(payloadText);
    return {
      deps: payload?.error?.deps ?? [],
      message: payload?.error?.message,
    };
  }

  // An assertion message travels to testem over its control socket, whose
  // per-message cap a full deps list can exceed (scoped-CSS module URLs carry
  // their stylesheet inline), so name the count and a bounded sample.
  function describeDeps(deps: string[]): string {
    let sample = deps.slice(0, 5).map((dep) => dep.slice(0, 120));
    return `${deps.length} deps, first ${sample.length}: ${JSON.stringify(sample)}`;
  }

  // Throws from the render route's beforeModel exactly once, so the next
  // transition into the route fails before its model hook runs.
  function failNextBeforeModel(owner: any) {
    let renderRoute = owner.lookup('route:render') as any;
    let originalBeforeModel = renderRoute.beforeModel;
    renderRoute.beforeModel = async function (this: any, ...args: any[]) {
      await originalBeforeModel.apply(this, args);
      renderRoute.beforeModel = originalBeforeModel;
      throw new Error('boom before model');
    };
    return renderRoute;
  }

  async function waitForErrorPayload() {
    await waitUntil(
      () => {
        let el = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        return Boolean(el?.textContent && el.textContent.trim().length > 0);
      },
      { timeout: 5000, timeoutMessage: 'prerender error element populated' },
    );
  }

  test('named transition from standby page surfaces pre-model error with card deps', async function (assert) {
    await visit('/_standby');

    let renderRoute = failNextBeforeModel(this.owner);

    let options = serializeRenderRouteOptions({
      cardRender: true,
    } as RenderRouteOptions);
    // Enter the render app the way the prerender driver does: through the
    // standby page's registered boxelTransitionTo helper.
    let boxelTransitionTo = (globalThis as any).boxelTransitionTo as (
      routeName: string,
      ...params: string[]
    ) => void;
    assert.strictEqual(
      typeof boxelTransitionTo,
      'function',
      'standby page registered boxelTransitionTo',
    );
    try {
      boxelTransitionTo(
        'render.html',
        `${testRealmURL}1.json`,
        '42',
        options,
        'isolated',
        '0',
      );
    } catch (e: any) {
      // expected: the pre-model throw rejects the transition
    }

    await waitForErrorPayload();

    let expectedDeps = [`${testRealmURL}1.json`, `${testRealmURL}1`];
    let { deps, message } = readErrorPayload();
    assert.true(
      message?.includes('boom before model'),
      `error message captured (got: ${message})`,
    );
    assert.true(
      expectedDeps.some((dep) => deps.includes(dep)),
      `pre-model error deps name the card (${describeDeps(deps)})`,
    );

    // Outside tests, the window error listeners fire on the transition's
    // unhandled rejection AFTER the route's error handling has written its
    // payload, replacing it. Replay that overwrite through the route's own
    // window-error handler and verify the final payload still carries the
    // card's deps.
    renderRoute.errorHandler(
      new CustomEvent('test-unhandled-rejection', {
        detail: { reason: new Error('boom before model') },
      }),
    );
    let overwrite = readErrorPayload();
    assert.true(
      overwrite.message?.includes('boom before model'),
      `window-error overwrite keeps the message (got: ${overwrite.message})`,
    );
    assert.true(
      expectedDeps.some((dep) => overwrite.deps.includes(dep)),
      `window-error overwrite still names the card in deps (${describeDeps(
        overwrite.deps,
      )})`,
    );
  });

  // A prerender tab renders visit after visit without leaving the render
  // route, so when a visit fails before its model hook, the runtime dependency
  // tracker still holds an earlier visit's session. The error row is the
  // failing visit's: its deps name the failing card and nothing an earlier
  // render loaded. Renders the first card at nonce 0, then fails `failingURL`
  // at nonce 1 before its model hook, and returns the error payload. The
  // rejection enters Ember's error substate, which exits the render route
  // before the error is written, so these tests cover the tracker's nodes
  // being left out once the route's session record is gone — not the card
  // and nonce checks in the route's deps gate.
  async function renderThenFailBeforeModel(
    assert: Assert,
    owner: any,
    failingURL: string,
  ) {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'Pet/mango.json': {
          data: {
            attributes: { cardTitle: 'Mango' },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    let options = serializeRenderRouteOptions({
      cardRender: true,
    } as RenderRouteOptions);
    await visit(
      `/render/${encodeURIComponent(`${testRealmURL}Pet/mango.json`)}/0/${encodeURIComponent(
        options,
      )}/html/isolated/0`,
    );
    await waitUntil(
      () =>
        (document.querySelector('[data-prerender]') as HTMLElement | null)
          ?.dataset.prerenderStatus === 'ready',
      { timeout: 10000, timeoutMessage: 'first card rendered' },
    );

    failNextBeforeModel(owner);
    let boxelTransitionTo = (globalThis as any).boxelTransitionTo as (
      routeName: string,
      ...params: string[]
    ) => void;
    assert.strictEqual(
      typeof boxelTransitionTo,
      'function',
      'render route registered boxelTransitionTo',
    );
    try {
      boxelTransitionTo(
        'render.html',
        failingURL,
        '1',
        options,
        'isolated',
        '0',
      );
    } catch (e: any) {
      // expected: the pre-model throw rejects the transition
    }

    await waitForErrorPayload();
    return readErrorPayload();
  }

  function assertOnlyOwnDeps(
    assert: Assert,
    failingURL: string,
    { deps, message }: { deps: string[]; message?: string },
  ) {
    let ownDeps = [failingURL, failingURL.replace(/\.json$/, '')];
    assert.true(
      message?.includes('boom before model'),
      `error message captured (got: ${message})`,
    );
    assert.true(
      ownDeps.some((dep) => deps.includes(dep)),
      `deps name the failing card (${describeDeps(deps)})`,
    );
    assert.deepEqual(
      deps.filter((dep) => !ownDeps.includes(dep)),
      [],
      'deps carry nothing from the earlier render',
    );
  }

  test('pre-model error after a completed render names only the failing card in deps', async function (assert) {
    let failingURL = `${testRealmURL}Pet/failing.json`;
    let payload = await renderThenFailBeforeModel(
      assert,
      this.owner,
      failingURL,
    );
    assertOnlyOwnDeps(assert, failingURL, payload);
  });

  test("pre-model error on a later visit to the same card does not take the earlier visit's deps", async function (assert) {
    let failingURL = `${testRealmURL}Pet/mango.json`;
    let payload = await renderThenFailBeforeModel(
      assert,
      this.owner,
      failingURL,
    );
    assertOnlyOwnDeps(assert, failingURL, payload);
  });
});
