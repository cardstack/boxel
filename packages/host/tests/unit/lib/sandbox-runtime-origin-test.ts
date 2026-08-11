import { module, test } from 'qunit';

import {
  allocateSandboxRuntimeOrigin,
  newSandboxRuntimeNonce,
} from '@cardstack/host/lib/sandbox-runtime-origin';

module('Unit | Sandbox runtime origin', function () {
  test('allocates one nonce subdomain for a hosted base origin', function (assert) {
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        'https://boxelusercontent.dev',
        'https://branch.boxel-host-preview.stack.cards',
        '0123456789abcdef0123456789abcdef',
      ),
      'https://0123456789abcdef0123456789abcdef.boxelusercontent.dev',
    );
  });

  test('retains configured local sandbox origins', function (assert) {
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        'https://sandbox.feature.localhost',
        'https://host.feature.localhost',
        '0123456789abcdef0123456789abcdef',
      ),
      'https://sandbox.feature.localhost',
    );
  });

  test('derives user.localhost when standard local development is unconfigured', function (assert) {
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        undefined,
        'https://localhost:4200',
        '0123456789abcdef0123456789abcdef',
      ),
      'https://user.localhost:4200',
    );
  });

  test('rejects malformed or non-TLS hosted configuration', function (assert) {
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        'https://boxelusercontent.dev/path',
        'https://host.example',
        '0123456789abcdef0123456789abcdef',
      ),
      undefined,
    );
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        'http://boxelusercontent.dev',
        'https://host.example',
        '0123456789abcdef0123456789abcdef',
      ),
      undefined,
    );
    assert.strictEqual(
      allocateSandboxRuntimeOrigin(
        'https://boxelusercontent.dev',
        'https://host.example',
        'not-a-nonce',
      ),
      undefined,
    );
  });

  test('generates a 128-bit lowercase hexadecimal nonce', function (assert) {
    assert.true(/^[a-f0-9]{32}$/.test(newSandboxRuntimeNonce()));
  });
});
