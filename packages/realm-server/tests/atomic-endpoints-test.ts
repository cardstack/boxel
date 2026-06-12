import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm, RealmAdapter } from '@cardstack/runtime-common';
import {
  type LooseSingleCardDocument,
  readFileAsText,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  type RealmRequest,
  waitUntil,
  withRealmPath,
} from './helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

type DiskSnapshot =
  | { kind: 'present'; lastModified: number; content: string }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

async function readDiskSnapshot(
  adapter: RealmAdapter,
  path: string,
): Promise<DiskSnapshot> {
  try {
    let file = await readFileAsText(path, (p) => adapter.openFile(p));
    if (!file) {
      return { kind: 'absent' };
    }
    return {
      kind: 'present',
      lastModified: file.lastModified,
      content: file.content,
    };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}

function formatDiskSnapshot(snapshot: DiskSnapshot): string {
  switch (snapshot.kind) {
    case 'absent':
      return '<absent>';
    case 'error':
      return `<error: ${snapshot.message}>`;
    case 'present':
      return `lastModified=${snapshot.lastModified} content=${JSON.stringify(snapshot.content)}`;
  }
}

// Read the raw rows for a URL from boxel_index + boxel_index_working,
// plus realm_versions, so we can tell whether a stale GET is the index
// being out of date or the GET path picking up the wrong row.
async function readIndexSnapshot(
  dbAdapter: PgAdapter,
  realmHref: string,
  cardURL: string,
  fileURL: string,
): Promise<{
  realmVersion: unknown;
  stable: unknown[];
  working: unknown[];
}> {
  let [versionRow] = (await dbAdapter.execute(
    `SELECT current_version FROM realm_versions WHERE realm_url = $1`,
    { bind: [realmHref] },
  )) as { current_version: number }[];

  let stable = (await dbAdapter.execute(
    `SELECT url, file_alias, type, realm_version, is_deleted,
            pristine_doc, last_modified
       FROM boxel_index
      WHERE realm_url = $1 AND (url = $2 OR url = $3 OR file_alias = $2 OR file_alias = $3)`,
    { bind: [realmHref, cardURL, fileURL] },
  )) as unknown[];

  let working = (await dbAdapter.execute(
    `SELECT url, file_alias, type, realm_version, is_deleted,
            pristine_doc, last_modified
       FROM boxel_index_working
      WHERE realm_url = $1 AND (url = $2 OR url = $3 OR file_alias = $2 OR file_alias = $3)`,
    { bind: [realmHref, cardURL, fileURL] },
  )) as unknown[];

  return {
    realmVersion: versionRow?.current_version ?? null,
    stable,
    working,
  };
}

module(basename(__filename), function () {
  module(
    'Realm-specific Endpoints: can make request to post /_atomic',
    function () {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealmHref = realmURL.href;
      let testRealm: Realm;
      let testRealmAdapter: RealmAdapter;
      let dbAdapter: PgAdapter;
      let request: RealmRequest;

      function onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        testRealmAdapter: RealmAdapter;
        dbAdapter: PgAdapter;
        request: SuperTest<Test>;
        dir: DirResult;
      }) {
        testRealm = args.testRealm;
        testRealmAdapter = args.testRealmAdapter;
        dbAdapter = args.dbAdapter;
        request = withRealmPath(args.request, realmURL);
      }

      module('writes', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          permissions: {
            '*': ['read', 'write'],
          },
          realmURL,
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
                href: 'place-modules/place.gts',
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
                href: 'place-modules/place1.gts',
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
                href: 'place-modules/place2.gts',
                data: {
                  type: 'source',
                  attributes: {
                    content: place2Source,
                  },
                },
              },
              {
                op: 'add',
                href: 'country.gts',
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
                href: 'new-person-1.json',
                data: {
                  type: 'card',
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
                href: 'new-person-1.json',
                data: {
                  type: 'card',
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
              },
              {
                op: 'add',
                href: 'new-person-2.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Van Gogh',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './person',
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
                href: 'place-modules/place1.gts',
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
                href: 'place-modules/place2.gts',
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
                href: 'place.gts',
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
                href: 'country.gts',
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
                href: 'malaysia.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Malaysia',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './country',
                      name: 'Country',
                    },
                  },
                },
              },
              {
                op: 'add',
                href: 'menara-kuala-lumpur.json',
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
                      module: './place',
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
                href: 'place-modules/place.gts',
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
                href: 'place.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Kuala Lumpur',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './place-modules/place.gts',
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

        test('can write new instance with new module when instance comes first in the batch', async function (assert) {
          // Regression test: the atomic batch loop iterates files in
          // map order. If the instance comes before the module its
          // adoptsFrom points at, fileSerialization would (without the
          // module-first sort and the pre-serialization index flush)
          // try to resolve the module from the modules cache before
          // it's been indexed, throwing FilterRefersToNonexistentTypeError
          // and rolling back the whole batch.
          //
          // Reorder is safe because the operations are atomic — the
          // realm is free to write them in any order so long as the
          // observable result is "all or nothing".
          let source = `
            import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            export class Town extends CardDef {
              static displayName = 'Town';
              @field name = contains(StringField);
            }
            `.trim();
          let doc = {
            'atomic:operations': [
              // Instance listed FIRST — module SECOND.
              {
                op: 'add',
                href: 'town.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Petaling Jaya',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './town-modules/town.gts',
                      name: 'Town',
                    },
                  },
                },
              },
              {
                op: 'add',
                href: 'town-modules/town.gts',
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

          assert.strictEqual(
            response.status,
            201,
            `expected 201, got ${response.status}: ${JSON.stringify(response.body)}`,
          );
          assert.strictEqual(response.body['atomic:results'].length, 2);
          let cardResponse = await request
            .get('/town')
            .set('Accept', SupportedMimeType.CardJson);
          let json = cardResponse.body as LooseSingleCardDocument;
          assert.strictEqual(json.data.attributes?.name, 'Petaling Jaya');
          let sourceResponse = await request
            .get('/town-modules/town.gts')
            .set('Accept', SupportedMimeType.CardSource);
          assert.strictEqual(
            sourceResponse.text.trim(),
            source,
            'the card source is correct',
          );
        });

        test('update is a no-op when content is unchanged', async function (assert) {
          let source = `
              import { field, CardDef, contains } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Place extends CardDef {
                static displayName = 'Place';
                @field name = contains(StringField);
              }
              `.trim();
          let addDoc = {
            'atomic:operations': [
              {
                op: 'add',
                href: 'place-modules/place-noop.gts',
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

          let addResponse = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(addDoc));

          assert.strictEqual(addResponse.status, 201, 'initial write succeeds');
          assert.strictEqual(
            addResponse.body['atomic:results'].length,
            1,
            'initial write returns one result',
          );

          let initialLastModified = await testRealmAdapter.lastModified(
            'place-modules/place-noop.gts',
          );

          let writeCalls = 0;
          let originalWrite = testRealmAdapter.write.bind(testRealmAdapter);
          testRealmAdapter.write = (async (path, contents) => {
            writeCalls++;
            return originalWrite(path, contents);
          }) as RealmAdapter['write'];

          try {
            let updateDoc = {
              'atomic:operations': [
                {
                  op: 'update',
                  href: 'place-modules/place-noop.gts',
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

            let updateResponse = await request
              .post('/_atomic')
              .set('Accept', SupportedMimeType.JSONAPI)
              .set(
                'Authorization',
                `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
              )
              .send(JSON.stringify(updateDoc));

            assert.strictEqual(
              updateResponse.status,
              201,
              'atomic update returns created status even when no writes occur',
            );
            assert.strictEqual(
              updateResponse.body['atomic:results'].length,
              1,
              'one result entry is returned even when no writes occur',
            );
            assert.strictEqual(
              writeCalls,
              0,
              'adapter.write not invoked for identical content',
            );
            assert.strictEqual(
              await testRealmAdapter.lastModified(
                'place-modules/place-noop.gts',
              ),
              initialLastModified,
              'lastModified unchanged when content is identical',
            );
          } finally {
            testRealmAdapter.write = originalWrite;
          }
        });
      });
      module('error handling', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          permissions: {
            '*': ['read', 'write'],
          },
          realmURL,
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
                href: 'person.gts',
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
            `Resource person.gts already exists`,
          );
        });
        test('returns error when failing to serialize a card resource', async function (assert) {
          let doc = {
            'atomic:operations': [
              {
                op: 'add',
                href: 'place.json',
                data: {
                  type: 'card',
                  attributes: {
                    name: 'Kuala Lumpur',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './missing-place/does-not-exist',
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
          assert.ok(
            response.body.errors[0].detail.includes(
              `Your filter refers to a nonexistent type: import { Place } from "${testRealmHref}missing-place/does-not-exist"`,
            ),
            'error message is correct',
          );
        });

        test('can update an existing instance', async function (assert) {
          let addDoc = {
            'atomic:operations': [
              {
                op: 'add',
                href: 'update-person.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Initial',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './person',
                      name: 'Person',
                    },
                  },
                },
              },
            ],
          };

          let addResponse = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`,
            )
            .send(JSON.stringify(addDoc))
            .expect(201);

          // Snapshot the on-disk serialized form right after the add so
          // the timeout message can show whether the update actually
          // changed the file or not.
          let postAddDisk = await readDiskSnapshot(
            testRealmAdapter,
            'update-person.json',
          );

          let updateDoc = {
            'atomic:operations': [
              {
                op: 'update',
                href: 'update-person.json',
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Updated',
                  },
                  meta: {
                    adoptsFrom: {
                      module: './person',
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
            .send(JSON.stringify(updateDoc));

          assert.strictEqual(response.status, 201);
          assert.strictEqual(response.body['atomic:results'].length, 1);

          // Snapshot the on-disk serialized form right after the update.
          // Together with postAddDisk this distinguishes "write was
          // skipped (content-equality false positive)" from "write
          // happened but reindex didn't pick it up".
          let postUpdateDisk = await readDiskSnapshot(
            testRealmAdapter,
            'update-person.json',
          );
          // Snapshot boxel_index/boxel_index_working too. With the disk
          // diagnostic from #4530 we know the file write lands; if the
          // index rows here have firstName="Initial" it's an indexer/
          // promotion bug, if they have "Updated" it's a GET-path bug.
          let postUpdateIndex = await readIndexSnapshot(
            dbAdapter,
            testRealmHref,
            `${testRealmHref}update-person`,
            `${testRealmHref}update-person.json`,
          );

          // The atomic POST awaits indexing, so by 201 boxel_index should
          // be updated. Poll up to 30s in case CI load delays read-path
          // readiness; the diagnostics above are captured pre-poll so
          // the timeout message reflects the immediate post-201 state.
          let updatedCard: LooseSingleCardDocument | undefined;
          let lastStatus: number | undefined;
          await waitUntil(
            async () => {
              let updatedCardResponse = await request
                .get('/update-person')
                .set('Accept', SupportedMimeType.CardJson);
              lastStatus = updatedCardResponse.status;
              updatedCard = updatedCardResponse.body as
                | LooseSingleCardDocument
                | undefined;
              return updatedCard?.data?.attributes?.firstName === 'Updated';
            },
            {
              timeout: 30_000,
              interval: 100,
              timeoutMessage: () =>
                [
                  'updated firstName was not visible via /update-person',
                  `last GET status=${lastStatus}`,
                  `last firstName=${JSON.stringify(updatedCard?.data?.attributes?.firstName)}`,
                  `add 201 body=${JSON.stringify(addResponse.body)}`,
                  `update 201 body=${JSON.stringify(response.body)}`,
                  `disk after add=${formatDiskSnapshot(postAddDisk)}`,
                  `disk after update=${formatDiskSnapshot(postUpdateDisk)}`,
                  `index after update=${JSON.stringify(postUpdateIndex)}`,
                ].join(' | '),
            },
          );
          assert.strictEqual(
            updatedCard?.data.attributes?.firstName,
            'Updated',
          );
        });
      });
      module('validation', function (hooks) {
        setupPermissionedRealmCached(hooks, {
          fixture: 'simple',
          permissions: {
            '*': ['read', 'write'],
          },
          realmURL,
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
            `You tried to use an unsupported operation type: 'delete'. Only 'add' and 'update' operations are currently supported`,
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
                { op: 'add', href: 'file.json', data: { type: 'file' } },
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

        test('rejects update when resource does not exist', async function (assert) {
          let response = await request
            .post('/_atomic')
            .set('Accept', SupportedMimeType.JSONAPI)
            .send({
              'atomic:operations': [
                {
                  op: 'update',
                  href: 'missing.json',
                  data: { type: 'card' },
                },
              ],
            })
            .expect(404);

          assert.strictEqual(response.body.errors.length, 1);
          let error = response.body.errors[0];
          assert.strictEqual(error.title, 'Resource does not exist');
          assert.strictEqual(error.status, 404);
          assert.strictEqual(
            error.detail,
            'Resource missing.json does not exist',
          );
        });
      });
    },
  );
});
