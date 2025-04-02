import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { validate as uuidValidate } from 'uuid';
import { copySync, existsSync, ensureDirSync, readJSONSync } from 'fs-extra';
import {
  isSingleCardDocument,
  baseRealm,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { Query } from '@cardstack/runtime-common/query';
import {
  findRealmEvent,
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  setupMatrixRoom,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
  testRealmInfo,
  cleanWhiteSpace,
  waitUntil,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
} from 'https://cardstack.com/base/matrix-event';

setGracefulCleanup();
const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
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
  module('Realm-specific Endpoints | card URLs', function (hooks) {
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

          setTestRequest(supertest(testRealmHttpServer));
        },
      });
    }

    hooks.beforeEach(function () {
      request = getTestRequest();
    });

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

    module('card GET request', function (_hooks) {
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
            .get('/person-1')
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
              id: `${testRealmHref}person-1`,
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
                // FIXME see elsewhere… global fix?
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmURL.href,
              },
              links: {
                self: `${testRealmHref}person-1`,
              },
            },
          });
        });

        test('serves a card error request without last known good state', async function (assert) {
          let response = await request
            .get('/missing-link')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 500, 'HTTP 500 status');
          let json = response.body;
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

          let errorBody = json.errors[0];
          assert.ok(errorBody.meta.stack.includes('at CurrentRun.visitFile'));
          delete errorBody.meta.stack;
          assert.deepEqual(errorBody, {
            id: `${testRealmHref}missing-link`,
            status: 404,
            title: 'Not Found',
            message: `missing file ${testRealmHref}does-not-exist.json`,
            realm: testRealmHref,
            meta: {
              lastKnownGoodHtml: null,
              scopedCssUrls: [],
              cardTitle: null,
            },
          });
        });
      });

      // using public writable realm to make it easy for test setup for the error tests
      module('public writable realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read', 'write'],
          },
          setTestRequest,
        );

        test('serves a card error request with last known good state', async function (assert) {
          await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                relationships: {
                  friend: {
                    links: {
                      self: './does-not-exist',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './friend.gts',
                    name: 'Friend',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          let response = await request
            .get('/hassan')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 500, 'HTTP 500 status');
          let json = response.body;
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

          let errorBody = json.errors[0];
          let lastKnownGoodHtml = cleanWhiteSpace(
            errorBody.meta.lastKnownGoodHtml,
          );

          assert.ok(errorBody.meta.stack.includes('at CurrentRun.visitFile'));
          assert.strictEqual(errorBody.status, 404);
          assert.strictEqual(errorBody.title, 'Not Found');
          assert.strictEqual(
            errorBody.message,
            `missing file ${testRealmHref}does-not-exist.json`,
          );
          assert.ok(lastKnownGoodHtml.includes('Hassan has a friend'));
          assert.ok(lastKnownGoodHtml.includes('Jade'));
          let scopedCssUrls = errorBody.meta.scopedCssUrls;
          assertScopedCssUrlsContain(
            assert,
            scopedCssUrls,
            cardDefModuleDependencies,
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
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });
      });
    });

    module('card POST request', function (_hooks) {
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
          let id: string | undefined;
          let realmEventTimestampStart = Date.now();

          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/card-api',
                    name: 'CardDef',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          await waitForIncrementalIndexEvent(
            getMessagesSince,
            realmEventTimestampStart,
          );

          let messages = await getMessagesSince(realmEventTimestampStart);
          let incrementalEvent = findRealmEvent(
            messages,
            'index',
            'incremental',
          )?.content as IncrementalIndexEventContent;

          id = incrementalEvent.invalidations[0].split('/').pop()!;
          assert.true(uuidValidate(id!), 'card identifier is a UUID');
          assert.strictEqual(
            incrementalEvent.invalidations[0],
            `${testRealmURL}CardDef/${id}`,
          );

          if (!id) {
            assert.ok(false, 'new card identifier was undefined');
          }
          assert.strictEqual(response.status, 201, 'HTTP 201 status');
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

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.id,
            `${testRealmHref}CardDef/${id}`,
            'the id is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'CardDef',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), 'card json exists');
          let card = readJSONSync(cardFile);
          assert.deepEqual(
            card,
            {
              data: {
                attributes: {
                  title: null,
                  description: null,
                  thumbnailURL: null,
                },
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/card-api',
                    name: 'CardDef',
                  },
                },
              },
            },
            'file contents are correct',
          );
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
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json'); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 permissions have been updated', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            );

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('201 with permission', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {},
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
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
        });
      });
    });

    module('card PATCH request', function (_hooks) {
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
          let entry = 'person-1.json';

          let response = await request
            .patch('/person-1')
            .send({
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
          assert.ok(json.data.meta.lastModified, 'lastModified exists');

          assert.true(
            isSingleCardDocument(json),
            'response body is a card document',
          );

          assert.strictEqual(
            json.data.attributes?.firstName,
            'Van Gogh',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          let cardFile = join(dir.name, 'realm_server_1', 'test', entry);
          assert.ok(existsSync(cardFile), 'card json exists');
          let card = readJSONSync(cardFile);
          assert.deepEqual(
            card,
            {
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Van Gogh',
                  description: null,
                  thumbnailURL: null,
                },
                meta: {
                  adoptsFrom: {
                    module: `./person`,
                    name: 'Person',
                  },
                },
              },
            },
            'file contents are correct',
          );

          let query: Query = {
            filter: {
              on: {
                module: `${testRealmHref}person`,
                name: 'Person',
              },
              eq: {
                firstName: 'Van Gogh',
              },
            },
          };

          response = await request
            .get(`/_search?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(response.body.data.length, 1, 'found one card');
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .patch('/person-1')
            .send({
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
            })
            .set('Accept', 'application/vnd.card+json');

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
            updatedFile: `${testRealmURL}person-1.json`,
          });

          assert.deepEqual(incrementalEvent!.content, {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}person-1`],
            clientRequestId: null,
          });
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
            .patch('/person-1')
            .send({})
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({
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
            })
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .patch('/person-1')
            .send({
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
            })
            .set('Accept', 'application/vnd.card+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });
    });

    module('card DELETE request', function (_hooks) {
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
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

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
          assert.false(existsSync(cardFile), 'card json does not exist');
        });

        test('broadcasts realm events', async function (assert) {
          let realmEventTimestampStart = Date.now();

          await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

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
            updatedFile: `${testRealmURL}person-1.json`,
          });

          assert.deepEqual(incrementalEvent!.content, {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [`${testRealmURL}person-1`],
          });
        });

        test('serves a card DELETE request with .json extension in the url', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1.json')
            .set('Accept', 'application/vnd.card+json');

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
          assert.false(existsSync(cardFile), 'card json does not exist');
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
            .delete('/person-1')

            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer invalid-token`);

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('204 with permission', async function (assert) {
          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json')
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

function assertScopedCssUrlsContain(
  assert: Assert,
  scopedCssUrls: string[],
  moduleUrls: string[],
) {
  moduleUrls.forEach((url) => {
    let pattern = new RegExp(`^${url}\\.[^.]+\\.glimmer-scoped\\.css$`);

    assert.true(
      scopedCssUrls.some((scopedCssUrl) => pattern.test(scopedCssUrl)),
      `css url for ${url} is in the deps`,
    );
  });
}

// These modules have CSS that CardDef consumes, so we expect to see them in all relationships of a prerendered card
let cardDefModuleDependencies = [
  'https://cardstack.com/base/default-templates/embedded.gts',
  'https://cardstack.com/base/default-templates/isolated-and-edit.gts',
  'https://cardstack.com/base/default-templates/field-edit.gts',
  'https://cardstack.com/base/field-component.gts',
  'https://cardstack.com/base/contains-many-component.gts',
  'https://cardstack.com/base/links-to-editor.gts',
  'https://cardstack.com/base/links-to-many-component.gts',
];

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
