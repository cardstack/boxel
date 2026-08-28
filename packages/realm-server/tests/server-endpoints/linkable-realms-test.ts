import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import {
  closeServer,
  createVirtualNetwork,
  setupDB,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  realmConfigCardJSON,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import type { LinkableRealmsDocument } from '../../handlers/handle-linkable-realms.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_linkable-realms', function (hooks) {
    let request: SuperTest<Test>;
    let testRealmHttpServer: Server;
    let realms: Realm[];

    // The author writes into a realm someone else owns, and can read a realm
    // that owner cannot. That split is what the endpoint exists to report:
    // the consuming realm resolves links under its owner, not its author.
    let authorUserId = '@author:localhost';
    let ownerUserId = '@owner:localhost';

    let consumingRealmURL = new URL('http://127.0.0.1:4444/consuming/');
    let sharedRealmURL = new URL('http://127.0.0.1:4444/shared/');
    let authorOnlyRealmURL = new URL('http://127.0.0.1:4444/author-only/');
    let publicRealmURL = new URL('http://127.0.0.1:4444/public/');
    // No `realm-owner` row, so it has no identity to resolve links under.
    let ownerlessRealmURL = new URL('http://127.0.0.1:4444/ownerless/');

    async function startLinkableRealmsServer({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      let virtualNetwork = createVirtualNetwork();
      let dir = dirSync();
      let result = await runTestRealmServerWithRealms({
        virtualNetwork,
        realmsRootPath: join(dir.name, 'realm_server_1'),
        realms: [
          {
            realmURL: consumingRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Consuming Realm' }),
            },
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
              [authorUserId]: ['read', 'write'],
            },
          },
          {
            realmURL: sharedRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Shared Realm' }),
            },
            permissions: {
              [ownerUserId]: ['read'],
              [authorUserId]: ['read'],
            },
          },
          {
            realmURL: authorOnlyRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Author Only Realm' }),
            },
            permissions: {
              [authorUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: publicRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Public Realm' }),
            },
            permissions: {
              '*': ['read'],
              [authorUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: ownerlessRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Ownerless Realm' }),
            },
            permissions: {
              [authorUserId]: ['read', 'write'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });

      testRealmHttpServer = result.testRealmHttpServer;
      realms = result.realms;
      request = supertest(result.testRealmHttpServer);
    }

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        await startLinkableRealmsServer({ dbAdapter, publisher, runner });
      },
      afterEach: async () => {
        for (let realm of realms) {
          realm.unsubscribe();
        }
        await closeServer(testRealmHttpServer);
        resetCatalogRealms();
      },
    });

    function makeRequest(body: Record<string, unknown>, user = authorUserId) {
      let realmServerToken = createRealmServerJWT(
        { user, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      return request
        .post('/_linkable-realms')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send(body);
    }

    test('QUERY /_linkable-realms drops realms the consuming realm’s owner cannot read', async function (assert) {
      let response = await makeRequest({
        consumingRealm: consumingRealmURL.href,
        realms: [
          consumingRealmURL.href,
          sharedRealmURL.href,
          authorOnlyRealmURL.href,
          publicRealmURL.href,
        ],
      });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as LinkableRealmsDocument;
      assert.strictEqual(body.data.type, 'linkable-realms', 'document type');
      assert.strictEqual(
        body.data.id,
        consumingRealmURL.href,
        'document is keyed by the consuming realm',
      );
      assert.deepEqual(
        body.data.attributes.realms.sort(),
        [
          consumingRealmURL.href,
          publicRealmURL.href,
          sharedRealmURL.href,
        ].sort(),
        'the realm the author owns alone is dropped; the consuming, shared, and world-readable realms remain',
      );
    });

    test('QUERY /_linkable-realms refuses a consuming realm the caller cannot write', async function (assert) {
      // The answer describes the consuming realm owner's access. A caller who
      // merely reads that realm would be asking about a third party, so read
      // is not enough to ask — otherwise a world-readable realm becomes a
      // probe for its owner's membership in any realm the caller can name.
      let response = await makeRequest({
        consumingRealm: sharedRealmURL.href,
        realms: [sharedRealmURL.href, consumingRealmURL.href],
      });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(sharedRealmURL.href),
        'response names the realm the caller cannot write',
      );
    });

    test('QUERY /_linkable-realms leaves an ownerless realm able to link only its own cards', async function (assert) {
      let response = await makeRequest({
        consumingRealm: ownerlessRealmURL.href,
        realms: [
          ownerlessRealmURL.href,
          publicRealmURL.href,
          sharedRealmURL.href,
        ],
      });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as LinkableRealmsDocument;
      assert.deepEqual(
        body.data.attributes.realms,
        [ownerlessRealmURL.href],
        'a realm with no owner resolves links under no identity, so not even a world-readable realm is linkable from it',
      );
    });

    test('QUERY /_linkable-realms keeps the consuming realm itself', async function (assert) {
      let response = await makeRequest({
        consumingRealm: consumingRealmURL.href,
        realms: [consumingRealmURL.href],
      });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let body = response.body as LinkableRealmsDocument;
      assert.deepEqual(
        body.data.attributes.realms,
        [consumingRealmURL.href],
        'a realm can always link to its own cards',
      );
    });

    test('QUERY /_linkable-realms answers only for realms the caller can read', async function (assert) {
      // `@owner` has no permission on the author-only realm, so the request
      // is refused outright rather than answered with a filtered list — the
      // response can never disclose a realm the caller cannot already reach.
      let response = await makeRequest(
        {
          consumingRealm: consumingRealmURL.href,
          realms: [consumingRealmURL.href, authorOnlyRealmURL.href],
        },
        ownerUserId,
      );

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(authorOnlyRealmURL.href),
        'response names the realm the caller cannot read',
      );
    });

    test('QUERY /_linkable-realms requires a consumingRealm', async function (assert) {
      let response = await makeRequest({ realms: [consumingRealmURL.href] });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'consumingRealm must be supplied in request body',
        ),
        'response explains the missing consumingRealm',
      );
    });

    test('QUERY /_linkable-realms requires the consuming realm to be among the realms', async function (assert) {
      let response = await makeRequest({
        consumingRealm: sharedRealmURL.href,
        realms: [consumingRealmURL.href],
      });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes('must be included in realms'),
        'response explains that the consuming realm must ride along in realms',
      );
    });
  });
});
