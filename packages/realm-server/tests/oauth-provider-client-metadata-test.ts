import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  CLIENT_IP_HEADER,
  DBRateLimitStore,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import type { KoaContextWithOIDC } from 'oidc-provider';
import {
  closeServer,
  createVirtualNetwork,
  ensureMatrixAdminUser,
  fixtureDir,
  matrixRegistrationSecret,
  matrixURL,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import {
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
  unusedDBAdapter,
} from './helpers/oauth-provider.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { registerUser } from '../synapse.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { oauthProviderAdapter } from '../lib/oauth-provider/adapter.ts';
import {
  boxelDomains,
  clientIdForLogs,
  clientMetadataDocuments,
  inMetadataDocumentRequest,
} from '../lib/oauth-provider/client-metadata-document.ts';
import {
  takeNewClient,
  type NewClientLimit,
} from '../lib/oauth-provider/new-client-limit.ts';
import { boxelHosts } from '../lib/oauth-provider/redirect-uris.ts';
import type { RealmHttpServer as Server } from '../server.ts';

const { copySync, ensureDirSync } = fsExtra;

// Real documents, each with the URL it was copied from and when. ChatGPT's
// connectors have one too, but each is made for one MCP server's redirect
// URI, so there is no public one to copy.
interface RealDocument {
  source: string;
  copied: string;
  cacheControl: string;
  document: Record<string, unknown> & {
    client_id: string;
    redirect_uris: string[];
  };
}
const REAL_DOCUMENTS = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'oauth-client-metadata-documents.json'),
    'utf8',
  ),
) as Record<'claude-code' | 'codex', RealDocument>;
const CLAUDE_CODE = REAL_DOCUMENTS['claude-code'].document;
const CODEX = REAL_DOCUMENTS.codex.document;

const AUTHORIZATION = '/_oauth-provider/auth';
const serverURL = new URL('http://127.0.0.1:0/');
const ISSUER = 'http://127.0.0.1:0';
const MCP = `${ISSUER}/mcp`;
const AUTHORIZE_PAGE = `${testOAuthSecureOriginURL.href}/authorize`;
const PUBLISHED_DOMAINS = { boxelSite: 'boxel.site' };

// The client IDs' origins, each served by the stub below. One of Boxel's own
// hosts is served too, so a test can show it is never asked.
const STUB_ORIGINS = [
  'https://claude.ai',
  'https://chatgpt.com',
  'https://client.example.test',
  'https://someone.boxel.site',
  // Beside the secure origin's host, under the same registrable domain.
  'https://other.oauth-provider.test',
];

const ROOMY_LIMIT: NewClientLimit = {
  perAddress: { requests: 100, windowSeconds: 3600 },
  perNetwork: { requests: 100, windowSeconds: 3600 },
  overall: { requests: 100, windowSeconds: 3600 },
  alertAfter: 99,
};

const CALLER = '203.0.113.7';

interface StubAnswer {
  status?: number;
  headers?: Record<string, string>;
  body: string;
  // Sent without a declared length, so only reading it shows its size.
  chunked?: boolean;
}

// Serves each client ID's document by path, as its origin would, and records
// every path asked for.
class DocumentServer {
  answers = new Map<string, StubAnswer>();
  requested: string[] = [];
  #server = http.createServer((req, res) => {
    let path = req.url ?? '/';
    this.requested.push(path);
    let answer = this.answers.get(path);
    if (!answer) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(answer.status ?? 200, {
      'content-type': 'application/json',
      ...answer.headers,
    });
    if (answer.chunked) {
      res.write(answer.body);
      res.end();
    } else {
      res.end(answer.body);
    }
  });

  async start(): Promise<string> {
    await new Promise<void>((resolve) =>
      this.#server.listen(0, '127.0.0.1', () => resolve()),
    );
    let { port } = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  serve(
    document: { client_id: string } & Record<string, unknown>,
    headers: Record<string, string> = {
      'cache-control': 'public, max-age=300',
    },
  ) {
    this.answers.set(new URL(document.client_id).pathname, {
      headers,
      body: JSON.stringify(document),
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }
}

function hooksFor(store: DBRateLimitStore, limit: NewClientLimit) {
  return clientMetadataDocuments({
    hosts: boxelHosts({ serverURL: new URL('https://realms.boxel.test/') }),
    scopes: ['boxel:read', 'boxel:write'],
    rateLimitStore: store,
    newClientLimit: limit,
  });
}

module(basename(import.meta.filename), function () {
  module('looking up a client', function () {
    test('a client ID registration could not have given is never looked up in the database', async function (assert) {
      // Any use of this database fails the test.
      let clients = oauthProviderAdapter(unusedDBAdapter)('Client');
      assert.strictEqual(await clients.find(CLAUDE_CODE.client_id), undefined);
      assert.strictEqual(await clients.find('not-a-registered-id'), undefined);
    });
  });

  module('naming a client in logs', function () {
    test('a document client is named by its host alone', function (assert) {
      assert.strictEqual(
        clientIdForLogs(
          'https://client.example.test/app/client.json?access_token=secret-1',
        ),
        'metadata document on client.example.test',
      );
      assert.strictEqual(
        clientIdForLogs('Ab3dE_fGhIjKlMnOpQrStUvWxYz01234'),
        'Ab3dE_fGhIjKlMnOpQrStUvWxYz01234',
        'a registered client by its generated ID',
      );
    });

    test("Boxel's domains are the registrable domains of its own hosts", function (assert) {
      assert.deepEqual(
        [
          ...boxelDomains(
            boxelHosts({
              serverURL: new URL('https://app.boxel.ai/'),
              secureOriginURL: new URL('https://secure.boxel.ai/secure'),
              appOrigins: ['https://*.preview.boxel.ai', 'http://127.0.0.1:*'],
              publishedDomains: ['boxel.site', 'boxel.space'],
            }),
          ),
        ].sort(),
        ['boxel.ai', 'boxel.site', 'boxel.space'],
      );
    });
  });

  module('checking a document', function () {
    let documents = hooksFor(
      new DBRateLimitStore(unusedDBAdapter),
      ROOMY_LIMIT,
    );

    test('a document client keeps only what a registration may set, and is native when it lists a loopback redirect', function (assert) {
      // As the library hands it over: its defaults filled in, then the
      // document's own fields.
      let metadata: Record<string, unknown> = {
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        ...REAL_DOCUMENTS.codex.document,
        jwks_uri: 'https://chatgpt.com/jwks.json',
        scope: 'openid boxel:read',
      };
      documents.validate(undefined, 'boxel_checks', undefined, metadata);
      assert.deepEqual(metadata, {
        client_id: CODEX.client_id,
        client_name: 'Codex',
        redirect_uris: CODEX.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'boxel:read',
        token_endpoint_auth_method: 'none',
        application_type: 'native',
      });
    });

    test('a document is held to the rules a registration meets', function (assert) {
      let cases: [string, Record<string, unknown>][] = [
        [
          'a redirect on a Boxel host',
          { redirect_uris: ['https://realms.boxel.test/callback'] },
        ],
        [
          'an HTTPS loopback redirect beside a plain one',
          {
            redirect_uris: [
              'http://127.0.0.1/callback',
              'https://127.0.0.1/callback',
            ],
          },
        ],
        ['a private-use scheme', { redirect_uris: ['cursor://callback'] }],
        [
          'a secret',
          {
            redirect_uris: ['http://127.0.0.1/callback'],
            token_endpoint_auth_method: 'client_secret_basic',
          },
        ],
        [
          'a name that displays as another',
          {
            redirect_uris: ['http://127.0.0.1/callback'],
            client_name: 'Claude‮Code',
          },
        ],
      ];
      for (let [label, fields] of cases) {
        assert.throws(
          () =>
            documents.validate(undefined, 'boxel_checks', undefined, {
              client_id: 'https://client.example.test/client.json',
              ...fields,
            }),
          (error: unknown) =>
            (error as { error?: string }).error === 'invalid_client_metadata',
          label,
        );
      }
    });

    test('a registered client is left as it was stored', function (assert) {
      let stored = {
        client_id: 'Ab3dE_fGhIjKlMnOpQrStUvWxYz01234',
        redirect_uris: ['https://app.example.test/callback'],
        application_type: 'web',
        client_uri: 'https://app.example.test',
      };
      let metadata = { ...stored };
      documents.validate(undefined, 'boxel_checks', undefined, metadata);
      assert.deepEqual(metadata, stored);
    });
  });

  module('counting new clients', function (hooks) {
    let store: DBRateLimitStore;
    setupDB(hooks, {
      beforeEach: async (dbAdapter: PgAdapter) => {
        store = new DBRateLimitStore(dbAdapter);
      },
    });

    const ONE_PER_ADDRESS: NewClientLimit = {
      ...ROOMY_LIMIT,
      perAddress: { requests: 1, windowSeconds: 3600 },
    };
    let ctx = {
      req: { headers: { [CLIENT_IP_HEADER]: CALLER } },
    } as unknown as KoaContextWithOIDC;

    test('a document downloaded again for a client already accepted is not a new client', async function (assert) {
      let documents = hooksFor(store, ONE_PER_ADDRESS);
      assert.true(await documents.allowFetch(ctx, CLAUDE_CODE.client_id));
      await documents.allowClient(ctx, { clientId: CLAUDE_CODE.client_id });
      assert.true(
        await documents.allowFetch(ctx, CLAUDE_CODE.client_id),
        'its next download is allowed, with the limit already reached',
      );
      assert.false(
        await documents.allowFetch(ctx, CODEX.client_id),
        'a client not accepted before is counted, and refused',
      );
      assert.false(
        await documents.allowFetch(ctx, CLAUDE_CODE.client_id),
        'its free download was not accepted, so the next one counts',
      );
    });

    test('a client ID never accepted is counted on every download', async function (assert) {
      let documents = hooksFor(store, ONE_PER_ADDRESS);
      assert.true(await documents.allowFetch(ctx, CLAUDE_CODE.client_id));
      // The download failed, or the document was refused: it is never used.
      assert.false(
        await documents.allowFetch(ctx, CLAUDE_CODE.client_id),
        'counted again',
      );
    });

    test("downloads share each caller's allowance with registration, but take nothing from the ceiling over everyone", async function (assert) {
      let limit: NewClientLimit = {
        perAddress: { requests: 2, windowSeconds: 3600 },
        perNetwork: { requests: 100, windowSeconds: 3600 },
        overall: { requests: 2, windowSeconds: 3600 },
        alertAfter: 1,
      };
      let documents = hooksFor(store, limit);
      // Downloads from three networks: more than the overall bucket holds.
      for (let caller of ['203.0.113.7', '198.51.100.7', '192.0.2.7']) {
        let ctxFrom = {
          req: { headers: { [CLIENT_IP_HEADER]: caller } },
        } as unknown as KoaContextWithOIDC;
        assert.true(
          await documents.allowFetch(
            ctxFrom,
            `https://client.example.test/${caller}.json`,
          ),
          `a download from ${caller}`,
        );
      }
      let registration = await takeNewClient(store, '203.0.113.99', limit);
      assert.true(
        registration.admitted,
        'registration still has the whole overall bucket',
      );
      // The first caller's address has one of its two left.
      assert.true(
        (await takeNewClient(store, '203.0.113.7', limit)).admitted,
        "a registration from the first caller takes the address's last",
      );
      assert.false(
        await documents.allowFetch(
          ctx,
          'https://client.example.test/next.json',
        ),
        'and its next download is refused: they share the allowance',
      );
    });

    test("outside the library's handling, the address comes from the request the provider's route is serving", async function (assert) {
      let documents = hooksFor(store, ROOMY_LIMIT);
      assert.false(
        await documents.allowFetch(undefined, CLAUDE_CODE.client_id),
        'with no request, the caller is unknown, and refused',
      );
      assert.true(
        await inMetadataDocumentRequest(CALLER, () =>
          documents.allowFetch(undefined, CLAUDE_CODE.client_id),
        ),
        "the route's request names the caller",
      );
    });

    test('a client ID gets one download decision per request', async function (assert) {
      let documents = hooksFor(store, ONE_PER_ADDRESS);
      await inMetadataDocumentRequest(CALLER, async () => {
        assert.true(
          await documents.allowFetch(undefined, CLAUDE_CODE.client_id),
        );
        assert.false(
          await documents.allowFetch(undefined, CLAUDE_CODE.client_id),
          'a second lookup in the request downloads nothing',
        );
        assert.false(
          await documents.allowFetch(undefined, CODEX.client_id),
          'refused by the limit',
        );
        let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
          assert.false(
            await documents.allowFetch(undefined, CODEX.client_id),
            'refused again',
          );
        });
        assert.deepEqual(lines, [], 'with no second refusal counted or logged');
      });
    });
  });

  module('starting a flow through the realm server', function (hooks) {
    let documentServer: DocumentServer;
    // Read by the provider for each download, so each test's stub port is
    // set here once the stub is listening.
    let documentOrigins = new Map<string, string>();
    let server: Server | undefined;
    let db: PgAdapter;

    // Consent details read the account's email through Synapse's admin API.
    hooks.before(async function () {
      await ensureMatrixAdminUser();
    });

    async function start({
      dbAdapter,
      publisher,
      runner,
      newClientLimit = ROOMY_LIMIT,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
      newClientLimit?: NewClientLimit;
    }): Promise<Server> {
      let realmsRootPath = join(dirSync().name, 'realm_server_oauth_cimd');
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
        domainsForPublishedRealms: PUBLISHED_DOMAINS,
        // The test names each caller in `X-Forwarded-For`.
        clientAddress: { trustedProxyHops: 1, infraAddresses: [] },
        oauthProvider: testOAuthProviderConfig(),
        oauthNewClientLimit: newClientLimit,
        oauthTestDocumentOrigins: documentOrigins,
      });
      return testRealmHttpServer;
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async (args) => {
        let built = await start(args);
        return () => closeServer(built);
      },
    });
    let restart: (limit: NewClientLimit) => Promise<void>;
    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (dbAdapter, publisher, runner) => {
        db = dbAdapter;
        documentServer = new DocumentServer();
        let origin = await documentServer.start();
        for (let stubbed of STUB_ORIGINS) {
          documentOrigins.set(stubbed, origin);
        }
        documentServer.serve(CLAUDE_CODE);
        documentServer.serve(CODEX);
        // The stub is on loopback, which the outbound guard refuses but for
        // its development allowlist.
        configureOutbound({ devAllowlist: ['127.0.0.1'] });
        server = await start({ dbAdapter, publisher, runner });
        restart = async (newClientLimit) => {
          await closeServer(server!);
          server = await start({
            dbAdapter,
            publisher,
            runner,
            newClientLimit,
          });
        };
      },
      afterEach: async () => {
        if (server) {
          await closeServer(server);
          server = undefined;
        }
        resetOutbound();
        documentOrigins.clear();
        await documentServer.close();
      },
    });

    function authorize(
      clientId: string,
      redirectURI: string,
      { caller = CALLER }: { caller?: string } = {},
    ) {
      let query = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectURI,
        scope: 'boxel:read',
        resource: MCP,
        state: 'state-marker-5a1c',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      });
      return supertest(server!)
        .get(`${AUTHORIZATION}?${query}`)
        .set('Host', serverURL.host)
        .set('X-Forwarded-For', caller);
    }

    // An accepted request starts an interaction; a refused one goes to the
    // secure origin's error page, and its reason is logged.
    function assertStarted(
      assert: Assert,
      response: supertest.Response,
      label: string,
    ) {
      assert.strictEqual(response.status, 303, `${label}: ${response.text}`);
      assert.true(
        (response.headers.location ?? '').startsWith(
          `${ISSUER}/_oauth-provider/interaction/`,
        ),
        `${label}: starts an interaction (${response.headers.location})`,
      );
    }
    async function assertRefused(
      assert: Assert,
      request: () => supertest.Test,
      reason: string,
      label: string,
    ) {
      let response: supertest.Response | undefined;
      let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
        response = await request();
      });
      assert.strictEqual(response!.status, 303, `${label}: ${response!.text}`);
      let location = new URL(response!.headers.location);
      assert.strictEqual(
        `${location.origin}${location.pathname}`,
        AUTHORIZE_PAGE,
        `${label}: goes to the error page`,
      );
      let messages = lines.map(({ message }) => message);
      assert.true(
        messages.some((message) =>
          message.startsWith(`authorization refused: ${reason} `),
        ),
        `${label}: refused as ${reason} (${messages.join(' | ')})`,
      );
      return messages;
    }

    test("Claude Code's document is accepted without declaring native, its loopback callback on any port", async function (assert) {
      assert.strictEqual(
        CLAUDE_CODE.application_type,
        undefined,
        'the document declares no application type',
      );
      assertStarted(
        assert,
        await authorize(
          CLAUDE_CODE.client_id,
          'http://localhost:54321/callback',
        ),
        'localhost',
      );
      assertStarted(
        assert,
        await authorize(
          CLAUDE_CODE.client_id,
          'http://127.0.0.1:61234/callback',
        ),
        '127.0.0.1',
      );
      await assertRefused(
        assert,
        () =>
          authorize(CLAUDE_CODE.client_id, 'http://localhost:54321/elsewhere'),
        'bad-redirect-uri',
        'a path the document does not list',
      );
      assert.deepEqual(
        documentServer.requested,
        ['/oauth/claude-code-client-metadata'],
        'downloaded once, then served from the cache',
      );
    });

    test("consent names a document client by its client ID's registrable domain, never by what the document says", async function (assert) {
      let username = `cimd-${randomBytes(6).toString('hex')}`;
      let { userId } = await registerUser({
        matrixURL,
        displayname: username,
        username,
        password: `pw-${randomBytes(12).toString('hex')}`,
        registrationSecret: matrixRegistrationSecret,
      });
      let authorization = await secureSessionAuth(db, userId);
      for (let [document, redirectURI, domain] of [
        [CLAUDE_CODE, 'http://localhost:54321/callback', 'claude.ai'],
        [CODEX, 'http://127.0.0.1:43210/callback', 'chatgpt.com'],
      ] as const) {
        let started = await authorize(document.client_id, redirectURI);
        assertStarted(assert, started, domain);
        let uid = new URL(started.headers.location).pathname.split('/').at(-1)!;
        let response = await supertest(server!)
          .get(`/_oauth-provider/consent/${uid}`)
          .set('Host', serverURL.host)
          .set('Origin', testOAuthSecureOriginURL.origin)
          .set('Authorization', authorization);
        assert.strictEqual(response.status, 200, response.text);
        assert.deepEqual(
          response.body.app,
          { kind: 'metadata-document', shown: domain, verified: true },
          `named ${domain}, not "${document.client_name}"`,
        );
      }
    });

    test('a log line names a document client by its host, never the rest of its client ID', async function (assert) {
      let clientId =
        'https://client.example.test/with-query.json?access_token=secret-token-7f3a';
      documentServer.answers.set(
        '/with-query.json?access_token=secret-token-7f3a',
        {
          body: JSON.stringify({
            client_id: clientId,
            redirect_uris: ['http://127.0.0.1/callback'],
          }),
        },
      );
      let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
        assertStarted(
          assert,
          await authorize(clientId, 'http://127.0.0.1:5000/callback'),
          'a client ID with a query',
        );
        await assertRefused(
          assert,
          () => authorize(clientId, 'http://127.0.0.1:5000/elsewhere'),
          'bad-redirect-uri',
          'a refused request from it',
        );
      });
      let messages = lines.map(({ message }) => message);
      assert.true(
        messages.some((message) =>
          message.includes(
            'authorization started: resources http://127.0.0.1:0/mcp, client metadata document on client.example.test',
          ),
        ),
        `named by its host (${messages.join(' | ')})`,
      );
      assert.false(
        messages.some(
          (message) =>
            message.includes('secret-token-7f3a') ||
            message.includes('/with-query.json'),
        ),
        'no line carries the rest of the client ID',
      );
    });

    test("Codex's document is accepted", async function (assert) {
      assertStarted(
        assert,
        await authorize(CODEX.client_id, 'http://127.0.0.1:43210/callback'),
        'codex',
      );
    });

    test('a document client is never stored', async function (assert) {
      assertStarted(
        assert,
        await authorize(CODEX.client_id, 'http://127.0.0.1:43210/callback'),
        'codex',
      );
      let [{ count }] = (await db.execute(
        `SELECT count(*)::int AS count FROM oauth_provider_dynamic_clients`,
      )) as { count: number }[];
      assert.strictEqual(count, 0);
    });

    test('a document whose redirect URI Boxel refuses is an unknown client', async function (assert) {
      let clientId = 'https://client.example.test/boxel-redirect.json';
      documentServer.serve({
        client_id: clientId,
        redirect_uris: ['https://someone.boxel.site/callback'],
      });
      await assertRefused(
        assert,
        () => authorize(clientId, 'https://someone.boxel.site/callback'),
        'unknown-client',
        'a redirect on a Boxel host',
      );
      assert.deepEqual(
        documentServer.requested,
        ['/boxel-redirect.json'],
        'downloaded once, though both Boxel and the library looked it up',
      );
    });

    test("a client ID on one of Boxel's own hosts is refused before any download", async function (assert) {
      let clientId = 'https://someone.boxel.site/client.json';
      documentServer.serve({
        client_id: clientId,
        redirect_uris: ['http://127.0.0.1/callback'],
      });
      let messages = await assertRefused(
        assert,
        () => authorize(clientId, 'http://127.0.0.1:5000/callback'),
        'unknown-client',
        'a published site',
      );
      assert.deepEqual(documentServer.requested, [], 'nothing is downloaded');
      assert.strictEqual(
        messages.filter((message) =>
          message.includes(
            'client metadata document: outcome=refused reason=boxel-domain host=someone.boxel.site',
          ),
        ).length,
        1,
        'the refusal is logged once',
      );
    });

    test("a client ID beside one of Boxel's hosts, under the same registrable domain, is refused before any download", async function (assert) {
      let clientId = 'https://other.oauth-provider.test/client.json';
      documentServer.serve({
        client_id: clientId,
        redirect_uris: ['http://127.0.0.1/callback'],
      });
      let messages = await assertRefused(
        assert,
        () => authorize(clientId, 'http://127.0.0.1:5000/callback'),
        'unknown-client',
        "a host beside the secure origin's",
      );
      assert.deepEqual(documentServer.requested, [], 'nothing is downloaded');
      assert.true(
        messages.some((message) =>
          message.includes(
            'outcome=refused reason=boxel-domain host=other.oauth-provider.test',
          ),
        ),
        'the refusal is logged',
      );
    });

    test('a client ID whose scheme is not written in lower case is refused before any download', async function (assert) {
      let clientId = CLAUDE_CODE.client_id.replace('https://', 'HTTPS://');
      await assertRefused(
        assert,
        () => authorize(clientId, 'http://localhost:54321/callback'),
        'unknown-client',
        'an upper-case scheme',
      );
      assert.deepEqual(documentServer.requested, [], 'nothing is downloaded');
    });

    test('a client ID on a private address is refused by the outbound guard', async function (assert) {
      let messages = await assertRefused(
        assert,
        () =>
          authorize(
            'https://10.0.0.1/client.json',
            'http://127.0.0.1:5000/callback',
          ),
        'unknown-client',
        'a private address',
      );
      assert.true(
        messages.some((message) =>
          message.includes(
            'client metadata document: outcome=failed reason=guard-address host=10.0.0.1',
          ),
        ),
        "the guard's refusal is logged",
      );
    });

    test('a redirect from the document URL is not followed', async function (assert) {
      let clientId = 'https://client.example.test/moved.json';
      documentServer.answers.set('/moved.json', {
        status: 302,
        headers: { location: '/claude-code-copy.json' },
        body: '',
      });
      documentServer.serve({
        ...CLAUDE_CODE,
        client_id: 'https://client.example.test/claude-code-copy.json',
      });
      await assertRefused(
        assert,
        () => authorize(clientId, 'http://127.0.0.1:5000/callback'),
        'unknown-client',
        'a redirect',
      );
      assert.deepEqual(documentServer.requested, ['/moved.json']);
    });

    test('a document refused after it is read is downloaded once in a request', async function (assert) {
      let large = {
        redirect_uris: ['http://127.0.0.1/callback'],
        client_name: 'Large',
        padding: 'x'.repeat(6 * 1024),
      };
      let cases: [string, string, StubAnswer][] = [
        [
          'over 5 KB, its length declared',
          'declared.json',
          {
            body: JSON.stringify({
              client_id: 'https://client.example.test/declared.json',
              ...large,
            }),
          },
        ],
        [
          'over 5 KB, its length found only by reading',
          'chunked.json',
          {
            chunked: true,
            body: JSON.stringify({
              client_id: 'https://client.example.test/chunked.json',
              ...large,
            }),
          },
        ],
        ['not JSON', 'not-json.json', { body: '{"client_id":' }],
        [
          'naming another client ID',
          'mismatched.json',
          {
            body: JSON.stringify({
              client_id: 'https://client.example.test/someone-else.json',
              redirect_uris: ['http://127.0.0.1/callback'],
            }),
          },
        ],
      ];
      for (let [label, path, answer] of cases) {
        documentServer.answers.set(`/${path}`, answer);
        let before = documentServer.requested.length;
        await assertRefused(
          assert,
          () =>
            authorize(
              `https://client.example.test/${path}`,
              'http://127.0.0.1:5000/callback',
            ),
          'unknown-client',
          label,
        );
        assert.deepEqual(
          documentServer.requested.slice(before),
          [`/${path}`],
          `${label}: downloaded once`,
        );
      }
    });

    test('downloads count against the new-client limit; cache hits do not', async function (assert) {
      await restart({
        ...ROOMY_LIMIT,
        perAddress: { requests: 1, windowSeconds: 3600 },
      });
      assertStarted(
        assert,
        await authorize(
          CLAUDE_CODE.client_id,
          'http://localhost:54321/callback',
        ),
        'the first client',
      );
      let messages = await assertRefused(
        assert,
        () => authorize(CODEX.client_id, 'http://127.0.0.1:43210/callback'),
        'unknown-client',
        'a second client from the same address',
      );
      assert.true(
        messages.some((message) =>
          message.includes(
            'client metadata document: outcome=refused reason=limited host=chatgpt.com',
          ),
        ),
        'the refusal is logged',
      );
      let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
        assertStarted(
          assert,
          await authorize(
            CLAUDE_CODE.client_id,
            'http://localhost:54322/callback',
          ),
          'the first client again',
        );
      });
      assert.true(
        lines.some(({ message }) =>
          message.includes(
            'client metadata document: outcome=cache-hit host=claude.ai',
          ),
        ),
        'served from the cache',
      );
      assertStarted(
        assert,
        await authorize(CODEX.client_id, 'http://127.0.0.1:43210/callback', {
          caller: '198.51.100.4',
        }),
        'the second client, from another address',
      );
      assert.deepEqual(
        documentServer.requested,
        ['/oauth/claude-code-client-metadata', '/oauth/codex/client.json'],
        'each client downloaded once',
      );
    });
  });
});
