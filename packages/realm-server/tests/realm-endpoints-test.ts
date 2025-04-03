import { module, skip, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, ensureDirSync, removeSync, writeJSONSync } from 'fs-extra';
import {
  baseRealm,
  loadCard,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createRealm,
  realmServerTestMatrix,
  realmServerSecretSeed,
  realmSecretSeed,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  getFastbootState,
  matrixRegistrationSecret,
  seedPath,
  testRealmInfo,
  waitUntil,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { RealmServer } from '../server';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { type PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealm2URL = new URL('http://127.0.0.1:4445/test/');
const testRealmHref = testRealmURL.href;
const testRealm2Href = testRealm2URL.href;
const distDir = resolve(join(__dirname, '..', '..', 'host', 'dist'));
console.log(`using host dist dir: ${distDir}`);

let createJWT = (
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) => {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
    },
    '7d',
  );
};

module(basename(__filename), function () {
  module('Realm-specific Endpoints', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer2: Server;
    let testRealm2: Realm;
    let dbAdapter2: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let testRealmDir: string;
    let seedRealm: Realm | undefined;

    function setTestRequest(newRequest: SuperTest<Test>) {
      request = newRequest;
    }

    function getTestRequest() {
      return request;
    }

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
      setTestRequest: (newRequest: SuperTest<Test>) => void,
      fileSystem?: Record<string, string | LooseSingleCardDocument>,
    ) {
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, publisher, runner) => {
          dbAdapter = _dbAdapter;
          dir = dirSync();
          let testRealmDir = join(dir.name, 'realm_server_1', 'test');
          ensureDirSync(testRealmDir);
          // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
          if (!fileSystem) {
            copySync(join(__dirname, 'cards'), testRealmDir);
          }

          let virtualNetwork = createVirtualNetwork();

          ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
            virtualNetwork,
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_1'),
            realmURL: testRealmURL,
            permissions,
            dbAdapter: _dbAdapter,
            runner,
            publisher,
            matrixURL,
            fileSystem,
          }));

          request = supertest(testRealmHttpServer);
          setTestRequest(request);
        },
      });
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, 'cards'), dir.name);
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealm(
      hooks,
      {
        '*': ['read', 'write'],
      },
      setTestRequest,
    );

    let { getMessagesSince } = setupMatrixRoom(hooks, getTestRequest);

    async function startRealmServer(
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) {
      if (testRealm2) {
        virtualNetwork.unmount(testRealm2.handle);
      }
      ({
        seedRealm,
        testRealm: testRealm2,
        testRealmHttpServer: testRealmHttpServer2,
      } = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath: join(dir.name, 'realm_server_2'),
        realmURL: testRealm2URL,
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      }));

      await testRealm.logInToMatrix();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter2 = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        testRealmDir = join(dir.name, 'realm_server_2', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        await startRealmServer(dbAdapter2, publisher, runner);
      },
      afterEach: async () => {
        if (seedRealm) {
          virtualNetwork.unmount(seedRealm.handle);
        }
        await closeServer(testRealmHttpServer2);
      },
    });

    test('can dynamically load a card definition from own realm', async function (assert) {
      let ref = {
        module: `${testRealmHref}person`,
        name: 'Person',
      };
      await loadCard(ref, { loader });
      let doc = {
        data: {
          attributes: { firstName: 'Mango' },
          meta: { adoptsFrom: ref },
        },
      };
      let api = await loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
      let person = await api.createFromSerialized<any>(
        doc.data,
        doc,
        undefined,
      );
      assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
    });

    test('can dynamically load a card definition from a different realm', async function (assert) {
      let ref = {
        module: `${testRealm2Href}person`,
        name: 'Person',
      };
      await loadCard(ref, { loader });
      let doc = {
        data: {
          attributes: { firstName: 'Mango' },
          meta: { adoptsFrom: ref },
        },
      };
      let api = await loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
      let person = await api.createFromSerialized<any>(
        doc.data,
        doc,
        undefined,
      );
      assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
    });

    test('can load a module when "last_modified" field in index is null', async function (assert) {
      await dbAdapter.execute('update boxel_index set last_modified = null');
      let response = await request
        .get(`/person`)
        .set('Accept', '*/*')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
        );
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
    });

    test('can instantiate a card that uses a code-ref field', async function (assert) {
      let adoptsFrom = {
        module: `${testRealm2Href}code-ref-test`,
        name: 'TestCard',
      };
      await loadCard(adoptsFrom, { loader });
      let ref = { module: `${testRealm2Href}person`, name: 'Person' };
      let doc = {
        data: {
          attributes: { ref },
          meta: { adoptsFrom },
        },
      };
      let api = await loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
      let testCard = await api.createFromSerialized<any>(
        doc.data,
        doc,
        undefined,
      );
      assert.deepEqual(testCard.ref, ref, 'card data is correct');
    });

    // CS-8095
    skip('can index a newly added file to the filesystem', async function (assert) {
      let realmEventTimestampStart = Date.now();

      {
        let response = await request
          .get('/new-card')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      }

      writeJSONSync(join(dir.name, 'realm_server_1', 'test', 'new-card.json'), {
        data: {
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument);

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);

      let incrementalIndexInitiationEvent = findRealmEvent(
        messages,
        'index',
        'incremental-index-initiation',
      );
      let incrementalEvent = findRealmEvent(messages, 'index', 'incremental');

      assert.deepEqual(incrementalIndexInitiationEvent?.content, {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: `${testRealmURL}new-card.json`,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmURL}new-card`],
      });

      {
        let response = await request
          .get('/new-card')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.ok(json.data.meta.lastModified, 'lastModified exists');
        delete json.data.meta.lastModified;
        delete json.data.meta.resourceCreatedAt;
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmURL.href,
          'realm url header is correct',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-public-readable'),
          'true',
          'realm is public readable',
        );
        assert.deepEqual(json, {
          data: {
            id: `${testRealmHref}new-card`,
            type: 'card',
            attributes: {
              title: 'Mango',
              firstName: 'Mango',
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: `./person`,
                name: 'Person',
              },
              // FIXME how to globally fix this?
              realmInfo: {
                ...testRealmInfo,
                realmUserId: '@node-test_realm:localhost',
              },
              realmURL: testRealmURL.href,
            },
            links: {
              self: `${testRealmHref}new-card`,
            },
          },
        });
      }
    });

    // CS-8095
    skip('can index a changed file in the filesystem', async function (assert) {
      let realmEventTimestampStart = Date.now();

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let json = response.body as LooseSingleCardDocument;
        assert.strictEqual(
          json.data.attributes?.firstName,
          'Mango',
          'initial firstName value is correct',
        );
      }

      writeJSONSync(join(dir.name, 'realm_server_1', 'test', 'person-1.json'), {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: './person.gts',
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument);

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);

      let incrementalIndexInitiationEvent = findRealmEvent(
        messages,
        'index',
        'incremental-index-initiation',
      );

      let incrementalEvent = findRealmEvent(messages, 'index', 'incremental');

      assert.deepEqual(incrementalIndexInitiationEvent?.content, {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: `${testRealmURL}person-1.json`,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      });

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let json = response.body as LooseSingleCardDocument;
        assert.strictEqual(
          json.data.attributes?.firstName,
          'Van Gogh',
          'updated firstName value is correct',
        );
      }
    });

    // CS-8095
    skip('can index a file deleted from the filesystem', async function (assert) {
      let realmEventTimestampStart = Date.now();

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      removeSync(join(dir.name, 'realm_server_1', 'test', 'person-1.json'));

      await waitForIncrementalIndexEvent(
        getMessagesSince,
        realmEventTimestampStart,
      );

      let messages = await getMessagesSince(realmEventTimestampStart);

      let incrementalIndexInitiationEvent = findRealmEvent(
        messages,
        'index',
        'incremental-index-initiation',
      );

      let incrementalEvent = findRealmEvent(messages, 'index', 'incremental');

      // FIXME split this test from the response-checking
      assert.deepEqual(incrementalIndexInitiationEvent?.content, {
        eventName: 'index',
        indexType: 'incremental-index-initiation',
        updatedFile: `${testRealmURL}person-1.json`,
      });

      assert.deepEqual(incrementalEvent?.content, {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmURL}person-1`],
      });

      {
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      }
    });

    test('can make HEAD request to get realmURL and isPublicReadable status', async function (assert) {
      let response = await request
        .head('/person-1')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.headers['x-boxel-realm-url'],
        testRealmURL.href,
      );
      assert.strictEqual(
        response.headers['x-boxel-realm-public-readable'],
        'true',
      );
    });
  });

  module('Realm server with realm mounted at the origin', function (hooks) {
    let testRealmServer: Server;

    let request: SuperTest<Test>;

    let dir: DirResult;

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        let testRealmDir = join(dir.name, 'realm_server_3', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_3'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test('serves an origin realm directory GET request', async function (assert) {
      let response = await request
        .get('/')
        .set('Accept', 'application/vnd.api+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      for (let relationship of Object.values(json.data.relationships)) {
        delete (relationship as any).meta.lastModified;
      }
      assert.deepEqual(
        json,
        {
          data: {
            id: testRealmHref,
            type: 'directory',
            relationships: {
              '%F0%9F%98%80.gts': {
                links: {
                  related: 'http://127.0.0.1:4444/%F0%9F%98%80.gts',
                },
                meta: {
                  kind: 'file',
                },
              },
              'a.js': {
                links: {
                  related: `${testRealmHref}a.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'b.js': {
                links: {
                  related: `${testRealmHref}b.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'c.js': {
                links: {
                  related: `${testRealmHref}c.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'chess-gallery.gts': {
                links: {
                  related: `${testRealmHref}chess-gallery.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'ChessGallery/': {
                links: {
                  related: `${testRealmHref}ChessGallery/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'code-ref-test.gts': {
                links: {
                  related: `${testRealmHref}code-ref-test.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'cycle-one.js': {
                links: {
                  related: `${testRealmHref}cycle-one.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'cycle-two.js': {
                links: {
                  related: `${testRealmHref}cycle-two.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'd.js': {
                links: {
                  related: `${testRealmHref}d.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'deadlock/': {
                links: {
                  related: `${testRealmHref}deadlock/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'dir/': {
                links: {
                  related: `${testRealmHref}dir/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'e.js': {
                links: {
                  related: `${testRealmHref}e.js`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'family_photo_card.gts': {
                links: {
                  related: `${testRealmHref}family_photo_card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'FamilyPhotoCard/': {
                links: {
                  related: `${testRealmHref}FamilyPhotoCard/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'friend.gts': {
                links: {
                  related: `${testRealmHref}friend.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'hassan.json': {
                links: {
                  related: `${testRealmHref}hassan.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'home.gts': {
                links: {
                  related: `${testRealmHref}home.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'index.json': {
                links: {
                  related: `${testRealmHref}index.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'jade.json': {
                links: {
                  related: `${testRealmHref}jade.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'missing-link.json': {
                links: {
                  related: `${testRealmHref}missing-link.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-1.json': {
                links: {
                  related: `${testRealmHref}person-1.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-2.json': {
                links: {
                  related: `${testRealmHref}person-2.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person-with-error.gts': {
                links: {
                  related: `${testRealmHref}person-with-error.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person.gts': {
                links: {
                  related: `${testRealmHref}person.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'person.json': {
                links: {
                  related: `${testRealmHref}person.json`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'PersonCard/': {
                links: {
                  related: `${testRealmHref}PersonCard/`,
                },
                meta: {
                  kind: 'directory',
                },
              },
              'query-test-cards.gts': {
                links: {
                  related: `${testRealmHref}query-test-cards.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
              'unused-card.gts': {
                links: {
                  related: `${testRealmHref}unused-card.gts`,
                },
                meta: {
                  kind: 'file',
                },
              },
            },
          },
        },
        'the directory response is correct',
      );
    });
  });

  module('Realm server serving multiple realms', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let base: Realm;
    let testRealm: Realm;

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();
    const basePath = resolve(join(__dirname, '..', '..', 'base'));

    hooks.beforeEach(async function () {
      dir = dirSync();
      ensureDirSync(join(dir.name, 'demo'));
      copySync(join(__dirname, 'cards'), join(dir.name, 'demo'));
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        let localBaseRealmURL = new URL('http://127.0.0.1:4446/base/');
        virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

        base = await createRealm({
          withWorker: true,
          dir: basePath,
          realmURL: baseRealm.url,
          virtualNetwork,
          publisher,
          runner,
          dbAdapter,
          deferStartUp: true,
        });
        virtualNetwork.mount(base.handle);

        testRealm = await createRealm({
          withWorker: true,
          dir: join(dir.name, 'demo'),
          virtualNetwork,
          realmURL: 'http://127.0.0.1:4446/demo/',
          publisher,
          runner,
          dbAdapter,
          deferStartUp: true,
        });
        virtualNetwork.mount(testRealm.handle);

        let matrixClient = new MatrixClient({
          matrixURL: realmServerTestMatrix.url,
          username: realmServerTestMatrix.username,
          seed: realmSecretSeed,
        });
        let getIndexHTML = (await getFastbootState()).getIndexHTML;
        testRealmServer = new RealmServer({
          realms: [base, testRealm],
          virtualNetwork,
          matrixClient,
          realmServerSecretSeed,
          realmSecretSeed,
          matrixRegistrationSecret,
          realmsRootPath: dir.name,
          dbAdapter,
          queue: publisher,
          getIndexHTML,
          seedPath,
          serverURL: new URL('http://127.0.0.1:4446'),
          assetsURL: new URL(`http://example.com/notional-assets-host/`),
        }).listen(parseInt(localBaseRealmURL.port));
        await base.start();
        await testRealm.start();

        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    test(`Can perform full indexing multiple times on a server that runs multiple realms`, async function (assert) {
      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await base.reindex();
      await testRealm.reindex();

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }

      await base.reindex();
      await testRealm.reindex();

      {
        let response = await request
          .get('/demo/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
      }
    });
  });

  module('Realm Server serving from a subdirectory', function (hooks) {
    let testRealmServer: Server;

    let request: SuperTest<Test>;

    let dir: DirResult;

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        dir = dirSync();
        let testRealmDir = join(dir.name, 'realm_server_4', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_4'),
            realmURL: new URL('http://127.0.0.1:4446/demo/'),
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test('serves a subdirectory GET request that results in redirect', async function (assert) {
      let response = await request.get('/demo');

      assert.strictEqual(response.status, 302, 'HTTP 302 status');
      assert.strictEqual(
        response.headers['location'],
        'http://127.0.0.1:4446/demo/',
      );
    });

    test('redirection keeps query params intact', async function (assert) {
      let response = await request.get(
        '/demo?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
      );

      assert.strictEqual(response.status, 302, 'HTTP 302 status');
      assert.strictEqual(
        response.headers['location'],
        'http://127.0.0.1:4446/demo/?operatorModeEnabled=true&operatorModeState=%7B%22stacks%22%3A%5B%7B%22items%22%3A%5B%7B%22card%22%3A%7B%22id%22%3A%22http%3A%2F%2Flocalhost%3A4204%2Findex%22%7D%2C%22format%22%3A%22isolated%22%7D%5D%7D%5D%7D',
      );
    });
  });
});

async function waitForIncrementalIndexEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  await waitUntil(async () => {
    let matrixMessages = await getMessagesSince(since);

    return matrixMessages.some(
      (m) =>
        m.type === APP_BOXEL_REALM_EVENT_TYPE &&
        m.content.eventName === 'index' &&
        m.content.indexType === 'incremental',
    );
  });
}

function findRealmEvent(
  events: MatrixEvent[],
  eventName: string,
  indexType: string,
): RealmEvent | undefined {
  return events.find(
    (m) =>
      m.type === APP_BOXEL_REALM_EVENT_TYPE &&
      m.content.eventName === eventName &&
      (realmEventIsIndex(m.content) ? m.content.indexType === indexType : true),
  ) as RealmEvent | undefined;
}

function realmEventIsIndex(
  event: RealmEventContent,
): event is IncrementalIndexEventContent {
  return event.eventName === 'index';
}
