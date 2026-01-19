import { module, test } from 'qunit';
import { basename, join } from 'path';
import { existsSync, readJSONSync } from 'fs-extra';
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
import { fetchSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';
import {
  closeServer,
  createJWT,
  realmSecretSeed,
  testRealmInfo,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
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
        let response = await context.request2
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

        let realmPath = join(
          context.dir.name,
          'realm_server_2',
          owner,
          endpoint,
        );
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

        let job = (await context.dbAdapter.execute(
          `SELECT priority FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' = '${json.data.id}' ORDER BY created_at DESC LIMIT 1`,
        )) as { priority: number }[];
        assert.ok(job[0], 'found from-scratch index job for created realm');
        assert.strictEqual(
          job[0].priority,
          userInitiatedPriority,
          'user initiated realm indexing uses high priority queue',
        );

        let permissions = await fetchRealmPermissions(
          context.dbAdapter,
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
          context.dbAdapter,
          json.data.id,
          ownerUserId,
        );
        assert.ok(
          sessionRoom,
          'session room record was created for the owner after realm creation',
        );

        let id: string;
        let realm = context.testRealmServer2.testingOnlyRealms.find(
          (r) => r.url === json.data.id,
        )!;
        {
          // owner can create an instance
          let response = await context.request2
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
          let response = await context.request2
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
          let response = await context.request2
            .post(`${new URL(realm.url).pathname}_search`)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWT(realm, ownerUserId, [
                'read',
                'write',
                'realm-owner',
              ])}`,
            )
            .send({
              filter: {
                on: baseCardRef,
                eq: {
                  title: 'Test Card',
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
        let response = await context.request2
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
        let realm = context.testRealmServer2.testingOnlyRealms.find(
          (r) => r.url === realmURL,
        )!;

        {
          let response = await context.request2
            .post(`${new URL(realmURL).pathname}_search`)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${createJWT(realm, 'rando')}`)
            .send({
              filter: {
                on: baseCardRef,
                eq: {
                  title: 'Test Card',
                },
              },
            } as Query);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');

          response = await context.request2
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
          let response = await context.request2
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
        let realm = context.testRealmServer2.testingOnlyRealms.find(
          (r) => r.url === realmURL,
        )!;
        {
          let response = await context.request2
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

        let jobsBeforeRestart =
          await context.dbAdapter.execute('select * from jobs');

        // Stop and restart the server
        context.testRealmServer2.testingOnlyUnmountRealms();
        await closeServer(context.testRealmHttpServer2);
        await context.startRealmServer();
        await context.testRealmServer2.start();

        let jobsAfterRestart =
          await context.dbAdapter.execute('select * from jobs');
        assert.strictEqual(
          jobsBeforeRestart.length,
          jobsAfterRestart.length,
          'no new indexing jobs were created on boot for the created realm',
        );

        {
          let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
        let response = await context.request2
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
          let response = await context.request2
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
          let response = await context.request2
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
          let response = await context.request2
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
          let response = await context.request2
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
        let providerRealm = context.testRealmServer2.testingOnlyRealms.find(
          (r) => r.url === providerRealmURL,
        )!;
        {
          // create a card def
          let response = await context.request2
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
          let response = await context.request2
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

        let consumerRealm = context.testRealmServer2.testingOnlyRealms.find(
          (r) => r.url === consumerRealmURL,
        )!;
        let id: string;
        {
          // create an instance using card def in different private realm
          let response = await context.request2
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
          let response = await context.request2
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
    },
  );
});
