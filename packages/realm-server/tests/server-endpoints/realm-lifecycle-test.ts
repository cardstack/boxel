import { module, test } from 'qunit';
import { basename, join } from 'path';
import { existsSync, readJSONSync } from 'fs-extra';
import type { Test, SuperTest } from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import type { Query } from '@cardstack/runtime-common/query';
import {
  baseCardRef,
  fetchRealmPermissions,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import type { SingleCardDocument } from '@cardstack/runtime-common';
import type { CardCollectionDocument } from '@cardstack/runtime-common/document-types';
import { cardSrc } from '@cardstack/runtime-common/etc/test-fixtures';
import {
  closeServer,
  createJWTForRealmURL,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupPermissionedRealmCached,
  testRealmInfo,
  testRealmURL as rootTestRealmURL,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest, testRealmURL } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      let context = setupServerEndpointsTest(hooks);

      test('POST /_create-realm', async function (assert) {
        // we randomize the realm and owner names so that we can isolate matrix
        // test state--there is no "delete user" matrix API
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'mango';
        let ownerUserId = '@mango:localhost';
        let response = await context.request
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

        assert.strictEqual(response.status, 202, 'HTTP 202 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'realm',
              id: `${testRealmURL.origin}/${owner}/${endpoint}/`,
              attributes: {
                ...testRealmInfo,
                endpoint,
                backgroundURL: 'http://example.com/background.jpg',
                iconURL: 'http://example.com/icon.jpg',
                publishable: true,
                status: 'pending',
              },
            },
          },
          'realm creation JSON is correct',
        );

        let realmPath = join(
          context.dir.name,
          'realm_server_1',
          owner,
          endpoint,
        );
        // No write path produces a .realm.json sidecar; createRealm
        // writes only the realm.json RealmConfig card.
        assert.notOk(
          existsSync(join(realmPath, '.realm.json')),
          'no .realm.json sidecar is written by createRealm',
        );
        let metadataRows = (await context.dbAdapter.execute(
          `SELECT publishable FROM realm_metadata WHERE url = '${json.data.id}'`,
        )) as { publishable: boolean | null }[];
        assert.deepEqual(
          metadataRows,
          [{ publishable: true }],
          'realm_metadata row seeded with publishable=true',
        );
        let realmCard = readJSONSync(join(realmPath, 'realm.json'));
        assert.deepEqual(
          realmCard,
          {
            data: {
              type: 'card',
              attributes: {
                cardInfo: { name: 'Test Realm' },
                iconURL: 'http://example.com/icon.jpg',
                backgroundURL: 'http://example.com/background.jpg',
              },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/realm-config',
                  name: 'RealmConfig',
                },
              },
            },
          },
          'realm.json card holds card-owned fields',
        );
        assert.ok(
          existsSync(join(realmPath, 'index.json')),
          'seed file index.json exists',
        );

        let jobs = (await context.dbAdapter.execute(
          `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${json.data.id}'`,
        )) as { priority: number }[];
        // Contract: realm creation enqueues exactly one
        // from-scratch-index job, at userInitiatedPriority. A second
        // job at default priority would block creation behind any
        // backlog of lower-priority indexing work.
        assert.deepEqual(
          jobs.map((j) => j.priority),
          [userInitiatedPriority],
          'realm creation enqueues exactly one from-scratch index job at userInitiatedPriority',
        );

        let permissions = await fetchRealmPermissions(
          context.dbAdapter,
          new URL(json.data.id),
        );
        assert.deepEqual(permissions, {
          [ownerUserId]: ['read', 'write', 'realm-owner'],
        });

        let id: string;
        // Phase 3 lazy mount: the realm isn't in realms[] yet — the
        // follow-up POST/GET below triggers findOrMountRealm.
        let realmURL = json.data.id as string;
        let realmServerURL = testRealmURL.origin + '/';
        {
          // owner can create an instance
          let response = await context.request
            .post(`/${owner}/${endpoint}/`)
            .send({
              data: {
                type: 'card',
                attributes: { cardInfo: { name: 'Test Card' } },
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
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let doc = response.body as SingleCardDocument;
          id = doc.data.id!;
        }

        {
          // owner can get an instance
          let response = await context.request
            .get(new URL(id).pathname)
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let doc = response.body as SingleCardDocument;
          assert.strictEqual(
            doc.data.attributes?.cardTitle,
            'Test Card',
            'instance data is correct',
          );
        }

        {
          // owner can search in the realm
          let response = await context.request
            .post(`${new URL(realmURL).pathname}_search`)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            )
            .send({
              filter: {
                on: baseCardRef,
                eq: {
                  cardTitle: 'Test Card',
                },
              },
            } as Query);

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
        let response = await context.request
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
        assert.strictEqual(response.status, 202, 'HTTP 202 status');
        let realmServerURL = testRealmURL.origin + '/';

        {
          let response = await context.request
            .post(`${new URL(realmURL).pathname}_search`)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: 'rando',
              })}`,
            )
            .send({
              filter: {
                on: baseCardRef,
                eq: {
                  cardTitle: 'Test Card',
                },
              },
            } as Query);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');

          response = await context.request
            .post(`/${owner}/${endpoint}/`)
            .send({
              data: {
                type: 'card',
                attributes: {
                  cardTitle: 'Test Card',
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
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: 'rando',
              })}`,
            );

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        }
      });

      test('can restart a realm that was created dynamically', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let owner = 'mango';
        let ownerUserId = '@mango:localhost';
        let realmURL: string;
        {
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          realmURL = response.body.data.id;
        }

        let realmServerURL = testRealmURL.origin + '/';
        {
          let response = await context.request
            .post(`/${owner}/${endpoint}/`)
            .send({
              data: {
                type: 'card',
                attributes: { cardInfo: { name: 'Test Card' } },
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
              `Bearer ${createJWTForRealmURL({
                realmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
        }

        let jobsBeforeRestart =
          await context.dbAdapter.execute('select * from jobs');

        context.testRealmServer.testingOnlyUnmountRealms();
        await closeServer(context.testRealmHttpServer);

        let restartedServer = await runTestRealmServer({
          virtualNetwork: context.virtualNetwork,
          testRealmDir: context.testRealmDir,
          realmsRootPath: join(context.dir.name, 'realm_server_1'),
          realmURL: testRealmURL,
          permissions: {
            '*': ['read', 'write'],
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
          dbAdapter: context.dbAdapter,
          publisher: context.publisher,
          runner: context.runner,
          matrixURL,
        });

        try {
          let jobsAfterRestart =
            await context.dbAdapter.execute('select * from jobs');
          assert.strictEqual(
            jobsBeforeRestart.length,
            jobsAfterRestart.length,
            'no new indexing jobs were created on boot for the created realm',
          );

          // Phase 3 PR 1: source/published realms are NOT eager-mounted on
          // restart. The reconciler tracks them in knownByUrl but defers
          // construction + start() to the first request (lazy mount via
          // findOrMountRealm). The production realm-server proves end-to-end
          // lazy mount in lazy-mount-test.ts. Here we only assert that the
          // realm survives restart in the registry — the test fixture's
          // makeTestReconciler doesn't construct Realms from registry rows
          // (no production-grade mountFromRow), so we can't drive the
          // request path here.
          let registryRows = (await context.dbAdapter.execute(
            `SELECT url FROM realm_registry WHERE url = $1`,
            { bind: [realmURL] },
          )) as { url: string }[];
          assert.strictEqual(
            registryRows.length,
            1,
            'realm registry row persists across restart',
          );
          assert.strictEqual(
            registryRows[0].url,
            realmURL,
            'persisted row matches the dynamically-created URL',
          );
        } finally {
          restartedServer.testRealmServer.testingOnlyUnmountRealms();
          await closeServer(restartedServer.testRealmHttpServer);
        }
      });

      test('POST /_create-realm without JWT', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let response = await context.request
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
        let response = await context.request
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
        assert.strictEqual(error, 'Token invalid', 'error message is correct');
      });

      test('POST /_create-realm with invalid JSON', async function (assert) {
        let response = await context.request
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
        let response = await context.request
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
        let response = await context.request
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
        let response = await context.request
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

      test('cannot create a new realm that collides with an existing realm', async function (assert) {
        let endpoint = `test-realm-${uuidv4()}`;
        let ownerUserId = '@mango:localhost';
        let response = await context.request
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
        assert.strictEqual(response.status, 202, 'HTTP 202 status');
        {
          let response = await context.request
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
          let response = await context.request
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
          let response = await context.request
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
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          providerRealmURL = response.body.data.id;
        }
        let realmServerURL = testRealmURL.origin + '/';
        {
          // create a card def
          let response = await context.request
            .post(`/${owner}/${providerEndpoint}/test-card.gts`)
            .set('Accept', 'application/vnd.card+source')
            .set(
              'Authorization',
              `Bearer ${createJWTForRealmURL({
                realmURL: providerRealmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            )
            .send(cardSrc);
          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        }

        let consumerEndpoint = `test-realm-consumer-${uuidv4()}`;
        let consumerRealmURL: string;
        {
          let response = await context.request
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
          assert.strictEqual(response.status, 202, 'HTTP 202 status');
          consumerRealmURL = response.body.data.id;
        }

        let id: string;
        {
          // create an instance using card def in different private realm
          let response = await context.request
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
              `Bearer ${createJWTForRealmURL({
                realmURL: consumerRealmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          let doc = response.body as SingleCardDocument;
          id = doc.data.id!;
        }

        {
          // get the instance
          let response = await context.request
            .get(new URL(id).pathname)
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWTForRealmURL({
                realmURL: consumerRealmURL,
                realmServerURL,
                user: ownerUserId,
                permissions: ['read', 'write', 'realm-owner'],
              })}`,
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
    },
  );

  module(
    'Realm creation when a realm is mounted at server origin',
    function (hooks) {
      let request!: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        realmURL: rootTestRealmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup(args) {
          request = args.request;
        },
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
    },
  );
});
