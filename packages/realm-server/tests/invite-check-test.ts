import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { readFileSync } from 'fs';
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  isBotAccount,
  shareARealmGrant,
} from '@cardstack/runtime-common';
import handleInviteCheck from '../handlers/handle-invite-check.ts';
import { setupDB } from './helpers/index.ts';

// The vectors the homeserver's invite module (boxel_invite_check) runs too,
// so it and `isBotAccount` apply one naming convention for service accounts.
const VECTORS_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'matrix',
  'support',
  'synapse',
  'modules',
  'test_service_account_vectors.json',
);

const secret = 'test-invite-check-secret';
const realmURL = new URL('http://127.0.0.1:4444/shared/');
const otherRealmURL = new URL('http://127.0.0.1:4444/other/');
const owner = '@owner:localhost';
const collaborator = '@collaborator:localhost';
const stranger = '@stranger:localhost';

// The homeserver's invite module asks `/_invite-check` whether one user may
// invite another. Two end users may share a room only when each holds a
// permission row naming them in the same realm (ADR 011 §1.2, §1.5); a
// service user may share a room with anyone.
module(basename(import.meta.filename), function () {
  module('shareARealmGrant', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await insertPermissions(dbAdapter, realmURL, {
          [owner]: ['read', 'write', 'realm-owner'],
          [collaborator]: ['read'],
          '*': ['read'],
          users: ['read', 'write'],
        });
        await insertPermissions(dbAdapter, otherRealmURL, {
          [stranger]: ['read', 'write', 'realm-owner'],
        });
      },
    });

    test('two users named in the same realm share a grant', async function (assert) {
      assert.true(await shareARealmGrant(dbAdapter, owner, collaborator));
      assert.true(
        await shareARealmGrant(dbAdapter, collaborator, owner),
        'the answer does not depend on the order of the users',
      );
    });

    test('users named in different realms share no grant', async function (assert) {
      assert.false(await shareARealmGrant(dbAdapter, owner, stranger));
      assert.false(await shareARealmGrant(dbAdapter, collaborator, stranger));
    });

    test('the * and users rows name no one', async function (assert) {
      // The stranger reads the shared realm through its `*` and `users`
      // rows, and is still a stranger to the users named in it.
      assert.false(await shareARealmGrant(dbAdapter, stranger, owner));
      assert.false(await shareARealmGrant(dbAdapter, '*', owner));
      assert.false(await shareARealmGrant(dbAdapter, 'users', owner));
    });

    test('a row that grants nothing does not count', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@revoked:localhost': ['read'],
      });
      assert.true(
        await shareARealmGrant(dbAdapter, owner, '@revoked:localhost'),
      );
      await insertPermissions(dbAdapter, realmURL, {
        '@revoked:localhost': [],
      });
      assert.false(
        await shareARealmGrant(dbAdapter, owner, '@revoked:localhost'),
        'a removed row stops counting at once',
      );
    });
  });

  module('service accounts', function () {
    test('isBotAccount agrees with the shared vectors', function (assert) {
      let { vectors } = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
        vectors: {
          userId: string;
          serverName: string;
          serviceAccount: boolean;
        }[];
      };
      assert.ok(vectors.length > 0, 'there are vectors');
      for (let { userId, serverName, serviceAccount } of vectors) {
        assert.strictEqual(
          isBotAccount(userId, serverName),
          serviceAccount,
          `${userId} on ${serverName}`,
        );
      }
    });
  });

  module('invite-check endpoint', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await insertPermissions(dbAdapter, realmURL, {
          [owner]: ['read', 'write', 'realm-owner'],
          [collaborator]: ['read'],
          users: ['read'],
        });
        await insertPermissions(dbAdapter, otherRealmURL, {
          [stranger]: ['read', 'write', 'realm-owner'],
        });
      },
    });

    // The secret is passed explicitly, never defaulted: `buildApp(undefined)`
    // has to build the endpoint with no secret configured.
    function buildApp(configuredSecret: string | undefined) {
      let app = new Koa();
      let router = new Router();
      router.get(
        '/_invite-check',
        handleInviteCheck({
          dbAdapter,
          matrixClient: {
            username: 'custom-named-server',
            serverName: 'localhost',
          },
          matrixInviteCheckSecret: configuredSecret,
        } as any),
      );
      app.use(router.routes());
      return app;
    }

    async function check(
      inviter: string,
      invitee: string,
      options: { secret?: string; app?: Koa } = {},
    ) {
      let request = supertest((options.app ?? buildApp(secret)).callback()).get(
        `/_invite-check?inviter=${encodeURIComponent(inviter)}&invitee=${encodeURIComponent(invitee)}`,
      );
      if (options.secret !== '') {
        request = request.set(
          'Authorization',
          `Bearer ${options.secret ?? secret}`,
        );
      }
      return await request;
    }

    test('allows an invite between users named in the same realm', async function (assert) {
      let response = await check(owner, collaborator);
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body, { allowed: true });
    });

    test('refuses an invite between users who share no realm grant', async function (assert) {
      let response = await check(owner, stranger);
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body, { allowed: false });

      response = await check(stranger, collaborator);
      assert.deepEqual(
        response.body,
        { allowed: false },
        'reading the realm through its users row names no one',
      );
    });

    test('allows an invite when either user is a service account', async function (assert) {
      for (let [inviter, invitee] of [
        ['@realm_server:localhost', stranger],
        [stranger, '@aibot:localhost'],
        [owner, '@submissionbot:localhost'],
        ['@realm/example-user/example-realm:localhost', stranger],
      ]) {
        let response = await check(inviter, invitee);
        assert.deepEqual(
          response.body,
          { allowed: true },
          `${inviter} may invite ${invitee}`,
        );
      }
    });

    test("allows an invite from or to the realm server's own account", async function (assert) {
      let response = await check('@custom-named-server:localhost', stranger);
      assert.deepEqual(response.body, { allowed: true });
      response = await check(stranger, '@custom-named-server:localhost');
      assert.deepEqual(response.body, { allowed: true });
    });

    test('rejects a missing or malformed user id', async function (assert) {
      let response = await supertest(buildApp(secret).callback())
        .get(`/_invite-check?inviter=${encodeURIComponent(owner)}`)
        .set('Authorization', `Bearer ${secret}`);
      assert.strictEqual(response.status, 400, 'invitee is missing');

      response = await check('owner', collaborator);
      assert.strictEqual(response.status, 400, 'inviter is not a matrix id');
    });

    test('requires the shared secret', async function (assert) {
      let response = await check(owner, collaborator, { secret: '' });
      assert.strictEqual(response.status, 401, 'no header');

      response = await check(owner, collaborator, { secret: 'wrong' });
      assert.strictEqual(response.status, 401, 'wrong secret');
    });

    test('answers 503 while no secret is configured', async function (assert) {
      let response = await check(owner, collaborator, {
        app: buildApp(undefined),
      });
      assert.strictEqual(response.status, 503);
    });
  });
});
