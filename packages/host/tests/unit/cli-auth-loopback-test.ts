import { module, test } from 'qunit';

import { cliAuthLoopbackUrl } from '@cardstack/host/lib/cli-auth-loopback';

// /cli-auth is told a port, not a URL, so the destination is always loopback on
// this machine. These cover the two things that are still caller-supplied.
module('Unit | cli-auth-loopback', function () {
  test('builds a loopback callback for a valid port and nonce', function (assert) {
    assert.strictEqual(
      cliAuthLoopbackUrl('53412', 'abc123def456'),
      'http://127.0.0.1:53412/callback?state=abc123def456',
    );
    assert.strictEqual(
      cliAuthLoopbackUrl('1', 'abc123def456'),
      'http://127.0.0.1:1/callback?state=abc123def456',
    );
    assert.strictEqual(
      cliAuthLoopbackUrl('65535', 'abc123def456'),
      'http://127.0.0.1:65535/callback?state=abc123def456',
    );
  });

  test('refuses a port that is not a real one', function (assert) {
    // 0 means "any free port" to a listener, so it is never a target.
    assert.strictEqual(cliAuthLoopbackUrl('0', 'abc123def456'), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('65536', 'abc123def456'), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('123456', 'abc123def456'), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('', 'abc123def456'), undefined);
    assert.strictEqual(cliAuthLoopbackUrl(null, 'abc123def456'), undefined);
  });

  test('refuses a port that is not plainly numeric', function (assert) {
    // Anything that could smuggle another host or path into the address.
    assert.strictEqual(
      cliAuthLoopbackUrl('80@evil.com', 'abc123def456'),
      undefined,
    );
    assert.strictEqual(
      cliAuthLoopbackUrl('80/../x', 'abc123def456'),
      undefined,
    );
    assert.strictEqual(cliAuthLoopbackUrl(' 80', 'abc123def456'), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('8_0', 'abc123def456'), undefined);
  });

  test('refuses a missing or malformed nonce', function (assert) {
    assert.strictEqual(cliAuthLoopbackUrl('53412', null), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('53412', ''), undefined);
    assert.strictEqual(cliAuthLoopbackUrl('53412', 'short'), undefined);
    assert.strictEqual(
      cliAuthLoopbackUrl('53412', 'has spaces and stuff'),
      undefined,
    );
  });
});
