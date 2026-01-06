import { module, test } from 'qunit';

import type { RenderError } from '@cardstack/runtime-common';

import { normalizeRenderError } from '@cardstack/host/utils/render-error';

module('Unit | render-error', function () {
  test('coerces missing authorization header message', function (assert) {
    let renderError: RenderError = {
      type: 'instance-error',
      error: {
        status: 401,
        cardTitle: 'Unauthorized',
        message: 'Request failed: Missing Authorization header',
        additionalErrors: null,
      },
    };

    let normalized = normalizeRenderError(renderError);

    assert.strictEqual(
      normalized.error.message,
      'Request failed: No authorized access - 401',
      'authorization header message is replaced',
    );
    assert.strictEqual(
      renderError.error.message,
      'Request failed: Missing Authorization header',
      'input object is not mutated',
    );
  });
});
