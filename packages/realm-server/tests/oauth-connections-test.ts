import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import {
  startStubOAuthProvider,
  type StubOAuthProvider,
} from './helpers/stub-oauth-provider.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  type SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  mintKeyWriteTicket,
  replaceUserKeyValue,
  type KeyWriteAction,
} from '../lib/user-keys.ts';
import { shareKey, suspendShare } from '../lib/key-shares.ts';
import {
  addOAuthClient,
  addPlatformClient,
  configureOAuth,
  resetOAuth,
} from '../lib/oauth.ts';

// ============================================================================
// OAuth clients and connections end to end, against a stub OAuth vendor that
// is the authorization server and the API both: a person connects through a
// client from the secure window, approves an operation for the connection,
// and a pipeline calls the API with an access token the realm server mints
// and refreshes.
//
// The vendor's URL is written into the card module before anything starts,
// so it listens on a fixed port. Its other loopback name is another host.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/oauth-connections-test/');
const secureOriginURL = new URL('https://secure.oauth.test/secure');
const PROVIDER_PORT = 4526;
const PROVIDER = `http://127.0.0.1:${PROVIDER_PORT}`;
const OTHER_HOST = `http://localhost:${PROVIDER_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@oauth-owner:localhost';
const TEAMMATE = '@oauth-teammate:localhost';
const REALM_USER = '@node-test_realm:localhost';
const CLIENT_ID = 'Iv1.stub-client';
const CLIENT_SECRET = 'stub-client-secret-6c1e0f';
const ROTATED_SECRET = 'stub-client-secret-rotated-9a2b';
const SERVICE = { module: rri(`${realmURL.href}service`), name: 'Service' };

const serviceModule = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";

  export class Service extends CardDef {
    @field title = contains(StringField);

    @operation static me = {
      base: 'callApi',
      url: '${PROVIDER}/api/user',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static elsewhere = {
      base: 'callApi',
      url: '${OTHER_HOST}/api/user',
      headers: { authorization: 'Bearer {{userKey}}' },
    };

    @operation static probe = {
      base: 'callApi',
      url: '${PROVIDER}/probe',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

const service: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: { title: 'the service' },
    meta: { adoptsFrom: SERVICE },
  },
};

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let keyring: SecretsKeyring;
  let provider: StubOAuthProvider;
  let clock: number;

  hooks.before(async function () {
    provider = await startStubOAuthProvider({
      port: PROVIDER_PORT,
      clients: [],
    });
  });
  hooks.after(async function () {
    await provider.close();
  });

  hooks.beforeEach(async function () {
    keyring = installSecretsKeyring(
      await new LocalKeyProvider().loadDataKeys(),
    );
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    clock = Date.now();
    configureOAuth({ retryDelaysMs: [0, 0], now: () => clock });
    Object.assign(provider, {
      clients: [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }],
      tokenRequests: [],
      apiCalls: [],
      authorizeRequests: [],
      issued: [],
      expiresIn: 3600,
      issueRefreshTokens: true,
      rotate: true,
      fail: [],
      tokenDelayMs: 0,
      deny: false,
    });
  });
  hooks.afterEach(function () {
    resetOAuth();
    resetOutbound();
    resetSecretsAtRest();
  });

  setupPermissionedRealmCached(hooks, {
    realmURL,
    secureOriginURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [TEAMMATE]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'service.gts': serviceModule,
      'the-service.json': service,
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
    },
  });

  async function ticket(
    owner: string,
    action: KeyWriteAction,
    {
      keyId = null,
      realm: realmOf = null,
    }: { keyId?: string | null; realm?: URL | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, owner, {
        action,
        keyId,
        realmURL: realmOf?.href ?? null,
        shareId: null,
      })
    ).ticket;
  }

  function clientSettings(overrides: Record<string, unknown> = {}) {
    return {
      clientId: CLIENT_ID,
      authorizeUrl: `${PROVIDER}/authorize`,
      tokenUrl: `${PROVIDER}/token`,
      scopes: 'read:user repo:status',
      apiHosts: [`${PROVIDER}/api/`],
      ...overrides,
    };
  }

  async function addClient(owner = OWNER, overrides = {}, name = 'stub app') {
    return await addOAuthClient(dbAdapter, keyring, {
      owner,
      name,
      value: CLIENT_SECRET,
      oauth: clientSettings(overrides),
      ticket: await ticket(owner, 'add'),
    });
  }

  // Finishes a sign-in as the `connected` page does: posts the code and
  // state its fragment carries, under `user`'s secure session.
  async function complete(user: string, landing: string) {
    let fragment = new URLSearchParams(new URL(landing).hash.slice(1));
    if (fragment.has('error')) {
      return { error: fragment.get('error')!, text: '' };
    }
    let finished = await request
      .post('/_oauth/connections/complete')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'oauth-callback',
          attributes: {
            state: fragment.get('state'),
            code: fragment.get('code'),
          },
        },
      });
    let attributes = finished.body.data?.attributes ?? {};
    return {
      keyId: attributes.connected as string | undefined,
      error: attributes.error as string | undefined,
      text: finished.text,
    };
  }

  // Signs `user` in through a client as the secure window does: starts the
  // sign-in, follows the vendor's redirect back to the realm server's
  // callback, which hands the window the code, and finishes it as
  // `completeAs` (the same user, unless a test says otherwise). Answers with
  // the connection made or why not, and every body the browser saw.
  async function connect(
    user: string,
    client: Record<string, unknown>,
    {
      name = 'my account',
      reconnect,
      completeAs = user,
    }: { name?: string; reconnect?: string; completeAs?: string } = {},
  ) {
    let started = await request
      .post('/_oauth/connections')
      .set('Authorization', await secureSessionAuth(dbAdapter, user))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'oauth-connect',
          attributes: reconnect ? { reconnect, client } : { name, client },
        },
        meta: {
          ticket: reconnect
            ? await ticket(user, 'replace', { keyId: reconnect })
            : await ticket(user, 'add'),
        },
      });
    if (started.status !== 201) {
      return { started, seen: [started.text] } as any;
    }
    let authorize = await fetch(started.body.data.attributes.authorizeUrl, {
      redirect: 'manual',
    });
    let callback = new URL(authorize.headers.get('location')!);
    let back = await request.get(`${callback.pathname}${callback.search}`);
    let location = back.headers.location as string;
    let finished = await complete(completeAs, location);
    return {
      started,
      callback,
      back,
      location,
      keyId: finished.keyId,
      error: finished.error,
      seen: [started.text, back.text, finished.text],
    };
  }

  async function approve(user: string, keyId: string, operation = 'me') {
    let auth = await secureSessionAuth(dbAdapter, user);
    let shown = await request
      .get('/_key-bindings/preview')
      .query({
        realm: realmURL.href,
        module: SERVICE.module,
        name: SERVICE.name,
        operation,
      })
      .set('Authorization', auth);
    let destination = shown.body.data?.attributes?.destination;
    let fingerprint = shown.body.data?.attributes?.slots?.[0]?.fingerprint;
    return await request
      .post('/_key-bindings')
      .set('Authorization', auth)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm: realmURL.href,
            operations: [
              {
                codeRef: SERVICE,
                operation,
                expectedDestination: destination,
                slots: { userKey: { keyId, expectedFingerprint: fingerprint } },
              },
            ],
          },
        },
      });
  }

  async function call(user: string, operation = 'me') {
    let response = (await realm.handlePipeline(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(realm, user, ['read', 'write'])}`,
        },
        body: JSON.stringify({
          'boxel:operations': [
            { op: 'invoke', 'boxel:name': operation, href: '/the-service' },
          ],
        }),
      }),
    ))!;
    return {
      status: response.status,
      body: JSON.parse(await response.text()),
    };
  }

  async function connectAndApprove(user = OWNER) {
    let client = await addClient(user);
    let { keyId } = await connect(user, { kind: 'own', keyId: client.id });
    let approved = await approve(user, keyId);
    return { client, keyId, approved };
  }

  function refreshes() {
    return provider.tokenRequests.filter((r) => r.grantType === 'refresh_token')
      .length;
  }

  async function keyState(keyId: string) {
    let [row] = await dbAdapter.execute(
      `SELECT state FROM user_keys WHERE id = $1`,
      { bind: [keyId] },
    );
    return row?.state;
  }

  test('connecting through a client stores a connection, and no token reaches the browser', async function (assert) {
    let client = await addClient();
    let { started, callback, back, location, keyId, seen } = await connect(
      OWNER,
      {
        kind: 'own',
        keyId: client.id,
      },
    );
    assert.strictEqual(started.status, 201, started.text);
    let [asked] = provider.authorizeRequests;
    assert.strictEqual(asked.get('client_id'), CLIENT_ID);
    assert.strictEqual(asked.get('scope'), 'read:user repo:status');
    assert.strictEqual(asked.get('code_challenge_method'), 'S256');
    assert.strictEqual(
      callback!.pathname,
      '/_oauth/callback',
      'the vendor sends the person back to the realm server',
    );
    assert.strictEqual(back!.status, 302);
    let landing = new URL(location);
    assert.strictEqual(
      `${landing.origin}${landing.pathname}`,
      `${secureOriginURL.href}/connected`,
      'the realm server sends the window on to its connected page',
    );
    assert.strictEqual(landing.search, '', 'with nothing in the query string');
    assert.deepEqual(
      [...new URLSearchParams(landing.hash.slice(1)).keys()].sort(),
      ['code', 'state'],
      'and only the one-use code and the state in the fragment',
    );
    assert.ok(keyId, 'the connected page finished it');
    let [exchange] = provider.tokenRequests;
    assert.strictEqual(exchange.grantType, 'authorization_code');
    assert.ok(exchange.body.get('code_verifier'), 'with a PKCE verifier');
    assert.strictEqual(exchange.body.get('client_secret'), CLIENT_SECRET);
    for (let token of provider.issued) {
      assert.false(
        seen.some((text: string) => text.includes(token)),
        'nothing the browser sees carries a token the vendor issued',
      );
    }

    let listed = await request
      .get(`/_user-keys/${keyId}`)
      .set('Authorization', `Bearer ${createJWT(realm, OWNER, [])}`);
    assert.strictEqual(listed.status, 200, listed.text);
    assert.strictEqual(listed.body.data.attributes.kind, 'oauth-connection');
    assert.strictEqual(listed.body.data.attributes.name, 'my account');
    assert.deepEqual(listed.body.data.attributes.oauth.connection, {
      client: {
        kind: 'own',
        label: 'stub app',
        ref: { kind: 'own', keyId: client.id },
      },
      scopes: 'read:user',
      status: 'active',
    });
    for (let token of provider.issued) {
      assert.false(listed.text.includes(token), 'the listing carries no token');
    }
  });

  test('a sign-in is used once, expires, and a declined one stores nothing', async function (assert) {
    let client = await addClient();
    let { location } = await connect(OWNER, { kind: 'own', keyId: client.id });
    let again = await complete(OWNER, location);
    assert.strictEqual(again.error, 'expired', 'the same state is spent');
    let forged = await complete(
      OWNER,
      `${secureOriginURL.href}/connected#code=x&state=nope`,
    );
    assert.strictEqual(forged.error, 'expired');

    provider.deny = true;
    let declined = await connect(
      OWNER,
      { kind: 'own', keyId: client.id },
      { name: 'declined' },
    );
    assert.strictEqual(declined.error, 'denied');
    let rows = await dbAdapter.execute(
      `SELECT name FROM user_keys WHERE owner = $1 AND kind = 'oauth-connection'`,
      { bind: [OWNER] },
    );
    assert.deepEqual(
      rows.map((r) => r.name),
      ['my account'],
    );
  });

  test('starting a sign-in takes the secure window and a ticket', async function (assert) {
    let client = await addClient();
    let appSession = await request
      .post('/_oauth/connections')
      .set('Authorization', `Bearer ${createJWT(realm, OWNER, [])}`)
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'oauth-connect',
          attributes: { name: 'x', client: { kind: 'own', keyId: client.id } },
        },
        meta: { ticket: await ticket(OWNER, 'add') },
      });
    assert.strictEqual(appSession.status, 403, 'the app session is refused');
    let noTicket = await request
      .post('/_oauth/connections')
      .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
      .set('Origin', secureOriginURL.origin)
      .set('Content-Type', 'application/json')
      .send({
        data: {
          type: 'oauth-connect',
          attributes: { name: 'x', client: { kind: 'own', keyId: client.id } },
        },
      });
    assert.strictEqual(noTicket.status, 403);
    let othersClient = await connect(TEAMMATE, {
      kind: 'own',
      keyId: client.id,
    });
    assert.strictEqual(
      othersClient.started.status,
      404,
      "another person's own client isn't theirs to connect through",
    );
  });

  test('an approved connection sends a minted access token under its grant, and refreshes it near expiry', async function (assert) {
    let { keyId, approved } = await connectAndApprove();
    assert.strictEqual(approved.status, 201, approved.text);
    assert.strictEqual(
      approved.body.data[0].meta.grant.destination,
      `${PROVIDER}/api/`,
    );
    let [grant] = await dbAdapter.execute(
      `SELECT g.id FROM user_key_grants g WHERE g.key_id = $1`,
      { bind: [keyId] },
    );
    assert.ok(grant, 'the approval made a grant of the connection');

    let first = await call(OWNER);
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    let sent = provider.apiCalls[0].token;
    assert.ok(sent?.startsWith('access_'), 'an access token was sent');
    assert.strictEqual(refreshes(), 0, 'the exchange gave the first token');

    await call(OWNER);
    assert.strictEqual(provider.apiCalls[1].token, sent, 'reused while fresh');
    assert.strictEqual(refreshes(), 0);

    clock += 3600 * 1000 - 30 * 1000;
    let refreshed = await call(OWNER);
    assert.strictEqual(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.strictEqual(refreshes(), 1, 'refreshed ahead of expiry');
    assert.notStrictEqual(provider.apiCalls[2].token, sent);

    // The vendor rotated the refresh token; the next refresh spends the new
    // one, which only works if it was stored.
    clock += 3600 * 1000;
    let again = await call(OWNER);
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    assert.strictEqual(refreshes(), 2);
  });

  test('concurrent calls that need a refresh mint once', async function (assert) {
    await connectAndApprove();
    await call(OWNER);
    clock += 3600 * 1000;
    provider.tokenDelayMs = 150;
    let results = await Promise.all(
      Array.from({ length: 5 }, () => call(OWNER)),
    );
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200, 200, 200],
    );
    assert.strictEqual(refreshes(), 1, 'one refresh served all five');
    assert.strictEqual(
      new Set(provider.apiCalls.slice(1).map((c) => c.token)).size,
      1,
      'all five sent the one new token',
    );
  });

  test('invalid_grant marks the connection rejected until its owner reconnects', async function (assert) {
    let { client, keyId } = await connectAndApprove();
    provider.revokeRefreshTokens();
    clock += 3600 * 1000;
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    let [error] = refused.body.errors;
    assert.strictEqual(error.code, 'credential-rejected');
    assert.strictEqual(error.meta.reason, 'rejected');
    assert.strictEqual(error.meta.destination, `${PROVIDER}/api/`);
    assert.strictEqual(await keyState(keyId), 'rejected');

    let before = provider.tokenRequests.length;
    let still = await call(OWNER);
    assert.strictEqual(still.status, 424);
    assert.strictEqual(
      provider.tokenRequests.length,
      before,
      'a rejected connection is refused without asking the vendor',
    );

    let reconnected = await connect(
      OWNER,
      { kind: 'own', keyId: client.id },
      { reconnect: keyId },
    );
    assert.strictEqual(reconnected.keyId, keyId);
    assert.strictEqual(await keyState(keyId), 'active');
    let served = await call(OWNER);
    assert.strictEqual(
      served.status,
      200,
      'the binding and grant serve the reconnected sign-in as they were',
    );
  });

  test('invalid_client breaks the client and every connection through it needs an administrator', async function (assert) {
    let { client, keyId } = await connectAndApprove();
    provider.clients = [{ clientId: CLIENT_ID, clientSecret: ROTATED_SECRET }];
    clock += 3600 * 1000;
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'needs-admin');
    let listed = await request
      .get(`/_user-keys/${keyId}`)
      .set('Authorization', `Bearer ${createJWT(realm, OWNER, [])}`);
    assert.strictEqual(
      listed.body.data.attributes.oauth.connection.status,
      'needs-admin',
    );
    assert.strictEqual(
      await keyState(keyId),
      'active',
      'the connection itself was not refused',
    );

    // Rotating the client's secret reaches the connection.
    await replaceUserKeyValue(dbAdapter, keyring, {
      owner: OWNER,
      id: client.id,
      value: ROTATED_SECRET,
      ticket: await ticket(OWNER, 'replace', { keyId: client.id }),
    });
    let served = await call(OWNER);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(
      provider.tokenRequests.at(-1)!.body.get('client_secret'),
      ROTATED_SECRET,
    );
  });

  test('a token endpoint that fails is retried, and unavailable once retries run out', async function (assert) {
    await connectAndApprove();
    clock += 3600 * 1000;
    provider.fail = [{ status: 503 }, { error: 'temporarily_unavailable' }];
    let served = await call(OWNER);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(refreshes(), 3, 'two failures, then the refresh');

    clock += 3600 * 1000;
    provider.fail = [{ status: 502 }, { status: 503 }, { status: 500 }];
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424);
    assert.strictEqual(refused.body.errors[0].meta.reason, 'unavailable');
  });

  test('a client shared into a realm gives each teammate their own connection, and follows the share', async function (assert) {
    let client = await addClient(OWNER);
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: client.id,
      label: 'Team GitHub app',
      ticket: await ticket(OWNER, 'share', {
        keyId: client.id,
        realm: realmURL,
      }),
    });
    let offered = await request
      .get('/_oauth/clients')
      .query({ realm: realmURL.href, destination: `${PROVIDER}/api/` })
      .set('Authorization', `Bearer ${createJWT(realm, TEAMMATE, [])}`);
    assert.strictEqual(offered.status, 200, offered.text);
    assert.deepEqual(
      offered.body.data.map((c: any) => [
        c.attributes.kind,
        c.attributes.label,
        c.attributes.scopes,
      ]),
      [['share', 'Team GitHub app', 'read:user repo:status']],
      'connect mode offers the shared client and what it asks for',
    );
    assert.false(offered.text.includes(CLIENT_SECRET));

    let mine = await connect(OWNER, { kind: 'own', keyId: client.id });
    let theirs = await connect(TEAMMATE, { kind: 'share', shareId: share.id });
    let teammateKey = theirs.keyId!;
    assert.notStrictEqual(mine.keyId, teammateKey);
    let [row] = await dbAdapter.execute(
      `SELECT owner FROM user_keys WHERE id = $1`,
      { bind: [teammateKey] },
    );
    assert.strictEqual(row.owner, TEAMMATE, 'the connection is the teammate’s');

    let approved = await approve(TEAMMATE, teammateKey);
    assert.strictEqual(approved.status, 201, approved.text);
    let served = await call(TEAMMATE);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));

    await suspendShare(dbAdapter, { user: OWNER, shareId: share.id });
    clock += 3600 * 1000;
    let suspended = await call(TEAMMATE);
    assert.strictEqual(suspended.status, 424);
    assert.strictEqual(suspended.body.errors[0].meta.reason, 'needs-admin');
  });

  test('a connection is never shared; its client is', async function (assert) {
    let { keyId } = await connectAndApprove();
    try {
      await shareKey(dbAdapter, {
        owner: OWNER,
        realm: realmURL.href,
        keyId,
        label: 'my sign-in',
        ticket: await ticket(OWNER, 'share', { keyId, realm: realmURL }),
      });
      assert.ok(false, 'sharing a connection should be refused');
    } catch (e: any) {
      assert.strictEqual(e.status, 400);
      assert.true(/never shared/.test(e.message), e.message);
    }
  });

  test("a connection's token goes only to a destination it was granted, never a token endpoint", async function (assert) {
    let { keyId } = await connectAndApprove();
    let elsewhere = await call(OWNER, 'elsewhere');
    assert.strictEqual(elsewhere.status, 409, JSON.stringify(elsewhere.body));
    assert.strictEqual(elsewhere.body.errors[0].code, 'binding-not-approved');
    assert.false(
      provider.apiCalls.some((c) => c.host.startsWith('localhost')),
      'nothing reached the other host',
    );

    let probe = await approve(OWNER, keyId, 'probe');
    assert.strictEqual(probe.status, 400, probe.text);
    assert.true(
      probe.text.includes('token endpoint'),
      'a destination covering the token endpoint is never granted',
    );
  });

  test('a client people sign in through is never sent; a client_credentials client mints its own token', async function (assert) {
    let signIn = await addClient(OWNER);
    let refused = await approve(OWNER, signIn.id);
    assert.strictEqual(refused.status, 400, refused.text);

    let machine = await addClient(
      OWNER,
      { grantType: 'client_credentials', authorizeUrl: undefined },
      'machine',
    );
    let approved = await approve(OWNER, machine.id);
    assert.strictEqual(approved.status, 201, approved.text);
    let served = await call(OWNER);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(
      provider.tokenRequests.at(-1)!.grantType,
      'client_credentials',
    );
    assert.ok(provider.apiCalls[0].token?.startsWith('access_'));
  });

  test('a platform client is offered to everyone and connected through like any other', async function (assert) {
    let platform = await addPlatformClient(dbAdapter, keyring, {
      name: 'stub',
      label: 'Boxel (read-only)',
      secret: CLIENT_SECRET,
      oauth: clientSettings(),
    });
    let offered = await request
      .get('/_oauth/clients')
      .query({ destination: `${PROVIDER}/api/` })
      .set('Authorization', `Bearer ${createJWT(realm, TEAMMATE, [])}`);
    assert.deepEqual(
      offered.body.data.map((c: any) => c.attributes.label),
      ['Boxel (read-only)'],
    );
    let connected = await connect(TEAMMATE, {
      kind: 'platform',
      clientId: platform.id,
    });
    let keyId = connected.keyId!;
    assert.ok(keyId, connected.error);
    let approved = await approve(TEAMMATE, keyId);
    assert.strictEqual(approved.status, 201, approved.text);
    let served = await call(TEAMMATE);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
  });
  test('a sign-in finishes only for the person who started it', async function (assert) {
    // Someone starts a sign-in and gets another person to approve it at the
    // vendor: the code comes back to the other person's window.
    let client = await addClient(TEAMMATE, {}, 'their app');
    let hijack = await connect(
      TEAMMATE,
      { kind: 'own', keyId: client.id },
      { completeAs: OWNER },
    );
    assert.strictEqual(hijack.error, 'expired');
    assert.strictEqual(
      provider.tokenRequests.length,
      0,
      'the code was never exchanged',
    );
    let rows = await dbAdapter.execute(
      `SELECT owner FROM user_keys WHERE kind = 'oauth-connection'`,
    );
    assert.deepEqual(rows, [], 'nothing was stored for anyone');
  });

  test("GitHub's own error codes are classified", async function (assert) {
    let { keyId } = await connectAndApprove();
    clock += 3600 * 1000;
    provider.fail = [{ error: 'bad_refresh_token' }];
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'rejected');
    assert.strictEqual(await keyState(keyId), 'rejected');
  });

  test("GitHub's refused client credentials break the client", async function (assert) {
    await connectAndApprove();
    clock += 3600 * 1000;
    provider.fail = [{ error: 'incorrect_client_credentials' }];
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'needs-admin');
  });

  test('a refused grant after an attempt the vendor may have acted on is unavailable, not rejected', async function (assert) {
    let { keyId } = await connectAndApprove();
    clock += 3600 * 1000;
    provider.fail = [{ status: 502 }, { error: 'invalid_grant' }];
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'unavailable');
    assert.strictEqual(
      await keyState(keyId),
      'active',
      'the first attempt may have spent the refresh token',
    );
  });

  test("another person's client fences off nothing for anyone else's keys", async function (assert) {
    // A client whose token URL names the API host itself.
    await addClient(
      TEAMMATE,
      { tokenUrl: `${PROVIDER}/api/token` },
      'squatting app',
    );
    let { approved } = await connectAndApprove(OWNER);
    assert.strictEqual(approved.status, 201, approved.text);
  });

  test('a cached token stops serving the moment its client does', async function (assert) {
    let client = await addClient(OWNER);
    let share = await shareKey(dbAdapter, {
      owner: OWNER,
      realm: realmURL.href,
      keyId: client.id,
      label: 'Team app',
      ticket: await ticket(OWNER, 'share', {
        keyId: client.id,
        realm: realmURL,
      }),
    });
    let { keyId } = await connect(TEAMMATE, {
      kind: 'share',
      shareId: share.id,
    });
    await approve(TEAMMATE, keyId!);
    assert.strictEqual((await call(TEAMMATE)).status, 200);
    await suspendShare(dbAdapter, { user: OWNER, shareId: share.id });
    let refused = await call(TEAMMATE);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'needs-admin');
  });

  test('a refresh by another process makes this one mint again', async function (assert) {
    let { keyId } = await connectAndApprove();
    await call(OWNER);
    assert.strictEqual(refreshes(), 0);
    // What another process's refresh leaves behind.
    await dbAdapter.execute(
      `UPDATE oauth_connections SET generation = generation + 1 WHERE key_id = $1`,
      { bind: [keyId] },
    );
    let served = await call(OWNER);
    assert.strictEqual(served.status, 200, JSON.stringify(served.body));
    assert.strictEqual(refreshes(), 1, 'its cached token may be revoked');
    let [row] = await dbAdapter.execute(
      `SELECT refreshing_until FROM oauth_connections WHERE key_id = $1`,
      { bind: [keyId] },
    );
    assert.strictEqual(row.refreshing_until, null, 'the lease is released');
  });

  test('an access token issued with no refresh token stops serving when it expires', async function (assert) {
    provider.issueRefreshTokens = false;
    provider.expiresIn = 600;
    let { keyId } = await connectAndApprove();
    assert.strictEqual((await call(OWNER)).status, 200);
    clock += 601 * 1000;
    let refused = await call(OWNER);
    assert.strictEqual(refused.status, 424, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.errors[0].meta.reason, 'rejected');
    assert.ok(keyId);
  });

  test('a reconnect signs in through the same client, and lists only that one', async function (assert) {
    let { keyId } = await connectAndApprove();
    let other = await addClient(OWNER, {}, 'another app');
    let moved = await connect(
      OWNER,
      { kind: 'own', keyId: other.id },
      { reconnect: keyId },
    );
    assert.strictEqual(moved.started.status, 409, moved.started.text);
    let listed = await request
      .get('/_oauth/clients')
      .query({ reconnect: keyId })
      .set('Authorization', `Bearer ${createJWT(realm, OWNER, [])}`);
    assert.deepEqual(
      listed.body.data.map((c: any) => c.attributes.label),
      ['stub app'],
    );
  });

  test('a minting key gets fresh grant markers when what it mints with changes', async function (assert) {
    let { client, keyId } = await connectAndApprove();
    let nonce = async () =>
      (
        await dbAdapter.execute(
          `SELECT encode(value_nonce, 'hex') AS nonce FROM user_key_grants WHERE key_id = $1`,
          { bind: [keyId] },
        )
      )[0].nonce;
    let before = await nonce();
    await connect(
      OWNER,
      { kind: 'own', keyId: client.id },
      { reconnect: keyId },
    );
    assert.notStrictEqual(await nonce(), before, 'a reconnect reseals');
    assert.strictEqual((await call(OWNER)).status, 200, 'and still sends');
  });
});
