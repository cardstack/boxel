import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import {
  secureCliAuthURL,
  secureSignInURL,
  secureSignOutURL,
} from '@cardstack/host/lib/secure-sign-in';

// Anything that names an origin or a URL travels to the secure origin in the
// fragment: a firewall in front of a deployment refuses a query string naming
// a loopback origin.
// A page of the secure origin, at its own path beneath the configured URL.
function secureOriginPage(page: string) {
  return `${ENV.secureOriginURL.replace(/\/+$/, '')}/${page}`;
}

module('Unit | secure-sign-in', function () {
  const LOCAL_APP = 'http://localhost:4200/some/path?operatorModeState=%7B%7D';

  test('signing in carries the page to come back to in the fragment', function (assert) {
    let url = new URL(secureSignInURL(LOCAL_APP));
    assert.strictEqual(url.href.split('#')[0], secureOriginPage('sign-in'));
    assert.strictEqual(
      new URLSearchParams(url.hash.slice(1)).get('return'),
      LOCAL_APP,
      'path and query are kept in full',
    );
  });

  test('signing out carries the page to come back to in the fragment', function (assert) {
    let url = new URL(secureSignOutURL('http://127.0.0.1:4200/'));
    assert.strictEqual(url.href.split('#')[0], secureOriginPage('sign-out'));
    assert.strictEqual(
      new URLSearchParams(url.hash.slice(1)).get('return'),
      'http://127.0.0.1:4200/',
    );
  });

  test("an older CLI's /cli-auth goes on with its port and state", function (assert) {
    let url = new URL(secureCliAuthURL('53412', 'abc123def456'));
    assert.strictEqual(url.origin + url.pathname, secureOriginPage('cli-auth'));
    assert.strictEqual(url.searchParams.get('port'), '53412');
    assert.strictEqual(url.searchParams.get('state'), 'abc123def456');
    assert.strictEqual(url.hash, '');
  });

  test('a /cli-auth missing its port or state goes on without them, for the secure page to refuse', function (assert) {
    let url = new URL(secureCliAuthURL('', ''));
    assert.strictEqual(url.origin + url.pathname, secureOriginPage('cli-auth'));
    assert.deepEqual([...url.searchParams.keys()], []);
  });
});
