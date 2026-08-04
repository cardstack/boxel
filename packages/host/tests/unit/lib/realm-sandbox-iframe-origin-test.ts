import { module, test } from 'qunit';

import {
  allocateRealmSandboxIframeOrigin,
  isRealmSandboxIframeChildLocation,
} from '@cardstack/host/lib/realm-sandbox-iframe-origin';

module('Unit | realm sandbox iframe origin', function () {
  test('allocates a nonce origin for a hosted renderer domain', function (assert) {
    let nonce = '0123456789abcdef0123456789abcdef';
    assert.strictEqual(
      allocateRealmSandboxIframeOrigin(
        'https://boxelusercontent.dev',
        'https://branch.boxel-host-preview.stack.cards',
        nonce,
      ),
      `https://${nonce}.boxelusercontent.dev`,
    );
    assert.strictEqual(
      allocateRealmSandboxIframeOrigin(
        'https://boxelusercontent.dev',
        'https://branch.boxel-host-preview.stack.cards',
        'not-random-enough',
      ),
      undefined,
      'hosted allocation requires exactly 128 bits of lowercase hex',
    );
  });

  test('preserves the separate loopback origin used by local staging previews', function (assert) {
    assert.strictEqual(
      allocateRealmSandboxIframeOrigin(undefined, 'https://localhost:4216'),
      'https://127.0.0.1:4216',
    );
    assert.strictEqual(
      allocateRealmSandboxIframeOrigin(
        'https://127.0.0.1:4216',
        'https://localhost:4216',
      ),
      'https://127.0.0.1:4216',
    );
  });

  test('recognizes only the exact nonce child beneath the configured domain', function (assert) {
    let child = 'https://0123456789abcdef0123456789abcdef.boxelusercontent.dev';
    assert.true(
      isRealmSandboxIframeChildLocation(
        'https://boxelusercontent.dev',
        child,
        `${child}/_realm-sandbox-frame?bootstrapID=one`,
        true,
      ),
    );
    for (let origin of [
      'https://boxelusercontent.dev',
      'https://short.boxelusercontent.dev',
      'https://0123456789abcdef0123456789abcdef.other.example',
      'http://0123456789abcdef0123456789abcdef.boxelusercontent.dev',
    ]) {
      assert.false(
        isRealmSandboxIframeChildLocation(
          'https://boxelusercontent.dev',
          origin,
          `${origin}/_realm-sandbox-frame`,
          true,
        ),
        `${origin} is not the configured renderer child`,
      );
    }
    assert.false(
      isRealmSandboxIframeChildLocation(
        'https://boxelusercontent.dev',
        child,
        `${child}/not-the-renderer`,
        true,
      ),
      'the nonce origin cannot turn arbitrary routes into renderer children',
    );
  });
});
