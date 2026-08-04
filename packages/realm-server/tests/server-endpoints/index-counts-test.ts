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
import { rri } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import {
  assertRealmIndexCounts,
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

const PERSON_SOURCE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Person extends CardDef {
    @field firstName = contains(StringField);
  }
`;

module(`server-endpoints/${basename(import.meta.filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_federated-index-counts', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    async function startCountsRealmServer({
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
      let testRealmURL = new URL('http://127.0.0.1:4444/test/');
      let secondaryRealmURL = new URL('http://127.0.0.1:4444/secondary/');
      let result = await runTestRealmServerWithRealms({
        virtualNetwork,
        realmsRootPath: join(dir.name, 'realm_server_1'),
        realms: [
          {
            realmURL: testRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Primary Realm' }),
              'person.gts': PERSON_SOURCE,
              'mango.json': {
                data: {
                  attributes: { firstName: 'Mango' },
                  meta: {
                    adoptsFrom: {
                      module: rri('./person.gts'),
                      name: 'Person',
                    },
                  },
                },
              },
              'notes.txt': 'a plain file',
            },
            permissions: {
              '*': ['read'],
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: secondaryRealmURL,
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Secondary Realm' }),
            },
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });

      testRealmHttpServer = result.testRealmHttpServer;
      request = supertest(result.testRealmHttpServer);
      testRealm = result.realms.find(
        (realm) => realm.url === testRealmURL.href,
      )!;
      secondaryRealm = result.realms.find(
        (realm) => realm.url === secondaryRealmURL.href,
      )!;
    }

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        await startCountsRealmServer({ dbAdapter, publisher, runner });
      },
      // Tolerate a half-finished setup. If the fixture build fails the realms
      // are never assigned, and an unguarded teardown throws before
      // `closeServer` — leaking the bound port so every later test in the
      // process fails with EADDRINUSE instead of the real error.
      afterEach: async () => {
        testRealm?.unsubscribe();
        secondaryRealm?.unsubscribe();
        if (testRealmHttpServer) {
          await closeServer(testRealmHttpServer);
        }
        resetCatalogRealms();
      },
    });

    test('QUERY returns counts for every requested realm', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_federated-index-counts')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let { data } = response.body as {
        data: {
          id: string;
          type: string;
          attributes: Record<string, unknown>;
        }[];
      };
      assert.strictEqual(data.length, 2, 'returns counts for both realms');

      let byId = new Map(data.map((entry) => [entry.id, entry]));
      assert.strictEqual(
        byId.get(testRealm.url)?.type,
        'realm-index-counts',
        'resource type is realm-index-counts',
      );
      // Two cards: `mango.json` plus the realm's own RealmConfig card at
      // `realm.json`. One definition (`person.gts`) and one plain file
      // (`notes.txt`) — note that neither card's `.json` lands in the file
      // count, since an instance and its file row share a url.
      assertRealmIndexCounts(assert, byId.get(testRealm.url)!.attributes, {
        cardCount: 2,
        definitionCount: 1,
        fileCount: 1,
      });
      // The secondary realm holds only its RealmConfig card.
      assertRealmIndexCounts(assert, byId.get(secondaryRealm.url)!.attributes, {
        cardCount: 1,
        definitionCount: 0,
        fileCount: 0,
      });
    });

    test('QUERY reflects a write once the realm re-indexes', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      let fetchCardCount = async () => {
        let response = await request
          .post('/_federated-index-counts')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({ realms: [testRealm.url] });
        return response.body.data[0].attributes.cardCount as number;
      };

      let before = await fetchCardCount();
      await testRealm.write(
        'vanGogh.json',
        JSON.stringify({
          data: {
            attributes: { firstName: 'Van Gogh' },
            meta: {
              adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
            },
          },
        }),
      );

      // The counts are memoized per index generation; the index swap has to
      // drop that cache or the tile would show a stale number forever.
      assert.strictEqual(
        await fetchCardCount(),
        before + 1,
        'the memoized counts are invalidated by the index swap',
      );
    });

    test('QUERY returns 403 when the caller lacks read access', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: '@rando:localhost', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let response = await request
        .post('/_federated-index-counts')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
    });

    test('QUERY returns 401 for an unauthenticated request to a private realm', async function (assert) {
      let response = await request
        .post('/_federated-index-counts')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .send({ realms: [secondaryRealm.url] });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('QUERY returns 400 when realms are missing', async function (assert) {
      let response = await request
        .post('/_federated-index-counts')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/vnd.api+json')
        .send({});

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });
  });
});
