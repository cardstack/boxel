import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, existsSync, ensureDirSync, readJSONSync } from 'fs-extra';
import {
  baseRealm,
  Deferred,
  Realm,
  RealmPermissions,
  fetchUserPermissions,
  baseCardRef,
  type LooseSingleCardDocument,
  type SingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
  encodeWebSafeBase64,
} from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { v4 as uuidv4 } from 'uuid';
import { Query } from '@cardstack/runtime-common/query';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  realmServerTestMatrix,
  realmSecretSeed,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  testRealmInfo,
  insertUser,
  insertPlan,
  fetchSubscriptionsByUserId,
  insertJob,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { shimExternals } from '../lib/externals';
import { RealmServer } from '../server';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import jwt from 'jsonwebtoken';
import { type CardCollectionDocument } from '@cardstack/runtime-common/card-document';
import { type PgAdapter } from '@cardstack/postgres';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  createJWT as createRealmServerJWT,
  RealmServerTokenClaim,
} from '../utils/jwt';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import Stripe from 'stripe';
import sinon from 'sinon';
import { getStripe } from '@cardstack/billing/stripe-webhook-handlers/stripe';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  MatrixEvent,
  RealmServerEventContent,
} from 'https://cardstack.com/base/matrix-event';
import { monitoringAuthToken } from '../utils/monitoring';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealm2URL = new URL('http://127.0.0.1:4445/test/');
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
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let testRealm: Realm;
      let testRealmHttpServer: Server;
      let request: SuperTest<Test>;
      let dir: DirResult;
      let dbAdapter: PgAdapter;

      function setupPermissionedRealm(
        hooks: NestedHooks,
        permissions: RealmPermissions,
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

      module('various other realm tests', function (hooks) {
        let testRealmHttpServer2: Server;
        let testRealmServer2: RealmServer;
        let testRealm2: Realm;
        let dbAdapter: PgAdapter;
        let publisher: QueuePublisher;
        let runner: QueueRunner;
        let request2: SuperTest<Test>;
        let testRealmDir: string;
        let seedRealm: Realm | undefined;

        hooks.beforeEach(async function () {
          shimExternals(virtualNetwork);
        });

        setupPermissionedRealm(hooks, {
          '*': ['read', 'write'],
        });

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
            testRealmServer: testRealmServer2,
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
          request2 = supertest(testRealmHttpServer2);
        }

        setupDB(hooks, {
          beforeEach: async (_dbAdapter, _publisher, _runner) => {
            dbAdapter = _dbAdapter;
            publisher = _publisher;
            runner = _runner;
            testRealmDir = join(dir.name, 'realm_server_2', 'test');
            ensureDirSync(testRealmDir);
            copySync(join(__dirname, 'cards'), testRealmDir);
            await startRealmServer(dbAdapter, publisher, runner);
          },
          afterEach: async () => {
            if (seedRealm) {
              virtualNetwork.unmount(seedRealm.handle);
            }
            await closeServer(testRealmHttpServer2);
          },
        });

        test('POST /_create-realm', async function (assert) {
          // we randomize the realm and owner names so that we can isolate matrix
          // test state--there is no "delete user" matrix API
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:boxel.ai';
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    ...testRealmInfo,
                    endpoint,
                    backgroundURL: 'http://example.com/background.jpg',
                    iconURL: 'http://example.com/icon.jpg',
                  },
                },
              }),
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              data: {
                type: 'realm',
                id: `${testRealm2URL.origin}/${owner}/${endpoint}/`,
                attributes: {
                  ...testRealmInfo,
                  endpoint,
                  backgroundURL: 'http://example.com/background.jpg',
                  iconURL: 'http://example.com/icon.jpg',
                },
              },
            },
            'realm creation JSON is correct',
          );

          let realmPath = join(dir.name, 'realm_server_2', owner, endpoint);
          let realmJSON = readJSONSync(join(realmPath, '.realm.json'));
          assert.deepEqual(
            realmJSON,
            {
              name: 'Test Realm',
              backgroundURL: 'http://example.com/background.jpg',
              iconURL: 'http://example.com/icon.jpg',
            },
            '.realm.json is correct',
          );
          assert.ok(
            existsSync(join(realmPath, 'index.json')),
            'seed file index.json exists',
          );
          assert.ok(
            existsSync(
              join(
                realmPath,
                'HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0.json',
              ),
            ),
            'seed file HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0.json exists',
          );
          assert.notOk(
            existsSync(join(realmPath, 'package.json')),
            'ignored seed file package.json does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, 'node_modules')),
            'ignored seed file node_modules/ does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, '.gitignore')),
            'ignored seed file .gitignore does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, 'tsconfig.json')),
            'ignored seed file tsconfig.json does not exist',
          );

          let permissions = await fetchUserPermissions(
            dbAdapter,
            new URL(json.data.id),
          );
          assert.deepEqual(permissions, {
            [`@realm/mango_${endpoint}:localhost`]: [
              'read',
              'write',
              'realm-owner',
            ],
            [ownerUserId]: ['read', 'write', 'realm-owner'],
          });

          let id: string;
          let realm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === json.data.id,
          )!;
          {
            // owner can get a seeded instance
            let response = await request2
              .get(`/${owner}/${endpoint}/jade`)
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let doc = response.body as SingleCardDocument;
            assert.strictEqual(
              doc.data.attributes?.title,
              'Jade',
              'instance data is correct',
            );
          }
          {
            // owner can create an instance
            let response = await request2
              .post(`/${owner}/${endpoint}/`)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    title: 'Test Card',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'https://cardstack.com/base/card-api',
                      name: 'CardDef',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            let doc = response.body as SingleCardDocument;
            id = doc.data.id;
          }

          {
            // owner can get an instance
            let response = await request2
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let doc = response.body as SingleCardDocument;
            assert.strictEqual(
              doc.data.attributes?.title,
              'Test Card',
              'instance data is correct',
            );
          }

          {
            // owner can search in the realm
            let response = await request2
              .get(
                `${new URL(realm.url).pathname}_search?${stringify({
                  filter: {
                    on: baseCardRef,
                    eq: {
                      title: 'Test Card',
                    },
                  },
                } as Query)}`,
              )
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let results = response.body as CardCollectionDocument;
            assert.strictEqual(results.data.length, 1),
              'correct number of search results';
          }
        });

        test('POST /_create-realm without copying seed realm', async function (assert) {
          // we randomize the realm and owner names so that we can isolate matrix
          // test state--there is no "delete user" matrix API
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:boxel.ai';
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    ...testRealmInfo,
                    endpoint,
                    backgroundURL: 'http://example.com/background.jpg',
                    iconURL: 'http://example.com/icon.jpg',
                    copyFromSeedRealm: false,
                  },
                },
              }),
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              data: {
                type: 'realm',
                id: `${testRealm2URL.origin}/${owner}/${endpoint}/`,
                attributes: {
                  ...testRealmInfo,
                  endpoint,
                  backgroundURL: 'http://example.com/background.jpg',
                  iconURL: 'http://example.com/icon.jpg',
                  copyFromSeedRealm: false,
                },
              },
            },
            'realm creation JSON is correct',
          );

          let realmPath = join(dir.name, 'realm_server_2', owner, endpoint);
          let realmJSON = readJSONSync(join(realmPath, '.realm.json'));
          assert.deepEqual(
            realmJSON,
            {
              name: 'Test Realm',
              backgroundURL: 'http://example.com/background.jpg',
              iconURL: 'http://example.com/icon.jpg',
            },
            '.realm.json is correct',
          );
          assert.ok(
            existsSync(join(realmPath, 'index.json')),
            'seed file index.json exists',
          );
          assert.notOk(
            existsSync(
              join(
                realmPath,
                'HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0.json',
              ),
            ),
            'seed file HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0.json exists',
          );
          assert.notOk(
            existsSync(join(realmPath, 'package.json')),
            'ignored seed file package.json does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, 'node_modules')),
            'ignored seed file node_modules/ does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, '.gitignore')),
            'ignored seed file .gitignore does not exist',
          );
          assert.notOk(
            existsSync(join(realmPath, 'tsconfig.json')),
            'ignored seed file tsconfig.json does not exist',
          );
        });

        test('dynamically created realms are not publicly readable or writable', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:boxel.ai';
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );

          let realmURL = response.body.data.id;
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let realm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === realmURL,
          )!;

          {
            let response = await request2
              .get(
                `${new URL(realmURL).pathname}_search?${stringify({
                  filter: {
                    on: baseCardRef,
                    eq: {
                      title: 'Test Card',
                    },
                  },
                } as Query)}`,
              )
              .set('Accept', 'application/vnd.card+json')
              .set('Authorization', `Bearer ${createJWT(realm, 'rando')}`);

            assert.strictEqual(response.status, 403, 'HTTP 403 status');

            response = await request2
              .post(`/${owner}/${endpoint}/`)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    title: 'Test Card',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'https://cardstack.com/base/card-api',
                      name: 'CardDef',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set('Authorization', `Bearer ${createJWT(realm, 'rando')}`);

            assert.strictEqual(response.status, 403, 'HTTP 403 status');
          }
        });

        test('can restart a realm that was created dynamically', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:boxel.ai';
          let realmURL: string;
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      name: 'Test Realm',
                      endpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            realmURL = response.body.data.id;
          }

          let id: string;
          let realm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === realmURL,
          )!;
          {
            let response = await request2
              .post(`/${owner}/${endpoint}/`)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    title: 'Test Card',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'https://cardstack.com/base/card-api',
                      name: 'CardDef',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            id = response.body.data.id;
          }

          // Stop and restart the server
          testRealmServer2.testingOnlyUnmountRealms();
          await closeServer(testRealmHttpServer2);
          await startRealmServer(dbAdapter, publisher, runner);
          await testRealmServer2.start();

          {
            let response = await request2
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(realm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let doc = response.body as SingleCardDocument;
            assert.strictEqual(
              doc.data.attributes?.title,
              'Test Card',
              'instance data is correct',
            );
          }
        });

        test('POST /_create-realm without JWT', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          let error = response.body.errors[0];
          assert.strictEqual(
            error,
            'Missing Authorization header',
            'error message is correct',
          );
        });

        test('POST /_create-realm with invalid JWT', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set('Authorization', 'Bearer invalid-jwt')
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          let error = response.body.errors[0];
          assert.strictEqual(
            error,
            'Token invalid',
            'error message is correct',
          );
        });

        test('POST /_create-realm with invalid JSON', async function (assert) {
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send('make a new realm please!');
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let error = response.body.errors[0];
          assert.ok(
            error.match(/not valid JSON-API/),
            'error message is correct',
          );
        });

        test('POST /_create-realm with bad JSON-API', async function (assert) {
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                name: 'mango-realm',
              }),
            );
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let error = response.body.errors[0];
          assert.ok(
            error.match(/not valid JSON-API/),
            'error message is correct',
          );
        });

        test('POST /_create-realm without a realm endpoint', async function (assert) {
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    name: 'Test Realm',
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let error = response.body.errors[0];
          assert.ok(
            error.match(/endpoint is required and must be a string/),
            'error message is correct',
          );
        });

        test('POST /_create-realm without a realm name', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    endpoint,
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let error = response.body.errors[0];
          assert.ok(
            error.match(/name is required and must be a string/),
            'error message is correct',
          );
        });

        test('cannot create a realm on a realm server that has a realm mounted at the origin', async function (assert) {
          let response = await request
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: '@mango:boxel.ai', sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    endpoint: 'mango-realm',
                    name: 'Test Realm',
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let error = response.body.errors[0];
          assert.ok(
            error.match(
              /a realm is already mounted at the origin of this server/,
            ),
            'error message is correct',
          );
        });

        test('cannot create a new realm that collides with an existing realm', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let ownerUserId = '@mango:boxel.ai';
          let response = await request2
            .post('/_create-realm')
            .set('Accept', 'application/vnd.api+json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send(
              JSON.stringify({
                data: {
                  type: 'realm',
                  attributes: {
                    endpoint,
                    name: 'Test Realm',
                  },
                },
              }),
            );
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  { user: ownerUserId, sessionRoom: 'session-room-test' },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      endpoint,
                      name: 'Another Test Realm',
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 400, 'HTTP 400 status');
            let error = response.body.errors[0];
            assert.ok(
              error.match(/already exists on this server/),
              'error message is correct',
            );
          }
        });

        test('cannot create a realm with invalid characters in endpoint', async function (assert) {
          let ownerUserId = '@mango:boxel.ai';
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  { user: ownerUserId, sessionRoom: 'session-room-test' },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      endpoint: 'invalid_realm_endpoint',
                      name: 'Test Realm',
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 400, 'HTTP 400 status');
            let error = response.body.errors[0];
            assert.ok(
              error.match(/contains invalid characters/),
              'error message is correct',
            );
          }
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  { user: ownerUserId, sessionRoom: 'session-room-test' },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      endpoint: 'invalid realm endpoint',
                      name: 'Test Realm',
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 400, 'HTTP 400 status');
            let error = response.body.errors[0];
            assert.ok(
              error.match(/contains invalid characters/),
              'error message is correct',
            );
          }
        });

        test('returns 404 for request that has malformed URI', async function (assert) {
          let response = await request2.get('/%c0').set('Accept', '*/*');
          assert.strictEqual(response.status, 404, 'HTTP 404 status');
        });

        test('can create a user', async function (assert) {
          let ownerUserId = '@mango:boxel.ai';
          let response = await request2
            .post('/_user')
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set(
              'Authorization',
              `Bearer ${createRealmServerJWT(
                { user: ownerUserId, sessionRoom: 'session-room-test' },
                realmSecretSeed,
              )}`,
            )
            .send({
              data: {
                type: 'user',
                attributes: {
                  registrationToken: 'reg_token_123',
                },
              },
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(response.text, 'ok', 'response body is correct');

          let user = await getUserByMatrixUserId(dbAdapter, ownerUserId);
          if (!user) {
            throw new Error('user does not exist in db');
          }
          assert.strictEqual(
            user.matrixUserId,
            ownerUserId,
            'matrix user ID is correct',
          );
          assert.strictEqual(
            user.matrixRegistrationToken,
            'reg_token_123',
            'registration token is correct',
          );
        });

        test('can not create a user without a jwt', async function (assert) {
          let response = await request2.post('/_user').send({});
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('can fetch catalog realms', async function (assert) {
          let response = await request2
            .get('/_catalog-realms')
            .set('Accept', 'application/json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(response.body, {
            data: [
              {
                type: 'catalog-realm',
                id: `${testRealm2URL}`,
                attributes: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
              },
              // the seed realm is automatically added to the realm server running
              // on port 4445 as a public realm
              {
                type: 'catalog-realm',
                id: `${new URL('/seed/', testRealm2URL)}`,
                attributes: testRealmInfo,
              },
            ],
          });
        });

        test(`returns 200 with empty data if failed to fetch catalog realm's info`, async function (assert) {
          virtualNetwork.mount(
            async (req: Request) => {
              if (req.url.includes('_info')) {
                return new Response('Failed to fetch realm info', {
                  status: 500,
                  statusText: 'Internal Server Error',
                });
              }
              return null;
            },
            { prepend: true },
          );
          let response = await request2
            .get('/_catalog-realms')
            .set('Accept', 'application/json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(response.body, {
            data: [],
          });
        });
      });

      module('stripe webhook handler', function (hooks) {
        let createSubscriptionStub: sinon.SinonStub;
        let fetchPriceListStub: sinon.SinonStub;
        let matrixClient: MatrixClient;
        let roomId: string;
        let userId = '@test_realm:localhost';
        let waitForBillingNotification = async function (
          assert: Assert,
          done: () => void,
        ) {
          let messages = await matrixClient.roomMessages(roomId);
          let firstMessageContent = messages[0].content;

          if (messageEventContentIsRealmServerEvent(firstMessageContent)) {
            assert.strictEqual(
              (firstMessageContent as RealmServerEventContent).body,
              JSON.stringify({ eventType: 'billing-notification' }),
            );
            done();
          } else {
            setTimeout(() => waitForBillingNotification(assert, done), 1);
          }
        };

        setupPermissionedRealm(hooks, {
          '*': ['read', 'write'],
        });

        hooks.beforeEach(async function () {
          shimExternals(virtualNetwork);
          let stripe = getStripe();
          createSubscriptionStub = sinon.stub(stripe.subscriptions, 'create');
          fetchPriceListStub = sinon.stub(stripe.prices, 'list');

          matrixClient = new MatrixClient({
            matrixURL: realmServerTestMatrix.url,
            username: 'test_realm',
            seed: realmSecretSeed,
          });
          await matrixClient.login();
          let userId = matrixClient.getUserId();

          let response = await request
            .post('/_server-session')
            .send(JSON.stringify({ user: userId }))
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json');
          let json = response.body;

          let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

          if (!rooms.includes(json.room)) {
            await matrixClient.joinRoom(json.room);
          }

          await matrixClient.sendEvent(json.room, 'm.room.message', {
            body: `auth-response: ${json.challenge}`,
            msgtype: 'm.text',
          });

          response = await request
            .post('/_server-session')
            .send(JSON.stringify({ user: userId, challenge: json.challenge }))
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json');
          roomId = json.room;
        });

        hooks.afterEach(async function () {
          createSubscriptionStub.restore();
          fetchPriceListStub.restore();
        });

        test('subscribes user back to free plan when the current subscription is expired', async function (assert) {
          const secret = process.env.STRIPE_WEBHOOK_SECRET;
          let user = await insertUser(
            dbAdapter,
            userId,
            'cus_123',
            'user@test.com',
          );
          let freePlan = await insertPlan(
            dbAdapter,
            'Free plan',
            0,
            100,
            'prod_free',
          );
          let creatorPlan = await insertPlan(
            dbAdapter,
            'Creator',
            12,
            5000,
            'prod_creator',
          );

          if (!secret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not set');
          }
          let stripeInvoicePaymentSucceededEvent = {
            id: 'evt_1234567890',
            object: 'event',
            type: 'invoice.payment_succeeded',
            data: {
              object: {
                id: 'in_1234567890',
                object: 'invoice',
                amount_paid: 12,
                billing_reason: 'subscription_create',
                period_end: 1638465600,
                period_start: 1635873600,
                subscription: 'sub_1234567890',
                customer: 'cus_123',
                lines: {
                  data: [
                    {
                      amount: 12,
                      price: { product: 'prod_creator' },
                    },
                  ],
                },
              },
            },
          };

          let timestamp = Math.floor(Date.now() / 1000);
          let stripeInvoicePaymentSucceededPayload = JSON.stringify(
            stripeInvoicePaymentSucceededEvent,
          );
          let stripeInvoicePaymentSucceededSignature =
            Stripe.webhooks.generateTestHeaderString({
              payload: stripeInvoicePaymentSucceededPayload,
              secret,
              timestamp,
            });
          await request
            .post('/_stripe-webhook')
            .send(stripeInvoicePaymentSucceededPayload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', stripeInvoicePaymentSucceededSignature);

          let subscriptions = await fetchSubscriptionsByUserId(
            dbAdapter,
            user.id,
          );
          assert.strictEqual(subscriptions.length, 1);
          assert.strictEqual(subscriptions[0].status, 'active');
          assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

          let waitForSubscriptionExpiryProcessed = new Deferred<void>();
          let waitForFreePlanSubscriptionProcessed = new Deferred<void>();

          // A function to simulate webhook call from stripe after we call 'stripe.subscription.create' endpoint
          let subscribeToFreePlan = async function () {
            await waitForSubscriptionExpiryProcessed.promise;
            let stripeInvoicePaymentSucceededEvent = {
              id: 'evt_1234567892',
              object: 'event',
              type: 'invoice.payment_succeeded',
              data: {
                object: {
                  id: 'in_1234567890',
                  object: 'invoice',
                  amount_paid: 0, // free plan
                  billing_reason: 'subscription_create',
                  period_end: 1638465600,
                  period_start: 1635873600,
                  subscription: 'sub_1234567890',
                  customer: 'cus_123',
                  lines: {
                    data: [
                      {
                        amount: 0,
                        price: { product: 'prod_free' },
                      },
                    ],
                  },
                },
              },
            };
            let stripeInvoicePaymentSucceededPayload = JSON.stringify(
              stripeInvoicePaymentSucceededEvent,
            );
            let stripeInvoicePaymentSucceededSignature =
              Stripe.webhooks.generateTestHeaderString({
                payload: stripeInvoicePaymentSucceededPayload,
                secret,
                timestamp,
              });
            await request
              .post('/_stripe-webhook')
              .send(stripeInvoicePaymentSucceededPayload)
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/json')
              .set('stripe-signature', stripeInvoicePaymentSucceededSignature);
            waitForFreePlanSubscriptionProcessed.fulfill();
          };
          const createSubscriptionResponse = {
            id: 'sub_1MowQVLkdIwHu7ixeRlqHVzs',
            object: 'subscription',
            automatic_tax: {
              enabled: false,
            },
            billing_cycle_anchor: 1679609767,
            cancel_at_period_end: false,
            collection_method: 'charge_automatically',
            created: 1679609767,
            currency: 'usd',
            current_period_end: 1682288167,
            current_period_start: 1679609767,
            customer: 'cus_123',
            invoice_settings: {
              issuer: {
                type: 'self',
              },
            },
          };
          createSubscriptionStub.callsFake(() => {
            subscribeToFreePlan();
            return createSubscriptionResponse;
          });

          let fetchPriceListResponse = {
            object: 'list',
            data: [
              {
                id: 'price_1QMRCxH9rBd1yAHRD4BXhAHW',
                object: 'price',
                active: true,
                billing_scheme: 'per_unit',
                created: 1731921923,
                currency: 'usd',
                custom_unit_amount: null,
                livemode: false,
                lookup_key: null,
                metadata: {},
                nickname: null,
                product: 'prod_REv3E69DbAPv4K',
                recurring: {
                  aggregate_usage: null,
                  interval: 'month',
                  interval_count: 1,
                  meter: null,
                  trial_period_days: null,
                  usage_type: 'licensed',
                },
                tax_behavior: 'unspecified',
                tiers_mode: null,
                transform_quantity: null,
                type: 'recurring',
                unit_amount: 0,
                unit_amount_decimal: '0',
              },
            ],
            has_more: false,
            url: '/v1/prices',
          };
          fetchPriceListStub.resolves(fetchPriceListResponse);

          let stripeSubscriptionDeletedEvent = {
            id: 'evt_sub_deleted_1',
            object: 'event',
            type: 'customer.subscription.deleted',
            data: {
              object: {
                id: 'sub_1234567890',
                canceled_at: 2,
                cancellation_details: {
                  reason: 'payment_failure',
                },
                customer: 'cus_123',
              },
            },
          };
          let stripeSubscriptionDeletedPayload = JSON.stringify(
            stripeSubscriptionDeletedEvent,
          );
          let stripeSubscriptionDeletedSignature =
            Stripe.webhooks.generateTestHeaderString({
              payload: stripeSubscriptionDeletedPayload,
              secret,
              timestamp,
            });
          await request
            .post('/_stripe-webhook')
            .send(stripeSubscriptionDeletedPayload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', stripeSubscriptionDeletedSignature);
          waitForSubscriptionExpiryProcessed.fulfill();

          await waitForFreePlanSubscriptionProcessed.promise;
          subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
          assert.strictEqual(subscriptions.length, 2);
          assert.strictEqual(subscriptions[0].status, 'expired');
          assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

          assert.strictEqual(subscriptions[1].status, 'active');
          assert.strictEqual(subscriptions[1].planId, freePlan.id);
          waitForBillingNotification(assert, assert.async());
        });

        test('ensures the current subscription expires when free plan subscription fails', async function (assert) {
          const secret = process.env.STRIPE_WEBHOOK_SECRET;
          let user = await insertUser(
            dbAdapter,
            userId,
            'cus_123',
            'user@test.com',
          );
          await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
          let creatorPlan = await insertPlan(
            dbAdapter,
            'Creator',
            12,
            5000,
            'prod_creator',
          );

          if (!secret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not set');
          }
          let stripeInvoicePaymentSucceededEvent = {
            id: 'evt_1234567890',
            object: 'event',
            type: 'invoice.payment_succeeded',
            data: {
              object: {
                id: 'in_1234567890',
                object: 'invoice',
                amount_paid: 12,
                billing_reason: 'subscription_create',
                period_end: 1638465600,
                period_start: 1635873600,
                subscription: 'sub_1234567890',
                customer: 'cus_123',
                lines: {
                  data: [
                    {
                      amount: 12,
                      price: { product: 'prod_creator' },
                    },
                  ],
                },
              },
            },
          };

          let timestamp = Math.floor(Date.now() / 1000);
          let stripeInvoicePaymentSucceededPayload = JSON.stringify(
            stripeInvoicePaymentSucceededEvent,
          );
          let stripeInvoicePaymentSucceededSignature =
            Stripe.webhooks.generateTestHeaderString({
              payload: stripeInvoicePaymentSucceededPayload,
              secret,
              timestamp,
            });
          await request
            .post('/_stripe-webhook')
            .send(stripeInvoicePaymentSucceededPayload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', stripeInvoicePaymentSucceededSignature);

          let subscriptions = await fetchSubscriptionsByUserId(
            dbAdapter,
            user.id,
          );
          assert.strictEqual(subscriptions.length, 1);
          assert.strictEqual(subscriptions[0].status, 'active');
          assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

          createSubscriptionStub.throws({
            message: 'Failed subscribing to free plan',
          });
          let fetchPriceListResponse = {
            object: 'list',
            data: [
              {
                id: 'price_1QMRCxH9rBd1yAHRD4BXhAHW',
                object: 'price',
                active: true,
                billing_scheme: 'per_unit',
                created: 1731921923,
                currency: 'usd',
                custom_unit_amount: null,
                livemode: false,
                lookup_key: null,
                metadata: {},
                nickname: null,
                product: 'prod_REv3E69DbAPv4K',
                recurring: {
                  aggregate_usage: null,
                  interval: 'month',
                  interval_count: 1,
                  meter: null,
                  trial_period_days: null,
                  usage_type: 'licensed',
                },
                tax_behavior: 'unspecified',
                tiers_mode: null,
                transform_quantity: null,
                type: 'recurring',
                unit_amount: 0,
                unit_amount_decimal: '0',
              },
            ],
            has_more: false,
            url: '/v1/prices',
          };
          fetchPriceListStub.resolves(fetchPriceListResponse);

          let stripeSubscriptionDeletedEvent = {
            id: 'evt_sub_deleted_1',
            object: 'event',
            type: 'customer.subscription.deleted',
            data: {
              object: {
                id: 'sub_1234567890',
                canceled_at: 2,
                cancellation_details: {
                  reason: 'payment_failure',
                },
                customer: 'cus_123',
              },
            },
          };
          let stripeSubscriptionDeletedPayload = JSON.stringify(
            stripeSubscriptionDeletedEvent,
          );
          let stripeSubscriptionDeletedSignature =
            Stripe.webhooks.generateTestHeaderString({
              payload: stripeSubscriptionDeletedPayload,
              secret,
              timestamp,
            });
          await request
            .post('/_stripe-webhook')
            .send(stripeSubscriptionDeletedPayload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', stripeSubscriptionDeletedSignature);

          subscriptions = await fetchSubscriptionsByUserId(dbAdapter, user.id);
          assert.strictEqual(subscriptions.length, 1);
          assert.strictEqual(subscriptions[0].status, 'expired');
          assert.strictEqual(subscriptions[0].planId, creatorPlan.id);

          // ensures the subscription info is null,
          // so the host can use that to redirect user to checkout free plan page
          let response = await request
            .get(`/_user`)
            .set('Accept', 'application/vnd.api+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, '@test_realm:localhost', [
                'read',
                'write',
              ])}`,
            );
          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              data: {
                type: 'user',
                id: user.id,
                attributes: {
                  matrixUserId: user.matrixUserId,
                  stripeCustomerId: user.stripeCustomerId,
                  stripeCustomerEmail: user.stripeCustomerEmail,
                  creditsAvailableInPlanAllowance: null,
                  creditsIncludedInPlanAllowance: null,
                  extraCreditsAvailableInBalance: null,
                },
                relationships: {
                  subscription: null,
                },
              },
              included: null,
            },
            '/_user response is correct',
          );
        });

        test('sends billing notification on invoice payment succeeded event', async function (assert) {
          const secret = process.env.STRIPE_WEBHOOK_SECRET;
          await insertUser(dbAdapter, userId!, 'cus_123', 'user@test.com');
          await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
          if (!secret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not set');
          }
          let event = {
            id: 'evt_1234567890',
            object: 'event',
            type: 'invoice.payment_succeeded',
            data: {
              object: {
                id: 'in_1234567890',
                object: 'invoice',
                amount_paid: 0, // free plan
                billing_reason: 'subscription_create',
                period_end: 1638465600,
                period_start: 1635873600,
                subscription: 'sub_1234567890',
                customer: 'cus_123',
                lines: {
                  data: [
                    {
                      amount: 0,
                      price: { product: 'prod_free' },
                    },
                  ],
                },
              },
            },
          };

          let payload = JSON.stringify(event);
          let timestamp = Math.floor(Date.now() / 1000);
          let signature = Stripe.webhooks.generateTestHeaderString({
            payload,
            secret,
            timestamp,
          });

          await request
            .post('/_stripe-webhook')
            .send(payload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', signature);
          waitForBillingNotification(assert, assert.async());
        });

        test('sends billing notification on checkout session completed event', async function (assert) {
          const secret = process.env.STRIPE_WEBHOOK_SECRET;
          await insertUser(dbAdapter, userId!, 'cus_123', 'user@test.com');
          await insertPlan(dbAdapter, 'Free plan', 0, 100, 'prod_free');
          if (!secret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not set');
          }
          let event = {
            id: 'evt_1234567890',
            object: 'event',
            data: {
              object: {
                id: 'cs_test_1234567890',
                object: 'checkout.session',
                client_reference_id: encodeWebSafeBase64(userId),
                customer: undefined,
                metadata: {},
              },
            },
            type: 'checkout.session.completed',
          };

          let payload = JSON.stringify(event);
          let timestamp = Math.floor(Date.now() / 1000);
          let signature = Stripe.webhooks.generateTestHeaderString({
            payload,
            secret,
            timestamp,
          });

          await request
            .post('/_stripe-webhook')
            .send(payload)
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', signature);
          waitForBillingNotification(assert, assert.async());
        });
      });

      module('_queue-status', function (hooks) {
        setupPermissionedRealm(hooks, {
          '*': ['read', 'write'],
        });

        hooks.beforeEach(async function () {
          shimExternals(virtualNetwork);
        });

        test('returns 200 with JSON-API doc', async function (assert) {
          await insertJob(dbAdapter, {
            job_type: 'test-job',
          });
          await insertJob(dbAdapter, {
            job_type: 'test-job',
            status: 'resolved',
            finished_at: new Date().toISOString(),
          });
          let response = await request.get('/_queue-status');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          response = await request
            .get('/_queue-status')
            .set('Authorization', `Bearer no-good`);
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          const REALM_SERVER_SECRET_SEED = "mum's the word";
          response = await request
            .get('/_queue-status')
            .set(
              'Authorization',
              `Bearer ${monitoringAuthToken(REALM_SERVER_SECRET_SEED)}`,
            );
          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(json, {
            data: {
              type: 'queue-status',
              id: 'queue-status',
              attributes: {
                pending: 1,
              },
            },
          });
        });
      });
    },
  );
  module('Realm server authentication', function (hooks) {
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
        let testRealmDir = join(dir.name, 'realm_server_5', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_5'),
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

    test('authenticates user', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        // it's a little awkward that we are hijacking a realm user to pretend to
        // act like a normal user, but that's what's happening here
        username: 'test_realm',
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let userId = matrixClient.getUserId();

      let response = await request
        .post('/_server-session')
        .send(JSON.stringify({ user: userId }))
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      let json = response.body;

      let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

      if (!rooms.includes(json.room)) {
        await matrixClient.joinRoom(json.room);
      }

      await matrixClient.sendEvent(json.room, 'm.room.message', {
        body: `auth-response: ${json.challenge}`,
        msgtype: 'm.text',
      });

      response = await request
        .post('/_server-session')
        .send(JSON.stringify({ user: userId, challenge: json.challenge }))
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');
      assert.strictEqual(response.status, 201, 'HTTP 201 status');
      let token = response.headers['authorization'];
      let decoded = jwt.verify(token, realmSecretSeed) as RealmServerTokenClaim;
      assert.strictEqual(decoded.user, userId);
      assert.notStrictEqual(
        decoded.sessionRoom,
        undefined,
        'sessionRoom should be defined',
      );
    });
  });
});

function messageEventContentIsRealmServerEvent(
  content: MatrixEvent['content'],
): content is RealmServerEventContent {
  return (
    'msgtype' in content &&
    (content.msgtype as string) === APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE
  );
}
