import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import jsonwebtoken from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupDB,
  setupSimpleRealmServerTemplate,
  startSimpleRealmServer,
  closeServer,
  ensureMatrixAdminUser,
  matrixRegistrationSecret,
  matrixURL,
  realmSecretSeed,
} from './helpers/index.ts';
import { getOrCreateUser, upsertSessionRoom } from '@cardstack/runtime-common';
import { logLinesDuring, withLogDefinition } from './helpers/log-capture.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import {
  createJWT as createRealmServerJWT,
  createSecureSessionJWT,
  retrieveTokenClaim,
} from '../utils/jwt.ts';
import { createJWT as createRealmJWT } from '../jwt.ts';
import { getMatrixAdminToken, registerUser } from '../synapse.ts';
import { keepsMethodAndPathOnly } from '../lib/request-telemetry.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';

const ADMIN = { matrixURL, adminUsername: 'admin', adminPassword: 'password' };
const APP_ORIGIN = 'https://app.secure-session.test';
const ADD_TICKET = {
  data: { type: 'key-write-ticket', attributes: { action: 'add' } },
};

// A Matrix account with a password, which is how these tests confirm it is
// the user.
async function registerPasswordUser(
  dbAdapter: PgAdapter,
  { boxelAccount = true }: { boxelAccount?: boolean } = {},
) {
  let username = `secure-${randomBytes(6).toString('hex')}`;
  let password = `pw-${randomBytes(12).toString('hex')}`;
  let { userId } = await registerUser({
    matrixURL,
    displayname: username,
    username,
    password,
    registrationSecret: matrixRegistrationSecret,
  });
  if (boxelAccount) {
    // What the user's first sign-in to Boxel records.
    await getOrCreateUser(dbAdapter, userId);
    await upsertSessionRoom(
      dbAdapter,
      userId,
      `!session-${username}:localhost`,
    );
  }
  return { username, password, userId };
}

async function addEmail(userId: string, address: string) {
  let adminToken = await getMatrixAdminToken(ADMIN);
  let response = await fetch(
    new URL(`_synapse/admin/v2/users/${encodeURIComponent(userId)}`, matrixURL),
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threepids: [{ medium: 'email', address }],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`could not add an email: ${response.status}`);
  }
}

async function threepids(userId: string) {
  let adminToken = await getMatrixAdminToken(ADMIN);
  let response = await fetch(
    new URL(`_synapse/admin/v2/users/${encodeURIComponent(userId)}`, matrixURL),
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  return ((await response.json()) as { threepids: unknown[] }).threepids;
}

// Every source file of the realm server outside its tests and dependencies.
function serverSources(dir: string): string[] {
  let files: string[] = [];
  for (let name of readdirSync(dir)) {
    if (['node_modules', 'tests', 'dist', '.cache'].includes(name)) {
      continue;
    }
    let path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...serverSources(path));
    } else if (/\.(ts|js|gts)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

module(basename(import.meta.filename), function () {
  module('secure session', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let secureOriginURL = new URL('https://secure.secure-session.test/secure');
    let secureOrigin = secureOriginURL.origin;

    hooks.before(ensureMatrixAdminUser);

    let templateDatabase = setupSimpleRealmServerTemplate(hooks);

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
        testRealmServer = await startSimpleRealmServer({
          dbAdapter,
          publisher,
          runner,
          secureOriginURL,
        });
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
        resetSecretsAtRest();
      },
    });

    function startRequest(
      username: string,
      origin: string | null = secureOrigin,
    ) {
      let req = request
        .post('/_secure-session/sign-in')
        .set('Content-Type', 'application/vnd.api+json');
      if (origin !== null) {
        req = req.set('Origin', origin);
      }
      return req.send({
        data: {
          type: 'secure-sign-in',
          attributes: { username, client: 'window' },
        },
      });
    }

    function completeRequest(
      attributes: Record<string, unknown>,
      origin: string | null = secureOrigin,
    ) {
      let req = request
        .post('/_secure-session')
        .set('Content-Type', 'application/vnd.api+json');
      if (origin !== null) {
        req = req.set('Origin', origin);
      }
      return req.send({ data: { type: 'secure-session', attributes } });
    }

    async function signIn(username: string, password: string) {
      let started = await startRequest(username);
      if (started.status !== 201) {
        throw new Error(`start: ${started.status} ${started.text}`);
      }
      let completed = await completeRequest({
        signIn: started.body.data.attributes.signIn,
        password,
      });
      if (completed.status !== 201) {
        throw new Error(`complete: ${completed.status} ${completed.text}`);
      }
      return completed.body.data.attributes as {
        token: string;
        user: string;
        expiresAt: string;
      };
    }

    function mint(authorization: string, origin?: string) {
      let req = request
        .post('/_key-write-tickets')
        .set('Authorization', authorization)
        .set('Content-Type', 'application/json');
      if (origin !== undefined) {
        req = req.set('Origin', origin);
      }
      return req.send(ADD_TICKET);
    }

    test('signing in with the password gives a session that mints key write tickets', async function (assert) {
      let { username, password, userId } =
        await registerPasswordUser(dbAdapter);

      let started = await startRequest(username);
      assert.strictEqual(started.status, 201, started.text);
      let { signIn: signInToken, user, stages } = started.body.data.attributes;
      assert.strictEqual(user, userId, 'the sign-in is for the account');
      assert.deepEqual(stages, ['password'], 'the password confirms it');

      let wrong = await completeRequest({
        signIn: signInToken,
        password: 'not-it',
      });
      assert.strictEqual(wrong.status, 401, 'a wrong password is refused');
      assert.strictEqual(wrong.body.errors[0].code, 'invalid-password');

      let completed = await completeRequest({ signIn: signInToken, password });
      assert.strictEqual(completed.status, 201, completed.text);
      let session = completed.body.data.attributes;
      assert.strictEqual(session.user, userId);
      assert.true(Date.parse(session.expiresAt) > Date.now());
      let claims = retrieveTokenClaim(session.token, realmSecretSeed);
      assert.strictEqual(claims.user, userId);
      assert.strictEqual(
        typeof claims.secureSession,
        'string',
        'the session carries the claim',
      );

      for (let origin of [secureOrigin, undefined]) {
        let minted = await mint(`Bearer ${session.token}`, origin);
        assert.strictEqual(
          minted.status,
          201,
          `a ticket is minted (Origin: ${origin ?? 'none'})`,
        );
      }

      let ticket = (await mint(`Bearer ${session.token}`)).body.data.attributes
        .ticket;
      let added = await request
        .post('/_user-keys')
        .set('Authorization', `Bearer ${session.token}`)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'user-key',
            attributes: { name: 'weather', value: 'sk-secure-session' },
          },
          meta: { ticket },
        });
      assert.strictEqual(added.status, 201, 'and the ticket adds a key');

      assert.deepEqual(
        await threepids(userId),
        [],
        'confirming it is the user changed nothing on the account',
      );
    });

    test('someone who has never signed in to Boxel is refused before confirming anything', async function (assert) {
      let { username } = await registerPasswordUser(dbAdapter, {
        boxelAccount: false,
      });
      let started = await startRequest(username);
      assert.strictEqual(started.status, 403);
      assert.strictEqual(started.body.errors[0].code, 'no-boxel-account');
    });

    test('a sign-in can be started by email address', async function (assert) {
      let { password, userId } = await registerPasswordUser(dbAdapter);
      let email = `${randomBytes(6).toString('hex')}@secure-session.test`;
      await addEmail(userId, email);
      let session = await signIn(email.toUpperCase(), password);
      assert.strictEqual(session.user, userId);
    });

    test('a sign-in signs in once', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let started = await startRequest(username);
      let signInToken = started.body.data.attributes.signIn;
      let first = await completeRequest({ signIn: signInToken, password });
      assert.strictEqual(first.status, 201);
      let again = await completeRequest({ signIn: signInToken, password });
      assert.strictEqual(again.status, 409, 'completing it again is refused');
      assert.strictEqual(again.body.errors[0].code, 'used');
    });

    test('a sign-in waiting on single sign-on answers pending until the user confirms', async function (assert) {
      let { username } = await registerPasswordUser(dbAdapter);
      let started = await startRequest(username);
      let pending = await completeRequest({
        signIn: started.body.data.attributes.signIn,
      });
      assert.strictEqual(pending.status, 409);
      assert.strictEqual(pending.body.errors[0].code, 'pending');
    });

    test('signing in is answered only for the secure origin', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      for (let origin of [APP_ORIGIN, 'null', null]) {
        let started = await startRequest(username, origin);
        assert.strictEqual(
          started.status,
          403,
          `starting is refused (Origin: ${origin ?? 'none'})`,
        );
      }
      let started = await startRequest(username);
      for (let origin of [APP_ORIGIN, 'null', null]) {
        let completed = await completeRequest(
          { signIn: started.body.data.attributes.signIn, password },
          origin,
        );
        assert.strictEqual(
          completed.status,
          403,
          `completing is refused (Origin: ${origin ?? 'none'})`,
        );
      }
    });

    test('a sign-in token is not a session, and a session is not a sign-in', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let started = await startRequest(username);
      let signInToken = started.body.data.attributes.signIn;
      let asSession = await request
        .get('/_user-keys')
        .set('Authorization', `Bearer ${signInToken}`);
      assert.strictEqual(asSession.status, 401, 'a sign-in is not a session');

      let session = await signIn(username, password);
      let asSignIn = await completeRequest({ signIn: session.token, password });
      assert.strictEqual(asSignIn.status, 400, 'a session is not a sign-in');

      let forged = jsonwebtoken.sign(
        {
          purpose: 'secure-sign-in',
          user: session.user,
          uiaSession: 'made-up',
          clientSecret: 'x',
          sid: 'y',
          client: 'window',
        },
        realmSecretSeed,
      );
      let forgedResponse = await completeRequest({ signIn: forged, password });
      assert.strictEqual(
        forgedResponse.status,
        400,
        'a sign-in signed with the session key is not recognized',
      );
    });

    test("the app's session can't mint a key write ticket from any origin", async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let appSession = `Bearer ${createRealmServerJWT(
        { user: userId, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      for (let origin of [secureOrigin, APP_ORIGIN, undefined]) {
        let minted = await mint(appSession, origin);
        assert.strictEqual(
          minted.status,
          403,
          `refused (Origin: ${origin ?? 'none'})`,
        );
        assert.strictEqual(minted.body.data, undefined, 'no ticket');
      }
    });

    test('a secure session is honoured only while its row lasts, and only for its user', async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let other = await registerPasswordUser(dbAdapter);

      let unrecorded = `Bearer ${createSecureSessionJWT(
        {
          user: userId,
          sessionRoom: 'test-session',
          secureSession: randomUUID(),
        },
        realmSecretSeed,
        3600,
      )}`;
      assert.strictEqual(
        (await mint(unrecorded)).status,
        403,
        'a claim naming no row is refused',
      );

      let othersSession = await secureSessionAuth(dbAdapter, other.userId);
      let { secureSession } = retrieveTokenClaim(
        othersSession,
        realmSecretSeed,
      );
      let borrowed = `Bearer ${createSecureSessionJWT(
        {
          user: userId,
          sessionRoom: 'test-session',
          secureSession: secureSession!,
        },
        realmSecretSeed,
        3600,
      )}`;
      assert.strictEqual(
        (await mint(borrowed)).status,
        403,
        "a claim naming another user's row is refused",
      );

      let expiring = await secureSessionAuth(dbAdapter, userId);
      assert.strictEqual((await mint(expiring)).status, 201);
      await dbAdapter.execute(
        `UPDATE secure_sessions SET expires_at = NOW() - interval '1 second'
          WHERE id = $1`,
        {
          bind: [retrieveTokenClaim(expiring, realmSecretSeed).secureSession!],
        },
      );
      assert.strictEqual(
        (await mint(expiring)).status,
        403,
        'an expired row is refused',
      );
    });

    test('signing out ends the session', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let session = await signIn(username, password);
      let auth = `Bearer ${session.token}`;
      assert.strictEqual((await mint(auth)).status, 201);

      let appSession = `Bearer ${createRealmServerJWT(
        { user: session.user, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let wrongSession = await request
        .delete('/_secure-session')
        .set('Authorization', appSession);
      assert.strictEqual(
        wrongSession.status,
        400,
        "the app's session has no secure session to end",
      );

      let ended = await request
        .delete('/_secure-session')
        .set('Authorization', auth);
      assert.strictEqual(ended.status, 204);
      assert.strictEqual(
        (await mint(auth)).status,
        403,
        'a signed-out session mints nothing',
      );
    });

    test('no other path mints the secure-session claim', async function (assert) {
      assert.throws(
        () =>
          createRealmServerJWT(
            {
              user: '@someone:localhost',
              sessionRoom: 'room',
              secureSession: randomUUID(),
            },
            realmSecretSeed,
          ),
        /secureSession claim/,
        'the realm-server session minter refuses it',
      );
      assert.throws(
        () =>
          createRealmJWT(
            {
              user: '@someone:localhost',
              realm: 'http://127.0.0.1:4444/test/',
              sessionRoom: 'room',
              permissions: ['read'],
              realmServerURL: 'http://127.0.0.1:4444/',
              secureSession: randomUUID(),
            } as any,
            '1h',
            realmSecretSeed,
          ),
        /secureSession claim/,
        'the realm session minter refuses it',
      );

      let serverRoot = join(import.meta.dirname, '..');
      let callers = serverSources(serverRoot)
        .filter((file) =>
          /createSecureSessionJWT\s*\(/.test(readFileSync(file, 'utf8')),
        )
        .map((file) => file.slice(serverRoot.length + 1))
        .sort();
      assert.deepEqual(
        callers,
        ['lib/secure-session.ts', 'utils/jwt.ts'],
        'only the secure sign-in mints it',
      );
    });

    test('nothing a sign-in sends reaches the request log or telemetry', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let lines = await withLogDefinition('realm:requests', 'info', () =>
        logLinesDuring(['realm:requests', 'realm:secure-session'], async () => {
          let started = await startRequest(username);
          await completeRequest({
            signIn: started.body.data.attributes.signIn,
            password: `${password}-wrong`,
          });
          await completeRequest({
            signIn: started.body.data.attributes.signIn,
            password,
          });
        }),
      );
      assert.true(lines.length > 0, 'the requests are logged');
      for (let line of lines) {
        assert.false(line.message.includes(password), 'no line carries it');
      }
      for (let path of ['/_secure-session', '/_secure-session/sign-in']) {
        assert.true(
          keepsMethodAndPathOnly({ url: `http://127.0.0.1:4444${path}` }),
          `${path} keeps only method and path`,
        );
      }
    });

    test('the secure origin is published for clients outside the browser', async function (assert) {
      let response = await request.get('/_secure-origin');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.body.data.attributes.url,
        secureOriginURL.href,
      );
    });
  });
});
