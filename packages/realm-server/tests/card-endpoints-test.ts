import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { join, basename } from 'path';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import { existsSync, readJSONSync, statSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import {
  isSingleCardDocument,
  type LooseSingleCardDocument,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import { stringify, parse } from 'qs';
import type { Query } from '@cardstack/runtime-common/query';
import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  setupPermissionedRealms,
  setupMatrixRoom,
  matrixURL,
  closeServer,
  testRealmInfo,
  cleanWhiteSpace,
  testRealmHref,
  createJWT,
  testRealmServerMatrixUserId,
  cardInfo,
} from './helpers';
import { expectIncrementalIndexEvent } from './helpers/indexing';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import type { PgAdapter } from '@cardstack/postgres';

module(basename(__filename), function () {
  module('Realm-specific Endpoints | card URLs', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = args.request;
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        dir,
        dbAdapter,
      };
    }

    setupBaseRealmServer(hooks, matrixURL);

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('card GET request', function (_hooks) {
      module('public readable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
        });

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
            testRealmHref,
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
                cardInfo,
                firstName: 'Mango',
                description: null,
                thumbnailURL: null,
              },
              relationships: {
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
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
                realmURL: testRealmHref,
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
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          let errorBody = json.errors[0];
          assert.ok(
            errorBody.meta.stack.includes('at Realm.getSourceOrRedirect'),
            'stack trace is correct',
          );
          delete errorBody.meta.stack;
          assert.deepEqual(errorBody, {
            id: `${testRealmHref}missing-link`,
            status: 404,
            title: 'Link Not Found',
            message: `missing file ${testRealmHref}does-not-exist.json`,
            realm: testRealmHref,
            meta: {
              lastKnownGoodHtml: null,
              scopedCssUrls: [],
              cardTitle: null,
            },
          });
        });
        test('card-level query-backed relationships resolve via search at read time', async function (assert) {
          let { testRealm: realm, request } = getRealmSetup();

          let writes = new Map<string, string>([
            [
              'query-person-finder.gts',
              `
                import { CardDef, field, contains, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";
                import { Person } from "./person";

                export class QueryPersonFinder extends CardDef {
                  @field title = contains(StringField);
                  @field favorite = linksTo(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.title' },
                      },
                    },
                  });
                  @field matches = linksToMany(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.title' },
                      },
                    },
                  });
                }
              `,
            ],
            [
              'query-person-finder.json',
              JSON.stringify({
                data: {
                  attributes: {
                    title: 'Mango',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './query-person-finder.gts',
                      name: 'QueryPersonFinder',
                    },
                  },
                },
              }),
            ],
          ]);

          await realm.writeMany(writes);

          let response = await request
            .get('/query-person-finder')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let doc = response.body;
          let favorite = doc.data.relationships.favorite;
          assert.deepEqual(
            favorite.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'linksTo query resolves to the matching person',
          );
          assert.strictEqual(
            favorite.links.self,
            `./person-1`,
            'linksTo relationship self link set to resolved card',
          );

          let matchesRelationship = doc.data.relationships['matches.0'];
          assert.ok(matchesRelationship, 'linksToMany relationship populated');
          assert.deepEqual(
            matchesRelationship.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'linksToMany query returns matching person in first slot',
          );

          assert.ok(
            Array.isArray(doc.included),
            'included resources present for query results',
          );
          assert.ok(
            doc.included.some(
              (resource: any) => resource.id === `${testRealmHref}person-1`,
            ),
            'included contains resolved person card',
          );
        });

        test('field-level query-backed relationships resolve at read time (nested contains)', async function (assert) {
          let { testRealm: realm, request } = getRealmSetup();

          let writes = new Map<string, string>([
            [
              'query-person-finder-nested.gts',
              `
                import { CardDef, FieldDef, field, contains, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
                import StringField from "https://cardstack.com/base/string";
                import { Person } from "./person";

                export class QueryLinksField extends FieldDef {
                  @field title = contains(StringField);
                  @field favorite = linksTo(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.title' },
                      },
                    },
                  });
                  @field matches = linksToMany(Person, {
                    query: {
                      filter: {
                        eq: { firstName: '$this.title' },
                      },
                    },
                  });
                }

                export class WrapperField extends FieldDef {
                  @field queries = contains(QueryLinksField);
                }

                export class OuterQueryCard extends CardDef {
                  @field info = contains(WrapperField);
                }

                export class DeepWrapperField extends FieldDef {
                  @field inner = contains(WrapperField);
                }

                export class DeepOuterQueryCard extends CardDef {
                  @field details = contains(DeepWrapperField);
                }
              `,
            ],
            [
              'query-person-finder-nested.json',
              JSON.stringify({
                data: {
                  attributes: {
                    info: {
                      queries: {
                        title: 'Mango',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './query-person-finder-nested.gts',
                      name: 'OuterQueryCard',
                    },
                  },
                },
              }),
            ],
            [
              'query-person-finder-deep.json',
              JSON.stringify({
                data: {
                  attributes: {
                    details: {
                      inner: {
                        queries: {
                          title: 'Mango',
                        },
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './query-person-finder-nested.gts',
                      name: 'DeepOuterQueryCard',
                    },
                  },
                },
              }),
            ],
          ]);

          await realm.writeMany(writes);

          let response = await request
            .get('/query-person-finder-nested')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            200,
            'HTTP 200 status for nested',
          );
          let doc = response.body;
          assert.deepEqual(
            doc.data.relationships['info.queries.favorite']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'nested linksTo query resolves to matching person',
          );
          assert.strictEqual(
            doc.data.relationships['info.queries.favorite']?.links?.self,
            `./person-1`,
            'nested linksTo relationship self link set',
          );
          assert.deepEqual(
            doc.data.relationships['info.queries.matches.0']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'nested linksToMany returns first match',
          );

          let deepResponse = await request
            .get('/query-person-finder-deep')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            deepResponse.status,
            200,
            'HTTP 200 status for deep nested',
          );
          let deepDoc = deepResponse.body;
          assert.deepEqual(
            deepDoc.data.relationships['details.inner.queries.favorite']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'deeply nested linksTo query resolves to matching person',
          );
          assert.deepEqual(
            deepDoc.data.relationships['details.inner.queries.matches.0']?.data,
            { type: 'card', id: `${testRealmHref}person-1` },
            'deeply nested linksToMany returns first match',
          );
        });
      });

      module('published realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
          published: true,
        });

        test('serves the request', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');

          let json = response.body;

          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;

          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
                cardInfo,
              },
              meta: {
                adoptsFrom: {
                  module: `./person`,
                  name: 'Person',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              relationships: {
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              links: {
                self: `${testRealmHref}person-1`,
              },
            },
          });
        });
      });

      // using public writable realm to make it easy for test setup for the error tests
      module('public writable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

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
            testRealmHref,
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

          assert.ok(
            errorBody.meta.stack.includes('at Realm.getSourceOrRedirect'),
            'stack trace is correct',
          );
          assert.strictEqual(errorBody.status, 404);
          assert.strictEqual(errorBody.title, 'Link Not Found');
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
        setupPermissionedRealm(hooks, {
          permissions: {
            john: ['read'],
            '@node-test_realm:localhost': ['read'],
          },
          onRealmSetup,
        });

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

        test('200 when server user assumes user that has read permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Assume-User', 'john')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, testRealmServerMatrixUserId, ['assume-user'])}`,
            );

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });

        test('403 when server user assumes user that has no read permission', async function (assert) {
          let response = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json')
            .set('X-Boxel-Assume-User', 'not-john')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, testRealmServerMatrixUserId, ['assume-user'])}`,
            );

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            undefined,
            'realm is not public readable',
          );
        });
      });

      module('public readable realm with file', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read'],
          },
          fileSystem: {
            'greeting.txt': 'hello',
          },
          onRealmSetup,
        });

        test('does not return card JSON for file urls', async function (assert) {
          let response = await request
            .get('/greeting.txt')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 404, 'HTTP 404 status');
        });
      });
    });

    module('card POST request', function (_hooks) {
      module('public writable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves the request', async function (assert) {
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

          let incrementalEventContent = await expectIncrementalIndexEvent(
            testRealmHref,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
          let id = incrementalEventContent.invalidations[0].split('/').pop()!;

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.ok(
            response.get('x-created'),
            'created header should be set for new card',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
                attributes: {},
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

        test('creates card instances when it encounters "lid" in the request', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4202/node-test/friend',
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      data: {
                        lid: 'local-id-2',
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      data: {
                        lid: 'local-id-3',
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-2',
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `${id}.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Hassan',
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './local-id-1',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-2.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/Friend/${id}`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/${id}`,
              type: 'card',
              attributes: {
                firstName: 'Hassan',
                title: 'Hassan',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: './local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}Friend/local-id-1`,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: 'http://localhost:4202/node-test/friend',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/${id}`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    title: 'Jade',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-2`,
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-3`,
                        type: 'card',
                      },
                    },
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    title: 'Germaine',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    title: 'Boris',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                title: 'Jade',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                'friends.0': {
                  links: {
                    self: './local-id-2',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-2`,
                    type: 'card',
                  },
                },
                'friends.1': {
                  links: {
                    self: './local-id-3',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-3`,
                    type: 'card',
                  },
                },
                friend: {
                  links: {
                    self: null,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: 'http://localhost:4202/node-test/friend',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/local-id-1`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    title: 'Germaine',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    title: 'Boris',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-2`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-2`,
                type: 'card',
                attributes: {
                  firstName: 'Germaine',
                  title: 'Germaine',
                  description: null,
                  thumbnailURL: null,
                  cardInfo,
                },
                relationships: {
                  friend: {
                    links: {
                      self: null,
                    },
                  },
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: 'http://localhost:4202/node-test/friend',
                  },
                  realmInfo: {
                    ...testRealmInfo,
                    realmUserId: '@node-test_realm:localhost',
                  },
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-2`,
                },
              },
            });
          }
          {
            let response = await request
              .get(`/Friend/local-id-3`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-3`,
                type: 'card',
                attributes: {
                  firstName: 'Boris',
                  title: 'Boris',
                  description: null,
                  thumbnailURL: null,
                  cardInfo,
                },
                relationships: {
                  friend: {
                    links: {
                      self: null,
                    },
                  },
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: 'http://localhost:4202/node-test/friend',
                  },
                  realmInfo: {
                    ...testRealmInfo,
                    realmUserId: '@node-test_realm:localhost',
                  },
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-3`,
                },
              },
            });
          }
        });

        test('ignores "lid" for other realms', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-3',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4202/node-test/friend',
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                    realmURL: `http://some-other-realm/`,
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `${id}.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Hassan',
                  },
                  relationships: {
                    friend: {
                      links: { self: null },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.false(
              existsSync(cardFile),
              `card json ${cardFile} does not exist`,
            );
          }
        });

        test('creates card instance when it encounters "lid" in the primary resource', async function (assert) {
          let response = await request
            .post('/')
            .send({
              data: {
                type: 'card',
                lid: 'local-id-1',
                attributes: {
                  firstName: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4202/node-test/friend',
                    name: 'Friend',
                  },
                  realmURL: testRealmHref.replace(/\/$/, ''),
                },
              },
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 201, 'HTTP 201 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          let json = response.body as SingleCardDocument;
          let id = json.data.id!.split('/').pop()!;
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'Friend',
            `${id}.json`,
          );
          assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
          let card = readJSONSync(cardFile);
          assert.deepEqual(
            card,
            {
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Hassan',
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4202/node-test/friend',
                    name: 'Friend',
                  },
                },
              },
            } as LooseSingleCardDocument,
            `file contents ${cardFile} are correct`,
          );
          {
            let response = await request
              .get(`/Friend/${id}`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/${id}`,
              type: 'card',
              attributes: {
                firstName: 'Hassan',
                title: 'Hassan',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: null,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: 'http://localhost:4202/node-test/friend',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/${id}`,
              },
            });
          }
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read'],
          },
          onRealmSetup,
        });

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

    module('card POST request | file URL', function (_hooks) {
      module('public writable realm with file', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          fileSystem: {
            'greeting.txt': 'hello',
          },
          onRealmSetup,
        });

        test('rejects POST to a file URL', async function (assert) {
          let response = await request
            .post('/greeting.txt')
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

          assert.strictEqual(response.status, 405, 'HTTP 405 status');
        });
      });
    });

    module('card PATCH request', function (_hooks) {
      module('public writable realm with file', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          fileSystem: {
            'greeting.txt': 'hello',
          },
          onRealmSetup,
        });

        test('rejects PATCH to a file URL', async function (assert) {
          let response = await request
            .patch('/greeting.txt')
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

          assert.strictEqual(response.status, 405, 'HTTP 405 status');
        });
      });

      module('public writable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

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
          assert.ok(
            response.get('x-created'),
            'created header should be set for updated card',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
                  cardInfo,
                },
                relationships: {
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
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

        test('no-op patch returns existing lastModified and does not rewrite file', async function (assert) {
          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let initialStat = statSync(cardFile);

          let initialResponse = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            initialResponse.status,
            200,
            'initial GET succeeds',
          );
          let initialLastModified = initialResponse.body.data.meta.lastModified;
          assert.ok(initialLastModified, 'initial lastModified exists');

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            })
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.body.data.meta.lastModified,
            initialLastModified,
            'lastModified remains unchanged after no-op patch',
          );
          assert.strictEqual(
            response.body.data.attributes?.firstName,
            'Mango',
            'card remains unchanged',
          );
          let afterStat = statSync(cardFile);
          assert.strictEqual(
            afterStat.mtimeMs,
            initialStat.mtimeMs,
            'card file not rewritten for no-op patch',
          );
        });

        test('patches card when index entry is an error using pristine doc', async function (assert) {
          let cardURL = `${testRealmHref}person-1`;
          let errorDoc = {
            message: 'render failed',
            status: 500,
            additionalErrors: null,
          };

          for (let table of ['boxel_index', 'boxel_index_working']) {
            await dbAdapter.execute(
              `UPDATE ${table}
               SET type = 'error', error_doc = $1::jsonb
               WHERE url = $2`,
              {
                bind: [JSON.stringify(errorDoc), cardURL],
              },
            );
          }

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Recovered',
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
            response.body.data.attributes?.firstName,
            'Recovered',
            'patched response uses last known good doc',
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.attributes?.firstName,
            'Recovered',
            'card file updated from error state',
          );
          assert.deepEqual(
            card.data.relationships?.['cardInfo.theme'],
            { links: { self: null } },
            'relationships from pristine doc are preserved',
          );
        });

        test('patches card when index entry is an error without pristine doc', async function (assert) {
          let cardURL = `${testRealmHref}person-1`;
          let errorDoc = {
            message: 'render failed',
            status: 500,
            additionalErrors: null,
          };

          for (let table of ['boxel_index', 'boxel_index_working']) {
            await dbAdapter.execute(
              `UPDATE ${table}
               SET type = 'error', error_doc = $1::jsonb, pristine_doc = NULL
               WHERE url = $2`,
              {
                bind: [JSON.stringify(errorDoc), cardURL],
              },
            );
          }

          let response = await request
            .patch('/person-1')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Fresh Start',
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
            response.body.data.attributes?.firstName,
            'Fresh Start',
            'patched response uses empty base when pristine doc missing',
          );

          let cardFile = join(
            dir.name,
            'realm_server_1',
            'test',
            'person-1.json',
          );
          let card = readJSONSync(cardFile);
          assert.strictEqual(
            card.data.attributes?.firstName,
            'Fresh Start',
            'card file updated even without pristine doc',
          );
          assert.deepEqual(card.data.meta.adoptsFrom, {
            module: './person',
            name: 'Person',
          });
          assert.strictEqual(card.data.type, 'card');
        });

        test('creates card instances when it encounters "lid" in the request', async function (assert) {
          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: './friend',
                    name: 'Friend',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      data: {
                        lid: 'local-id-2',
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      data: {
                        lid: 'local-id-3',
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-2',
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
            'Paper',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan.json',
            );
            assert.ok(existsSync(cardFile), 'card json exists');
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './Friend/local-id-1',
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: `./friend`,
                      name: 'Friend',
                    },
                  },
                },
              },
              'file contents are correct',
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './local-id-2',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './local-id-3',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-2.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/hassan`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}hassan`,
              type: 'card',
              attributes: {
                firstName: 'Paper',
                cardInfo,
                title: 'Paper',
                description: null,
                thumbnailURL: null,
              },
              relationships: {
                friend: {
                  links: {
                    self: './Friend/local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}Friend/local-id-1`,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: './friend',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}hassan`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    title: 'Jade',
                    cardInfo,
                    description: null,
                    thumbnailURL: null,
                  },
                  relationships: {
                    'friends.0': {
                      links: {
                        self: './Friend/local-id-2',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-2`,
                        type: 'card',
                      },
                    },
                    'friends.1': {
                      links: {
                        self: './Friend/local-id-3',
                      },
                      data: {
                        id: `${testRealmHref}Friend/local-id-3`,
                        type: 'card',
                      },
                    },
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    cardInfo,
                    firstName: 'Germaine',
                    title: 'Germaine',
                    description: null,
                    thumbnailURL: null,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    cardInfo,
                    firstName: 'Boris',
                    title: 'Boris',
                    description: null,
                    thumbnailURL: null,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}Friend/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                title: 'Jade',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                'friends.0': {
                  links: {
                    self: './local-id-2',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-2`,
                    type: 'card',
                  },
                },
                'friends.1': {
                  links: {
                    self: './local-id-3',
                  },
                  data: {
                    id: `${testRealmHref}Friend/local-id-3`,
                    type: 'card',
                  },
                },
                friend: {
                  links: {
                    self: null,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'Friend',
                  module: '../friend',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}Friend/local-id-1`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}Friend/local-id-2`,
                  type: 'card',
                  attributes: {
                    firstName: 'Germaine',
                    title: 'Germaine',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
                {
                  id: `${testRealmHref}Friend/local-id-3`,
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                    title: 'Boris',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/Friend/local-id-2`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-2`,
                type: 'card',
                attributes: {
                  firstName: 'Germaine',
                  title: 'Germaine',
                  description: null,
                  thumbnailURL: null,
                  cardInfo,
                },
                relationships: {
                  friend: {
                    links: {
                      self: null,
                    },
                  },
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: '../friend',
                  },
                  realmInfo: {
                    ...testRealmInfo,
                    realmUserId: '@node-test_realm:localhost',
                  },
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-2`,
                },
              },
            });
          }
          {
            let response = await request
              .get(`/Friend/local-id-3`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json, {
              data: {
                id: `${testRealmHref}Friend/local-id-3`,
                type: 'card',
                attributes: {
                  firstName: 'Boris',
                  title: 'Boris',
                  description: null,
                  thumbnailURL: null,
                  cardInfo,
                },
                relationships: {
                  friend: {
                    links: {
                      self: null,
                    },
                  },
                  'cardInfo.theme': {
                    links: {
                      self: null,
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    name: 'Friend',
                    module: '../friend',
                  },
                  realmInfo: {
                    ...testRealmInfo,
                    realmUserId: '@node-test_realm:localhost',
                  },
                  realmURL: testRealmHref,
                },
                links: {
                  self: `${testRealmHref}Friend/local-id-3`,
                },
              },
            });
          }
        });

        test('creates card instances when it encounters "lid" in the request for requests that has "isUsed: true" links', async function (assert) {
          let response = await request
            .patch('/hassan-x')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-1',
                      type: 'card',
                    },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module:
                      'http://localhost:4202/node-test/friend-with-used-link',
                    name: 'FriendWithUsedLink',
                  },
                },
              },
              included: [
                {
                  lid: 'local-id-1',
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  meta: {
                    adoptsFrom: {
                      module:
                        'http://localhost:4202/node-test/friend-with-used-link',
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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
            'Paper',
            'the field data is correct',
          );
          assert.ok(json.data.meta.lastModified, 'lastModified is populated');
          delete json.data.meta.lastModified;
          delete json.data.meta.resourceCreatedAt;
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan-x.json',
            );
            assert.ok(existsSync(cardFile), 'card json exists');
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './FriendWithUsedLink/local-id-1',
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module:
                        'http://localhost:4202/node-test/friend-with-used-link',
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              },
              'file contents are correct',
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'FriendWithUsedLink',
              `local-id-1.json`,
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                  },
                  meta: {
                    adoptsFrom: {
                      module:
                        'http://localhost:4202/node-test/friend-with-used-link',
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let response = await request
              .get(`/hassan-x`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}hassan-x`,
              type: 'card',
              attributes: {
                firstName: 'Paper',
                title: 'Paper',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: './FriendWithUsedLink/local-id-1',
                  },
                  data: {
                    type: 'card',
                    id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'FriendWithUsedLink',
                  module:
                    'http://localhost:4202/node-test/friend-with-used-link',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}hassan-x`,
              },
            });

            for (let resource of json.included!) {
              delete resource.meta.realmURL;
              delete resource.meta.realmInfo;
              delete resource.meta.lastModified;
              delete resource.meta.resourceCreatedAt;
              delete resource.links;
            }
            assert.deepEqual(
              json.included,
              [
                {
                  id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
                  type: 'card',
                  attributes: {
                    firstName: 'Jade',
                    title: 'Jade',
                    description: null,
                    thumbnailURL: null,
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: null,
                      },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module:
                        'http://localhost:4202/node-test/friend-with-used-link',
                      name: 'FriendWithUsedLink',
                    },
                  },
                },
              ],
              'included is correct',
            );
          }
          {
            let response = await request
              .get(`/FriendWithUsedLink/local-id-1`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            let json = response.body;
            assert.ok(json.data.meta.lastModified, 'lastModified exists');
            delete json.data.meta.lastModified;
            delete json.data.meta.resourceCreatedAt;
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              testRealmHref,
              'realm url header is correct',
            );
            assert.deepEqual(json.data, {
              id: `${testRealmHref}FriendWithUsedLink/local-id-1`,
              type: 'card',
              attributes: {
                firstName: 'Jade',
                title: 'Jade',
                description: null,
                thumbnailURL: null,
                cardInfo,
              },
              relationships: {
                friend: {
                  links: {
                    self: null,
                  },
                },
                'cardInfo.theme': {
                  links: {
                    self: null,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  name: 'FriendWithUsedLink',
                  module:
                    'http://localhost:4202/node-test/friend-with-used-link',
                },
                realmInfo: {
                  ...testRealmInfo,
                  realmUserId: '@node-test_realm:localhost',
                },
                realmURL: testRealmHref,
              },
              links: {
                self: `${testRealmHref}FriendWithUsedLink/local-id-1`,
              },
            });
          }
        });

        test('ignores "lid" for other realms', async function (assert) {
          let response = await request
            .patch('/hassan')
            .send({
              data: {
                type: 'card',
                attributes: {
                  firstName: 'Paper',
                },
                relationships: {
                  friend: {
                    data: {
                      lid: 'local-id-3',
                      type: 'card',
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
              included: [
                {
                  lid: 'local-id-3',
                  type: 'card',
                  attributes: {
                    firstName: 'Boris',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/node-test/friend',
                      name: 'Friend',
                    },
                    realmURL: `http://some-other-realm/`,
                  },
                },
              ],
            } as LooseSingleCardDocument)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'hassan.json',
            );
            assert.ok(existsSync(cardFile), `card json ${cardFile} exists`);
            let card = readJSONSync(cardFile);
            assert.deepEqual(
              card,
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Paper',
                    cardInfo,
                  },
                  relationships: {
                    friend: {
                      links: { self: './jade' },
                    },
                    'cardInfo.theme': {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: './friend',
                      name: 'Friend',
                    },
                  },
                },
              } as LooseSingleCardDocument,
              `file contents ${cardFile} are correct`,
            );
          }
          {
            let cardFile = join(
              dir.name,
              'realm_server_1',
              'test',
              'Friend',
              `local-id-3.json`,
            );
            assert.false(
              existsSync(cardFile),
              `card json ${cardFile} does not exist`,
            );
          }
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

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read'],
          },
          onRealmSetup,
        });

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

    module('card PUT request | file URL', function (_hooks) {
      module('public writable realm with file', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          fileSystem: {
            'greeting.txt': 'hello',
          },
          onRealmSetup,
        });

        test('rejects PUT to a file URL', async function (assert) {
          let response = await request
            .put('/greeting.txt')
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

          assert.strictEqual(response.status, 405, 'HTTP 405 status');
        });
      });
    });

    module('card DELETE request', function (_hooks) {
      module('public writable realm with file', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          fileSystem: {
            'greeting.txt': 'hello',
          },
          onRealmSetup,
        });

        test('rejects DELETE to a file URL', async function (assert) {
          let response = await request
            .delete('/greeting.txt')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 405, 'HTTP 405 status');
        });
      });

      module('public writable realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

        test('serves the request', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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

          await expectIncrementalIndexEvent(
            `${testRealmHref}person-1.json`,
            realmEventTimestampStart,
            {
              assert,
              getMessagesSince,
              realm: testRealmHref,
            },
          );
        });

        test('serves a card DELETE request with .json extension in the url', async function (assert) {
          let entry = 'person-1.json';

          let response = await request
            .delete('/person-1.json')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 204, 'HTTP 204 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            testRealmHref,
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

        test('removes file meta when card is deleted', async function (assert) {
          // confirm meta.resourceCreatedAt exists prior to deletion
          let initial = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(initial.status, 200, 'precondition GET 200');
          let initialCreatedAt = initial.body?.data?.meta?.resourceCreatedAt;
          assert.ok(initialCreatedAt, 'resourceCreatedAt exists before delete');

          // delete the card
          let delResp = await request
            .delete('/person-1')
            .set('Accept', 'application/vnd.card+json');
          assert.strictEqual(delResp.status, 204, 'delete succeeds with 204');

          // subsequent GET should not expose resourceCreatedAt (file meta removed)
          let after = await request
            .get('/person-1')
            .set('Accept', 'application/vnd.card+json');
          // Depending on implementation could be 404 Not Found; just assert it's not 200
          assert.notStrictEqual(
            after.status,
            200,
            'GET after delete is not 200',
          );
          let afterCreatedAt = after.body?.data?.meta?.resourceCreatedAt;
          assert.strictEqual(
            afterCreatedAt,
            undefined,
            'resourceCreatedAt is absent after deletion',
          );
          assert.false(
            JSON.stringify(after.body).includes('resourceCreatedAt'),
            'No resourceCreatedAt key present anywhere in error payload',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            john: ['read', 'write'],
            '@node-test_realm:localhost': ['read'],
          },
          onRealmSetup,
        });

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

  module('Query-backed relationships runtime resolver', function (hooks) {
    const providerRealmURL = 'http://127.0.0.1:5521/';
    const consumerRealmURL = 'http://127.0.0.1:5522/';
    const UNREACHABLE_REALM_URL = 'https://example.invalid/offline/';
    let consumerRequest: SuperTest<Test>;

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealms(hooks, {
      realms: [
        {
          realmURL: providerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'person.gts': `
              import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";

              export class Person extends CardDef {
                @field name = contains(StringField);
              }
            `,
            'person-remote.json': {
              data: {
                attributes: {
                  name: 'Zed',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
        {
          realmURL: consumerRealmURL,
          permissions: {
            '*': ['read', 'write', 'realm-owner'],
          },
          fileSystem: {
            'favorite-finder.gts': `
              import { CardDef, field, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
              import { Person } from "${providerRealmURL}person";

              export class FavoriteLookup extends CardDef {
                @field favorite = linksTo(Person, {
                  query: {
                    realm: '$thisRealm',
                    page: { size: 1 },
                  },
                });
                @field matches = linksToMany(Person, {
                  query: {
                    realm: '${providerRealmURL}',
                    sort: [
                      { by: 'name', direction: 'desc' },
                    ],
                    page: { size: 1 },
                  },
                });
                @field failingMatches = linksToMany(Person, {
                  query: {
                    realm: '${UNREACHABLE_REALM_URL}',
                    page: { size: 1 },
                  },
                });
              }
            `,
            'favorite.json': {
              data: {
                meta: {
                  adoptsFrom: {
                    module: './favorite-finder',
                    name: 'FavoriteLookup',
                  },
                },
              },
            },
            'local-person.json': {
              data: {
                attributes: {
                  name: 'Abe',
                },
                meta: {
                  adoptsFrom: {
                    module: `${providerRealmURL}person`,
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      ],
      onRealmSetup({ realms }) {
        let latestRealms = realms.slice(-2);
        consumerRequest = supertest(latestRealms[1].realmHttpServer);
      },
    });

    hooks.afterEach(() => {
      resetCatalogRealms();
    });

    test('linksTo query resolves the first aggregated result and includes it', async function (assert) {
      let response = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let doc = response.body;
      let favoriteRelationship = doc.data.relationships.favorite;

      assert.deepEqual(
        favoriteRelationship?.data,
        { type: 'card', id: `${consumerRealmURL}local-person` },
        'linksTo picks the first (local realm) match',
      );
      let favoriteSearchLink = favoriteRelationship?.links?.search;
      assert.ok(
        favoriteSearchLink,
        'linksTo relationship exposes canonical search link',
      );
      let favoriteSearchURL = new URL(favoriteSearchLink);
      assert.strictEqual(
        favoriteSearchURL.href.split('?')[0],
        new URL('_search', consumerRealmURL).href,
        'favorite relationship search link targets consumer realm',
      );
      let favoriteQueryParams = parse(
        favoriteSearchURL.searchParams.toString(),
      ) as Record<string, any>;
      assert.deepEqual(
        favoriteQueryParams.page,
        { size: '1', number: '0' },
        'favorite relationship search link encodes pagination',
      );
      assert.strictEqual(
        favoriteQueryParams.filter?.type?.module,
        `${providerRealmURL}person`,
        'favorite relationship search link encodes implicit type filter module',
      );
      assert.strictEqual(
        favoriteQueryParams.filter?.type?.name,
        'Person',
        'favorite relationship search link encodes implicit type filter name',
      );
      assert.ok(
        Array.isArray(doc.included),
        '`included` array exists for linksTo query',
      );
      assert.ok(
        doc.included.some(
          (resource: any) => resource.id === `${consumerRealmURL}local-person`,
        ),
        '`included` contains the resolved favorite card',
      );
      assert.deepEqual(
        favoriteRelationship?.data,
        { type: 'card', id: `${consumerRealmURL}local-person` },
        'favorite relationship data references the resolved card',
      );
      assert.ok(
        doc.included.find(
          (resource: any) => resource.id === `${consumerRealmURL}local-person`,
        ),
        'local person is present in included array',
      );
    });

    test('linksToMany query returns remote results and records errors for failing realm', async function (assert) {
      let response = await consumerRequest
        .get('/favorite')
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');

      let doc = response.body;
      let relationships = doc.data.relationships as Record<string, any>;
      let remoteRelationship = relationships['matches.0'];
      let matchesRelationship = relationships.matches;

      assert.ok(remoteRelationship, 'remote match is present');
      assert.deepEqual(
        remoteRelationship?.data,
        { type: 'card', id: `${providerRealmURL}person-remote` },
        'remote realm result is returned',
      );

      assert.notOk(
        matchesRelationship?.meta?.errors,
        'successful remote query does not include errors metadata',
      );
      assert.deepEqual(
        matchesRelationship?.data,
        [{ type: 'card', id: `${providerRealmURL}person-remote` }],
        'linksToMany base relationship provides data array for remote results',
      );
      let matchesSearchLink = matchesRelationship?.links?.search;
      assert.ok(
        matchesSearchLink,
        'linksToMany relationship exposes canonical search link',
      );
      let matchesSearchURL = new URL(matchesSearchLink);
      assert.strictEqual(
        matchesSearchURL.href.split('?')[0],
        new URL('_search', providerRealmURL).href,
        'matches relationship search link targets provider realm',
      );
      let matchesQueryParams = parse(
        matchesSearchURL.searchParams.toString(),
      ) as Record<string, any>;
      assert.deepEqual(
        matchesQueryParams.page,
        { size: '1', number: '0' },
        'matches relationship search link encodes pagination',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.by,
        'name',
        'matches relationship search link preserves sort by',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.direction,
        'desc',
        'matches relationship search link preserves sort direction',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.on?.module,
        `${providerRealmURL}person`,
        'matches relationship search link encodes sort module',
      );
      assert.strictEqual(
        matchesQueryParams.sort?.[0]?.on?.name,
        'Person',
        'matches relationship search link encodes sort card name',
      );

      let failingRelationship = relationships.failingMatches;
      assert.ok(
        failingRelationship?.meta?.errors,
        'failingMatches relationship meta includes errors array',
      );
      assert.ok(
        failingRelationship.meta.errors.some(
          (error: any) => error.realm === UNREACHABLE_REALM_URL,
        ),
        'meta includes unreachable realm entry for failing query',
      );
      let failingSearchLink = failingRelationship.links?.search;
      assert.ok(
        failingSearchLink,
        'failingMatches relationship exposes canonical search link despite error',
      );
      let failingSearchURL = new URL(failingSearchLink);
      assert.strictEqual(
        failingSearchURL.href.split('?')[0],
        new URL('_search', UNREACHABLE_REALM_URL).href,
        'failingMatches search link targets unreachable realm',
      );
      let failingQueryParams = parse(
        failingSearchURL.searchParams.toString(),
      ) as Record<string, any>;
      assert.deepEqual(
        failingQueryParams.page,
        { size: '1', number: '0' },
        'failingMatches search link encodes pagination',
      );
      assert.strictEqual(
        failingQueryParams.filter?.type?.module,
        `${providerRealmURL}person`,
        'failingMatches search link encodes implicit type filter module',
      );
      assert.strictEqual(
        failingQueryParams.filter?.type?.name,
        'Person',
        'failingMatches search link encodes implicit type filter name',
      );
      assert.deepEqual(
        failingRelationship.data,
        [],
        'failingMatches relationship provides empty data array when query fails',
      );

      assert.ok(Array.isArray(doc.included), '`included` array is present');
      let includedIds = (doc.included ?? []).map(
        (resource: any) => resource.id,
      );
      assert.ok(
        includedIds.includes(`${consumerRealmURL}local-person`),
        '`included` contains the local person result',
      );
      assert.ok(
        includedIds.includes(`${providerRealmURL}person-remote`),
        '`included` contains the remote person result',
      );
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
