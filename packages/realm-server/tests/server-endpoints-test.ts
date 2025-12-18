import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import { dirSync, type DirResult } from 'tmp';
import { copySync, existsSync, ensureDirSync, readJSONSync } from 'fs-extra';
import type { Realm, VirtualNetwork } from '@cardstack/runtime-common';
import {
  Deferred,
  fetchRealmPermissions,
  baseCardRef,
  type SingleCardDocument,
  type QueuePublisher,
  type QueueRunner,
  DEFAULT_PERMISSIONS,
  systemInitiatedPriority,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { cardSrc } from '@cardstack/runtime-common/etc/test-fixtures';
import { stringify } from 'qs';
import { v4 as uuidv4 } from 'uuid';
import type { Query } from '@cardstack/runtime-common/query';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  runTestRealmServer,
  setupDB,
  realmServerTestMatrix,
  realmSecretSeed,
  createVirtualNetwork,
  matrixURL,
  closeServer,
  testRealmInfo,
  insertUser,
  insertPlan,
  fetchSubscriptionsByUserId,
  insertJob,
  testRealmURL,
  createJWT,
  grafanaSecret,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { RealmServer } from '../server';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import jwt from 'jsonwebtoken';
import type { CardCollectionDocument } from '@cardstack/runtime-common/document-types';
import type { PgAdapter } from '@cardstack/postgres';
import {
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import type { RealmServerTokenClaim } from '../utils/jwt';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import Stripe from 'stripe';
import sinon from 'sinon';
import { getStripe } from '@cardstack/billing/stripe-webhook-handlers/stripe';
import * as boxelUIChangeChecker from '../lib/boxel-ui-change-checker';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import { fetchSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';
import type {
  MatrixEvent,
  RealmServerEventContent,
} from 'https://cardstack.com/base/matrix-event';
import { monitoringAuthToken } from '../utils/monitoring';

const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

module(basename(__filename), function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dir: DirResult;
      let dbAdapter: PgAdapter;

      function onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dir: DirResult;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dir = args.dir;
        dbAdapter = args.dbAdapter;
      }
      setupBaseRealmServer(hooks, matrixURL);

      hooks.beforeEach(async function () {
        dir = dirSync();
        copySync(join(__dirname, 'cards'), dir.name);
      });

      module('various other realm tests', function (hooks) {
        let testRealmHttpServer2: Server;
        let testRealmServer2: RealmServer;
        let dbAdapter: PgAdapter;
        let publisher: QueuePublisher;
        let runner: QueueRunner;
        let request2: SuperTest<Test>;
        let testRealmDir: string;
        let virtualNetwork: VirtualNetwork;
        let ownerUserId = '@mango:localhost';

        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        async function startRealmServer(
          dbAdapter: PgAdapter,
          publisher: QueuePublisher,
          runner: QueueRunner,
        ) {
          virtualNetwork = createVirtualNetwork();
          ({
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
            permissions: {
              '*': ['read', 'write'],
              [ownerUserId]: DEFAULT_PERMISSIONS,
            },
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
            await closeServer(testRealmHttpServer2);
          },
        });

        test('startup indexing uses system initiated queue priority', async function (assert) {
          let [job] = (await dbAdapter.execute(
            `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${testRealm2URL.href}' ORDER BY created_at DESC LIMIT 1`,
          )) as { priority: number }[];

          assert.ok(job, 'found startup from-scratch index job for realm');
          assert.strictEqual(
            job.priority,
            systemInitiatedPriority,
            'realm startup uses system initiated priority',
          );
        });

        test('POST /_create-realm', async function (assert) {
          // we randomize the realm and owner names so that we can isolate matrix
          // test state--there is no "delete user" matrix API
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:localhost';
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
                  publishable: true,
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
              publishable: true,
            },
            '.realm.json is correct',
          );
          assert.ok(
            existsSync(join(realmPath, 'index.json')),
            'seed file index.json exists',
          );

          let job = (await dbAdapter.execute(
            `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${json.data.id}' ORDER BY created_at DESC LIMIT 1`,
          )) as { priority: number }[];
          assert.ok(job[0], 'found from-scratch index job for created realm');
          assert.strictEqual(
            job[0].priority,
            userInitiatedPriority,
            'user initiated realm indexing uses high priority queue',
          );

          let permissions = await fetchRealmPermissions(
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

          let sessionRoom = await fetchSessionRoom(
            dbAdapter,
            json.data.id,
            ownerUserId,
          );
          assert.ok(
            sessionRoom,
            'session room record was created for the owner after realm creation',
          );

          let id: string;
          let realm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === json.data.id,
          )!;
          {
            // owner can create an instance
            let response = await request2
              .post(`/${owner}/${endpoint}/`)
              .send({
                data: {
                  type: 'card',
                  attributes: { cardInfo: { title: 'Test Card' } },
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
            id = doc.data.id!;
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
            (assert.strictEqual(results.data.length, 1),
              'correct number of search results');
          }
        });

        test('dynamically created realms are not publicly readable or writable', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = '@mango:localhost';
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
          let ownerUserId = '@mango:localhost';
          let realmURL: string;
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  {
                    user: '@mango:localhost',
                    sessionRoom: 'session-room-test',
                  },
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
                  attributes: { cardInfo: { title: 'Test Card' } },
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

          let jobsBeforeRestart = await dbAdapter.execute('select * from jobs');

          // Stop and restart the server
          testRealmServer2.testingOnlyUnmountRealms();
          await closeServer(testRealmHttpServer2);
          await startRealmServer(dbAdapter, publisher, runner);
          await testRealmServer2.start();

          let jobsAfterRestart = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            jobsBeforeRestart.length,
            jobsAfterRestart.length,
            'no new indexing jobs were created on boot for the created realm',
          );

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
                { user: '@mango:localhost', sessionRoom: 'session-room-test' },
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
                { user: '@mango:localhost', sessionRoom: 'session-room-test' },
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
                { user: '@mango:localhost', sessionRoom: 'session-room-test' },
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
                { user: '@mango:localhost', sessionRoom: 'session-room-test' },
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
                { user: '@mango:localhost', sessionRoom: 'session-room-test' },
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
          let ownerUserId = '@mango:localhost';
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
          let ownerUserId = '@mango:localhost';
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

        test('can create instance in private realm using card def from a different private realm both owned by the same user', async function (assert) {
          let owner = 'mango';
          let ownerUserId = '@mango:localhost';
          let providerEndpoint = `test-realm-provider-${uuidv4()}`;
          let providerRealmURL: string;
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  {
                    user: '@mango:localhost',
                    sessionRoom: 'session-room-test',
                  },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      name: 'Test Provider Realm',
                      endpoint: providerEndpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            providerRealmURL = response.body.data.id;
          }
          let providerRealm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === providerRealmURL,
          )!;
          {
            // create a card def
            let response = await request2
              .post(`/${owner}/${providerEndpoint}/test-card.gts`)
              .set('Accept', 'application/vnd.card+source')
              .set(
                'Authorization',
                `Bearer ${createJWT(providerRealm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              )
              .send(cardSrc);
            assert.strictEqual(response.status, 204, 'HTTP 204 status');
          }

          let consumerEndpoint = `test-realm-consumer-${uuidv4()}`;
          let consumerRealmURL: string;
          {
            let response = await request2
              .post('/_create-realm')
              .set('Accept', 'application/vnd.api+json')
              .set('Content-Type', 'application/json')
              .set(
                'Authorization',
                `Bearer ${createRealmServerJWT(
                  {
                    user: '@mango:localhost',
                    sessionRoom: 'session-room-test',
                  },
                  realmSecretSeed,
                )}`,
              )
              .send(
                JSON.stringify({
                  data: {
                    type: 'realm',
                    attributes: {
                      name: 'Test Consumer Realm',
                      endpoint: consumerEndpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            consumerRealmURL = response.body.data.id;
          }

          let consumerRealm = testRealmServer2.testingOnlyRealms.find(
            (r) => r.url === consumerRealmURL,
          )!;
          let id: string;
          {
            // create an instance using card def in different private realm
            let response = await request2
              .post(`/${owner}/${consumerEndpoint}/`)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Mango',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${providerRealmURL}test-card`,
                      name: 'Person',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(consumerRealm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            let doc = response.body as SingleCardDocument;
            id = doc.data.id!;
          }

          {
            // get the instance
            let response = await request2
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json')
              .set(
                'Authorization',
                `Bearer ${createJWT(consumerRealm, ownerUserId, [
                  'read',
                  'write',
                  'realm-owner',
                ])}`,
              );

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let doc = response.body as SingleCardDocument;
            assert.strictEqual(
              doc.data.attributes?.firstName,
              'Mango',
              'instance data is correct',
            );
          }
        });

        test('can force job completion by job_id via grafana endpoint', async function (assert) {
          let [{ id }] = (await dbAdapter.execute(`INSERT INTO jobs
            (args, job_type, concurrency_group, timeout, priority)
            VALUES
            (
              '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
              'from-scratch-index',
              'indexing:${testRealm2URL.href}',
              180,
              0
            ) RETURNING id`)) as { id: string }[];
          let response = await request2
            .get(
              `/_grafana-complete-job?authHeader=${grafanaSecret}&job_id=${id}`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 204, 'HTTP 204 response');
          let [job] = await dbAdapter.execute(
            `SELECT * FROM jobs WHERE id = ${id}`,
          );
          assert.strictEqual(job.status, 'rejected', 'job status is correct');
          assert.deepEqual(
            job.result,
            {
              status: 418,
              message: 'User initiated job cancellation',
            },
            'job result is correct',
          );
          assert.ok(job.finished_at, 'job was marked with finish time');
        });

        test('can force job completion by reservation_id via grafana endpoint', async function (assert) {
          let [{ id: jobId }] = (await dbAdapter.execute(`INSERT INTO jobs
            (args, job_type, concurrency_group, timeout, priority)
            VALUES
            (
              '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
              'from-scratch-index',
              'indexing:${testRealm2URL.href}',
              180,
              0
            ) RETURNING id`)) as { id: string }[];
          let [{ id: reservationId }] =
            (await dbAdapter.execute(`INSERT INTO job_reservations
            (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '3 minutes') RETURNING id `)) as {
              id: string;
            }[];
          let response = await request2
            .get(
              `/_grafana-complete-job?authHeader=${grafanaSecret}&reservation_id=${reservationId}`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 204, 'HTTP 204 response');
          let [reservation] = await dbAdapter.execute(
            `SELECT * FROM job_reservations WHERE id = ${reservationId}`,
          );
          assert.ok(reservation.completed_at, 'completed_at time set');
          let [job] = await dbAdapter.execute(
            `SELECT * FROM jobs WHERE id = ${jobId}`,
          );
          assert.strictEqual(job.status, 'rejected', 'job status is correct');
          assert.deepEqual(
            job.result,
            {
              status: 418,
              message: 'User initiated job cancellation',
            },
            'job result is correct',
          );
          assert.ok(job.finished_at, 'job was marked with finish time');
        });

        test('can force job completion by job_id where reservation id exists via grafana endpoint', async function (assert) {
          let [{ id: jobId }] = (await dbAdapter.execute(`INSERT INTO jobs
            (args, job_type, concurrency_group, timeout, priority)
            VALUES
            (
              '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
              'from-scratch-index',
              'indexing:${testRealm2URL.href}',
              180,
              0
            ) RETURNING id`)) as { id: string }[];
          let [{ id: reservationId }] =
            (await dbAdapter.execute(`INSERT INTO job_reservations
            (job_id, locked_until ) VALUES (${jobId}, NOW() + INTERVAL '3 minutes') RETURNING id `)) as {
              id: string;
            }[];
          let response = await request2
            .get(
              `/_grafana-complete-job?authHeader=${grafanaSecret}&job_id=${jobId}`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 204, 'HTTP 204 response');
          let [reservation] = await dbAdapter.execute(
            `SELECT * FROM job_reservations WHERE id = ${reservationId}`,
          );
          assert.ok(reservation.completed_at, 'completed_at time set');
          let [job] = await dbAdapter.execute(
            `SELECT * FROM jobs WHERE id = ${jobId}`,
          );
          assert.strictEqual(job.status, 'rejected', 'job status is correct');
          assert.deepEqual(
            job.result,
            {
              status: 418,
              message: 'User initiated job cancellation',
            },
            'job result is correct',
          );
          assert.ok(job.finished_at, 'job was marked with finish time');
        });

        test('returns 401 when calling grafana job completion endpoint without a grafana secret', async function (assert) {
          let [{ id }] = (await dbAdapter.execute(`INSERT INTO jobs
            (args, job_type, concurrency_group, timeout, priority)
            VALUES
            (
              '{"realmURL": "${testRealm2URL.href}", "realmUsername":"node-test_realm"}',
              'from-scratch-index',
              'indexing:${testRealm2URL.href}',
              180,
              0
            ) RETURNING id`)) as { id: string }[];
          let response = await request2
            .get(`/_grafana-complete-job?job_id=${id}`)
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          let [job] = await dbAdapter.execute(
            `SELECT * FROM jobs WHERE id = ${id}`,
          );
          assert.strictEqual(
            job.status,
            'unfulfilled',
            'job status is correct',
          );
          assert.strictEqual(
            job.finished_at,
            null,
            'job was not marked with finish time',
          );
        });

        test('can add user credit via grafana endpoint', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
          let sum = await sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
            userId: user.id,
          });
          assert.strictEqual(sum, 0, `user has 0 extra credit`);

          let response = await request2
            .get(
              `/_grafana-add-credit?authHeader=${grafanaSecret}&user=${user.matrixUserId}&credit=1000`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.deepEqual(
            response.body,
            {
              message: `Added 1000 credits to user '${user.matrixUserId}'`,
            },
            `response body is correct`,
          );
          sum = await sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
            userId: user.id,
          });
          assert.strictEqual(sum, 1000, `user has 1000 extra credit`);
        });

        test('returns 400 when calling grafana add credit endpoint without a user', async function (assert) {
          let response = await request2
            .get(`/_grafana-add-credit?authHeader=${grafanaSecret}&credit=1000`)
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
        });

        test('returns 400 when calling grafana add credit endpoint with credit amount that is not a number', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
          let response = await request2
            .get(
              `/_grafana-add-credit?authHeader=${grafanaSecret}&user=${user.matrixUserId}&credit=a+million+dollars`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          let sum = await sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
            userId: user.id,
          });
          assert.strictEqual(sum, 0, `user has 0 extra credit`);
        });

        test("returns 400 when calling grafana add credit endpoint when user doesn't exist", async function (assert) {
          let response = await request2
            .get(
              `/_grafana-add-credit?authHeader=${grafanaSecret}&user=nobody&credit=1000`,
            )
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 400, 'HTTP 400 status');
        });

        test('returns 401 when calling grafana add credit endpoint without a grafana secret', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            'user@test',
            'cus_123',
            'user@test.com',
          );
          let response = await request2
            .get(`/_grafana-add-credit?user=${user.matrixUserId}&credit=1000`)
            .set('Content-Type', 'application/json');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          let sum = await sumUpCreditsLedger(dbAdapter, {
            creditType: ['extra_credit', 'extra_credit_used'],
            userId: user.id,
          });
          assert.strictEqual(sum, 0, `user has 0 extra credit`);
        });

        test('can reindex a realm via grafana endpoint', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = `@${owner}:localhost`;
          let realmURL: string;
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
                      name: 'Test Realm',
                      endpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            realmURL = response.body.data.id;
          }
          let initialJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            initialJobs.length,
            2,
            'number of jobs initially is correct',
          );
          {
            let realmPath = realmURL.substring(
              new URL(testRealm2URL.origin).href.length,
            );
            let response = await request2
              .get(
                `/_grafana-reindex?authHeader=${grafanaSecret}&realm=${realmPath}`,
              )
              .set('Content-Type', 'application/json');
            assert.deepEqual(response.body, {
              moduleErrors: 0,
              instanceErrors: 0,
              modulesIndexed: 0,
              instancesIndexed: 2,
              totalIndexEntries: 2,
            });
          }
          let finalJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(finalJobs.length, 3, 'an index job was created');
          let job = finalJobs.pop()!;
          assert.strictEqual(
            job.job_type,
            'from-scratch-index',
            'job type is correct',
          );
          assert.strictEqual(
            job.concurrency_group,
            `indexing:${realmURL}`,
            'concurrency group is correct',
          );
          assert.strictEqual(
            job.status,
            'resolved',
            'job completed successfully',
          );
          assert.ok(job.finished_at, 'job was marked with a finish time');
          assert.deepEqual(
            job.args,
            {
              realmURL,
              realmUsername: owner,
            },
            'realm args are correct',
          );
        });

        test('returns 401 when calling grafana reindex endpoint without a grafana secret', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = `@${owner}:localhost`;
          let realmURL: string;
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
                      name: 'Test Realm',
                      endpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            realmURL = response.body.data.id;
          }
          let initialJobs = await dbAdapter.execute('select * from jobs');
          {
            let response = await request2
              .get(`/_grafana-reindex?realm=${encodeURIComponent(realmURL)}`)
              .set('Content-Type', 'application/json');
            assert.strictEqual(response.status, 401, 'HTTP 401 status');
          }
          let finalJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            initialJobs.length,
            'an index job was not created',
          );
        });

        test('post-deployment endpoint requires authorization header', async function (assert: Assert) {
          let response = await request2
            .post('/_post-deployment')
            .set('Content-Type', 'application/json');

          assert.strictEqual(
            response.status,
            401,
            'HTTP 401 status for missing auth header',
          );
        });

        test('post-deployment endpoint rejects incorrect authorization', async function (assert: Assert) {
          let response = await request2
            .post('/_post-deployment')
            .set('Content-Type', 'application/json')
            .set('Authorization', 'wrong-secret');

          assert.strictEqual(
            response.status,
            401,
            'HTTP 401 status for wrong auth header',
          );
        });

        test('post-deployment endpoint triggers full reindex when checksums differ', async function (assert: Assert) {
          let compareCurrentBoxelUIChecksumStub = sinon
            .stub(boxelUIChangeChecker, 'compareCurrentBoxelUIChecksum')
            .resolves({
              previousChecksum: 'old-checksum-123',
              currentChecksum: 'new-checksum-456',
            });
          let writeCurrentBoxelUIChecksumStub = sinon.stub(
            boxelUIChangeChecker,
            'writeCurrentBoxelUIChecksum',
          );

          try {
            let initialJobs = await dbAdapter.execute('select * from jobs');
            let initialJobCount = initialJobs.length;

            let response = await request2
              .post('/_post-deployment')
              .set('Content-Type', 'application/json')
              .set('Authorization', "mum's the word");

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            assert.deepEqual(
              response.body,
              {
                previousChecksum: 'old-checksum-123',
                currentChecksum: 'new-checksum-456',
              },
              'response body contains checksum comparison result',
            );

            let finalJobs = await dbAdapter.execute('select * from jobs');
            assert.strictEqual(
              finalJobs.length,
              initialJobCount + 1,
              'a new full-reindex job was created when checksums differ',
            );

            let reindexJob = finalJobs.find(
              (job) => job.job_type === 'full-reindex',
            );
            assert.ok(reindexJob, 'full-reindex job exists');
            if (reindexJob) {
              assert.strictEqual(
                reindexJob.concurrency_group,
                'full-reindex-group',
                'job has correct concurrency group',
              );
              assert.strictEqual(
                reindexJob.timeout,
                360,
                'job has correct timeout (6 minutes)',
              );
            }

            assert.ok(
              writeCurrentBoxelUIChecksumStub.calledOnce,
              'writeCurrentBoxelUIChecksum was called',
            );
            assert.ok(
              writeCurrentBoxelUIChecksumStub.calledWith('new-checksum-456'),
              'writeCurrentBoxelUIChecksum called with new checksum',
            );
          } finally {
            compareCurrentBoxelUIChecksumStub.restore();
            writeCurrentBoxelUIChecksumStub.restore();
          }
        });

        test('post-deployment endpoint ignores reindex when checksums match', async function (assert: Assert) {
          let compareCurrentBoxelUIChecksumStub = sinon
            .stub(boxelUIChangeChecker, 'compareCurrentBoxelUIChecksum')
            .resolves({
              previousChecksum: 'same-checksum-789',
              currentChecksum: 'same-checksum-789',
            });
          let writeCurrentBoxelUIChecksumStub = sinon.stub(
            boxelUIChangeChecker,
            'writeCurrentBoxelUIChecksum',
          );

          try {
            let initialJobs = await dbAdapter.execute('select * from jobs');
            let initialJobCount = initialJobs.length;

            let response = await request2
              .post('/_post-deployment')
              .set('Content-Type', 'application/json')
              .set('Authorization', "mum's the word");

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            assert.deepEqual(
              response.body,
              {
                previousChecksum: 'same-checksum-789',
                currentChecksum: 'same-checksum-789',
              },
              'response body contains checksum comparison result',
            );

            let finalJobs = await dbAdapter.execute('select * from jobs');
            assert.strictEqual(
              finalJobs.length,
              initialJobCount,
              'no new job was created when checksums are the same',
            );

            assert.ok(
              writeCurrentBoxelUIChecksumStub.notCalled,
              'writeCurrentBoxelUIChecksum was not called when checksums are same',
            );
          } finally {
            compareCurrentBoxelUIChecksumStub.restore();
            writeCurrentBoxelUIChecksumStub.restore();
          }
        });

        test('can reindex all realms via grafana endpoint', async function (assert) {
          let endpoint = `test-realm-${uuidv4()}`;
          let owner = 'mango';
          let ownerUserId = `@${owner}:localhost`;
          let realmURL: string;
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
                      name: 'Test Realm',
                      endpoint,
                    },
                  },
                }),
              );
            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            realmURL = response.body.data.id;
          }
          let initialJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            initialJobs.length,
            2,
            'number of jobs initially is correct',
          );
          {
            let response = await request2
              .get(`/_grafana-full-reindex?authHeader=${grafanaSecret}`)
              .set('Content-Type', 'application/json');
            assert.deepEqual(
              response.body.realms,
              [testRealm2URL.href, realmURL],
              'indexed realms are correct',
            );
          }
          let finalJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            3,
            'realm full reindex job was created',
          );
          let jobs = finalJobs.slice(2);
          assert.strictEqual(
            jobs[0].job_type,
            'full-reindex',
            'job type is correct',
          );
          assert.strictEqual(
            jobs[0].concurrency_group,
            `full-reindex-group`,
            'concurrency group is correct',
          );
        });

        test('returns 401 when calling grafana full reindex endpoint without a grafana secret', async function (assert) {
          let initialJobs = await dbAdapter.execute('select * from jobs');
          {
            let response = await request2
              .get(`/_grafana-full-reindex`)
              .set('Content-Type', 'application/json');
            assert.strictEqual(response.status, 401, 'HTTP 401 status');
          }
          let finalJobs = await dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            finalJobs.length,
            initialJobs.length,
            'an index job was not created',
          );
        });

        test('returns 404 for request that has malformed URI', async function (assert) {
          let response = await request2.get('/%c0').set('Accept', '*/*');
          assert.strictEqual(response.status, 404, 'HTTP 404 status');
        });

        test('can create a user', async function (assert) {
          let ownerUserId = '@mango:localhost';
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
            ],
          });
        });

        test(`returns 200 with empty data if failed to fetch catalog realm's info`, async function (assert) {
          let failedRealmInfoMock = async (req: Request) => {
            if (req.url.includes('_info')) {
              return new Response('Failed to fetch realm info', {
                status: 500,
                statusText: 'Internal Server Error',
              });
            }
            return null;
          };
          virtualNetwork.mount(failedRealmInfoMock, { prepend: true });
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
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        hooks.beforeEach(async function () {
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
                  extraCreditsAvailableInBalance: 0,
                },
                relationships: {
                  subscription: null,
                },
              },
              included: [
                {
                  type: 'plan',
                  id: 'free',
                  attributes: {
                    name: 'Free',
                    monthlyPrice: 0,
                    creditsIncluded: 0,
                  },
                },
              ],
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
          let user = await insertUser(
            dbAdapter,
            userId!,
            'cus_123',
            'user@test.com',
          );
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
                customer: 'cus_123',
                metadata: {
                  user_id: user.id,
                },
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

      module('stripe session handler', function (hooks) {
        let createCustomerStub: sinon.SinonStub;
        let createCheckoutSessionStub: sinon.SinonStub;
        let listSubscriptionsStub: sinon.SinonStub;
        let retrieveProductStub: sinon.SinonStub;
        let createBillingPortalSessionStub: sinon.SinonStub;
        let matrixClient: MatrixClient;
        let userId = '@test_realm:localhost';
        let jwtToken: string;

        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        hooks.beforeEach(async function () {
          let stripe = getStripe();
          createCustomerStub = sinon.stub(stripe.customers, 'create');
          createCheckoutSessionStub = sinon.stub(
            stripe.checkout.sessions,
            'create',
          );
          listSubscriptionsStub = sinon.stub(stripe.subscriptions, 'list');
          retrieveProductStub = sinon.stub(stripe.products, 'retrieve');
          createBillingPortalSessionStub = sinon.stub(
            stripe.billingPortal.sessions,
            'create',
          );

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

          jwtToken = response.headers['authorization'];
        });

        hooks.afterEach(async function () {
          createCustomerStub.restore();
          createCheckoutSessionStub.restore();
          listSubscriptionsStub.restore();
          retrieveProductStub.restore();
          createBillingPortalSessionStub.restore();
        });

        test('creates checkout session for AI tokens when user has no Stripe customer', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            userId,
            '', // no stripe customer id
            '',
          );

          const mockCustomer = {
            id: 'cus_test123',
            email: 'test@example.com',
          };

          const mockSession = {
            id: 'cs_test123',
            url: 'https://checkout.stripe.com/test123',
          };

          createCustomerStub.resolves(mockCustomer);
          createCheckoutSessionStub.resolves(mockSession);

          let response = await request
            .post(
              '/_stripe-session?returnUrl=http%3A//example.com/return&email=test@example.com&aiTokenAmount=2500',
            )
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', jwtToken);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              url: 'https://checkout.stripe.com/test123',
              sessionId: 'cs_test123',
              type: 'checkout',
            },
            'response body is correct',
          );

          // Verify Stripe customer was created
          assert.ok(
            createCustomerStub.calledOnce,
            'customer.create was called',
          );
          assert.deepEqual(
            createCustomerStub.firstCall.args[0],
            { email: 'test@example.com' },
            'customer created with correct email',
          );

          // Verify checkout session was created
          assert.ok(
            createCheckoutSessionStub.calledOnce,
            'checkout.sessions.create was called',
          );
          let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
          assert.strictEqual(
            sessionArgs.customer,
            'cus_test123',
            'session created with correct customer',
          );
          assert.strictEqual(
            sessionArgs.mode,
            'payment',
            'session mode is payment',
          );
          assert.strictEqual(
            sessionArgs.success_url,
            'http://example.com/return',
            'success URL is correct',
          );
          assert.strictEqual(
            sessionArgs.cancel_url,
            'http://example.com/return',
            'cancel URL is correct',
          );
          assert.strictEqual(
            sessionArgs.line_items[0].price_data.unit_amount,
            500,
            'price is correct (5 USD)',
          );
          assert.strictEqual(
            sessionArgs.line_items[0].price_data.product_data.name,
            '2,500 AI credits',
            'product name is correct',
          );
          assert.strictEqual(
            sessionArgs.metadata.credit_reload_amount,
            '2500',
            'metadata has correct credit amount',
          );
          assert.strictEqual(
            sessionArgs.metadata.user_id,
            user.id,
            'metadata has correct user id',
          );

          // Verify user was updated with Stripe customer info
          let updatedUser = await getUserByMatrixUserId(dbAdapter, userId);
          assert.strictEqual(
            updatedUser?.stripeCustomerId,
            'cus_test123',
            'user updated with customer ID',
          );
          assert.strictEqual(
            updatedUser?.stripeCustomerEmail,
            'test@example.com',
            'user updated with customer email',
          );
        });

        test('creates checkout session for AI tokens when user already has Stripe customer', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            userId,
            'cus_existing123', // existing stripe customer id
            'existing@example.com',
          );

          const mockSession = {
            id: 'cs_test456',
            url: 'https://checkout.stripe.com/test456',
          };

          createCheckoutSessionStub.resolves(mockSession);

          let response = await request
            .post(
              '/_stripe-session?returnUrl=http%3A//example.com/return&email=test@example.com&aiTokenAmount=20000',
            )
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', jwtToken);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              url: 'https://checkout.stripe.com/test456',
              sessionId: 'cs_test456',
              type: 'checkout',
            },
            'response body is correct',
          );

          // Verify Stripe customer was NOT created (since user already has one)
          assert.ok(
            createCustomerStub.notCalled,
            'customer.create was not called',
          );

          // Verify checkout session was created with existing customer
          assert.ok(
            createCheckoutSessionStub.calledOnce,
            'checkout.sessions.create was called',
          );
          let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
          assert.strictEqual(
            sessionArgs.customer,
            'cus_existing123',
            'session created with existing customer ID',
          );
          assert.strictEqual(
            sessionArgs.mode,
            'payment',
            'session mode is payment',
          );
          assert.strictEqual(
            sessionArgs.success_url,
            'http://example.com/return',
            'success URL is correct',
          );
          assert.strictEqual(
            sessionArgs.cancel_url,
            'http://example.com/return',
            'cancel URL is correct',
          );
          assert.strictEqual(
            sessionArgs.line_items[0].price_data.unit_amount,
            3000,
            'price is correct (30 USD for 20000 tokens)',
          );
          assert.strictEqual(
            sessionArgs.line_items[0].price_data.product_data.name,
            '20,000 AI credits',
            'product name is correct',
          );
          assert.strictEqual(
            sessionArgs.metadata.credit_reload_amount,
            '20000',
            'metadata has correct credit amount',
          );
          assert.strictEqual(
            sessionArgs.metadata.user_id,
            user.id,
            'metadata has correct user id',
          );

          // Verify user info remains unchanged
          let updatedUser = await getUserByMatrixUserId(dbAdapter, userId);
          assert.strictEqual(
            updatedUser?.stripeCustomerId,
            'cus_existing123',
            'user customer ID unchanged',
          );
          assert.strictEqual(
            updatedUser?.stripeCustomerEmail,
            'existing@example.com',
            'user customer email unchanged',
          );
        });

        test('creates checkout session for subscription when user has no active subscription', async function (assert) {
          let user = await insertUser(
            dbAdapter,
            userId,
            'cus_existing123', // existing stripe customer id
            'existing@example.com',
          );

          // Create a test plan
          let plan = await insertPlan(
            dbAdapter,
            'TestPlan',
            12,
            5000,
            'prod_test_plan',
          );

          const mockSession = {
            id: 'cs_subscription_test',
            url: 'https://checkout.stripe.com/subscription',
          };

          const mockProduct = {
            id: 'prod_test_plan',
            default_price: 'price_123',
          };

          // User has no active subscriptions
          listSubscriptionsStub.resolves({ data: [] });
          retrieveProductStub.resolves(mockProduct);
          createCheckoutSessionStub.resolves(mockSession);

          let response = await request
            .post(
              '/_stripe-session?returnUrl=http%3A//example.com/return&plan=TestPlan',
            )
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', jwtToken);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              url: 'https://checkout.stripe.com/subscription',
              sessionId: 'cs_subscription_test',
              type: 'checkout',
            },
            'response body is correct',
          );

          // Verify subscriptions.list was called to check for active subscriptions
          assert.ok(
            listSubscriptionsStub.calledOnce,
            'subscriptions.list was called',
          );
          assert.deepEqual(
            listSubscriptionsStub.firstCall.args[0],
            {
              customer: 'cus_existing123',
              status: 'active',
              limit: 1,
            },
            'subscriptions listed with correct parameters',
          );

          // Verify product was retrieved
          assert.ok(
            retrieveProductStub.calledOnce,
            'products.retrieve was called',
          );
          assert.strictEqual(
            retrieveProductStub.firstCall.args[0],
            'prod_test_plan',
            'correct product ID was used',
          );

          // Verify checkout session was created for subscription
          assert.ok(
            createCheckoutSessionStub.calledOnce,
            'checkout.sessions.create was called',
          );
          let sessionArgs = createCheckoutSessionStub.firstCall.args[0];
          assert.strictEqual(
            sessionArgs.customer,
            'cus_existing123',
            'session created with correct customer',
          );
          assert.strictEqual(
            sessionArgs.mode,
            'subscription',
            'session mode is subscription',
          );
          assert.strictEqual(
            sessionArgs.success_url,
            'http://example.com/return',
            'success URL is correct',
          );
          assert.strictEqual(
            sessionArgs.cancel_url,
            'http://example.com/return',
            'cancel URL is correct',
          );
          assert.deepEqual(
            sessionArgs.line_items,
            [
              {
                price: 'price_123',
                quantity: 1,
              },
            ],
            'line items are correct',
          );
          assert.deepEqual(
            sessionArgs.payment_method_data,
            {
              allow_redisplay: 'always',
            },
            'payment method data allows redisplay',
          );
          assert.deepEqual(
            sessionArgs.metadata,
            {
              plan_name: 'TestPlan',
              plan_id: plan.id,
              user_id: user.id,
            },
            'metadata is correct',
          );

          // Verify Stripe customer was NOT created (since user already has one)
          assert.ok(
            createCustomerStub.notCalled,
            'customer.create was not called',
          );
        });

        test('creates billing portal session when user already has active subscription', async function (assert) {
          // Create a test plan
          await insertPlan(
            dbAdapter,
            'ExistingPlan',
            15,
            7500,
            'prod_existing_plan',
          );

          await insertUser(
            dbAdapter,
            userId,
            'cus_existing456',
            'existing@example.com',
          );

          const mockPortalSession = {
            url: 'https://billing.stripe.com/portal123',
          };

          // User has an active subscription
          listSubscriptionsStub.resolves({
            data: [
              {
                id: 'sub_active123',
                status: 'active',
                customer: 'cus_existing456',
              },
            ],
          });
          createBillingPortalSessionStub.resolves(mockPortalSession);

          let response = await request
            .post(
              '/_stripe-session?returnUrl=http%3A//example.com/return&plan=ExistingPlan',
            )
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('Authorization', jwtToken);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(
            json,
            {
              url: 'https://billing.stripe.com/portal123',
              type: 'portal',
              message:
                'You already have an active subscription. Redirecting to manage your subscription...',
            },
            'response body is correct',
          );

          // Verify subscriptions.list was called to check for active subscriptions
          assert.ok(
            listSubscriptionsStub.calledOnce,
            'subscriptions.list was called',
          );
          assert.deepEqual(
            listSubscriptionsStub.firstCall.args[0],
            {
              customer: 'cus_existing456',
              status: 'active',
              limit: 1,
            },
            'subscriptions listed with correct parameters',
          );

          // Verify billing portal session was created
          assert.ok(
            createBillingPortalSessionStub.calledOnce,
            'billingPortal.sessions.create was called',
          );
          assert.deepEqual(
            createBillingPortalSessionStub.firstCall.args[0],
            {
              customer: 'cus_existing456',
              return_url: 'http://example.com/return',
            },
            'billing portal session created with correct parameters',
          );

          // Verify product retrieval and checkout session creation were NOT called
          assert.ok(
            retrieveProductStub.notCalled,
            'products.retrieve was not called',
          );
          assert.ok(
            createCheckoutSessionStub.notCalled,
            'checkout.sessions.create was not called',
          );

          // Verify Stripe customer was NOT created
          assert.ok(
            createCustomerStub.notCalled,
            'customer.create was not called',
          );
        });
      });

      module('_queue-status', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
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

    setupBaseRealmServer(hooks, matrixURL);

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
