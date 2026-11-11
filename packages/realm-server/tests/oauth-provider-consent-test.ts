import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { randomBytes } from 'crypto';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  createVirtualNetwork,
  ensureMatrixAdminUser,
  fixtureDir,
  matrixRegistrationSecret,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from './helpers/oauth-provider.ts';
import {
  assertNoSecrets,
  telemetryDuring,
} from './helpers/oauth-provider-secrets.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { getMatrixAdminToken, registerUser } from '../synapse.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  findConsentDecision,
  sha256Hex,
  takeConsentTicket,
} from '../lib/oauth-provider/objects.ts';
import { buildRegistry } from '../lib/oauth-provider/registry.ts';
import type { CallerLimit } from '../lib/oauth-provider/caller-limit.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const { copySync, ensureDirSync } = fsExtra;

const serverURL = new URL('http://127.0.0.1:0/');
const ISSUER = 'http://127.0.0.1:0';
const MCP = `${ISSUER}/mcp`;
const SECURE_ORIGIN = testOAuthSecureOriginURL.origin;
const WEB_REDIRECT_URI = 'https://app.connector.example.co.uk/callback';
const LOOPBACK_REDIRECT_URI = 'http://127.0.0.1/callback';
const ADMIN = { matrixURL, adminUsername: 'admin', adminPassword: 'password' };

// What the registry says about `/mcp`, which the page must show whatever the
// client sent.
const MCP_ENTRY = buildRegistry(ISSUER).find(({ id }) => id === MCP)!;

const ROOMY_LIMIT: CallerLimit = {
  perAddress: { requests: 1000, windowSeconds: 600 },
  perNetwork: { requests: 1000, windowSeconds: 600 },
  overall: { requests: 1000, windowSeconds: 600 },
  alertAfter: 999,
};

async function start({
  dbAdapter,
  publisher,
  runner,
}: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  let realmsRootPath = join(dirSync().name, 'realm_server_oauth_consent');
  let testRealmDir = join(realmsRootPath, 'root');
  ensureDirSync(testRealmDir);
  copySync(fixtureDir('simple'), testRealmDir);
  let { testRealmHttpServer } = await runTestRealmServer({
    virtualNetwork: createVirtualNetwork(),
    testRealmDir,
    realmsRootPath,
    realmURL: serverURL,
    dbAdapter,
    publisher,
    runner,
    matrixURL,
    secureOriginURL: testOAuthSecureOriginURL,
    clientAddress: { trustedProxyHops: 0, infraAddresses: [] },
    oauthProvider: testOAuthProviderConfig(),
    oauthNewClientLimit: ROOMY_LIMIT,
    oauthAuthorizationLimit: ROOMY_LIMIT,
  });
  return testRealmHttpServer;
}

// A Matrix account, with an email address when `email` is given.
async function matrixAccount({
  email,
  displayname,
}: { email?: string; displayname?: string } = {}): Promise<string> {
  let username = `consent-${randomBytes(6).toString('hex')}`;
  let { userId } = await registerUser({
    matrixURL,
    displayname: displayname ?? username,
    username,
    password: `pw-${randomBytes(12).toString('hex')}`,
    registrationSecret: matrixRegistrationSecret,
  });
  if (email) {
    let response = await fetch(
      new URL(
        `_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
        matrixURL,
      ),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${await getMatrixAdminToken(ADMIN)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threepids: [{ medium: 'email', address: email }],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`could not add the email: ${response.status}`);
    }
  }
  return userId;
}

function interactionUid(location: string): string {
  let prefix = `${ISSUER}/_oauth-provider/interaction/`;
  if (!location?.startsWith(prefix)) {
    throw new Error(`not the interaction route: ${location}`);
  }
  return location.slice(prefix.length);
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let db: PgAdapter;

  hooks.before(async function () {
    await ensureMatrixAdminUser();
  });

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      let built = await start(args);
      return () => closeServer(built);
    },
  });
  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      db = dbAdapter;
      server = await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function register({
    redirectUri = WEB_REDIRECT_URI,
    clientName = 'Test App',
    grantTypes,
  }: {
    redirectUri?: string;
    clientName?: string;
    grantTypes?: string[];
  } = {}): Promise<string> {
    let response = await supertest(server!)
      .post('/_oauth-provider/reg')
      .set('Host', serverURL.host)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          client_name: clientName,
          redirect_uris: [redirectUri],
          ...(grantTypes ? { grant_types: grantTypes } : {}),
        }),
      );
    if (response.status !== 201) {
      throw new Error(`registration failed: ${JSON.stringify(response.body)}`);
    }
    return response.body.client_id as string;
  }

  // Starts a flow the way an app does, and answers its interaction ID.
  async function startFlow(
    clientId: string,
    {
      redirectUri = WEB_REDIRECT_URI,
      scope = 'boxel:read',
    }: { redirectUri?: string; scope?: string } = {},
  ): Promise<string> {
    let query = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope,
      resource: MCP,
      state: 'state-marker-7c2e',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    });
    let response = await supertest(server!)
      .get(`/_oauth-provider/auth?${query}`)
      .set('Host', serverURL.host);
    if (response.status !== 303) {
      throw new Error(`the flow didn't start: ${response.status}`);
    }
    return interactionUid(response.headers.location);
  }

  function details(
    uid: string,
    {
      authorization,
      origin = SECURE_ORIGIN,
    }: { authorization?: string; origin?: string } = {},
  ) {
    let request = supertest(server!)
      .get(`/_oauth-provider/consent/${uid}`)
      .set('Host', serverURL.host)
      .set('Origin', origin);
    return authorization
      ? request.set('Authorization', authorization)
      : request;
  }

  function decide(
    uid: string,
    body: unknown,
    {
      authorization,
      origin = SECURE_ORIGIN,
    }: { authorization?: string; origin?: string } = {},
  ) {
    let request = supertest(server!)
      .post(`/_oauth-provider/consent/${uid}`)
      .set('Host', serverURL.host)
      .set('Origin', origin)
      .set('Content-Type', 'application/json');
    if (authorization) {
      request = request.set('Authorization', authorization);
    }
    return request.send(JSON.stringify(body));
  }

  async function rawObjects(): Promise<string> {
    let rows = await db.execute(
      `SELECT kind, encode(id_hash, 'hex') AS id_hash, payload::text AS payload
         FROM oauth_provider_objects`,
    );
    return JSON.stringify(rows);
  }

  async function lifetimeOf(kind: string): Promise<number> {
    let [row] = (await db.execute(
      `SELECT extract(epoch FROM expires_at - created_at)::float AS lifetime
         FROM oauth_provider_objects WHERE kind = $1`,
      { bind: [kind] },
    )) as { lifetime: number }[];
    return row.lifetime;
  }

  module('who may ask', function () {
    test('a request without a secure window session is refused, and decides nothing', async function (assert) {
      let user = await matrixAccount();
      let uid = await startFlow(await register());
      let appSession = `Bearer ${createRealmServerJWT(
        { user, sessionRoom: 'test-session' },
        realmSecretSeed,
      )}`;
      let cliSession = await secureSessionAuth(db, user, { client: 'cli' });
      let windowSession = await secureSessionAuth(db, user);
      let refusals: [
        string,
        { authorization?: string; origin?: string },
        number,
      ][] = [
        ['no session', {}, 401],
        ['the app session', { authorization: appSession }, 401],
        ['a CLI secure session', { authorization: cliSession }, 401],
        [
          'a secure window session from another origin',
          { authorization: windowSession, origin: 'https://app.boxel.test' },
          403,
        ],
        [
          'a secure window session with no origin',
          { authorization: windowSession, origin: '' },
          403,
        ],
      ];
      for (let [name, caller, status] of refusals) {
        let read = await details(uid, caller);
        assert.strictEqual(read.status, status, `details: ${name}`);
        assert.strictEqual(read.headers['cache-control'], 'no-store');
        let decided = await decide(
          uid,
          { decision: 'allow', renew: true },
          caller,
        );
        assert.strictEqual(decided.status, status, `decision: ${name}`);
        assert.notOk(decided.body.ticket, `no ticket: ${name}`);
      }
      assert.strictEqual(
        await findConsentDecision(db, uid),
        undefined,
        'no decision was recorded',
      );
      let allowed = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: windowSession },
      );
      assert.strictEqual(
        allowed.status,
        201,
        'the secure window session can still decide the flow',
      );
    });

    test('a secure window session whose row has ended is refused', async function (assert) {
      let user = await matrixAccount();
      let uid = await startFlow(await register());
      let session = await secureSessionAuth(db, user);
      await db.execute(
        `UPDATE secure_sessions SET expires_at = now() - interval '1 second'
           WHERE user_id = $1`,
        { bind: [user] },
      );
      let read = await details(uid, { authorization: session });
      assert.strictEqual(read.status, 401);
      assert.deepEqual(read.body, { error: 'signed-out' });
    });
  });

  module('details', function () {
    test("they carry the registry's text and the account, whatever the client sent", async function (assert) {
      let user = await matrixAccount({ email: 'consent-reader@example.test' });
      let clientId = await register({
        clientName: 'Boxel (official) — read-only, nothing else',
      });
      let uid = await startFlow(clientId, { scope: 'boxel:read boxel:write' });
      let response = await details(uid, {
        authorization: await secureSessionAuth(db, user),
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, {
        app: {
          kind: 'dynamic',
          shown: 'example.co.uk',
          verified: false,
          claimedName: 'Boxel (official) — read-only, nothing else',
        },
        outsideApp: true,
        resources: [
          {
            id: MCP,
            name: MCP_ENTRY.name,
            description: MCP_ENTRY.description,
            coverage: MCP_ENTRY.coverage,
            scopes: MCP_ENTRY.scopes.map(
              ({ name, description, label, caution }) => ({
                name,
                description,
                label,
                caution,
              }),
            ),
          },
        ],
        account: { email: 'consent-reader@example.test' },
        renewalOffered: true,
      });
      assert.true(
        response.body.resources[0].scopes.some(
          ({ caution }: { caution: boolean }) => caution,
        ),
        'precondition: a scope is marked as a caution',
      );
    });

    test('only the scopes asked for are described', async function (assert) {
      let user = await matrixAccount();
      let uid = await startFlow(await register(), { scope: 'boxel:read' });
      let response = await details(uid, {
        authorization: await secureSessionAuth(db, user),
      });
      assert.deepEqual(
        response.body.resources[0].scopes.map(
          ({ name }: { name: string }) => name,
        ),
        ['boxel:read'],
      );
    });

    test('a loopback redirect is named as an app on this computer', async function (assert) {
      let user = await matrixAccount();
      let clientId = await register({ redirectUri: LOOPBACK_REDIRECT_URI });
      let uid = await startFlow(clientId, {
        redirectUri: LOOPBACK_REDIRECT_URI,
      });
      let response = await details(uid, {
        authorization: await secureSessionAuth(db, user),
      });
      assert.strictEqual(response.status, 200, response.text);
      assert.deepEqual(response.body.app, {
        kind: 'dynamic',
        shown: 'an app on this computer',
        verified: false,
        claimedName: 'Test App',
      });
    });

    test('an account without an email address is named by its display name', async function (assert) {
      let user = await matrixAccount({ displayname: 'Consent Reader' });
      let uid = await startFlow(await register());
      let response = await details(uid, {
        authorization: await secureSessionAuth(db, user),
      });
      assert.deepEqual(response.body.account, {
        displayName: 'Consent Reader',
      });
    });

    test('renewal is offered only to a client that may use the refresh grant', async function (assert) {
      let user = await matrixAccount();
      let session = await secureSessionAuth(db, user);
      let uid = await startFlow(
        await register({ grantTypes: ['authorization_code'] }),
      );
      let response = await details(uid, { authorization: session });
      assert.strictEqual(response.status, 200, response.text);
      assert.false(response.body.renewalOffered);

      let decided = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: session },
      );
      assert.strictEqual(decided.status, 201);
      assert.false(
        (await findConsentDecision(db, uid))!.renew,
        'a renewal the page could not offer is not recorded',
      );
    });

    test('an unknown or expired interaction has no details', async function (assert) {
      let user = await matrixAccount();
      let session = await secureSessionAuth(db, user);
      let unknown = await details(randomBytes(32).toString('base64url'), {
        authorization: session,
      });
      assert.strictEqual(unknown.status, 404);
      assert.deepEqual(unknown.body, { error: 'expired' });

      let uid = await startFlow(await register());
      await db.execute(
        `UPDATE oauth_provider_objects
           SET expires_at = now() - interval '1 second'
           WHERE kind = 'Interaction'`,
      );
      let expired = await details(uid, { authorization: session });
      assert.strictEqual(expired.status, 404);
      let decided = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: session },
      );
      assert.strictEqual(decided.status, 404);
      assert.strictEqual(await findConsentDecision(db, uid), undefined);
    });
  });

  module('decision', function () {
    test('Allow records the decision with the user and answers a ticket', async function (assert) {
      let user = await matrixAccount();
      let clientId = await register();
      let uid = await startFlow(clientId, { scope: 'boxel:read boxel:write' });
      let response = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: await secureSessionAuth(db, user) },
      );
      assert.strictEqual(response.status, 201, response.text);
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      let { ticket } = response.body;
      assert.strictEqual(typeof ticket, 'string');
      assert.deepEqual(await findConsentDecision(db, uid), {
        user,
        allowed: true,
        renew: true,
        clientId,
        scopes: { [MCP]: ['boxel:read', 'boxel:write'] },
      });
      assert.deepEqual(
        await takeConsentTicket(db, ticket),
        { interaction: sha256Hex(uid) },
        'the ticket names its flow',
      );
      assert.strictEqual(
        await takeConsentTicket(db, ticket),
        undefined,
        'a ticket is taken once',
      );
    });

    test('Deny records a decision that renews nothing', async function (assert) {
      let user = await matrixAccount();
      let uid = await startFlow(await register());
      let response = await decide(
        uid,
        { decision: 'deny', renew: true },
        { authorization: await secureSessionAuth(db, user) },
      );
      assert.strictEqual(response.status, 201, response.text);
      let decision = await findConsentDecision(db, uid);
      assert.false(decision!.allowed);
      assert.false(decision!.renew);
    });

    test('a flow is decided once', async function (assert) {
      let user = await matrixAccount();
      let session = await secureSessionAuth(db, user);
      let uid = await startFlow(await register());
      let first = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: session },
      );
      assert.strictEqual(first.status, 201);
      let second = await decide(
        uid,
        { decision: 'deny', renew: false },
        { authorization: session },
      );
      assert.strictEqual(second.status, 409);
      assert.deepEqual(second.body, { error: 'decided' });
      assert.true(
        (await findConsentDecision(db, uid))!.allowed,
        'the first decision stands',
      );

      let other = await secureSessionAuth(db, await matrixAccount());
      let byAnother = await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: other },
      );
      assert.strictEqual(
        byAnother.status,
        409,
        'another user cannot decide it either',
      );
    });

    test('a decision that is not one is refused', async function (assert) {
      let user = await matrixAccount();
      let session = await secureSessionAuth(db, user);
      let uid = await startFlow(await register());
      for (let body of [
        {},
        { decision: 'allow' },
        { decision: 'maybe', renew: true },
        { decision: 'allow', renew: 'yes' },
        ['allow'],
        { decision: 'allow', renew: true, padding: 'x'.repeat(2000) },
      ]) {
        let response = await decide(uid, body, { authorization: session });
        assert.strictEqual(
          response.status,
          400,
          `refused: ${JSON.stringify(body).slice(0, 60)}`,
        );
      }
      assert.strictEqual(await findConsentDecision(db, uid), undefined);
    });

    test('the ticket lives a minute, and never past its interaction', async function (assert) {
      let session = await secureSessionAuth(db, await matrixAccount());
      let uid = await startFlow(await register());
      await decide(
        uid,
        { decision: 'allow', renew: true },
        { authorization: session },
      );
      let lifetime = await lifetimeOf('ConsentTicket');
      assert.true(lifetime > 58, `a ticket lives a minute (${lifetime})`);
      assert.true(lifetime <= 60, `and no longer (${lifetime})`);

      // A flow with 20 seconds left.
      let late = await startFlow(await register());
      await db.execute(
        `UPDATE oauth_provider_objects
           SET payload = jsonb_set(payload, '{exp}',
             to_jsonb(extract(epoch FROM now())::int + 20))
           WHERE kind = 'Interaction' AND id_hash = decode($1, 'hex')`,
        { bind: [sha256Hex(late)] },
      );
      await db.execute(
        `DELETE FROM oauth_provider_objects WHERE kind = 'ConsentTicket'`,
      );
      let response = await decide(
        late,
        { decision: 'allow', renew: true },
        { authorization: session },
      );
      assert.strictEqual(response.status, 201, response.text);
      assert.true(
        (await lifetimeOf('ConsentTicket')) <= 21,
        'the ticket ends with its interaction',
      );
    });

    test('an expired ticket is gone', async function (assert) {
      let session = await secureSessionAuth(db, await matrixAccount());
      let uid = await startFlow(await register());
      let { ticket } = (
        await decide(
          uid,
          { decision: 'allow', renew: true },
          { authorization: session },
        )
      ).body;
      await db.execute(
        `UPDATE oauth_provider_objects
           SET expires_at = now() - interval '1 second'
           WHERE kind = 'ConsentTicket'`,
      );
      assert.strictEqual(await takeConsentTicket(db, ticket), undefined);
    });
  });

  module('secrets', function () {
    test('no ticket or interaction ID is stored readable, logged or sent to Sentry', async function (assert) {
      let user = await matrixAccount({ email: 'consent-secret@example.test' });
      let session = await secureSessionAuth(db, user);
      let clientId = await register();
      let uid = '';
      let ticket = '';
      let telemetry = await telemetryDuring(async () => {
        uid = await startFlow(clientId);
        await details(uid, { authorization: session });
        ticket = (
          await decide(
            uid,
            { decision: 'allow', renew: true },
            { authorization: session },
          )
        ).body.ticket;
      });
      assert.true(
        telemetry.logs.includes('/_oauth-provider/consent/:uid'),
        'the request log names the consent route by its label',
      );
      assert.true(
        telemetry.logs.includes('consent shown'),
        'consents shown are logged',
      );
      assert.true(
        telemetry.logs.includes('consent allowed'),
        'consents allowed are logged',
      );
      assertNoSecrets(assert, telemetry, {
        'interaction ID': uid,
        ticket,
        email: 'consent-secret@example.test',
      });
      let stored = await rawObjects();
      assert.true(
        stored.includes('ConsentDecision'),
        'precondition: the decision is stored',
      );
      assert.true(
        stored.includes('ConsentTicket'),
        'precondition: the ticket is stored',
      );
      assert.false(stored.includes(uid), 'no row holds the interaction ID');
      assert.false(stored.includes(ticket), 'no row holds the ticket');
    });
  });
});
