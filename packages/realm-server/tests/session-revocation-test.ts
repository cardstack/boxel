import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { param, query } from '@cardstack/runtime-common';
import {
  isSessionRevoked,
  revokeUserSessions,
} from '@cardstack/runtime-common/db-queries/user-queries';
import { AuthenticationErrorMessages } from '@cardstack/runtime-common/router';
import { grafanaAuthorization, jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import handleRevokeUserSessions from '../handlers/handle-revoke-user-sessions.ts';
import { setupDB, insertUser, realmSecretSeed } from './helpers/index.ts';

const user = '@alice:localhost';
const grafanaSecret = 'test-grafana-secret';

// The revocation instant and a JWT's `iat` are both epoch *seconds*, so a token
// minted and revoked inside the same second is legitimately ambiguous. Tests
// that need an unambiguous verdict set the revocation instant explicitly rather
// than sleeping out the second boundary.
// Upserts rather than updates so the recorded instant does not depend on the
// user row already existing — the same reason `revokeUserSessions` upserts.
async function setRevokedAt(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  epochSeconds: number,
) {
  let [row] = await query(dbAdapter, [
    'INSERT INTO users (matrix_user_id, sessions_revoked_at) VALUES (',
    param(matrixUserId),
    ',',
    param(epochSeconds),
    ') ON CONFLICT (matrix_user_id) DO UPDATE SET sessions_revoked_at =',
    param(epochSeconds),
    'RETURNING sessions_revoked_at',
  ]);
  if (Number(row?.sessions_revoked_at) !== epochSeconds) {
    throw new Error(
      `setRevokedAt: expected ${epochSeconds} to be recorded for ${matrixUserId}, got ${row?.sessions_revoked_at}`,
    );
  }
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

module(basename(import.meta.filename), function () {
  module('isSessionRevoked', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await insertUser(dbAdapter, user, 'cus_alice', 'alice@example.com');
      },
    });

    test('a user who has never been revoked is not revoked', async function (assert) {
      assert.false(
        await isSessionRevoked(dbAdapter, user, nowInSeconds()),
        'no revocation recorded means no token is revoked',
      );
    });

    test('a token issued before the revocation is revoked', async function (assert) {
      let revokedAt = nowInSeconds();
      await setRevokedAt(dbAdapter, user, revokedAt);

      assert.true(
        await isSessionRevoked(dbAdapter, user, revokedAt - 1),
        'a token issued a second before the revocation is rejected',
      );
    });

    test('a token issued after the revocation is not revoked', async function (assert) {
      let revokedAt = nowInSeconds();
      await setRevokedAt(dbAdapter, user, revokedAt);

      assert.false(
        await isSessionRevoked(dbAdapter, user, revokedAt + 1),
        're-minted tokens survive, so a live matrix session recovers',
      );
    });

    test('a token with no issued-at claim is revoked', async function (assert) {
      await setRevokedAt(dbAdapter, user, nowInSeconds());

      assert.true(
        await isSessionRevoked(dbAdapter, user, undefined),
        'a token that cannot be placed relative to the revocation is rejected',
      );
    });

    test('revocation is scoped to one user', async function (assert) {
      await insertUser(dbAdapter, '@bob:localhost', 'cus_bob', null);
      await setRevokedAt(dbAdapter, user, nowInSeconds() + 60);

      assert.false(
        await isSessionRevoked(dbAdapter, '@bob:localhost', nowInSeconds()),
        "revoking one user leaves another user's sessions alone",
      );
    });
  });

  module('revokeUserSessions', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    test('records a revocation for an existing user', async function (assert) {
      await insertUser(dbAdapter, user, 'cus_alice', 'alice@example.com');

      let revokedAt = await revokeUserSessions(dbAdapter, user);

      assert.ok(
        Math.abs(revokedAt - nowInSeconds()) <= 5,
        'records approximately the current epoch second',
      );
      assert.true(
        await isSessionRevoked(dbAdapter, user, revokedAt - 1),
        'a token predating the recorded instant is revoked',
      );
    });

    test('records a revocation for a user with no row yet', async function (assert) {
      // Realm session tokens are minted without requiring a `users` row, so
      // revoking a user who has none still has to take effect.
      let revokedAt = await revokeUserSessions(dbAdapter, user);

      assert.true(
        await isSessionRevoked(dbAdapter, user, revokedAt - 1),
        'revocation applies even though the user had no row',
      );
    });

    test('a later revocation supersedes an earlier one', async function (assert) {
      await insertUser(dbAdapter, user, 'cus_alice', 'alice@example.com');
      await setRevokedAt(dbAdapter, user, nowInSeconds() - 3600);

      let revokedAt = await revokeUserSessions(dbAdapter, user);

      assert.ok(
        revokedAt > nowInSeconds() - 3600,
        'the recorded instant moves forward',
      );
      assert.true(
        await isSessionRevoked(dbAdapter, user, nowInSeconds() - 60),
        'a token minted after the first revocation is caught by the second',
      );
    });
  });

  module('jwtMiddleware honors revocation', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await insertUser(dbAdapter, user, 'cus_alice', 'alice@example.com');
      },
    });

    function buildApp() {
      let app = new Koa();
      let router = new Router();
      router.get(
        '/_test-protected',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        async (ctxt) => {
          ctxt.status = 200;
          ctxt.body = JSON.stringify({ user: (ctxt.state.token as any).user });
        },
      );
      app.use(router.routes());
      return app;
    }

    test('accepts a token when the user has no revocation', async function (assert) {
      let token = createJWT(
        { user, sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(buildApp().callback())
        .get('/_test-protected')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(response.status, 200, 'the request is authorized');
    });

    test('rejects a token issued before the revocation', async function (assert) {
      let token = createJWT(
        { user, sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      // Ahead of the token's `iat` regardless of where the second boundary fell.
      await setRevokedAt(dbAdapter, user, nowInSeconds() + 60);

      let response = await supertest(buildApp().callback())
        .get('/_test-protected')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(response.status, 401, 'the request is unauthorized');
      assert.ok(
        JSON.stringify(response.body).includes(
          AuthenticationErrorMessages.SessionRevoked,
        ),
        'the response names session revocation as the reason',
      );
    });
  });

  module('revoke-user-sessions endpoint', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await insertUser(dbAdapter, user, 'cus_alice', 'alice@example.com');
      },
    });

    function buildApp() {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_grafana-revoke-user-sessions',
        grafanaAuthorization(grafanaSecret),
        handleRevokeUserSessions({ dbAdapter } as any),
      );
      app.use(router.routes());
      return app;
    }

    test('revokes the named user', async function (assert) {
      let response = await supertest(buildApp().callback())
        .post(`/_grafana-revoke-user-sessions?user=${encodeURIComponent(user)}`)
        .set('Authorization', `Bearer ${grafanaSecret}`);

      assert.strictEqual(response.status, 200, 'the action succeeds');
      assert.true(
        await isSessionRevoked(dbAdapter, user, nowInSeconds() - 60),
        'sessions issued before the call are revoked',
      );
    });

    test('rejects a missing user param', async function (assert) {
      let response = await supertest(buildApp().callback())
        .post('/_grafana-revoke-user-sessions')
        .set('Authorization', `Bearer ${grafanaSecret}`);

      assert.strictEqual(response.status, 400, 'the action is rejected');
    });

    test('rejects a user that is not a full matrix id', async function (assert) {
      let response = await supertest(buildApp().callback())
        .post('/_grafana-revoke-user-sessions?user=alice')
        .set('Authorization', `Bearer ${grafanaSecret}`);

      assert.strictEqual(response.status, 400, 'the action is rejected');
    });

    test('requires the grafana secret', async function (assert) {
      let response = await supertest(buildApp().callback()).post(
        `/_grafana-revoke-user-sessions?user=${encodeURIComponent(user)}`,
      );

      assert.strictEqual(response.status, 401, 'the action is unauthorized');
      assert.false(
        await isSessionRevoked(dbAdapter, user, nowInSeconds() - 60),
        'an unauthenticated call revokes nothing',
      );
    });
  });
});
