import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { randomBytes } from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import type { Realm } from '@cardstack/runtime-common';
import { getOrCreateUser } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  matrixRegistrationSecret,
  matrixURL,
  realmServerTestMatrix,
  realmSecretSeed,
} from '../helpers/index.ts';
import { registerUser } from '../../synapse.ts';

// A realm's `_session` mints a session carrying the room the realm messages
// its holder in. A person has that room once they have a Boxel account; a
// platform account is given none.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('realm session for a Matrix account', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: { '*': ['read'] },
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    async function registerPerson() {
      let username = `session-account-${randomBytes(6).toString('hex')}`;
      let password = `pw-${randomBytes(12).toString('hex')}`;
      let { userId } = await registerUser({
        matrixURL,
        displayname: username,
        username,
        password,
        registrationSecret: matrixRegistrationSecret,
      });
      return { username, password, userId };
    }

    async function openIdToken(client: MatrixClient) {
      await client.login();
      return await client.getOpenIdToken();
    }

    function postSession(token: unknown) {
      return request
        .post('/_session')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(token));
    }

    test('a person with no Boxel account is refused a session, naming them', async function (assert) {
      let { username, password, userId } = await registerPerson();
      let response = await postSession(
        await openIdToken(
          new MatrixClient({
            matrixURL: new URL(matrixURL),
            username,
            password,
          }),
        ),
      );

      assert.strictEqual(response.status, 403, 'the session is refused');
      assert.notOk(response.get('Authorization'), 'no session token is issued');
      assert.ok(
        JSON.stringify(response.body).includes(userId),
        `the refusal names the account (${JSON.stringify(response.body)})`,
      );
    });

    test('a person with a Boxel account gets a session carrying their session room', async function (assert) {
      let { username, password, userId } = await registerPerson();
      await getOrCreateUser(dbAdapter, userId);
      let response = await postSession(
        await openIdToken(
          new MatrixClient({
            matrixURL: new URL(matrixURL),
            username,
            password,
          }),
        ),
      );

      assert.strictEqual(response.status, 201, 'the session is created');
      let claims = jsonwebtoken.decode(response.get('Authorization')!) as {
        user: string;
        sessionRoom?: string;
        realm: string;
      };
      assert.strictEqual(claims.user, userId, 'the session is the person’s');
      assert.strictEqual(claims.realm, testRealm.url, 'for this realm');
      assert.ok(claims.sessionRoom, 'the session carries a session room');
    });

    test('the realm server’s own account gets a session without a session room', async function (assert) {
      let response = await postSession(
        await openIdToken(
          new MatrixClient({
            matrixURL: realmServerTestMatrix.url,
            username: realmServerTestMatrix.username,
            seed: realmSecretSeed,
          }),
        ),
      );

      assert.strictEqual(response.status, 201, 'the session is created');
      let claims = jsonwebtoken.decode(response.get('Authorization')!) as {
        sessionRoom?: string;
      };
      assert.notOk(claims.sessionRoom, 'no session room is made for it');
    });
  });
});
