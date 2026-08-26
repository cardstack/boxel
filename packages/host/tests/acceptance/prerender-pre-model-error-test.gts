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

import { testRealmURL } from '../helpers';
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

  setupMockMatrix(hooks, {
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

  test('named transition from standby page surfaces pre-model error with card deps', async function (assert) {
    await visit('/_standby');

    let renderRoute = this.owner.lookup('route:render') as any;
    let originalBeforeModel = renderRoute.beforeModel;
    renderRoute.beforeModel = async function (this: any, ...args: any[]) {
      await originalBeforeModel.apply(this, args);
      renderRoute.beforeModel = originalBeforeModel;
      throw new Error('boom before model');
    };

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

    await waitUntil(
      () => {
        let el = document.querySelector(
          '[data-prerender-error]',
        ) as HTMLElement | null;
        return Boolean(el?.textContent && el.textContent.trim().length > 0);
      },
      { timeout: 5000, timeoutMessage: 'prerender error element populated' },
    );

    let expectedDeps = [`${testRealmURL}1.json`, `${testRealmURL}1`];
    let { deps, message } = readErrorPayload();
    assert.true(
      message?.includes('boom before model'),
      `error message captured (got: ${message})`,
    );
    assert.true(
      expectedDeps.some((dep) => deps.includes(dep)),
      `pre-model error deps name the card (deps: ${JSON.stringify(deps)})`,
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
      `window-error overwrite still names the card in deps (deps: ${JSON.stringify(
        overwrite.deps,
      )})`,
    );
  });
});
