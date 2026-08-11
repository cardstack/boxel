import { module, test } from 'qunit';

import { shouldSkipReauthenticationForContext } from '@cardstack/runtime-common/authorization-middleware';

module('Unit | authorization middleware render context', function () {
  test('dedicated prerender contexts remain storage-token only', function (assert) {
    assert.true(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: false,
      }),
    );
  });

  test('interactive CardPrerender may silently recover a realm session', function (assert) {
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 1,
        isBrowserTestEnv: false,
      }),
    );
  });

  test('ordinary browser and browser-test requests may reauthenticate', function (assert) {
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: false,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: false,
      }),
    );
    assert.false(
      shouldSkipReauthenticationForContext({
        inRenderContext: true,
        interactiveRenderContextDepth: 0,
        isBrowserTestEnv: true,
      }),
    );
  });
});
