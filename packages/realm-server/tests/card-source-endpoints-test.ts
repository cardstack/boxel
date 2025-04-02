import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, existsSync, ensureDirSync, readFileSync } from 'fs-extra';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';
import {
  baseRealm,
  RealmPaths,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  waitUntil,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import stripScopedCSSGlimmerAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-glimmer-attributes';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import isEqual from 'lodash/isEqual';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
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
  module('Realm-specific Endpoints | card source requests', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;

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

          let request = supertest(testRealmHttpServer);
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

    module('card source GET request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read'],
          },
          setTestRequest,
        );

        test('serves the request', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
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
          let result = response.text.trim();
          assert.strictEqual(result, cardSrc, 'the card source is correct');
          assert.ok(
            response.headers['last-modified'],
            'last-modified header exists',
          );
        });

        test('serves a card-source GET request that results in redirect', async function (assert) {
          let response = await request
            .get('/person')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(response.headers['location'], '/person.gts');
        });

        test('serves a card instance GET request with card-source accept header that results in redirect', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(response.headers['location'], '/person-1.json');
        });

        test('serves a card instance GET request with a .json extension and json accept header that results in redirect', async function (assert) {
          let response = await request
            .get('/person.json')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 302, 'HTTP 302 status');
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
          assert.strictEqual(response.headers['location'], '/person');
        });

        test('serves a module GET request', async function (assert) {
          let response = await request.get('/person');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmURL.href,
            'realm URL header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let body = response.text.trim();
          let moduleAbsolutePath = resolve(join(__dirname, '..', 'person.gts'));

          // Remove platform-dependent id, from https://github.com/emberjs/babel-plugin-ember-template-compilation/blob/d67cca121cfb3bbf5327682b17ed3f2d5a5af528/__tests__/tests.ts#LL1430C1-L1431C1
          body = stripScopedCSSGlimmerAttributes(
            body.replace(/"id":\s"[^"]+"/, '"id": "<id>"'),
          );

          assert.codeEqual(
            body,
            compiledCard('"<id>"', moduleAbsolutePath),
            'module JS is correct',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            john: ['read'],
          },
          setTestRequest,
        );

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .get('/person.gts')
            .set('Accept', 'application/vnd.card+source')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });
    });

    module('card-source DELETE request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read', 'write'],
          },
          setTestRequest,
        );

        let { getMessagesSince } = setupMatrixRoom(hooks, getTestRequest);

        test('serves the request', async function (assert) {
          let entry = 'unused-card.gts';

          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
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
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card module does not exist');
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source');

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

          let incrementalEvent = findRealmEvent(
            messages,
            'index',
            'incremental',
          );

          assert.deepEqual(incrementalIndexInitiationEvent!.content, {
            eventName: 'index',
            indexType: 'incremental-index-initiation',
            updatedFile: `${testRealmURL}unused-card.gts`,
          });

          assert.deepEqual(incrementalEvent!.content, {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}unused-card.gts`],
          });
        });

        test('serves a card-source DELETE request for a card instance', async function (assert) {
          let entry = 'person-1';
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+source');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
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
          let cardFile = join(dir.name, entry);
          assert.false(existsSync(cardFile), 'card instance does not exist');
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            john: ['read', 'write'],
          },
          setTestRequest,
        );

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .delete('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });
      });
    });

    module('card-source POST request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read', 'write'],
          },
          setTestRequest,
        );

        let { getMessagesSince } = setupMatrixRoom(hooks, getTestRequest);

        test('serves a card-source POST request', async function (assert) {
          let entry = 'unused-card.gts';
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`);

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
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

          let srcFile = join(dir.name, 'realm_server_1', 'test', entry);
          assert.ok(existsSync(srcFile), 'card src exists');
          let src = readFileSync(srcFile, { encoding: 'utf8' });
          assert.codeEqual(
            src,
            `//TEST UPDATE
          ${cardSrc}`,
          );
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`);

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

          let incrementalEvent = findRealmEvent(
            messages,
            'index',
            'incremental',
          );

          assert.deepEqual(incrementalIndexInitiationEvent!.content, {
            eventName: 'index',
            indexType: 'incremental-index-initiation',
            updatedFile: `${testRealmURL}unused-card.gts`,
          });

          assert.deepEqual(incrementalEvent!.content, {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}unused-card.gts`],
            // FIXME ??
            clientRequestId: null,
          });
        });

        test('serves a card-source POST request for a .txt file', async function (assert) {
          let response = await request
            .post('/hello-world.txt')
            .set('Accept', 'application/vnd.card+source')
            .send(`Hello World`);

          assert.strictEqual(response.status, 204, 'HTTP 204 status');

          let txtFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'hello-world.txt',
          );
          assert.ok(existsSync(txtFile), 'file exists');
          let src = readFileSync(txtFile, { encoding: 'utf8' });
          assert.strictEqual(src, 'Hello World');
        });

        test('can serialize a card instance correctly after card definition is changed', async function (assert) {
          let realmEventTimestampStart = Date.now();

          // create a card def
          {
            let response = await request
              .post('/test-card.gts')
              .set('Accept', 'application/vnd.card+source').send(`
                import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
                import StringCard from 'https://cardstack.com/base/string';

                export class TestCard extends CardDef {
                  @field field1 = contains(StringCard);
                  @field field2 = contains(StringCard);
                }
              `);

            assert.strictEqual(response.status, 204, 'HTTP 204 status');
          }

          // make an instance of the card def
          let maybeId: string | undefined;
          {
            let response = await request
              .post('/')
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field1: 'a',
                    field2: 'b',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${testRealmURL}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 201, 'HTTP 201 status');
            maybeId = response.body.data.id;
          }
          if (!maybeId) {
            assert.ok(false, 'new card identifier was undefined');
            // eslint-disable-next-line qunit/no-early-return
            return;
          }
          let id = maybeId;

          // modify field
          {
            let response = await request
              .post('/test-card.gts')
              .set('Accept', 'application/vnd.card+source').send(`
                import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
                import StringCard from 'https://cardstack.com/base/string';

                export class TestCard extends CardDef {
                  @field field1 = contains(StringCard);
                  @field field2a = contains(StringCard); // rename field2 -> field2a
                }
              `);

            assert.strictEqual(response.status, 204, 'HTTP 204 status');
          }

          // verify serialization matches new card def
          {
            let response = await request
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: null,
              title: null,
              description: null,
              thumbnailURL: null,
            });
          }

          // set value on renamed field
          {
            let response = await request
              .patch(new URL(id).pathname)
              .send({
                data: {
                  type: 'card',
                  attributes: {
                    field2a: 'c',
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${testRealmURL}test-card`,
                      name: 'TestCard',
                    },
                  },
                },
              })
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
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

            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: 'c',
              title: null,
              description: null,
              thumbnailURL: null,
            });
          }

          // verify file serialization is correct
          {
            let localPath = new RealmPaths(testRealmURL).local(new URL(id));
            let jsonFile = `${join(
              dir.name,
              'realm_server_1',
              'test',
              localPath,
            )}.json`;
            let doc = JSON.parse(
              readFileSync(jsonFile, { encoding: 'utf8' }),
            ) as LooseSingleCardDocument;
            assert.deepEqual(
              doc,
              {
                data: {
                  type: 'card',
                  attributes: {
                    field1: 'a',
                    field2a: 'c',
                    title: null,
                    description: null,
                    thumbnailURL: null,
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/test-card',
                      name: 'TestCard',
                    },
                  },
                },
              },
              'instance serialized to filesystem correctly',
            );
          }

          // verify instance GET is correct
          {
            let response = await request
              .get(new URL(id).pathname)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.deepEqual(json.data.attributes, {
              field1: 'a',
              field2a: 'c',
              title: null,
              description: null,
              thumbnailURL: null,
            });
          }

          let messages = await getMessagesSince(realmEventTimestampStart);

          let expected = [
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${testRealmURL}test-card.gts`,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [`${testRealmURL}test-card.gts`],
                // ??
                // realmURL: testRealmURL.href,
                clientRequestId: null,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${testRealmURL}test-card.gts`,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [`${testRealmURL}test-card.gts`, id],
                // ??
                // realmURL: testRealmURL.href,
                clientRequestId: null,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental-index-initiation',
                updatedFile: `${id}.json`,
              },
            },
            {
              type: APP_BOXEL_REALM_EVENT_TYPE,
              content: {
                eventName: 'index',
                indexType: 'incremental',
                invalidations: [id],
                // ??
                // realmURL: testRealmURL.href,
                clientRequestId: null,
              },
            },
          ];

          for (let expectedEvent of expected) {
            // FIXME is there a better way?
            let actualEvent = matchRealmEvent(messages, expectedEvent);

            assert.deepEqual(
              actualEvent?.content,
              expectedEvent.content,
              'expected event was broadcast',
            );
          }
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            john: ['read', 'write'],
          },
          setTestRequest,
        );

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .post('/unused-card.gts')
            .set('Accept', 'application/vnd.card+source')
            .send(`//TEST UPDATE\n${cardSrc}`)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
        });
      });
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

function matchRealmEvent(events: MatrixEvent[], event: any) {
  return events.find(
    (m) => m.type === event.type && isEqual(event.content, m.content),
  );
}
