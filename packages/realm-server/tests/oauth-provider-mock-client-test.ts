import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomBytes } from 'crypto';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  closeServer,
  insertUser,
  matrixRegistrationSecret,
  matrixURL,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import {
  OAUTH_TEST_ISSUER,
  OAUTH_TEST_SERVER_URL,
  decideOAuthFlow,
  interactionUid,
  landOAuthFlow,
  startOAuthProviderServer,
  type OAuthRequester,
} from './helpers/oauth-provider-flow.ts';
import { testOAuthSecureOriginURL } from './helpers/oauth-provider.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { registerUser } from '../synapse.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  CODE_PREVIEW_LENGTH,
  EXAMPLE_AI_APP_CLIENT_ID_URL,
  EXAMPLE_AI_APP_NAME,
  EXAMPLE_AI_APP_WEB_ORIGIN,
  EXAMPLE_AI_APP_WEB_REDIRECT_URI,
  type ProviderTransport,
  type RegistrationMode,
} from './support/mock-oauth-client/client.ts';
import {
  startExampleAIApp,
  type RunningExampleAIApp,
} from './support/mock-oauth-client/server.ts';
import type { RealmHttpServer as Server } from '../server.ts';

// Where the provider downloads the app's metadata document from: its
// `https://` client ID's origin maps to the app's server on loopback, set once
// the app is listening.
const documentOrigins = new Map<string, string>();

function start(args: {
  dbAdapter: PgAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<Server> {
  return startOAuthProviderServer(args, 'realm_server_oauth_mock_client', {
    documentOrigins,
  });
}

// The app's requests to the provider, sent to the test's realm server in
// process, as the issuer's host.
function inProcessTransport(server: () => Server): ProviderTransport {
  let pathOf = (url: string) => {
    let parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  };
  let answer = (response: supertest.Response) => ({
    status: response.status,
    body: response.type === 'application/json' ? response.body : undefined,
  });
  return {
    async get(url) {
      return answer(
        await supertest(server())
          .get(pathOf(url))
          .set('Host', OAUTH_TEST_SERVER_URL.host),
      );
    },
    async post(url, contentType, body) {
      return answer(
        await supertest(server())
          .post(pathOf(url))
          .set('Host', OAUTH_TEST_SERVER_URL.host)
          .set('Content-Type', contentType)
          .send(body),
      );
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let server: Server | undefined;
  let db: PgAdapter | undefined;
  let running: RunningExampleAIApp | undefined;

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
      // The app's server is on loopback, which the outbound guard refuses but
      // for its development allowlist.
      configureOutbound({ devAllowlist: ['127.0.0.1'] });
      server = await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      await running?.close();
      running = undefined;
      documentOrigins.clear();
      resetOutbound();
      if (server) {
        await closeServer(server);
        server = undefined;
      }
    },
  });

  async function startApp(mode: RegistrationMode) {
    running = await startExampleAIApp({
      mode,
      issuer: OAUTH_TEST_ISSUER,
      transport: inProcessTransport(() => server!),
    });
    documentOrigins.set(EXAMPLE_AI_APP_WEB_ORIGIN, running.origin);
    return running;
  }

  // A user with a Matrix account, which the consent details read, a row in
  // `users`, which a grant names, and a secure window session.
  async function secureSession(): Promise<string> {
    let username = `mock-client-${randomBytes(6).toString('hex')}`;
    let { userId } = await registerUser({
      matrixURL,
      displayname: username,
      username,
      password: `pw-${randomBytes(12).toString('hex')}`,
      registrationSecret: matrixRegistrationSecret,
    });
    await insertUser(db!, userId, `cus_${userId}`, null);
    return await secureSessionAuth(db!, userId);
  }

  // Clicks Connect, follows the app's redirect to Boxel, and answers the
  // browser and the flow's interaction ID.
  async function connect(appPages: OAuthRequester) {
    let connectPage = await appPages.get('/');
    if (!connectPage.text.includes('href="/connect"')) {
      throw new Error('the Connect page has no Connect button');
    }
    let started = await appPages.get('/connect');
    if (started.status !== 302) {
      throw new Error(`Connect didn't start a flow: ${started.status}`);
    }
    let authorize = new URL(started.headers.location);
    let browser = supertest.agent(server!);
    let response = await browser
      .get(`${authorize.pathname}${authorize.search}`)
      .set('Host', OAUTH_TEST_SERVER_URL.host);
    if (response.status !== 303) {
      throw new Error(`Boxel didn't start the flow: ${response.status}`);
    }
    return {
      authorize,
      browser,
      uid: interactionUid(response.headers.location),
    };
  }

  // What Boxel's authorize page is told about the app.
  async function appShownOnConsent(uid: string, session: string) {
    let response = await supertest(server!)
      .get(`/_oauth-provider/consent/${uid}`)
      .set('Host', OAUTH_TEST_SERVER_URL.host)
      .set('Origin', testOAuthSecureOriginURL.origin)
      .set('Authorization', session);
    return response.body.app;
  }

  test('registers with a loopback redirect, connects, and shows what it got back but never the token', async function (assert) {
    let app = await startApp('loopback');
    let appPages = supertest.agent(app.server);
    let session = await secureSession();

    let { authorize, browser, uid } = await connect(appPages);
    assert.strictEqual(
      authorize.searchParams.get('code_challenge_method'),
      'S256',
      'the flow starts with PKCE',
    );
    assert.strictEqual(
      authorize.searchParams.get('redirect_uri'),
      `${app.origin}/callback`,
      "the flow comes back to the app's port on loopback",
    );
    assert.deepEqual(
      await appShownOnConsent(uid, session),
      {
        kind: 'dynamic',
        shown: 'an app on this computer',
        verified: false,
        claimedName: EXAMPLE_AI_APP_NAME,
      },
      'consent names it as an app on this computer',
    );

    let ticket = await decideOAuthFlow(server!, uid, session);
    let landed = await landOAuthFlow(browser, uid, ticket);
    assert.strictEqual(
      `${landed.origin}${landed.pathname}`,
      `${app.origin}/callback`,
      'Boxel sends the browser back to the app',
    );
    let code = landed.searchParams.get('code')!;

    let result = await appPages.get(`${landed.pathname}${landed.search}`);
    assert.strictEqual(result.status, 200);
    assert.true(
      result.text.includes('data-test-result="connected"'),
      result.text,
    );
    assert.true(
      result.text.includes(
        `<code>${code.slice(0, CODE_PREVIEW_LENGTH)}…</code>`,
      ),
      "shows the code's first characters",
    );
    assert.false(result.text.includes(code), 'never the whole code');
    assert.true(
      result.text.includes('<code>boxel:read</code>'),
      'shows the scopes',
    );
    assert.true(result.text.includes('In 10 minutes'), 'shows the expiry');
    assert.true(
      result.text.includes('Boxel issued a refresh token'),
      'a renewing grant came with a refresh token',
    );
    let tokens = app.app.heldTokensForTests;
    assert.ok(tokens?.accessToken, 'the app holds an access token');
    assert.ok(tokens?.refreshToken, 'and a refresh token');
    assert.false(
      result.text.includes(tokens!.accessToken),
      'never the access token',
    );
    assert.false(
      result.text.includes(tokens!.refreshToken!),
      'never the refresh token',
    );
  });

  test('registers with a redirect on the web, and is shown as unverified', async function (assert) {
    let app = await startApp('unverified');
    let appPages = supertest.agent(app.server);
    let session = await secureSession();

    let { uid, browser } = await connect(appPages);
    assert.deepEqual(
      await appShownOnConsent(uid, session),
      {
        kind: 'dynamic',
        shown: 'example.com',
        verified: false,
        claimedName: EXAMPLE_AI_APP_NAME,
      },
      "consent names it by its redirect's domain, beside the name it gave, unverified",
    );

    let ticket = await decideOAuthFlow(server!, uid, session);
    let landed = await landOAuthFlow(browser, uid, ticket);
    assert.strictEqual(
      `${landed.origin}${landed.pathname}`,
      EXAMPLE_AI_APP_WEB_REDIRECT_URI,
      'Boxel sends the browser to the redirect on the web',
    );
    // That host serves nothing; the app's own server stands in for it.
    let result = await appPages.get(`/callback${landed.search}`);
    assert.true(
      result.text.includes('data-test-result="connected"'),
      result.text,
    );
  });

  test('is identified by a client ID metadata document, and named by its domain', async function (assert) {
    let app = await startApp('cimd');
    let appPages = supertest.agent(app.server);
    let session = await secureSession();
    assert.strictEqual(
      app.app.clientId,
      EXAMPLE_AI_APP_CLIENT_ID_URL,
      'its client ID is its document URL',
    );

    let { authorize, browser, uid } = await connect(appPages);
    assert.strictEqual(
      authorize.searchParams.get('client_id'),
      EXAMPLE_AI_APP_CLIENT_ID_URL,
    );
    assert.deepEqual(
      await appShownOnConsent(uid, session),
      { kind: 'metadata-document', shown: 'example.com', verified: true },
      "consent names it by its client ID's domain, verified",
    );

    let ticket = await decideOAuthFlow(server!, uid, session);
    let landed = await landOAuthFlow(browser, uid, ticket);
    assert.strictEqual(
      `${landed.origin}${landed.pathname}`,
      `${app.origin}/callback`,
      "its document's loopback redirect matches the app's port",
    );
    let result = await appPages.get(`${landed.pathname}${landed.search}`);
    assert.true(
      result.text.includes('data-test-result="connected"'),
      result.text,
    );
    assert.true(result.text.includes('<code>boxel:read</code>'));
  });

  test('shows a denied connection', async function (assert) {
    let app = await startApp('loopback');
    let appPages = supertest.agent(app.server);
    let session = await secureSession();

    let { uid, browser } = await connect(appPages);
    let ticket = await decideOAuthFlow(server!, uid, session, {
      decision: 'deny',
    });
    let landed = await landOAuthFlow(browser, uid, ticket);
    assert.strictEqual(landed.searchParams.get('error'), 'access_denied');
    let result = await appPages.get(`${landed.pathname}${landed.search}`);
    assert.true(result.text.includes('data-test-result="denied"'), result.text);
    assert.strictEqual(app.app.heldTokensForTests, undefined, 'no tokens');
  });

  test("refuses a response to a flow it didn't start, and a response used twice", async function (assert) {
    let app = await startApp('loopback');
    let appPages = supertest.agent(app.server);
    let session = await secureSession();

    let stray = await appPages.get('/callback?code=abc&state=not-a-flow');
    assert.true(
      stray.text.includes('data-test-result="error"'),
      'an unknown state',
    );

    let { uid, browser } = await connect(appPages);
    let ticket = await decideOAuthFlow(server!, uid, session);
    let landed = await landOAuthFlow(browser, uid, ticket);
    let first = await appPages.get(`${landed.pathname}${landed.search}`);
    assert.true(
      first.text.includes('data-test-result="connected"'),
      first.text,
    );
    let again = await appPages.get(`${landed.pathname}${landed.search}`);
    assert.true(
      again.text.includes('data-test-result="error"'),
      'the same state again',
    );
  });
});
