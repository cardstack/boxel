import { module, test } from 'qunit';
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import { SupportedMimeType, type TokenClaims } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';
import {
  aiBotDelegationSecret,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testRealmHref,
  testRealmURL,
} from '../helpers/index.ts';
import {
  DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER,
  DELEGATED_USER_REALM_SESSION_TIMESTAMP_HEADER,
  delegatedUserRealmSessionSignature,
} from '@cardstack/runtime-common/user-delegated-realm-server-session';

const onBehalfOf = '@jane:localhost';
// A user with no permission rows on the test realm.
const stranger = '@stranger:localhost';

function signedPost(
  request: SuperTest<Test>,
  rawBody: string,
  opts: {
    timestamp?: number;
    secret?: string;
    signature?: string;
    omitTimestamp?: boolean;
    omitSignature?: boolean;
  } = {},
) {
  let timestamp = String(opts.timestamp ?? Date.now());
  let signature =
    opts.signature ??
    delegatedUserRealmSessionSignature(
      opts.secret ?? aiBotDelegationSecret,
      timestamp,
      rawBody,
    );
  let req = request
    .post('/_delegate-session')
    .set('Content-Type', 'application/json');
  if (!opts.omitTimestamp) {
    req = req.set(DELEGATED_USER_REALM_SESSION_TIMESTAMP_HEADER, timestamp);
  }
  if (!opts.omitSignature) {
    req = req.set(DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER, signature);
  }
  return req.send(rawBody);
}

module(`server-endpoints/${basename(__filename)}`, function () {
  module('POST /_delegate-session', function (hooks) {
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      // Deliberately no '*' read grant: reads on this realm require a valid
      // JWT, so the delegated token's realm-side acceptance is actually
      // exercised. `onBehalfOf` is realm-owner — broader than read — which is
      // exactly the case the exact-permissions-match invariant would reject
      // without the delegated-token handling in realm.ts.
      permissions: {
        [onBehalfOf]: ['read', 'write', 'realm-owner'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      realmURL: testRealmURL,
      onRealmSetup: (args: {
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) => {
        request = args.request;
      },
    });

    test('mints a read-only delegated token scoped to the user and realm', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
      );

      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.strictEqual(
        response.body.realm,
        testRealmHref,
        'response echoes the normalized realm URL',
      );
      assert.deepEqual(
        response.body.permissions,
        ['read'],
        'response reports read-only permissions',
      );

      let claims = jwt.verify(
        response.body.token,
        realmSecretSeed,
      ) as TokenClaims & {
        iat: number;
        exp: number;
      };
      assert.strictEqual(claims.user, onBehalfOf, 'token is bound to the user');
      assert.strictEqual(
        claims.realm,
        testRealmHref,
        'token is scoped to the realm',
      );
      assert.deepEqual(claims.permissions, ['read'], 'token carries only read');
      assert.true(claims.delegated, 'token is flagged delegated');
      assert.strictEqual(
        claims.exp - claims.iat,
        30 * 60,
        'token lives for 30 minutes',
      );
    });

    test('minted token authorizes a realm read even though the user is realm-owner', async function (assert) {
      let mint = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
      );
      assert.strictEqual(mint.status, 200, 'token minted');

      let read = await request
        .get('/friend.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${mint.body.token}`);
      assert.strictEqual(
        read.status,
        200,
        'delegated token can read realm source',
      );
    });

    test('minted token cannot write to the realm', async function (assert) {
      let mint = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
      );
      assert.strictEqual(mint.status, 200, 'token minted');

      let write = await request
        .post('/')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${mint.body.token}`)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          }),
        );
      assert.strictEqual(
        write.status,
        403,
        'delegated token is rejected for write (read-only)',
      );
    });

    test('a delegated token scoped to another realm is rejected (single-realm scope)', async function (assert) {
      // A well-formed delegated token (validly signed with the realm-server
      // seed) but minted for a different realm must not be accepted here, even
      // though the bound user has read on this realm.
      let foreignToken = jwt.sign(
        {
          user: onBehalfOf,
          realm: 'http://some-other-realm.example/',
          permissions: ['read'],
          realmServerURL: testRealmURL.href,
          delegated: true,
        },
        realmSecretSeed,
        { expiresIn: '30m' },
      );

      let read = await request
        .get('/friend.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${foreignToken}`);
      assert.strictEqual(
        read.status,
        401,
        'token minted for another realm is rejected',
      );
    });

    test('denies a user with no read access to the realm', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf: stranger, realm: testRealmHref }),
      );
      assert.strictEqual(response.status, 403, 'HTTP 403');
    });

    test('rejects a request with no signature or timestamp', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
        { omitSignature: true, omitTimestamp: true },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a request with an invalid signature', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
        { signature: 'deadbeef'.repeat(8) },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a request signed with the wrong secret', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
        { secret: 'not-the-shared-secret' },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a stale timestamp outside the ±60s window', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
        { timestamp: Date.now() - 61_000 },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a timestamp too far in the future', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
        { timestamp: Date.now() + 61_000 },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a body that is not valid JSON (signature still required)', async function (assert) {
      let response = await signedPost(request, 'this is not json');
      assert.strictEqual(response.status, 400, 'HTTP 400');
    });

    test('rejects a body missing onBehalfOf', async function (assert) {
      let response = await signedPost(
        request,
        JSON.stringify({ realm: testRealmHref }),
      );
      assert.strictEqual(response.status, 400, 'HTTP 400');
    });

    test('rejects a body missing realm', async function (assert) {
      let response = await signedPost(request, JSON.stringify({ onBehalfOf }));
      assert.strictEqual(response.status, 400, 'HTTP 400');
    });
  });

  // A realm whose read access comes from the `users` grant (any Matrix user
  // with a profile) rather than an exact per-user row. The endpoint must mint
  // for such a user, matching what the realm authorizer would accept.
  module('POST /_delegate-session — users grant', function (hooks) {
    let request: SuperTest<Test>;
    const karl = '@karl:localhost';

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      permissions: {
        users: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      realmURL: testRealmURL,
      onRealmSetup: (args: {
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) => {
        request = args.request;
      },
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('mints for a user who can read via a `users` grant (no exact row)', async function (assert) {
      sinon
        .stub(MatrixClient.prototype, 'getProfile')
        .resolves({ displayname: 'Karl' });

      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf: karl, realm: testRealmHref }),
      );
      assert.strictEqual(response.status, 200, 'HTTP 200');
      let claims = jwt.verify(
        response.body.token,
        realmSecretSeed,
      ) as TokenClaims;
      assert.strictEqual(claims.user, karl, 'token is bound to the user');
      assert.deepEqual(claims.permissions, ['read'], 'token carries only read');
    });

    test('denies a `users`-grant realm when the user has no Matrix profile', async function (assert) {
      sinon.stub(MatrixClient.prototype, 'getProfile').resolves(undefined);

      let response = await signedPost(
        request,
        JSON.stringify({ onBehalfOf: karl, realm: testRealmHref }),
      );
      assert.strictEqual(response.status, 403, 'HTTP 403');
    });
  });
});
