import { module, test } from 'qunit';

import { isLoopbackRedirect } from '@cardstack/host/lib/cli-auth-redirect';

// The redirect target on /cli-auth arrives as a query parameter, so it is
// attacker-controllable. Everything this accepts is somewhere a Matrix session
// can be sent.
module('Unit | cli-auth-redirect', function () {
  test('accepts a loopback listener on any port', function (assert) {
    assert.true(isLoopbackRedirect('http://127.0.0.1:53412/callback'));
    assert.true(isLoopbackRedirect('http://127.0.0.1:1/cb?state=abc'));
    assert.true(isLoopbackRedirect('http://localhost:8080/callback'));
    assert.true(isLoopbackRedirect('http://[::1]:9000/callback'));
  });

  test('refuses a target that is not this machine', function (assert) {
    assert.false(isLoopbackRedirect('https://evil.example.com/steal'));
    assert.false(isLoopbackRedirect('http://evil.example.com/steal'));
    assert.false(isLoopbackRedirect('http://169.254.169.254/latest/meta-data'));
  });

  test('refuses a hostname that merely looks like loopback', function (assert) {
    // Parses with hostname `evil.example.com` — the userinfo before `@` is not
    // the host, however much it reads like one.
    assert.false(isLoopbackRedirect('http://127.0.0.1@evil.example.com/'));
    assert.false(isLoopbackRedirect('http://127.0.0.1.evil.example.com/'));
    assert.false(isLoopbackRedirect('http://notlocalhost/callback'));
  });

  test('refuses a non-http scheme', function (assert) {
    // A loopback listener is plain HTTP; these are ways to reach something
    // else entirely.
    assert.false(isLoopbackRedirect('https://127.0.0.1/callback'));
    assert.false(isLoopbackRedirect('file:///etc/passwd'));
    assert.false(isLoopbackRedirect('javascript:alert(1)'));
    assert.false(isLoopbackRedirect('data:text/html,hi'));
  });

  test('refuses input that is not a URL at all', function (assert) {
    assert.false(isLoopbackRedirect(''));
    assert.false(isLoopbackRedirect('not a url'));
    assert.false(isLoopbackRedirect('/callback'));
  });
});
