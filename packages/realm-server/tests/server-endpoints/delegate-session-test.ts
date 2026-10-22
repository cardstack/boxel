import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import sinon from 'sinon';
import jwt from 'jsonwebtoken';
import {
  SupportedMimeType,
  upsertSessionRoom,
  type TokenClaims,
} from '@cardstack/runtime-common';
import { AuthenticationErrorMessages } from '@cardstack/runtime-common/router';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';
import {
  aiBotDelegationSecret,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testRealmHref,
  testRealmURL,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
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

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
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

  // A delegated session reads its realm on its user's behalf and nothing else.
  // The realm-server routes that act as the user refuse it, while a full
  // session for the same user is still answered by each of them. The user owns
  // the realm, so every refusal below is the session's, never the user's.
  module('a delegated session on the realm-server routes', function (hooks) {
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
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
        dbAdapter = args.dbAdapter;
      },
    });

    // `/_realm-auth` answers a full session with the user's session room, so
    // the user has one already rather than the handler creating it in Matrix.
    hooks.beforeEach(async function () {
      await upsertSessionRoom(
        dbAdapter,
        onBehalfOf,
        '!jane-session-room:localhost',
      );
    });

    async function mintDelegatedSession(assert: Assert): Promise<string> {
      let mint = await signedPost(
        request,
        JSON.stringify({ onBehalfOf, realm: testRealmHref }),
      );
      assert.strictEqual(mint.status, 200, 'delegated session minted');
      return mint.body.token;
    }

    function realmAuth(token: string) {
      return request
        .post('/_realm-auth')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${token}`)
        .send('{}');
    }

    function fetchUser(token: string) {
      return request
        .get('/_user')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', `Bearer ${token}`);
    }

    function downloadRealm(token: string) {
      return request
        .get('/_download-realm')
        .query({ realm: testRealmHref })
        .set('Authorization', `Bearer ${token}`);
    }

    test('`/_realm-auth` refuses a delegated session and mints no realm session', async function (assert) {
      let delegated = await mintDelegatedSession(assert);

      let refused = await realmAuth(delegated);
      assert.strictEqual(refused.status, 401, 'HTTP 401');
      assert.deepEqual(
        refused.body,
        { errors: [AuthenticationErrorMessages.TokenInvalid] },
        'the response is the refusal alone, carrying no realm session',
      );

      let read = await request
        .get('/friend.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', `Bearer ${delegated}`);
      assert.strictEqual(
        read.status,
        200,
        'the refused session still reads the realm it was minted for',
      );
    });

    test('`GET /_user` refuses a delegated session', async function (assert) {
      let delegated = await mintDelegatedSession(assert);

      let refused = await fetchUser(delegated);
      assert.strictEqual(refused.status, 401, 'HTTP 401');
      assert.deepEqual(refused.body, {
        errors: [AuthenticationErrorMessages.TokenInvalid],
      });
    });

    test('`/_download-realm` refuses a delegated session, even for the realm it was minted for', async function (assert) {
      let delegated = await mintDelegatedSession(assert);

      let refused = await downloadRealm(delegated);
      assert.strictEqual(refused.status, 401, 'HTTP 401');
      assert.deepEqual(refused.body, {
        errors: [AuthenticationErrorMessages.TokenInvalid],
      });
    });

    test('a full session for the same user is answered by each of those routes', async function (assert) {
      let full = createRealmServerJWT(
        { user: onBehalfOf, sessionRoom: '!jane-session-room:localhost' },
        realmSecretSeed,
      );

      let auth = await realmAuth(full);
      assert.strictEqual(auth.status, 200, '`/_realm-auth` answers');
      let realmSession = jwt.verify(
        auth.body[testRealmHref],
        realmSecretSeed,
      ) as TokenClaims;
      assert.deepEqual(
        [...realmSession.permissions].sort(),
        ['read', 'realm-owner', 'write'],
        "the realm session carries the user's full permissions",
      );

      let user = await fetchUser(full);
      assert.strictEqual(user.status, 200, '`GET /_user` answers');
      assert.strictEqual(user.body.data.attributes.matrixUserId, onBehalfOf);

      let download = await downloadRealm(full);
      assert.strictEqual(download.status, 200, '`/_download-realm` answers');
      assert.strictEqual(download.headers['content-type'], 'application/zip');
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
