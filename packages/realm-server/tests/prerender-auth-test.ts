import QUnit from 'qunit';
const { module, test } = QUnit;

import { basename } from 'path';
import { VirtualNetwork } from '@cardstack/runtime-common';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';
import { verifyJWT } from '../jwt.ts';

const secretSeed = 'prerender-auth-test-seed';
const userId = '@user:localhost';

function claimsFor(auth: string, realm: string) {
  let sessions = JSON.parse(auth) as Record<string, string>;
  return verifyJWT(sessions[realm], secretSeed);
}

module(basename(import.meta.filename), function () {
  test('a given realm server URL is used for every realm', function (assert) {
    let createPrerenderAuth = buildCreatePrerenderAuth(
      secretSeed,
      'http://realm-server.example',
    );
    let auth = createPrerenderAuth(userId, {
      '@cardstack/base/': ['read'],
      'http://other.example/user/realm/': ['read', 'write'],
    });
    assert.strictEqual(
      claimsFor(auth, '@cardstack/base/').realmServerURL,
      'http://realm-server.example/',
    );
    assert.strictEqual(
      claimsFor(auth, 'http://other.example/user/realm/').realmServerURL,
      'http://realm-server.example/',
    );
  });

  test('a prefix-form realm id resolves to the origin of its mapped URL', function (assert) {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
    let createPrerenderAuth = buildCreatePrerenderAuth(
      secretSeed,
      undefined,
      (realm) => virtualNetwork.toURL(realm),
    );
    let auth = createPrerenderAuth(userId, {
      '@cardstack/base/': ['read'],
      'http://localhost:4202/test/': ['read', 'write'],
    });

    let baseClaims = claimsFor(auth, '@cardstack/base/');
    assert.strictEqual(baseClaims.realm, '@cardstack/base/');
    assert.strictEqual(baseClaims.realmServerURL, 'http://localhost:4201/');
    assert.deepEqual(baseClaims.permissions, ['read']);
    assert.strictEqual(
      claimsFor(auth, 'http://localhost:4202/test/').realmServerURL,
      'http://localhost:4202/',
    );
  });

  test('a realm whose URL cannot be determined gets no token, and the others still do', function (assert) {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
    let createPrerenderAuth = buildCreatePrerenderAuth(
      secretSeed,
      undefined,
      (realm) => virtualNetwork.toURL(realm),
    );
    let auth = createPrerenderAuth(userId, {
      '@cardstack/base/': ['read'],
      '@cardstack/catalog/': ['read'],
    });
    let sessions = JSON.parse(auth) as Record<string, string>;
    assert.deepEqual(Object.keys(sessions), ['@cardstack/base/']);
    assert.strictEqual(
      claimsFor(auth, '@cardstack/base/').realmServerURL,
      'http://localhost:4201/',
    );
  });

  test('a prefix-form realm id with no resolver gets no token', function (assert) {
    let createPrerenderAuth = buildCreatePrerenderAuth(secretSeed);
    let auth = createPrerenderAuth(userId, {
      '@cardstack/base/': ['read'],
      'http://localhost:4202/test/': ['read'],
    });
    let sessions = JSON.parse(auth) as Record<string, string>;
    assert.deepEqual(Object.keys(sessions), ['http://localhost:4202/test/']);
  });
});
