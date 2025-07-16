import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { Server } from 'http';
import { type DirResult } from 'tmp';
import {
  baseRealm,
  Realm,
  type LooseSingleCardDocument,
  SupportedMimeType,
  RealmAdapter,
} from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  setupPermissionedRealm,
  createVirtualNetworkAndLoader,
  matrixURL,
  testRealmHref,
  createJWT,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(__filename), function () {
  module(
    'Realm-specific Endpoints: can make request to post /_atomic',
    function (hooks) {
      let testRealm: Realm;
      let testRealmAdapter: RealmAdapter;
      let request: SuperTest<Test>;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        testRealmAdapter: RealmAdapter;
        request: SuperTest<Test>;
        dir: DirResult;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        testRealmAdapter = args.testRealmAdapter;
      }

      let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

      setupCardLogs(
        hooks,
        async () => await loader.import(`${baseRealm.url}card-api`),
      );

      setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

      module('writes', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });
        test('can write single new module', async function (assert) {
          let source = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Place extends CardDef {
                static displayName = 'Place';
                @field name = contains(StringField);
              }
              `.trim();
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place-modules/place.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: source,
                  },
                  meta: {},
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.body['atomic:results'].length, 1);
          assert.strictEqual(response.status, 201);
          assert.deepEqual(
            response.body['atomic:results'][0].data.id,
            `${testRealmHref}place-modules/place.gts`,
          );
          let sourceResponse = await request
            .get('/place-modules/place.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(
            sourceResponse.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            sourceResponse.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          assert.strictEqual(
            sourceResponse.text.trim(),
            source,
            'the card source is correct',
          );
        });
        test('can write multiple new modules', async function (assert) {
          let place1Source = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Place extends CardDef {
                static displayName = 'Place';
                @field name = contains(StringField);
              }
              `.trim();
          let place2Source = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Place2 extends CardDef {
                static displayName = 'Place2';
                @field name = contains(StringField);
              }
              `.trim();
          let countrySource = `
              import { field, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Country extends CardDef {
                static displayName = 'Country';
                @field name = contains(StringField);
              }
              `.trim();

          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place-modules/place1.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: place1Source,
                  },
                  meta: {},
                },
              },
              {
                op: 'add',
                href: '/place-modules/place2.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: place2Source,
                  },
                },
              },
              {
                op: 'add',
                href: '/country.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: countrySource,
                  },
                  meta: {},
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));

          assert.strictEqual(response.status, 201, 'HTTP 200 status');
          assert.strictEqual(response.body['atomic:results'].length, 3);
          let place1Response = await request
            .get('/place-modules/place1.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(place1Response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            place1Response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            place1Response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          assert.strictEqual(
            place1Response.text.trim(),
            place1Source,
            'the card source is correct',
          );
          let place2Response = await request
            .get('/place-modules/place2.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(place2Response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            place2Response.text.trim(),
            place2Source,
            'the card source is correct',
          );
          assert.strictEqual(
            place2Response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            place2Response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );

          let countryResponse = await request
            .get('/country.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(countryResponse.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            countryResponse.text.trim(),
            countrySource,
            'the card source is correct',
          );
          assert.strictEqual(
            countryResponse.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            countryResponse.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
        });
        test('can write a single instance', async function (assert) {
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/new-person-1.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Mango',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/person',
                      name: 'Person',
                    },
                  },
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.body['atomic:results'].length, 1);
          let cardResponse = await request
            .get('/new-person-1')
            .set('Accept', SupportedMimeType.CardJson);
          let json = cardResponse.body as LooseSingleCardDocument;
          assert.strictEqual(json.data.attributes?.firstName, 'Mango');
        });
        test('can write multiple instances', async function (assert) {
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/new-person-1.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Mango',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/person',
                      name: 'Person',
                    },
                  },
                },
              },
              {
                op: 'add',
                href: '/new-person-2.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Van Gogh',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/person',
                      name: 'Person',
                    },
                  },
                },
              },
            ],
          };

          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.body['atomic:results'].length, 2);
          let cardResponse1 = await request
            .get('/new-person-1')
            .set('Accept', SupportedMimeType.CardJson);
          let json1 = cardResponse1.body as LooseSingleCardDocument;
          assert.strictEqual(json1.data.attributes?.firstName, 'Mango');
          let cardResponse2 = await request
            .get('/new-person-2')
            .set('Accept', SupportedMimeType.CardJson);
          let json2 = cardResponse2.body as LooseSingleCardDocument;
          assert.strictEqual(json2.data.attributes?.firstName, 'Van Gogh');
        });
        test('can write multiple modules that depend on each other', async function (assert) {
          let place1Source = `
            import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            export class Place extends CardDef {
              static displayName = 'Place';
              @field name = contains(StringField);
            }
            `.trim();
          let place2Source = `
            import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            import { Place } from './place'
            export class Place2 extends Place {
              static displayName = 'Place2';
              @field name = contains(StringField);
            }
            `.trim();
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place-modules/place1.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: place1Source,
                  },
                  meta: {},
                },
              },
              {
                op: 'add',
                href: '/place-modules/place2.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: place2Source,
                  },
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));

          assert.strictEqual(response.status, 201, 'HTTP 200 status');
          assert.strictEqual(response.body['atomic:results'].length, 2);
          let place1Response = await request
            .get('/place-modules/place1.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(place1Response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            place1Response.text.trim(),
            place1Source,
            'the card source is correct',
          );
          assert.strictEqual(
            place1Response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            place1Response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
          let place2Response = await request
            .get('/place-modules/place2.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(place2Response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            place2Response.text.trim(),
            place2Source,
            'the card source is correct',
          );
          assert.strictEqual(
            place2Response.get('X-boxel-realm-url'),
            testRealmHref,
            'realm url header is correct',
          );
          assert.strictEqual(
            place2Response.get('X-boxel-realm-public-readable'),
            'true',
            'realm is public readable',
          );
        });

        test('can write multiple instances that depend on each other', async function (assert) {
          let placeSource = `
              import { field, CardDef, contains, linksTo } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              import { Country } from './country'
              export class Place extends CardDef {
                static displayName = 'Place';
                @field name = contains(StringField);
                @field country = linksTo(()=>Country);
              }
              `.trim();
          let countrySource = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Country extends CardDef {
                static displayName = 'Country';
                @field name = contains(StringField);
              }
              `.trim();
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: placeSource,
                  },
                  meta: {},
                },
              },
              {
                op: 'add',
                href: '/country.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: countrySource,
                  },
                  meta: {},
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));

          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.body['atomic:results'].length, 2);
          let placeResponse = await request
            .get('/place.gts')
            .set('Accept', SupportedMimeType.CardSource);
          let countryResponse = await request
            .get('/country.gts')
            .set('Accept', SupportedMimeType.CardSource);

          assert.strictEqual(
            placeResponse.text.trim(),
            placeSource,
            'the card source is correct',
          );
          assert.strictEqual(
            countryResponse.text.trim(),
            countrySource,
            'the card source is correct',
          );
          let instanceDoc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/malaysia.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Malaysia',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/country',
                      name: 'Country',
                    },
                  },
                },
              },
              {
                op: 'add',
                href: '/menara-kuala-lumpur.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Menara Kuala Lumpur',
                  },
                  relationships: {
                    country: {
                      links: {
                        self: './malaysia.json', //at least in our implementation, it seems you need this although data already exists
                      },
                      data: {
                        id: '/malaysia.json',
                        type: 'card',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/place',
                      name: 'Place',
                    },
                  },
                },
              },
            ],
          };
          let instanceResponse = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(instanceDoc));
          assert.strictEqual(instanceResponse.status, 201);
          assert.strictEqual(instanceResponse.body['atomic:results'].length, 2);
        });
        test('can write new instance with new module', async function (assert) {
          let source = `
            import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            export class Place extends CardDef {
              static displayName = 'Place';
              @field name = contains(StringField);
            }
            `.trim();
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place-modules/place.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: source,
                  },
                  meta: {},
                },
              },
              {
                op: 'add',
                href: '/place.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Kuala Lumpur',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/place-modules/place',
                      name: 'Place',
                    },
                  },
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));

          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.body['atomic:results'].length, 2);
          let cardResponse = await request
            .get('/place')
            .set('Accept', SupportedMimeType.CardJson);
          let json = cardResponse.body as LooseSingleCardDocument;
          assert.strictEqual(json.data.attributes?.name, 'Kuala Lumpur');
          let sourceResponse = await request
            .get('/place-modules/place.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(
            sourceResponse.text.trim(),
            source,
            'the card source is correct',
          );
        });
        test('writes will get file directly from disk enabling writes that rely on file system but not index', async function (assert) {
          let source = `
            import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            export class Place extends CardDef {
              static displayName = 'Place';
              @field name = contains(StringField);
            }
            `.trim();

          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place-modules/place.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: source,
                  },
                  meta: {},
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.status, 201);
          //place module is indexed but it will be overwritten by a file write
          let unIndexedSource = `
          import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Place extends CardDef {
            static displayName = 'Place';
            @field newName = contains(StringField);
          }
          `;
          await testRealmAdapter.write(
            '/place-modules/place.gts',
            unIndexedSource,
          );
          // this instance should adoptsFrom the file unIndexedSource
          let newDoc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place.json',
                data: {
                  type: 'card',
                  attributes: {
                    newName: 'Kuala Lumpur',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/place-modules/place',
                      name: 'Place',
                    },
                  },
                },
              },
            ],
          };

          response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(newDoc));
          assert.strictEqual(response.status, 201);

          let cardResponse = await request
            .get('/place')
            .set('Accept', SupportedMimeType.CardJson);
          let json = cardResponse.body as LooseSingleCardDocument;
          assert.strictEqual(json.data.attributes?.name, undefined);
          assert.strictEqual(json.data.attributes?.newName, 'Kuala Lumpur');
        });
      });
      module('error handling', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });
        test('returns error when resource already exists', async function (assert) {
          let source = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Place extends CardDef {
                static displayName = 'Place';
                @field name = contains(StringField);
              }
              `.trim();
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/person.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: source,
                  },
                  meta: {},
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.status, 409);
          assert.strictEqual(response.body.errors.length, 1);
          assert.strictEqual(
            response.body.errors[0].title,
            'Resource already exists',
          );
          assert.strictEqual(
            response.body.errors[0].detail,
            `Resource /person.gts already exists`,
          );
        });
        test('returns error when failing to serialize a card resource', async function (assert) {
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: '/place.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Kuala Lumpur',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '/place-modules/place',
                      name: 'Place',
                    },
                  },
                },
              },
            ],
          };
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(doc));
          assert.strictEqual(response.status, 500);
          assert.strictEqual(response.body.errors.length, 1);
          assert.strictEqual(response.body.errors[0].title, 'Write Error');
          assert.strictEqual(
            response.body.errors[0].detail,
            `Error: ${testRealmHref}place-modules/place not found`,
          );
        });
      });
      module('validation', function (hooks) {
        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });
        test('rejects non-array atomic:operations', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({ 'atomic:operations': 'not-an-array' })
            .expect(400);
          assert.strictEqual(response.status, 400);
          assert.strictEqual(response.body.errors.length, 1);
          let error = response.body.errors[0];
          assert.strictEqual(error.status, 400);
          assert.strictEqual(
            error.detail,
            `Request body must contain 'atomic:operations' array`,
          );
          assert.strictEqual(
            response.body.errors[0].title,
            'Invalid atomic:operations format',
          );
        });
        test('rejects request without atomic:operations array', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({ data: { something: 'else' } })
            .expect(400);
          assert.strictEqual(response.body.errors.length, 1);
          let error = response.body.errors[0];
          assert.strictEqual(error.title, 'Invalid atomic:operations format');
          assert.strictEqual(error.status, 400);
          assert.strictEqual(
            error.detail,
            `Request body must contain 'atomic:operations' array`,
          );
        });
        test('rejects if href is not present', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({
              'atomic:operations': [{ op: 'add', data: { type: 'card' } }],
            })
            .expect(400);

          assert.strictEqual(response.body.errors.length, 1);
          let error = response.body.errors[0];
          assert.strictEqual(error.title, 'Invalid atomic:operations format');
          assert.strictEqual(error.status, 400);
          assert.strictEqual(
            error.detail,
            `Request operation must contain 'href' property`,
          );
        });
        test('rejects unsupported operation types', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({
              'atomic:operations': [{ op: 'delete', data: { type: 'card' } }],
            })
            .expect(400);
          assert.strictEqual(response.body.errors.length, 2);
          let [error1, error2] = response.body.errors;
          assert.strictEqual(error1.title, 'Invalid atomic:operations format');
          assert.strictEqual(error1.status, 422);
          assert.strictEqual(
            error1.detail,
            `You tried to use an unsupported operation type: 'delete'. Only 'add' operations are currently supported`,
          );
          assert.strictEqual(error2.title, 'Invalid atomic:operations format');
          assert.strictEqual(error2.status, 400);
          assert.strictEqual(
            error2.detail,
            `Request operation must contain 'href' property`,
          );
        });
        test('rejects unsupported resource types', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({
              'atomic:operations': [
                { op: 'add', href: '/file.json', data: { type: 'file' } },
              ],
            })
            .expect(400);
          assert.strictEqual(response.body.errors.length, 1);
          let error = response.body.errors[0];
          assert.strictEqual(error.title, 'Invalid atomic:operations format');
          assert.strictEqual(error.status, 422);
          assert.strictEqual(
            error.detail,
            `You tried to use an unsupported resource type: 'file'. Only 'card' and 'source' resource types are currently supported`,
          );
        });
      });
    },
  );
});
