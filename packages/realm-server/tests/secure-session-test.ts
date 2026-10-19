import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { readdirSync, readFileSync, statSync } from 'fs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { getOrCreateUser, upsertSessionRoom } from '@cardstack/runtime-common';
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
const GOOGLE_CLIENT_ID = 'secure-session-test-client';
const GOOGLE_CLIENT_SECRET = 'secure-session-test-secret';

async function adminRequest(path: string, init: RequestInit = {}) {
  let adminToken = await getMatrixAdminToken(ADMIN);
  return await fetch(new URL(path, matrixURL), {
    ...init,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// A Matrix account with a password. With `boxelAccount`, it has also signed in
// to Boxel, which is what records its session room.
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
    await getOrCreateUser(dbAdapter, userId);
    await upsertSessionRoom(
      dbAdapter,
      userId,
      `!session-${username}:localhost`,
    );
  }
  return { username, password, userId };
}

async function updateAccount(userId: string, body: Record<string, unknown>) {
  let response = await adminRequest(
    `_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
  if (!response.ok) {
    throw new Error(`could not update the account: ${response.status}`);
  }
}

// Links a Google identity to the account, as Boxel's OIDC mapping provider
// does when the user first signs in with Google.
async function linkGoogle(userId: string, sub: string) {
  await updateAccount(userId, {
    external_ids: [{ auth_provider: 'oidc-google', external_id: sub }],
  });
}

async function threepids(userId: string) {
  let response = await adminRequest(
    `_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
  );
  return ((await response.json()) as { threepids: unknown[] }).threepids;
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url');
}

interface IssuedCode {
  sub: string;
  nonce: string;
  challenge: string;
  claims?: Record<string, unknown>;
  reusable?: boolean;
}

// Stands in for Google: OpenID discovery, and a token endpoint that redeems
// the codes a test issues. Each code is issued for a subject, a nonce and a
// PKCE challenge, as Google's authorization endpoint would, and is redeemed
// once unless the test asks otherwise.
class FakeGoogle {
  server: HttpServer;
  issuer = '';
  exchanges: URLSearchParams[] = [];
  private codes = new Map<string, IssuedCode>();

  constructor() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let { status, json } = this.answer(req.url ?? '/', body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      });
    });
  }

  async start() {
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    let { port } = this.server.address() as AddressInfo;
    this.issuer = `http://127.0.0.1:${port}`;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  issue(
    sub: string,
    {
      claims,
      reusable,
    }: { claims?: Record<string, unknown>; reusable?: boolean } = {},
  ) {
    let code = randomBytes(16).toString('hex');
    let nonce = randomBytes(16).toString('hex');
    let codeVerifier = randomBytes(32).toString('base64url');
    let challenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    this.codes.set(code, { sub, nonce, challenge, claims, reusable });
    return { code, nonce, codeVerifier };
  }

  private answer(url: string, body: string): { status: number; json: unknown } {
    if (url === '/.well-known/openid-configuration') {
      return {
        status: 200,
        json: {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/authorize`,
          token_endpoint: `${this.issuer}/token`,
        },
      };
    }
    if (url !== '/token') {
      return { status: 404, json: {} };
    }
    let params = new URLSearchParams(body);
    this.exchanges.push(params);
    let code = params.get('code') ?? '';
    let issued = this.codes.get(code);
    let verifier = params.get('code_verifier') ?? '';
    if (
      !issued ||
      params.get('client_id') !== GOOGLE_CLIENT_ID ||
      params.get('client_secret') !== GOOGLE_CLIENT_SECRET ||
      createHash('sha256').update(verifier).digest('base64url') !==
        issued.challenge
    ) {
      return { status: 400, json: { error: 'invalid_grant' } };
    }
    if (!issued.reusable) {
      this.codes.delete(code);
    }
    let claims = {
      iss: this.issuer,
      aud: GOOGLE_CLIENT_ID,
      sub: issued.sub,
      nonce: issued.nonce,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...issued.claims,
    };
    return {
      status: 200,
      json: {
        id_token: `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(claims))}.`,
      },
    };
  }
}

const SECURE_SESSIONS_MIGRATION = join(
  dirname(
    createRequire(import.meta.url).resolve('@cardstack/postgres/package.json'),
  ),
  'migrations',
  '1792107467874_add-secure-sessions.js',
);

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
    let google = new FakeGoogle();
    let secureOriginURL = new URL('https://secure.secure-session.test/secure');
    let secureOrigin = secureOriginURL.origin;

    hooks.before(async function () {
      await ensureMatrixAdminUser();
      await google.start();
    });
    hooks.after(async function () {
      await google.stop();
    });

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
          googleSignIn: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            issuer: google.issuer,
          },
        });
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
        resetSecretsAtRest();
      },
    });

    function post(
      path: string,
      type: string,
      attributes: Record<string, unknown>,
      origin: string | null = secureOrigin,
    ) {
      let req = request
        .post(path)
        .set('Content-Type', 'application/vnd.api+json');
      if (origin !== null) {
        req = req.set('Origin', origin);
      }
      return req.send({ data: { type, attributes } });
    }

    function passwordSignIn(
      username: string,
      password: string,
      origin: string | null = secureOrigin,
    ) {
      return post(
        '/_secure-session',
        'secure-session',
        { username, password, client: 'window' },
        origin,
      );
    }

    function googleSignIn(
      attributes: Record<string, unknown>,
      origin: string | null = secureOrigin,
    ) {
      return post(
        '/_secure-session/google',
        'google-sign-in',
        { client: 'window', ...attributes },
        origin,
      );
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

    async function runSecureSessionsMigration() {
      let statements: string[] = [];
      createRequire(import.meta.url)(SECURE_SESSIONS_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    test('signing in with a password gives a session that mints key write tickets', async function (assert) {
      let { username, password, userId } =
        await registerPasswordUser(dbAdapter);

      let response = await passwordSignIn(username, password);
      assert.strictEqual(response.status, 201, response.text);
      let session = response.body.data.attributes;
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
        'checking the password changed nothing on the account',
      );
    });

    test('a password sign-in can name the account by email address', async function (assert) {
      let { password, userId } = await registerPasswordUser(dbAdapter);
      let email = `${randomBytes(6).toString('hex')}@secure-session.test`;
      await updateAccount(userId, {
        threepids: [{ medium: 'email', address: email }],
      });
      let response = await passwordSignIn(email.toUpperCase(), password);
      assert.strictEqual(response.status, 201, response.text);
      assert.strictEqual(response.body.data.attributes.user, userId);
    });

    test('a failed password sign-in says nothing about the account', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let outsider = await registerPasswordUser(dbAdapter, {
        boxelAccount: false,
      });
      let wrongPassword = await passwordSignIn(username, `${password}-wrong`);
      let noSuchUser = await passwordSignIn(
        `nobody-${randomBytes(6).toString('hex')}`,
        password,
      );
      let noSuchEmail = await passwordSignIn(
        `${randomBytes(6).toString('hex')}@nowhere.test`,
        password,
      );
      let notInBoxel = await passwordSignIn(
        outsider.username,
        outsider.password,
      );
      for (let refusal of [noSuchUser, noSuchEmail, notInBoxel]) {
        assert.strictEqual(refusal.status, 401);
        assert.deepEqual(
          refusal.body,
          wrongPassword.body,
          'it is the same answer as a wrong password',
        );
      }
      assert.strictEqual(wrongPassword.status, 401);
      assert.strictEqual(
        wrongPassword.body.errors[0].code,
        'invalid-credentials',
      );
    });

    test('password sign-ins are limited per account', async function (assert) {
      let { username, password } = await registerPasswordUser(dbAdapter);
      let statuses = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        statuses.push(
          (await passwordSignIn(username, `${password}-wrong-${attempt}`))
            .status,
        );
      }
      assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
      let limited = await passwordSignIn(username, password);
      assert.strictEqual(
        limited.status,
        429,
        'even the right password waits once the limit is reached',
      );
      assert.strictEqual(limited.body.errors[0].code, 'rate-limited');
    });

    test('signing in is answered only for the secure origin', async function (assert) {
      let { username, password, userId } =
        await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);
      for (let origin of [APP_ORIGIN, 'null', null]) {
        let viaPassword = await passwordSignIn(username, password, origin);
        assert.strictEqual(
          viaPassword.status,
          403,
          `a password sign-in is refused (Origin: ${origin ?? 'none'})`,
        );
        let viaGoogle = await googleSignIn(google.issue(sub), origin);
        assert.strictEqual(
          viaGoogle.status,
          403,
          `a Google sign-in is refused (Origin: ${origin ?? 'none'})`,
        );
      }
    });

    test('the secure window learns where to send the user for Google', async function (assert) {
      let response = await request.get('/_secure-session/google');
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body.data.attributes, {
        authorizationEndpoint: `${google.issuer}/authorize`,
        clientId: GOOGLE_CLIENT_ID,
        redirectURI: `${secureOriginURL.href}/google-callback`,
      });
    });

    test('signing in with Google gives a session for the linked account', async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);

      let response = await googleSignIn(google.issue(sub));
      assert.strictEqual(response.status, 201, response.text);
      let session = response.body.data.attributes;
      assert.strictEqual(session.user, userId);
      assert.strictEqual(
        (await mint(`Bearer ${session.token}`)).status,
        201,
        'the session mints a ticket',
      );
      assert.strictEqual(
        google.exchanges.at(-1)!.get('redirect_uri'),
        `${secureOriginURL.href}/google-callback`,
        "the code is redeemed for the secure origin's callback",
      );
    });

    test("a Google sign-in is refused when Google's answer doesn't fit it", async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);

      let unlinked = await googleSignIn(google.issue(`google-${randomUUID()}`));
      assert.strictEqual(unlinked.status, 403, 'an unlinked Google account');
      assert.strictEqual(unlinked.body.errors[0].code, 'not-linked');

      let wrongNonce = await googleSignIn({
        ...google.issue(sub),
        nonce: 'another-sign-in',
      });
      assert.strictEqual(wrongNonce.status, 401, 'another sign-in’s nonce');

      let wrongVerifier = await googleSignIn({
        ...google.issue(sub),
        codeVerifier: randomBytes(32).toString('base64url'),
      });
      assert.strictEqual(wrongVerifier.status, 401, 'the wrong PKCE verifier');

      let otherClient = await googleSignIn(
        google.issue(sub, { claims: { aud: 'another-client' } }),
      );
      assert.strictEqual(otherClient.status, 401, 'another client’s token');
      let otherIssuer = await googleSignIn(
        google.issue(sub, { claims: { iss: 'https://evil.test' } }),
      );
      assert.strictEqual(otherIssuer.status, 401, 'another issuer’s token');
      let expired = await googleSignIn(
        google.issue(sub, {
          claims: { exp: Math.floor(Date.now() / 1000) - 10 },
        }),
      );
      assert.strictEqual(expired.status, 401, 'an expired token');
    });

    test('a deactivated account is refused with Google', async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);
      await updateAccount(userId, { deactivated: true });
      let response = await googleSignIn(google.issue(sub));
      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.errors[0].code, 'deactivated');
    });

    test('a Google sign-in signs in once, even after its session ends', async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);
      // A provider that would redeem the same code twice, so only the server's
      // own record of what signed in stops the second use.
      let issued = google.issue(sub, { reusable: true });

      let first = await googleSignIn(issued);
      assert.strictEqual(first.status, 201);
      let again = await googleSignIn(issued);
      assert.strictEqual(again.status, 409, 'the same code again is refused');
      assert.strictEqual(again.body.errors[0].code, 'used');

      let ended = await request
        .delete('/_secure-session')
        .set('Authorization', `Bearer ${first.body.data.attributes.token}`);
      assert.strictEqual(ended.status, 204);
      let afterSignOut = await googleSignIn(issued);
      assert.strictEqual(
        afterSignOut.status,
        409,
        'and after signing out it still is',
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
      let { username, password, userId } =
        await registerPasswordUser(dbAdapter);
      let session = (await passwordSignIn(username, password)).body.data
        .attributes;
      let auth = `Bearer ${session.token}`;
      assert.strictEqual((await mint(auth)).status, 201);

      let appSession = `Bearer ${createRealmServerJWT(
        { user: userId, sessionRoom: 'test-session' },
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

    test('a secure session can check that it is still signed in', async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let auth = await secureSessionAuth(dbAdapter, userId);
      let check = (authorization: string) =>
        request.get('/_secure-session').set('Authorization', authorization);

      assert.strictEqual((await check(auth)).status, 204, 'signed in');

      let appSession = `Bearer ${createRealmServerJWT(
        { user: userId, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let app = await check(appSession);
      assert.strictEqual(app.status, 401, "the app's session is not one");
      assert.strictEqual(app.body.errors[0].code, 'signed-out');

      await request.delete('/_secure-session').set('Authorization', auth);
      let ended = await check(auth);
      assert.strictEqual(ended.status, 401, 'a signed-out session is not one');
      assert.strictEqual(ended.body.errors[0].code, 'signed-out');
    });

    test("signing out of the app signs the user's secure windows out", async function (assert) {
      let { userId } = await registerPasswordUser(dbAdapter);
      let other = await registerPasswordUser(dbAdapter);
      let windows = [
        await secureSessionAuth(dbAdapter, userId),
        await secureSessionAuth(dbAdapter, userId),
      ];
      let cli = await secureSessionAuth(dbAdapter, userId, { client: 'cli' });
      let othersWindow = await secureSessionAuth(dbAdapter, other.userId);
      let appSession = `Bearer ${createRealmServerJWT(
        { user: userId, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let endWindows = (query = '?client=window') =>
        request.delete(`/_secure-sessions${query}`);

      assert.strictEqual(
        (await endWindows()).status,
        401,
        'an unauthenticated request is refused',
      );
      for (let query of ['', '?client=cli']) {
        assert.strictEqual(
          (await endWindows(query).set('Authorization', appSession)).status,
          400,
          `only window sessions are ended (${query || 'no client'})`,
        );
      }
      for (let auth of windows) {
        assert.strictEqual((await mint(auth)).status, 201, 'signed in');
      }

      let ended = await endWindows().set('Authorization', appSession);
      assert.strictEqual(ended.status, 204);
      assert.deepEqual(ended.body, {}, 'the answer says nothing');
      for (let auth of windows) {
        assert.strictEqual(
          (await mint(auth)).status,
          403,
          'a signed-out window mints nothing',
        );
      }
      assert.strictEqual(
        (await mint(cli)).status,
        201,
        "the user's CLI session is left alone",
      );
      assert.strictEqual(
        (await mint(othersWindow)).status,
        201,
        "another user's window is left alone",
      );

      let rows = (await dbAdapter.execute(
        `SELECT expires_at <= NOW() AS ended FROM secure_sessions
          WHERE user_id = $1 AND client = 'window'`,
        { bind: [userId] },
      )) as { ended: boolean }[];
      assert.deepEqual(
        rows.map((row) => row.ended),
        [true, true],
        'the rows are expired, not deleted, so their proofs stay spent',
      );

      assert.strictEqual(
        (await endWindows().set('Authorization', appSession)).status,
        204,
        'answered alike when there is nothing to end',
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
      let { username, password, userId } =
        await registerPasswordUser(dbAdapter);
      let sub = `google-${randomUUID()}`;
      await linkGoogle(userId, sub);
      let issued = google.issue(sub);
      let lines = await withLogDefinition('realm:requests', 'info', () =>
        logLinesDuring(['realm:requests', 'realm:secure-session'], async () => {
          await passwordSignIn(username, `${password}-wrong`);
          await passwordSignIn(username, password);
          await googleSignIn(issued);
        }),
      );
      assert.true(lines.length > 0, 'the requests are logged');
      for (let line of lines) {
        assert.false(line.message.includes(password), 'no line carries it');
        assert.false(line.message.includes(issued.code), 'nor the code');
        assert.false(
          line.message.includes(issued.codeVerifier),
          'nor the verifier',
        );
      }
      for (let path of [
        '/_secure-session',
        '/_secure-session/google',
        '/_secure-sessions?client=window',
      ]) {
        assert.true(
          keepsMethodAndPathOnly({ url: `http://127.0.0.1:4444${path}` }),
          `${path} keeps only method and path`,
        );
      }
    });

    test("the read-only role can't select secure_sessions, and its owner still can", async function (assert) {
      // The role and its blanket grant as staging and production have them,
      // a member that inherits it and was also granted SELECT directly, then
      // the migration that withholds the table.
      for (let role of [
        'readonly_role',
        'readonly_member_for_secure_sessions',
      ]) {
        await dbAdapter.execute(
          `DO $$
           BEGIN
             CREATE ROLE ${role};
           EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
           END
           $$`,
        );
      }
      await dbAdapter.execute(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
      );
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_member_for_secure_sessions`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE secure_sessions TO readonly_member_for_secure_sessions`,
      );
      await runSecureSessionsMigration();

      async function selectAs(role: string, sql: string) {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }
      for (let role of [
        'readonly_role',
        'readonly_member_for_secure_sessions',
      ]) {
        await assert.rejects(
          selectAs(role, `SELECT * FROM secure_sessions`),
          /permission denied for table secure_sessions/,
          `${role} can't select secure_sessions`,
        );
      }
      let [{ owner }] = (await dbAdapter.execute(
        `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
          WHERE oid = 'secure_sessions'::regclass`,
      )) as { owner: string }[];
      assert.deepEqual(
        await selectAs(
          owner,
          `SELECT COUNT(*) >= 0 AS readable FROM secure_sessions`,
        ),
        [{ readable: true }],
        "the table's owner keeps reading it",
      );

      // A grant the migration's revokes can't remove, made by another role
      // holding the grant option, stops the migration.
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE granter_for_secure_sessions;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE secure_sessions TO granter_for_secure_sessions WITH GRANT OPTION`,
      );
      await dbAdapter.withTransaction(async (query: any) => {
        await query([`SET LOCAL ROLE granter_for_secure_sessions`]);
        await query([
          `GRANT SELECT ON TABLE secure_sessions TO readonly_member_for_secure_sessions`,
        ]);
      });
      await assert.rejects(
        runSecureSessionsMigration(),
        /readonly_member_for_secure_sessions can read secure_sessions/,
        'the migration names the role that can still read it',
      );
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
