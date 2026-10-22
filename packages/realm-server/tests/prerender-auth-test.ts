import QUnit from 'qunit';
const { module, test } = QUnit;

import { basename } from 'path';
import { VirtualNetwork } from '@cardstack/runtime-common';
import { buildCreatePrerenderAuth } from '../prerender/auth.ts';
import { renderActorFor } from '../prerender/render-runner.ts';
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

  test('a realm-authority session carries the claim on every token, and an ordinary one on none', function (assert) {
    let createPrerenderAuth = buildCreatePrerenderAuth(
      secretSeed,
      'http://realm-server.example',
    );
    let permissions = {
      'http://localhost:4202/test/': ['read' as const, 'realm-owner' as const],
      'http://localhost:4202/other/': ['read' as const],
    };

    let authority = createPrerenderAuth(userId, permissions, {
      realmAuthority: true,
    });
    for (let realm of Object.keys(permissions)) {
      assert.true(
        claimsFor(authority, realm).realmAuthority,
        `the token for ${realm} says it is a realm-authority session`,
      );
    }

    let ordinary = createPrerenderAuth(userId, permissions);
    for (let realm of Object.keys(permissions)) {
      assert.strictEqual(
        claimsFor(ordinary, realm).realmAuthority,
        undefined,
        `the token for ${realm} carries no claim`,
      );
    }
  });

  module('the actor a render runs as', function () {
    let createPrerenderAuth = buildCreatePrerenderAuth(
      secretSeed,
      'http://realm-server.example',
    );
    let permissions = {
      'http://localhost:4202/test/': ['read' as const],
      'http://localhost:4202/other/': ['read' as const],
    };

    test('ordinary sessions for one user run as that user', function (assert) {
      assert.strictEqual(
        renderActorFor(createPrerenderAuth(userId, permissions)),
        userId,
      );
    });

    test('realm-authority sessions run as nobody', function (assert) {
      assert.strictEqual(
        renderActorFor(
          createPrerenderAuth(userId, permissions, { realmAuthority: true }),
        ),
        null,
      );
    });

    test('an anonymous render, with no session, runs as nobody', function (assert) {
      assert.strictEqual(renderActorFor('{}'), null);
    });

    test('sessions naming more than one user run as nobody', function (assert) {
      let mine = JSON.parse(
        createPrerenderAuth(userId, {
          'http://localhost:4202/test/': ['read'],
        }),
      );
      let theirs = JSON.parse(
        createPrerenderAuth('@someone-else:localhost', {
          'http://localhost:4202/other/': ['read'],
        }),
      );
      assert.strictEqual(
        renderActorFor(JSON.stringify({ ...mine, ...theirs })),
        null,
      );
    });

    test('auth that cannot be read runs as nobody', function (assert) {
      let nullPayload = `x.${Buffer.from('null').toString('base64url')}.y`;
      for (let [label, auth] of [
        ['not JSON', 'not json'],
        ['a token that is not a string', JSON.stringify({ realm: 42 })],
        ['a token that is not a JWT', JSON.stringify({ realm: 'opaque' })],
        [
          'a token whose claims are null',
          JSON.stringify({ realm: nullPayload }),
        ],
      ]) {
        assert.strictEqual(renderActorFor(auth), null, label);
      }
    });
  });
});
