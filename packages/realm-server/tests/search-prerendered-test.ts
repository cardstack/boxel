import { module, test } from 'qunit';
import supertest, { Test, SuperTest } from 'supertest';
import { join, resolve, basename } from 'path';
import { Server } from 'http';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import {
  baseRealm,
  Realm,
  RealmPermissions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { stringify } from 'qs';
import { Query } from '@cardstack/runtime-common/query';
import {
  setupCardLogs,
  setupBaseRealmServer,
  runTestRealmServer,
  setupDB,
  createVirtualNetwork,
  createVirtualNetworkAndLoader,
  matrixURL,
  closeServer,
} from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';

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
  module('Realm-specific Endpoints | _search-prerendered', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;

    function setupPermissionedRealm(
      hooks: NestedHooks,
      permissions: RealmPermissions,
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

    module('GET request', function (_hooks) {
      module(
        'instances with no embedded template css of its own',
        function (hooks) {
          setupPermissionedRealm(
            hooks,
            {
              '*': ['read'],
            },
            {
              'person.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringCard from "https://cardstack.com/base/string";

              export class Person extends CardDef {
                @field firstName = contains(StringCard);
                static isolated = class Isolated extends Component<typeof this> {
                  <template>
                    <h1><@fields.firstName/></h1>
                  </template>
                }
                static embedded = class Embedded extends Component<typeof this> {
                  <template>
                    Embedded Card Person: <@fields.firstName/>
                  </template>
                }
                static fitted = class Fitted extends Component<typeof this> {
                  <template>
                    Fitted Card Person: <@fields.firstName/>
                  </template>
                }
              }
            `,
              'john.json': {
                data: {
                  attributes: {
                    firstName: 'John',
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
          );

          test('endpoint will respond with a bad request if html format is not provided', async function (assert) {
            let response = await request
              .get(`/_search-prerendered`)
              .set('Accept', 'application/vnd.card+json');

            assert.strictEqual(response.status, 400, 'HTTP 200 status');

            assert.ok(
              response.body.errors[0].message.includes(
                "Must include a 'prerenderedHtmlFormat' parameter with a value of 'embedded' or 'atom' to use this endpoint",
              ),
            );
          });

          test('returns prerendered instances', async function (assert) {
            let query: Query & { prerenderedHtmlFormat: string } = {
              filter: {
                on: {
                  module: `${testRealmHref}person`,
                  name: 'Person',
                },
                eq: {
                  firstName: 'John',
                },
              },
              prerenderedHtmlFormat: 'embedded',
            };
            let response = await request
              .get(`/_search-prerendered?${stringify(query)}`)
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

            assert.strictEqual(
              json.data.length,
              1,
              'one card instance is returned in the search results',
            );

            assert.strictEqual(json.data[0].type, 'prerendered-card');

            assert.true(
              json.data[0].attributes.html
                .replace(/\s+/g, ' ')
                .includes('Embedded Card Person: John'),
              'embedded html looks correct',
            );

            assertScopedCssUrlsContain(
              assert,
              json.meta.scopedCssUrls,
              cardDefModuleDependencies,
            );

            assert.strictEqual(
              json.meta.page.total,
              1,
              'total count is correct',
            );
          });
        },
      );

      module('instances whose embedded template has css', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read'],
          },
          {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <h1><@fields.firstName/></h1>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>

                <style scoped>
                  .border {
                    border: 1px solid red;
                  }
                </style>
              </template>
            }
          }
        `,
            'fancy-person.gts': `
          import { Person } from './person';
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class FancyPerson extends Person {
            @field favoriteColor = contains(StringCard);

            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card FancyPerson: <@fields.firstName/>

                <style scoped>
                  .fancy-border {
                    border: 1px solid pink;
                  }
                </style>
              </template>
            }
          }
        `,
            'aaron.json': {
              data: {
                attributes: {
                  firstName: 'Aaron',
                  title: 'Person Aaron',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
            'craig.json': {
              data: {
                attributes: {
                  firstName: 'Craig',
                  title: 'Person Craig',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
            'jane.json': {
              data: {
                attributes: {
                  firstName: 'Jane',
                  favoriteColor: 'blue',
                  title: 'FancyPerson Jane',
                },
                meta: {
                  adoptsFrom: {
                    module: './fancy-person',
                    name: 'FancyPerson',
                  },
                },
              },
            },
            'jimmy.json': {
              data: {
                attributes: {
                  firstName: 'Jimmy',
                  favoriteColor: 'black',
                  title: 'FancyPerson Jimmy',
                },
                meta: {
                  adoptsFrom: {
                    module: './fancy-person',
                    name: 'FancyPerson',
                  },
                },
              },
            },
          },
        );

        test('returns instances with CardDef prerendered embedded html + css when there is no "on" filter', async function (assert) {
          let response = await request
            .get(`/_search-prerendered?prerenderedHtmlFormat=embedded`)
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

          assert.strictEqual(
            json.data.length,
            4,
            'returned results count is correct',
          );

          // 1st card: Person Aaron
          assert.strictEqual(json.data[0].type, 'prerendered-card');
          assert.true(
            json.data[0].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card Person: Aaron'),
            'embedded html looks correct (Person template)',
          );

          // 2nd card: Person Craig
          assert.strictEqual(json.data[1].type, 'prerendered-card');
          assert.true(
            json.data[1].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card Person: Craig'),
            'embedded html for Craig looks correct (Person template)',
          );

          // 3rd card: FancyPerson Jane
          assert.strictEqual(json.data[2].type, 'prerendered-card');
          assert.true(
            json.data[2].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jane'),
            'embedded html for Jane looks correct (FancyPerson template)',
          );

          // 4th card: FancyPerson Jimmy
          assert.strictEqual(json.data[3].type, 'prerendered-card');
          assert.true(
            json.data[3].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jimmy'),
            'embedded html for Jimmy looks correct (FancyPerson template)',
          );

          assertScopedCssUrlsContain(
            assert,
            json.meta.scopedCssUrls,
            cardDefModuleDependencies,
          );

          assert.strictEqual(json.meta.page.total, 4, 'total count is correct');
        });

        test('returns correct css in relationships, even the one indexed in another realm (CardDef)', async function (assert) {
          let query: Query & { prerenderedHtmlFormat: string } = {
            filter: {
              on: {
                module: `${testRealmHref}fancy-person`,
                name: 'FancyPerson',
              },
              not: {
                eq: {
                  firstName: 'Peter',
                },
              },
            },
            prerenderedHtmlFormat: 'embedded',
          };

          let response = await request
            .get(`/_search-prerendered?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            'returned results count is correct',
          );

          // 1st card: FancyPerson Jane
          assert.true(
            json.data[0].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jane'),
            'embedded html for Jane looks correct (FancyPerson template)',
          );

          //  2nd card: FancyPerson Jimmy
          assert.true(
            json.data[1].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jimmy'),
            'embedded html for Jimmy looks correct (FancyPerson template)',
          );

          assertScopedCssUrlsContain(assert, json.meta.scopedCssUrls, [
            ...cardDefModuleDependencies,
            ...[
              `${testRealmHref}fancy-person.gts`,
              `${testRealmHref}person.gts`,
            ],
          ]);
        });

        test('can filter prerendered instances', async function (assert) {
          let query: Query & { prerenderedHtmlFormat: string } = {
            filter: {
              on: {
                module: `${testRealmHref}person`,
                name: 'Person',
              },
              eq: {
                firstName: 'Jimmy',
              },
            },
            prerenderedHtmlFormat: 'embedded',
          };
          let response = await request
            .get(`/_search-prerendered?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            1,
            'one prerendered card instance is returned in the filtered search results',
          );
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jimmy.json',
          );
        });

        test('can use cardUrls to filter prerendered instances', async function (assert) {
          let query: Query & {
            prerenderedHtmlFormat: string;
            cardUrls: string[];
          } = {
            prerenderedHtmlFormat: 'embedded',
            cardUrls: [`${testRealmHref}jimmy.json`],
          };
          let response = await request
            .get(`/_search-prerendered?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            1,
            'one prerendered card instance is returned in the filtered search results',
          );
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jimmy.json',
          );

          query = {
            prerenderedHtmlFormat: 'embedded',
            cardUrls: [
              `${testRealmHref}jimmy.json`,
              `${testRealmHref}jane.json`,
            ],
          };
          response = await request
            .get(`/_search-prerendered?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            '2 prerendered card instances are returned in the filtered search results',
          );
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jane.json',
          );
          assert.strictEqual(
            json.data[1].id,
            'http://127.0.0.1:4444/jimmy.json',
          );
        });

        test('can sort prerendered instances', async function (assert) {
          let query: Query & { prerenderedHtmlFormat: string } = {
            sort: [
              {
                by: 'firstName',
                on: { module: `${testRealmHref}person`, name: 'Person' },
                direction: 'desc',
              },
            ],
            prerenderedHtmlFormat: 'embedded',
          };
          let response = await request
            .get(`/_search-prerendered?${stringify(query)}`)
            .set('Accept', 'application/vnd.card+json');

          let json = response.body;

          assert.strictEqual(json.data.length, 4, 'results count is correct');

          // firstName descending
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jimmy.json',
          );
          assert.strictEqual(
            json.data[1].id,
            'http://127.0.0.1:4444/jane.json',
          );
          assert.strictEqual(
            json.data[2].id,
            'http://127.0.0.1:4444/craig.json',
          );
          assert.strictEqual(
            json.data[3].id,
            'http://127.0.0.1:4444/aaron.json',
          );
        });
      });
    });

    module('QUERY request', function (_hooks) {
      module(
        'instances with no embedded template css of its own',
        function (hooks) {
          setupPermissionedRealm(
            hooks,
            {
              '*': ['read'],
            },
            {
              'person.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringCard from "https://cardstack.com/base/string";

              export class Person extends CardDef {
                @field firstName = contains(StringCard);
                static isolated = class Isolated extends Component<typeof this> {
                  <template>
                    <h1><@fields.firstName/></h1>
                  </template>
                }
                static embedded = class Embedded extends Component<typeof this> {
                  <template>
                    Embedded Card Person: <@fields.firstName/>
                  </template>
                }
                static fitted = class Fitted extends Component<typeof this> {
                  <template>
                    Fitted Card Person: <@fields.firstName/>
                  </template>
                }
              }
            `,
              'john.json': {
                data: {
                  attributes: {
                    firstName: 'John',
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
          );

          test('endpoint will respond with a bad request if html format is not provided', async function (assert) {
            let response = await request
              .post('/_search-prerendered')
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send({});

            assert.strictEqual(response.status, 400, 'HTTP 400 status');
            assert.ok(
              response.body.errors[0].message.includes(
                "Must include a 'prerenderedHtmlFormat' parameter with a value of 'embedded' or 'atom' to use this endpoint",
              ),
            );
          });

          test('returns prerendered instances', async function (assert) {
            let query: Query & { prerenderedHtmlFormat: string } = {
              filter: {
                on: {
                  module: `${testRealmHref}person`,
                  name: 'Person',
                },
                eq: {
                  firstName: 'John',
                },
              },
              prerenderedHtmlFormat: 'embedded',
            };

            let response = await request
              .post('/_search-prerendered')
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send(query);

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

            assert.strictEqual(
              json.data.length,
              1,
              'one card instance is returned in the search results',
            );

            assert.strictEqual(json.data[0].type, 'prerendered-card');

            assert.true(
              json.data[0].attributes.html
                .replace(/\s+/g, ' ')
                .includes('Embedded Card Person: John'),
              'embedded html looks correct',
            );

            assertScopedCssUrlsContain(
              assert,
              json.meta.scopedCssUrls,
              cardDefModuleDependencies,
            );

            assert.strictEqual(
              json.meta.page.total,
              1,
              'total count is correct',
            );
          });
        },
      );

      module('instances whose embedded template has css', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            '*': ['read'],
          },
          {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <h1><@fields.firstName/></h1>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>

                <style scoped>
                  .border {
                    border: 1px solid red;
                  }
                </style>
              </template>
            }
          }
        `,
            'fancy-person.gts': `
          import { Person } from './person';
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class FancyPerson extends Person {
            @field favoriteColor = contains(StringCard);

            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card FancyPerson: <@fields.firstName/>

                <style scoped>
                  .fancy-border {
                    border: 1px solid pink;
                  }
                </style>
              </template>
            }
          }
        `,
            'aaron.json': {
              data: {
                attributes: {
                  firstName: 'Aaron',
                  title: 'Person Aaron',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
            'craig.json': {
              data: {
                attributes: {
                  firstName: 'Craig',
                  title: 'Person Craig',
                },
                meta: {
                  adoptsFrom: {
                    module: './person',
                    name: 'Person',
                  },
                },
              },
            },
            'jane.json': {
              data: {
                attributes: {
                  firstName: 'Jane',
                  favoriteColor: 'blue',
                  title: 'FancyPerson Jane',
                },
                meta: {
                  adoptsFrom: {
                    module: './fancy-person',
                    name: 'FancyPerson',
                  },
                },
              },
            },
            'jimmy.json': {
              data: {
                attributes: {
                  firstName: 'Jimmy',
                  favoriteColor: 'black',
                  title: 'FancyPerson Jimmy',
                },
                meta: {
                  adoptsFrom: {
                    module: './fancy-person',
                    name: 'FancyPerson',
                  },
                },
              },
            },
          },
        );

        test('returns instances with CardDef prerendered embedded html + css using QUERY method', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              prerenderedHtmlFormat: 'embedded',
            });

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

          assert.strictEqual(
            json.data.length,
            4,
            'returned results count is correct',
          );

          // 1st card: Person Aaron
          assert.strictEqual(json.data[0].type, 'prerendered-card');
          assert.true(
            json.data[0].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card Person: Aaron'),
            'embedded html looks correct (Person template)',
          );

          // 4th card: FancyPerson Jimmy
          assert.strictEqual(json.data[3].type, 'prerendered-card');
          assert.true(
            json.data[3].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jimmy'),
            'embedded html for Jimmy looks correct (FancyPerson template)',
          );

          assertScopedCssUrlsContain(
            assert,
            json.meta.scopedCssUrls,
            cardDefModuleDependencies,
          );

          assert.strictEqual(json.meta.page.total, 4, 'total count is correct');
        });

        test('can use cardUrls to filter prerendered instances using QUERY method', async function (assert) {
          let query: Query & {
            prerenderedHtmlFormat: string;
            cardUrls: string[];
          } = {
            prerenderedHtmlFormat: 'embedded',
            cardUrls: [
              `${testRealmHref}jimmy.json`,
              `${testRealmHref}jane.json`,
            ],
          };

          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            '2 prerendered card instances are returned in the filtered search results',
          );
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jane.json',
          );
          assert.strictEqual(
            json.data[1].id,
            'http://127.0.0.1:4444/jimmy.json',
          );
        });

        test('can filter prerendered instances with complex query in request body', async function (assert) {
          let complexQuery = {
            filter: {
              on: {
                module: `${testRealmHref}fancy-person`,
                name: 'FancyPerson',
              },
              not: {
                eq: {
                  firstName: 'Peter',
                },
              },
            },
            prerenderedHtmlFormat: 'embedded',
          };

          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(complexQuery);

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            'returned results count is correct',
          );

          // 1st card: FancyPerson Jane
          assert.true(
            json.data[0].attributes.html
              .replace(/\s+/g, ' ')
              .includes('Embedded Card FancyPerson: Jane'),
            'embedded html for Jane looks correct (FancyPerson template)',
          );

          assertScopedCssUrlsContain(assert, json.meta.scopedCssUrls, [
            ...cardDefModuleDependencies,
            ...[
              `${testRealmHref}fancy-person.gts`,
              `${testRealmHref}person.gts`,
            ],
          ]);
        });

        test('can sort prerendered instances using QUERY method', async function (assert) {
          let query = {
            sort: [
              {
                by: 'firstName',
                on: { module: `${testRealmHref}person`, name: 'Person' },
                direction: 'desc',
              },
            ],
            prerenderedHtmlFormat: 'embedded',
          };

          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(json.data.length, 4, 'results count is correct');

          // firstName descending
          assert.strictEqual(
            json.data[0].id,
            'http://127.0.0.1:4444/jimmy.json',
          );
          assert.strictEqual(
            json.data[1].id,
            'http://127.0.0.1:4444/jane.json',
          );
          assert.strictEqual(
            json.data[2].id,
            'http://127.0.0.1:4444/craig.json',
          );
          assert.strictEqual(
            json.data[3].id,
            'http://127.0.0.1:4444/aaron.json',
          );
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(
          hooks,
          {
            john: ['read'],
          },
          {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringCard from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringCard);
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>
              </template>
            }
          }
        `,
            'john.json': {
              data: {
                attributes: {
                  firstName: 'John',
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
        );

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer invalid-token`)
            .send({ prerenderedHtmlFormat: 'embedded' });

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({ prerenderedHtmlFormat: 'embedded' }); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`)
            .send({ prerenderedHtmlFormat: 'embedded' });

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
            )
            .send({ prerenderedHtmlFormat: 'embedded' });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
        });
      });

      module('search query validation', function (hooks) {
        setupPermissionedRealm(hooks, {
          '*': ['read'],
        });

        test('400 with invalid query schema', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              invalid: 'query structure',
              prerenderedHtmlFormat: 'embedded',
            });

          assert.strictEqual(response.status, 400, 'HTTP 400 status');
          assert.ok(
            response.body.errors[0].message.includes('Invalid query'),
            'Error message indicates invalid query',
          );
        });

        test('400 with invalid filter logic', async function (assert) {
          let response = await request
            .post('/_search-prerendered')
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              filter: {
                badOperator: { firstName: 'Mango' },
              },
              prerenderedHtmlFormat: 'embedded',
            });

          assert.strictEqual(response.status, 400, 'HTTP 400 status');
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
