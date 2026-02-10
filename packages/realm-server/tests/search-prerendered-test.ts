import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealm, createJWT } from './helpers';
import { PRERENDERED_HTML_FORMATS } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

const missingPrerenderedHtmlFormatMessage = `Must include a 'prerenderedHtmlFormat' parameter with a value of ${PRERENDERED_HTML_FORMATS.join()} to use this endpoint`;

module(basename(__filename), function () {
  module('Realm-specific Endpoints | _search-prerendered', function () {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let searchPath: string;
    let realmHref: string;
    let realmURL = new URL('http://127.0.0.1:4444/test/');

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      let realmURLFromTest = new URL(testRealm.url);
      realmHref = realmURLFromTest.href;
      searchPath = `${realmURLFromTest.pathname.replace(/\/$/, '')}/_search-prerendered`;
    }

    module('QUERY request (formerly GET)', function (_hooks) {
      module(
        'instances with no embedded template css of its own',
        function (hooks) {
          setupPermissionedRealm(hooks, {
            realmURL,
            permissions: {
              '*': ['read'],
            },
            fileSystem: {
              'person.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";

              export class Person extends CardDef {
                @field firstName = contains(StringField);
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
            onRealmSetup,
          });

          test('endpoint will respond with a bad request if html format is not provided', async function (assert) {
            let response = await request
              .post(searchPath)
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send({});

            assert.strictEqual(response.status, 400, 'HTTP 200 status');

            assert.ok(
              response.body.errors[0].message.includes(
                missingPrerenderedHtmlFormatMessage,
              ),
            );
          });

          test('returns prerendered instances', async function (assert) {
            let query: Query & { prerenderedHtmlFormat: string } = {
              filter: {
                on: {
                  module: `${realmHref}person`,
                  name: 'Person',
                },
                eq: {
                  firstName: 'John',
                },
              },
              prerenderedHtmlFormat: 'embedded',
            };
            let response = await request
              .post(searchPath)
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send(query);

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              realmHref,
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
        setupPermissionedRealm(hooks, {
          realmURL,
          permissions: {
            '*': ['read'],
          },
          fileSystem: {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
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
          import StringField from "https://cardstack.com/base/string";

          export class FancyPerson extends Person {
            @field favoriteColor = contains(StringField);

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
                  cardTitle: 'Person Aaron',
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
                  cardTitle: 'Person Craig',
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
                  cardTitle: 'FancyPerson Jane',
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
                  cardTitle: 'FancyPerson Jimmy',
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
          onRealmSetup,
        });

        test('returns instances with CardDef prerendered embedded html + css when there is no "on" filter', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              prerenderedHtmlFormat: 'embedded',
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            realmHref,
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
                module: `${realmHref}fancy-person`,
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
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

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
            ...[`${realmHref}fancy-person.gts`, `${realmHref}person.gts`],
          ]);
        });

        test('can filter prerendered instances', async function (assert) {
          let query: Query & { prerenderedHtmlFormat: string } = {
            filter: {
              on: {
                module: `${realmHref}person`,
                name: 'Person',
              },
              eq: {
                firstName: 'Jimmy',
              },
            },
            prerenderedHtmlFormat: 'embedded',
          };
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            1,
            'one prerendered card instance is returned in the filtered search results',
          );
          assert.strictEqual(json.data[0].id, `${realmHref}jimmy.json`);
        });

        test('can use cardUrls to filter prerendered instances', async function (assert) {
          let query: Query & {
            prerenderedHtmlFormat: string;
            cardUrls: string[];
          } = {
            prerenderedHtmlFormat: 'embedded',
            cardUrls: [`${realmHref}jimmy.json`],
          };
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            1,
            'one prerendered card instance is returned in the filtered search results',
          );
          assert.strictEqual(json.data[0].id, `${realmHref}jimmy.json`);

          query = {
            prerenderedHtmlFormat: 'embedded',
            cardUrls: [`${realmHref}jimmy.json`, `${realmHref}jane.json`],
          };
          response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            '2 prerendered card instances are returned in the filtered search results',
          );
          assert.strictEqual(json.data[0].id, `${realmHref}jane.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}jimmy.json`);
        });

        test('can sort prerendered instances', async function (assert) {
          let query: Query & { prerenderedHtmlFormat: string } = {
            sort: [
              {
                by: 'firstName',
                on: { module: `${realmHref}person`, name: 'Person' },
                direction: 'desc',
              },
            ],
            prerenderedHtmlFormat: 'embedded',
          };
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(json.data.length, 4, 'results count is correct');

          // firstName descending
          assert.strictEqual(json.data[0].id, `${realmHref}jimmy.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}jane.json`);
          assert.strictEqual(json.data[2].id, `${realmHref}craig.json`);
          assert.strictEqual(json.data[3].id, `${realmHref}aaron.json`);
        });

        test('can paginate prerendered instances', async function (assert) {
          // First page with size 2
          let query: Query & { prerenderedHtmlFormat: string } = {
            page: {
              number: 0,
              size: 2,
            },
            sort: [
              {
                by: 'firstName',
                on: { module: `${realmHref}person`, name: 'Person' },
                direction: 'asc',
              },
            ],
            prerenderedHtmlFormat: 'embedded',
          };

          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(json.data.length, 2, 'first page has 2 results');
          assert.strictEqual(json.meta.page.total, 4, 'total count is correct');
          assert.strictEqual(json.data[0].id, `${realmHref}aaron.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}craig.json`);

          // Second page
          query.page = { number: 1, size: 2 };
          response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          json = response.body;

          assert.strictEqual(json.data.length, 2, 'second page has 2 results');
          assert.strictEqual(json.meta.page.total, 4, 'total count is correct');
          assert.strictEqual(json.data[0].id, `${realmHref}jane.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}jimmy.json`);
        });
      });
    });

    module('QUERY request', function (_hooks) {
      module(
        'instances with no embedded template css of its own',
        function (hooks) {
          setupPermissionedRealm(hooks, {
            realmURL,
            permissions: {
              '*': ['read'],
            },
            fileSystem: {
              'person.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";

              export class Person extends CardDef {
                @field firstName = contains(StringField);
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
            onRealmSetup,
          });

          test('endpoint will respond with a bad request if html format is not provided', async function (assert) {
            let response = await request
              .post(searchPath)
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send({});

            assert.strictEqual(response.status, 400, 'HTTP 400 status');
            assert.ok(
              response.body.errors[0].message.includes(
                missingPrerenderedHtmlFormatMessage,
              ),
            );
          });

          test('returns prerendered instances', async function (assert) {
            let query: Query & { prerenderedHtmlFormat: string } = {
              filter: {
                on: {
                  module: `${realmHref}person`,
                  name: 'Person',
                },
                eq: {
                  firstName: 'John',
                },
              },
              prerenderedHtmlFormat: 'embedded',
            };

            let response = await request
              .post(searchPath)
              .set('Accept', 'application/vnd.card+json')
              .set('X-HTTP-Method-Override', 'QUERY')
              .send(query);

            assert.strictEqual(response.status, 200, 'HTTP 200 status');
            assert.strictEqual(
              response.get('X-boxel-realm-url'),
              realmHref,
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
        setupPermissionedRealm(hooks, {
          realmURL,
          permissions: {
            '*': ['read'],
          },
          fileSystem: {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
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
          import StringField from "https://cardstack.com/base/string";

          export class FancyPerson extends Person {
            @field favoriteColor = contains(StringField);

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
                  cardTitle: 'Person Aaron',
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
                  cardTitle: 'Person Craig',
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
                  cardTitle: 'FancyPerson Jane',
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
                  cardTitle: 'FancyPerson Jimmy',
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
          onRealmSetup,
        });

        test('returns instances with CardDef prerendered embedded html + css using QUERY method', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({
              prerenderedHtmlFormat: 'embedded',
            });

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            response.get('X-boxel-realm-url'),
            realmHref,
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
            cardUrls: [`${realmHref}jimmy.json`, `${realmHref}jane.json`],
          };

          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(
            json.data.length,
            2,
            '2 prerendered card instances are returned in the filtered search results',
          );
          assert.strictEqual(json.data[0].id, `${realmHref}jane.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}jimmy.json`);
        });

        test('can filter prerendered instances with complex query in request body', async function (assert) {
          let complexQuery = {
            filter: {
              on: {
                module: `${realmHref}fancy-person`,
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
            .post(searchPath)
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
            ...[`${realmHref}fancy-person.gts`, `${realmHref}person.gts`],
          ]);
        });

        test('gets no results when asking for a type that the realm does not have knowledge of', async function (assert) {
          let complexQuery = {
            filter: {
              on: {
                module: `http://some-realm-server/some-realm/some-card`,
                name: 'SomeCard',
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
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(complexQuery);

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;

          assert.strictEqual(
            json.data.length,
            0,
            'returned results count is correct',
          );
        });

        test('can sort prerendered instances using QUERY method', async function (assert) {
          let query = {
            sort: [
              {
                by: 'firstName',
                on: { module: `${realmHref}person`, name: 'Person' },
                direction: 'desc',
              },
            ],
            prerenderedHtmlFormat: 'embedded',
          };

          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send(query);

          let json = response.body;

          assert.strictEqual(json.data.length, 4, 'results count is correct');

          // firstName descending
          assert.strictEqual(json.data[0].id, `${realmHref}jimmy.json`);
          assert.strictEqual(json.data[1].id, `${realmHref}jane.json`);
          assert.strictEqual(json.data[2].id, `${realmHref}craig.json`);
          assert.strictEqual(json.data[3].id, `${realmHref}aaron.json`);
        });
      });

      module('permissioned realm', function (hooks) {
        setupPermissionedRealm(hooks, {
          realmURL,
          permissions: {
            john: ['read'],
            '@node-test_realm:localhost': ['read'],
          },
          fileSystem: {
            'person.gts': `
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
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
          onRealmSetup,
        });

        test('401 with invalid JWT', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer invalid-token`)
            .send({ prerenderedHtmlFormat: 'embedded' });

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('401 without a JWT', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .send({ prerenderedHtmlFormat: 'embedded' }); // no Authorization header

          assert.strictEqual(response.status, 401, 'HTTP 401 status');
        });

        test('403 without permission', async function (assert) {
          let response = await request
            .post(searchPath)
            .set('Accept', 'application/vnd.card+json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`)
            .send({ prerenderedHtmlFormat: 'embedded' });

          assert.strictEqual(response.status, 403, 'HTTP 403 status');
        });

        test('200 with permission', async function (assert) {
          let response = await request
            .post(searchPath)
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
          realmURL,
          permissions: {
            '*': ['read'],
          },
          onRealmSetup,
        });

        test('400 with invalid query schema', async function (assert) {
          let response = await request
            .post(searchPath)
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
            .post(searchPath)
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
