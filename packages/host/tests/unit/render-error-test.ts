import { module, test } from 'qunit';

import type { RenderError } from '@cardstack/runtime-common';

import { normalizeRenderError } from '@cardstack/host/utils/render-error';

module('Unit | render-error', function () {
  test('coerces missing authorization header message', function (assert) {
    let renderError: RenderError = {
      type: 'instance-error',
      error: {
        status: 401,
        title: 'Unauthorized',
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

  test('a missing card instance is reported as the .json file backing it', function (assert) {
    let renderError: RenderError = {
      type: 'instance-error',
      error: {
        status: 404,
        title: 'Not Found',
        message: 'missing file http://test-realm/test/Widget/w-1',
        additionalErrors: null,
      },
    };

    let normalized = normalizeRenderError(renderError);

    assert.strictEqual(
      normalized.error.id,
      'http://test-realm/test/Widget/w-1.json',
      'an extensionless instance id resolves to the file the realm serves it from',
    );
    assert.strictEqual(
      normalized.error.message,
      'missing file http://test-realm/test/Widget/w-1.json',
      'the message names that file',
    );
    assert.strictEqual(
      normalized.error.title,
      'Link Not Found',
      'the error is titled as a missing link',
    );
  });

  test('a missing file keeps its own path', function (assert) {
    let renderError: RenderError = {
      type: 'instance-error',
      error: {
        status: 404,
        title: 'Not Found',
        message: 'missing file http://test-realm/test/images/photo.jpg',
        additionalErrors: null,
      },
    };

    let normalized = normalizeRenderError(renderError);

    assert.strictEqual(
      normalized.error.id,
      'http://test-realm/test/images/photo.jpg',
      'a reference that already names a file is reported as that file',
    );
    assert.strictEqual(
      normalized.error.message,
      'missing file http://test-realm/test/images/photo.jpg',
      'the message names the file the realm is missing, not a .json path it has never held',
    );
  });
});
