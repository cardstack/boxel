import { module, test } from 'qunit';
import { dirSync } from 'tmp';
import type {
  DBAdapter,
  LooseSingleCardDocument,
  Realm,
  RealmPermissions,
  RealmAdapter,
} from '@cardstack/runtime-common';
import type {
  IndexedInstance,
  QueuePublisher,
  QueueRunner,
} from '@cardstack/runtime-common';
import {
  setupBaseRealmServer,
  setupDB,
  createVirtualNetwork,
  matrixURL,
  cleanWhiteSpace,
  runTestRealmServer,
  closeServer,
  setupPermissionedRealms,
  cardInfo,
} from './helpers';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { join, basename } from 'path';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms';
import type {
  PgQueueRunner,
  PgAdapter,
  PgQueuePublisher,
} from '@cardstack/postgres';

function trimCardContainer(text: string) {
  return cleanWhiteSpace(text)
    .replace(/=""/g, '')
    .replace(
      /<div .*? data-test-field-component-card>\s?[<!---->]*? (.*?) <\/div>/g,
      '$1',
    );
}

let testDbAdapter: DBAdapter;
const testRealm = new URL('http://127.0.0.1:4445/test/');

type TestRealmServerResult = Awaited<ReturnType<typeof runTestRealmServer>>;

function makeTestRealmFileSystem(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'person.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import NumberField from "https://cardstack.com/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1> Embedded Card Person: <@fields.firstName/></h1>

            <style scoped>
              h1 { color: red }
            </style>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1> Fitted Card Person: <@fields.firstName/></h1>

            <style scoped>
              h1 { color: red }
            </style>
          </template>
        }
      }
    `,
    'pet-person.gts': `
      import { contains, linksTo, field, CardDef, Component, StringField } from "https://cardstack.com/base/card-api";
      import { Pet } from "./pet";

      export class PetPerson extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(() => Pet);
        @field nickName = contains(StringField, {
          computeVia: function (this: Person) {
            if (this.pet?.firstName) {
              return this.pet.firstName + "'s buddy";
            }
            return 'buddy';
          },
        });
      }
    `,
    'pet.gts': `
      import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
    `,
    'fancy-person.gts': `
      import { contains, field, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class FancyPerson extends Person {
        @field favoriteColor = contains(StringField);

        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1> Embedded Card Fancy Person: <@fields.firstName/></h1>

            <style scoped>
              h1 { color: pink }
            </style>
          </template>
        }
      }
    `,
    'post.gts': `
      import { contains, field, linksTo, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class Post extends CardDef {
        static displayName = 'Post';
        @field author = linksTo(Person);
        @field message = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.message/></h1>
            <h2><@fields.author/></h2>
          </template>
        }
      }
    `,
    'boom.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Boom extends CardDef {
        @field firstName = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName/>{{this.boom}}</h1>
          </template>
          get boom() {
            throw new Error('intentional error');
          }
        }
      }
    `,
    'boom2.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Boom extends CardDef {
        @field firstName = contains(StringField);
        boom = () => {};
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            {{! From CS-7216 we are using a modifier in a strict mode template that is not imported }}
            <h1 {{did-insert this.boom}}><@fields.firstName/></h1>
          </template>
        }
      }
    `,
    'atom-boom.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Boom extends CardDef {
        @field firstName = contains(StringField);
        static atom = class Atom extends Component<typeof this> {
          <template>
            <h1><@fields.firstName/>{{this.boom}}</h1>
          </template>
          get boom() {
            throw new Error('intentional error');
          }
        }
      }
    `,
    'embedded-boom.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Boom extends CardDef {
        @field firstName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1><@fields.firstName/>{{this.boom}}</h1>
          </template>
          get boom() {
            throw new Error('intentional error');
          }
        }
      }
    `,
    'fitted-boom.gts': `
      import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
      import StringField from "https://cardstack.com/base/string";

      export class Boom extends CardDef {
        @field firstName = contains(StringField);
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1><@fields.firstName/>{{this.boom}}</h1>
          </template>
          get boom() {
            throw new Error('intentional error');
          }
        }
      }
    `,
    'mango.json': {
      data: {
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
    'vangogh.json': {
      data: {
        attributes: {
          firstName: 'Van Gogh',
          hourlyRate: 50,
        },
        meta: {
          adoptsFrom: {
            module: './person',
            name: 'Person',
          },
        },
      },
    },
    'hassan.json': {
      data: {
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          pet: { links: { self: './ringo' } },
        },
        meta: {
          adoptsFrom: {
            module: './pet-person',
            name: 'PetPerson',
          },
        },
      },
    },
    'ringo.json': {
      data: {
        attributes: {
          firstName: 'Ringo',
        },
        meta: {
          adoptsFrom: {
            module: './pet',
            name: 'Pet',
          },
        },
      },
    },
    'post-1.json': {
      data: {
        attributes: {
          message: 'Who wants to fetch?!',
        },
        relationships: {
          author: {
            links: {
              self: './vangogh',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: './post',
            name: 'Post',
          },
        },
      },
    },
    'bad-link.json': {
      data: {
        attributes: {
          message: 'I have a bad link',
        },
        relationships: {
          author: {
            links: {
              self: 'http://localhost:9000/this-is-a-link-to-nowhere',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: './post',
            name: 'Post',
          },
        },
      },
    },
    'boom.json': {
      data: {
        attributes: {
          firstName: 'Boom!',
        },
        meta: {
          adoptsFrom: {
            module: './boom',
            name: 'Boom',
          },
        },
      },
    },
    'boom2.json': {
      data: {
        attributes: {
          firstName: 'Boom!',
        },
        meta: {
          adoptsFrom: {
            module: './boom2',
            name: 'Boom',
          },
        },
      },
    },
    'atom-boom.json': {
      data: {
        attributes: {
          firstName: 'Boom!',
        },
        meta: {
          adoptsFrom: {
            module: './atom-boom',
            name: 'Boom',
          },
        },
      },
    },
    'embedded-boom.json': {
      data: {
        attributes: {
          firstName: 'Boom!',
        },
        meta: {
          adoptsFrom: {
            module: './embedded-boom',
            name: 'Boom',
          },
        },
      },
    },
    'fitted-boom.json': {
      data: {
        attributes: {
          firstName: 'Boom!',
        },
        meta: {
          adoptsFrom: {
            module: './fitted-boom',
            name: 'Boom',
          },
        },
      },
    },
    'empty.json': {
      data: {
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    },
    'random-file.txt': 'hello',
    'random-image.png': 'i am an image',
    '.DS_Store':
      'In  macOS, .DS_Store is a file that stores custom attributes of its containing folder',
  };
}

async function startTestRealm({
  dbAdapter,
  publisher,
  runner,
}: {
  dbAdapter: DBAdapter;
  publisher: QueuePublisher;
  runner: QueueRunner;
}): Promise<TestRealmServerResult> {
  let virtualNetwork = createVirtualNetwork();
  let dir = dirSync().name;
  let testRealmServer = await runTestRealmServer({
    testRealmDir: dir,
    realmsRootPath: join(dir, 'realm_server_1'),
    virtualNetwork,
    realmURL: testRealm,
    dbAdapter: dbAdapter as PgAdapter,
    publisher: publisher as PgQueuePublisher,
    runner: runner as PgQueueRunner,
    matrixURL,
    fileSystem: makeTestRealmFileSystem(),
  });
  await testRealmServer.testRealm.start();
  return testRealmServer;
}

async function stopTestRealm(testRealmServer?: TestRealmServerResult) {
  if (!testRealmServer) {
    return;
  }
  testRealmServer.testRealm.unsubscribe();
  await closeServer(testRealmServer.testRealmHttpServer);
  resetCatalogRealms();
}

module(basename(__filename), function () {
  module('indexing (read only)', function (hooks) {
    let realm: Realm;
    let testRealmServer: TestRealmServerResult | undefined;

    async function getInstance(
      realm: Realm,
      url: URL,
    ): Promise<IndexedInstance | undefined> {
      let maybeInstance = await realm.realmIndexQueryEngine.instance(url);
      if (maybeInstance?.type === 'error') {
        return undefined;
      }
      return maybeInstance;
    }

    setupBaseRealmServer(hooks, matrixURL);

    setupDB(hooks, {
      before: async (dbAdapter, publisher, runner) => {
        testDbAdapter = dbAdapter;
        testRealmServer = await startTestRealm({
          dbAdapter,
          publisher,
          runner,
        });
        realm = testRealmServer.testRealm;
      },
      after: async () => {
        await stopTestRealm(testRealmServer);
        testRealmServer = undefined;
      },
    });

    test('realm is full indexed at boot', async function (assert) {
      let jobs = await testDbAdapter.execute('select * from jobs');
      assert.strictEqual(
        jobs.length,
        1,
        'there is one job that was run in the queue',
      );
      let [job] = jobs;
      assert.strictEqual(
        job.job_type,
        'from-scratch-index',
        'the job is a from scratch index job',
      );
      assert.strictEqual(
        job.concurrency_group,
        `indexing:${testRealm}`,
        'the job is an index of the test realm',
      );
      assert.strictEqual(
        job.status,
        'resolved',
        'the job completed successfully',
      );
      assert.ok(job.finished_at, 'the job was marked with a finish time');
    });

    test('can store card pre-rendered html in the index', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}mango`),
      );
      if (entry?.type === 'instance') {
        assert.strictEqual(
          trimCardContainer(stripScopedCSSAttributes(entry!.isolatedHtml!)),
          cleanWhiteSpace(`<h1> Mango $</h1>`),
          'pre-rendered isolated format html is correct',
        );
        assert.strictEqual(
          trimCardContainer(
            stripScopedCSSAttributes(
              entry!.embeddedHtml![`${testRealm}person/Person`],
            ),
          ),
          cleanWhiteSpace(`<h1> Embedded Card Person: Mango </h1>`),
          'pre-rendered embedded format html is correct',
        );

        assert.ok(entry.headHtml, 'pre-rendered head format html is present');

        let cleanedHead = cleanWhiteSpace(entry.headHtml!);

        // TODO: restore in CS-9807
        // assert.ok(
        //   cleanedHead.includes('<title data-test-card-head-title>'),
        //   `head html includes title: ${cleanedHead}`,
        // );
        assert.ok(
          cleanedHead.includes(`property="og:url" content="${testRealm}mango"`),
          `head html includes canonical url: ${cleanedHead}`,
        );

        assert.strictEqual(
          trimCardContainer(
            stripScopedCSSAttributes(
              entry!.fittedHtml![`${testRealm}person/Person`],
            ),
          ),
          cleanWhiteSpace(`<h1> Fitted Card Person: Mango </h1>`),
          'pre-rendered fitted format html is correct',
        );
      } else {
        assert.ok(false, 'expected index entry not to be an error');
      }
    });

    test('can store error doc in the index when atom view throws error', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}atom-boom`),
      );
      if (entry?.type === 'error') {
        assert.strictEqual(
          entry.error.errorDetail.message,
          'intentional error',
        );
        assert.deepEqual(entry.error.errorDetail.deps, [
          `${testRealm}atom-boom`,
        ]);
      } else {
        assert.ok(false, 'expected index entry to be an error');
      }
    });

    test('can store error doc in the index when embedded view throws error', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}embedded-boom`),
      );
      if (entry?.type === 'error') {
        assert.strictEqual(
          entry.error.errorDetail.message,
          'intentional error',
        );
        assert.deepEqual(entry.error.errorDetail.deps, [
          `${testRealm}embedded-boom`,
        ]);
      } else {
        assert.ok(false, 'expected index entry to be an error');
      }
    });

    test('can store error doc in the index when fitted view throws error', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}fitted-boom`),
      );
      if (entry?.type === 'error') {
        assert.strictEqual(
          entry.error.errorDetail.message,
          'intentional error',
        );
        assert.deepEqual(entry.error.errorDetail.deps, [
          `${testRealm}fitted-boom`,
        ]);
      } else {
        assert.ok(false, 'expected index entry to be an error');
      }
    });

    test('rendering a card that has a template error does not affect indexing other instances', async function (assert) {
      {
        let entry = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}boom`),
        );
        if (entry?.type === 'error') {
          assert.strictEqual(
            entry.error.errorDetail.message,
            'intentional error',
          );
          assert.deepEqual(entry.error.errorDetail.deps, [`${testRealm}boom`]);
        } else {
          assert.ok('false', 'expected search entry to be an error document');
        }
      }
      {
        let entry = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}boom2`),
        );
        if (entry?.type === 'error') {
          assert.strictEqual(
            entry.error.errorDetail.message,
            'Attempted to resolve a modifier in a strict mode template, but it was not in scope: did-insert',
          );
          assert.deepEqual(entry.error.errorDetail.deps, [`${testRealm}boom2`]);
        } else {
          assert.ok('false', 'expected search entry to be an error document');
        }
      }
      {
        let entry = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}vangogh`),
        );
        if (entry?.type === 'doc') {
          assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
          let item = await realm.realmIndexQueryEngine.instance(
            new URL(`${testRealm}vangogh`),
          );
          if (item?.type === 'instance') {
            assert.strictEqual(
              trimCardContainer(stripScopedCSSAttributes(item.isolatedHtml!)),
              cleanWhiteSpace(`<h1> Van Gogh $50</h1>`),
            );
            assert.strictEqual(
              trimCardContainer(
                stripScopedCSSAttributes(
                  item.embeddedHtml![`${testRealm}person/Person`]!,
                ),
              ),
              cleanWhiteSpace(`<h1> Embedded Card Person: Van Gogh </h1>`),
            );
            assert.strictEqual(
              trimCardContainer(
                stripScopedCSSAttributes(
                  item.fittedHtml![`${testRealm}person/Person`]!,
                ),
              ),
              cleanWhiteSpace(`<h1> Fitted Card Person: Van Gogh </h1>`),
            );
          } else {
            assert.ok(false, 'expected index entry not to be an error');
          }
        } else {
          assert.ok(
            false,
            `expected search entry to be a document but was: ${entry?.error.errorDetail.message}`,
          );
        }
      }
    });

    test('can make an error doc for a card that has a link to a URL that is not a card', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}bad-link`),
      );
      if (entry?.type === 'error') {
        assert.strictEqual(
          entry.error.errorDetail.message,
          'unable to fetch http://localhost:9000/this-is-a-link-to-nowhere: fetch failed',
        );
        let actualDeps = (entry.error.errorDetail.deps ?? []).map((d) =>
          d.endsWith('.json') ? d.slice(0, -5) : d,
        );
        let expectedDeps = [
          `${testRealm}post`,
          `http://localhost:9000/this-is-a-link-to-nowhere`,
        ];
        assert.deepEqual(actualDeps.sort(), expectedDeps.sort());
      } else {
        assert.ok('false', 'expected search entry to be an error document');
      }
    });

    // Note this particular test should only be a server test as the nature of
    // the TestAdapter in the host tests will trigger the linked card to be
    // already loaded when in fact in the real world it is not.
    test('it can index a card with a contains computed that consumes a linksTo field', async function (assert) {
      const hassanId = `${testRealm}hassan`;
      let queryEngine = realm.realmIndexQueryEngine;
      let hassan = await queryEngine.cardDocument(new URL(hassanId));
      if (hassan?.type === 'doc') {
        assert.deepEqual(
          hassan.doc.data.attributes,
          {
            title: 'Untitled Card',
            nickName: "Ringo's buddy",
            firstName: 'Hassan',
            description: null,
            thumbnailURL: null,
            cardInfo,
          },
          'doc attributes are correct',
        );
        assert.deepEqual(
          hassan.doc.data.relationships,
          {
            pet: {
              links: {
                self: './ringo',
              },
            },
            'cardInfo.theme': {
              links: {
                self: null,
              },
            },
          },
          'doc relationships are correct',
        );
      } else {
        assert.ok(
          false,
          `search entry was an error: ${hassan?.error.errorDetail.message}`,
        );
      }

      let hassanEntry = await getInstance(realm, new URL(`${testRealm}hassan`));
      if (hassanEntry) {
        assert.deepEqual(
          hassanEntry.searchDoc,
          {
            id: hassanId,
            pet: {
              id: `${testRealm}ringo`,
              title: 'Untitled Card',
              firstName: 'Ringo',
              cardInfo: {
                theme: null,
              },
            },
            nickName: "Ringo's buddy",
            _cardType: 'PetPerson',
            firstName: 'Hassan',
            title: 'Untitled Card',
            cardInfo: {
              theme: null,
            },
          },
          'searchData is correct',
        );
      } else {
        assert.ok(false, `could not find ${hassanId} in the index`);
      }
    });

    test('sets resource_created_at for modules and instances', async function (assert) {
      let entry = (await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}fancy-person.gts`),
      )) as { resourceCreatedAt: number };

      assert.ok(entry!.resourceCreatedAt, 'resourceCreatedAt is set');

      entry = (await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}mango`),
      )) as { resourceCreatedAt: number };

      assert.ok(entry!.resourceCreatedAt, 'resourceCreatedAt is set');
    });

    test('sets urls containing encoded CSS for deps for a module', async function (assert) {
      let entry = (await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}fancy-person.gts`),
      )) as { deps: string[] };

      let assertCssDependency = (
        deps: string[],
        pattern: RegExp,
        fileName: string,
      ) => {
        assert.true(
          !!deps.find((dep) => pattern.test(dep)),
          `css for ${fileName} is in the deps`,
        );
      };

      let dependencies = [
        {
          pattern: /fancy-person\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'fancy-person.gts',
        },
        {
          pattern: /\/person\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'person.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/default-templates\/embedded\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/embedded.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/default-templates\/isolated-and-edit\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/isolated-and-edit.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/default-templates\/missing-template\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/missing-template.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/default-templates\/field-edit\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/field-edit.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/links-to-many-component.gts.*\.glimmer-scoped\.css$/,
          fileName: 'links-to-many-component.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/links-to-editor.gts.*\.glimmer-scoped\.css$/,
          fileName: 'links-to-editor.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/contains-many-component.gts.*\.glimmer-scoped\.css$/,
          fileName: 'contains-many-component.gts',
        },
        {
          pattern:
            /cardstack.com\/base\/field-component.gts.*\.glimmer-scoped\.css$/,
          fileName: 'field-component.gts',
        },
      ];

      dependencies.forEach(({ pattern, fileName }) => {
        assertCssDependency(entry.deps, pattern, fileName);
      });
    });

    test('will not invalidate non-json/non-executable files', async function (assert) {
      let deletedEntries = (await testDbAdapter.execute(
        `SELECT url FROM boxel_index WHERE is_deleted = TRUE`,
      )) as { url: string }[];

      let deletedEntryUrls = deletedEntries.map((row) => row.url);

      ['random-file.txt', 'random-image.png', '.DS_Store'].forEach((file) => {
        assert.notOk(deletedEntryUrls.includes(file));
      });
    });
  });

  module('indexing (mutating)', function (hooks) {
    let realm: Realm;
    let adapter: RealmAdapter;
    let testRealmServer: TestRealmServerResult | undefined;

    setupBaseRealmServer(hooks, matrixURL);

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        testDbAdapter = dbAdapter;
        testRealmServer = await startTestRealm({
          dbAdapter,
          publisher,
          runner,
        });
        realm = testRealmServer.testRealm;
        adapter = testRealmServer.testRealmAdapter;
      },
      afterEach: async () => {
        await stopTestRealm(testRealmServer);
        testRealmServer = undefined;
      },
    });

    test('can incrementally index updated instance', async function (assert) {
      await realm.write(
        'mango.json',
        JSON.stringify({
          data: {
            attributes: {
              firstName: 'Mang-Mang',
            },
            meta: {
              adoptsFrom: {
                module: './person.gts',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          on: { module: `${testRealm}person`, name: 'Person' },
          eq: { firstName: 'Mang-Mang' },
        },
      });
      assert.strictEqual(result.length, 1, 'found updated document');
      assert.strictEqual(
        realm.realmIndexUpdater.stats.instancesIndexed,
        1,
        'indexed updated instance',
      );
    });

    test('can recover from a card error after error is removed from card source', async function (assert) {
      // introduce errors into 2 cards and observe that invalidation doesn't
      // blindly invalidate all cards are in an error state
      await realm.write(
        'pet.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          export class Pet extends CardDef {
            @field firstName = contains(StringField);
          }
          throw new Error('boom!');
        `,
      );
      await realm.write(
        'person.gts',
        `
          // syntax error
          export class Intentionally Thrown Error {}
        `,
      );
      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          type: { module: `${testRealm}person`, name: 'Person' },
        },
      });
      assert.deepEqual(
        result,
        [],
        'the broken type results in no instance results',
      );
      await realm.write(
        'person.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
          }
        `,
      );
      result = (
        await realm.realmIndexQueryEngine.search({
          filter: {
            type: { module: `${testRealm}person`, name: 'Person' },
          },
        })
      ).data;
      assert.strictEqual(
        result.length,
        2,
        'correct number of instances returned',
      );
    });

    test('can recover from a module sequence error', async function (assert) {
      // introduce errors into 2 gts file with first module has dependency on second module
      await realm.write(
        'pet.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { Name } from "./name"; // this is missing
          export class Pet extends CardDef {
            @field name = contains(Name);
          }
        `,
      );
      await realm.write(
        'name.gts',
        `
          import { contains, field, FieldDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Name extends FieldDef {
            @field firstName = contains(StringField);
            @field lastName = contains(StringField);
          }
        `,
      );

      // Aspect module should be indexed
      let name = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}name`),
      );
      assert.strictEqual(
        name?.type,
        'module',
        'Name module is successfully indexed',
      );

      // Since the name is ready, the pet should be indexed and not in an error state
      // Fetch the pet module
      let pet = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}pet`),
      );
      assert.strictEqual(
        pet?.type,
        'module',
        'Pet module is successfully indexed',
      );
    });

    test('can successfully create instance after module sequence error is resolved', async function (assert) {
      // First create pet.gts that depends on name.gts which doesn't exist yet
      await realm.write(
        'pet.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { Name } from "./name";
          export class Pet extends CardDef {
            @field name = contains(Name);
          }
        `,
      );

      // Now create the missing name.gts module
      await realm.write(
        'name.gts',
        `
          import { contains, field, FieldDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Name extends FieldDef {
            @field firstName = contains(StringField);
            @field lastName = contains(StringField);
          }
        `,
      );

      // Verify the Name module is properly indexed
      let name = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}name`),
      );
      assert.strictEqual(
        name?.type,
        'module',
        'Name module is successfully indexed',
      );

      // Create a pet instance
      await realm.write(
        'pet-apple.json',
        JSON.stringify({
          data: {
            attributes: {
              name: {
                firstName: 'Apple',
                lastName: 'Tangle',
              },
            },
            meta: {
              adoptsFrom: {
                module: './pet',
                name: 'Pet',
              },
            },
          },
        }),
      );

      let petApple = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}pet-apple`),
      );
      assert.strictEqual(
        petApple?.type,
        'instance',
        'pet-apple instance is created without error',
      );
    });

    test('can incrementally index deleted instance', async function (assert) {
      await realm.delete('mango.json');

      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          on: { module: `${testRealm}person`, name: 'Person' },
          eq: { firstName: 'Mango' },
        },
      });
      assert.strictEqual(result.length, 0, 'found no documents');
      assert.strictEqual(
        realm.realmIndexUpdater.stats.instancesIndexed,
        0,
        'index did not touch any instance files',
      );
      assert.strictEqual(
        realm.realmIndexUpdater.stats.modulesIndexed,
        0,
        'index did not touch any module files',
      );
      assert.strictEqual(
        realm.realmIndexUpdater.stats.instanceErrors,
        0,
        'no instance errors occurred',
      );
      assert.strictEqual(
        realm.realmIndexUpdater.stats.moduleErrors,
        0,
        'no module errors occurred',
      );
    });

    test('can incrementally index instance that depends on updated card source', async function (assert) {
      await realm.write(
        'post.gts',
        `
        import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends CardDef {
          @field author = linksTo(Person);
          @field message = contains(StringField);
          @field nickName = contains(StringField, {
            computeVia: function() {
              return this.author.firstName + '-poo';
            }
          })
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1><@fields.message/></h1>
              <h2><@fields.author/></h2>
            </template>
          }
        }
      `,
      );

      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          on: { module: `${testRealm}post`, name: 'Post' },
          eq: { nickName: 'Van Gogh-poo' },
        },
      });
      assert.strictEqual(result.length, 1, 'found updated document');
    });

    test('can incrementally index instance that depends on updated card source consumed by other card sources', async function (assert) {
      await realm.write(
        'person.gts',
        `
          import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            @field nickName = contains(StringField, {
              computeVia: function() {
                return this.firstName + '-poo';
              }
            })
            static embedded = class Embedded extends Component<typeof this> {
              <template><@fields.firstName/> (<@fields.nickName/>)</template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template><@fields.firstName/> (<@fields.nickName/>)</template>
            }
          }
        `,
      );

      let { data: result } = await realm.realmIndexQueryEngine.search({
        filter: {
          on: { module: `${testRealm}post`, name: 'Post' },
          eq: { 'author.nickName': 'Van Gogh-poo' },
        },
      });
      assert.strictEqual(result.length, 1, 'found updated document');
    });

    test('can incrementally index instance that depends on deleted card source', async function (assert) {
      await realm.delete('post.gts');
      {
        let { data: result } = await realm.realmIndexQueryEngine.search({
          filter: {
            type: { module: `${testRealm}post`, name: 'Post' },
          },
        });
        assert.deepEqual(
          result,
          [],
          'the deleted type results in no card instance results',
        );
      }
      let actual = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}post-1`),
      );
      if (actual?.type === 'error') {
        assert.ok(actual.error.errorDetail.stack, 'stack trace is included');
        delete actual.error.errorDetail.stack;
        assert.deepEqual(
          // we splat because despite having the same shape, the constructors are different
          { ...actual.error.errorDetail },
          {
            id: `${testRealm}post`,
            isCardError: true,
            additionalErrors: null,
            message: `missing file ${testRealm}post`,
            status: 404,
            title: 'Link Not Found',
            deps: [`${testRealm}post`],
          },
          'card instance is an error document',
        );
      } else {
        assert.ok(false, 'search index entry is not an error document');
      }

      // when the definitions is created again, the instance should mend its broken link
      await realm.write(
        'post.gts',
        `
        import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Person } from "./person";

        export class Post extends CardDef {
          @field author = linksTo(Person);
          @field message = contains(StringField);
          @field nickName = contains(StringField, {
            computeVia: function() {
              return this.author?.firstName + '-poo';
            }
          })
        }
      `,
      );
      {
        let { data: result } = await realm.realmIndexQueryEngine.search({
          filter: {
            on: { module: `${testRealm}post`, name: 'Post' },
            eq: { nickName: 'Van Gogh-poo' },
          },
        });
        assert.strictEqual(result.length, 1, 'found the post instance');
      }
    });

    test('should be able to handle dependencies between modules', async function (assert) {
      let moduleWrites = new Map<string, string>();
      moduleWrites.set(
        'author.gts',
        `
            import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            import { BlogApp } from "./blog-app";

            export class Author extends CardDef {
              @field name = contains(StringField);
              @field blog = linksTo(BlogApp);
            }
          `,
      );
      moduleWrites.set(
        'blog-category.gts',
        `
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { BlogApp } from "./blog-app";

        export class BlogCategory extends CardDef {
          @field name = contains(StringField);
          @field blog = linksTo(BlogApp);
        }
      `,
      );
      moduleWrites.set(
        'blog-post.gts',
        `
        import { contains, field, CardDef, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Author } from "./author";
        import { BlogApp } from "./blog-app";

        export class BlogPost extends CardDef {
          @field title = contains(StringField);
          @field author = linksToMany(Author);
          @field blog = linksTo(BlogApp);
        }
      `,
      );
      moduleWrites.set(
        'blog-app.gts',
        `
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import type { BlogPost } from "./blog-post";

        export class BlogApp extends CardDef {
          @field title = contains(StringField);
        }
      `,
      );
      await realm.writeMany(moduleWrites);

      let blogPostModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-post`),
      );
      assert.strictEqual(
        blogPostModule?.type,
        'module',
        'BlogPost module is in resolved module successfully',
      );

      let blogCategoryModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-category`),
      );
      assert.strictEqual(
        blogCategoryModule?.type,
        'module',
        'BlogCategory module is in resolved module successfully',
      );

      let authorModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}author`),
      );
      assert.strictEqual(
        authorModule?.type,
        'module',
        'Author module is in resolved module successfully',
      );

      let blogAppModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-app`),
      );
      assert.strictEqual(
        blogAppModule?.type,
        'module',
        'BlogApp module is in resolved module successfully',
      );
    });

    test('should be able to handle dependencies between modules - with thunk', async function (assert) {
      let moduleWrites = new Map<string, string>();
      moduleWrites.set(
        'author.gts',
        `
            import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
            import StringField from "https://cardstack.com/base/string";
            import { BlogApp } from "./blog-app";

            export class Author extends CardDef {
              @field name = contains(StringField);
              @field blog = linksTo(() => BlogApp);
            }
          `,
      );
      moduleWrites.set(
        'blog-category.gts',
        `
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { BlogApp } from "./blog-app";

        export class BlogCategory extends CardDef {
          @field name = contains(StringField);
          @field blog = linksTo(() => BlogApp);
        }
      `,
      );
      moduleWrites.set(
        'blog-post.gts',
        `
        import { contains, field, CardDef, linksTo, linksToMany } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Author } from "./author";
        import { BlogApp } from "./blog-app";

        export class BlogPost extends CardDef {
          @field title = contains(StringField);
          @field author = linksToMany(() => Author);
          @field blog = linksTo(() => BlogApp);
        }
      `,
      );
      moduleWrites.set(
        'blog-app.gts',
        `
        import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import type { BlogPost } from "./blog-post";

        export class BlogApp extends CardDef {
          @field title = contains(StringField);
        }
      `,
      );
      await realm.writeMany(moduleWrites);

      let blogPostModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-post`),
      );
      assert.strictEqual(
        blogPostModule?.type,
        'module',
        'BlogPost module is in resolved module successfully',
      );

      let blogCategoryModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-category`),
      );
      assert.strictEqual(
        blogCategoryModule?.type,
        'module',
        'BlogCategory module is in resolved module successfully',
      );

      let authorModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}author`),
      );
      assert.strictEqual(
        authorModule?.type,
        'module',
        'Author module is in resolved module successfully',
      );

      let blogAppModule = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}blog-app`),
      );
      assert.strictEqual(
        blogAppModule?.type,
        'module',
        'BlogApp module is in resolved module successfully',
      );
    });

    test('can write several modules at once', async function (assert) {
      let mapOfWrites = new Map();
      mapOfWrites.set(
        'place.gts',
        `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class Place extends CardDef {
          @field name = contains(StringField);
        }
      `,
      );
      mapOfWrites.set(
        'country.gts',
        `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class Country extends CardDef {
          @field name = contains(StringField);
        }
      `,
      );
      let result = await realm.writeMany(mapOfWrites);
      assert.strictEqual(result.length, 2, '2 files were written');
      assert.strictEqual(result[0].path, 'place.gts');
      assert.strictEqual(result[1].path, 'country.gts');

      let place = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}place`),
      );
      assert.ok(place, 'place module is in the index');

      let country = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}country`),
      );
      assert.ok(country, 'country module is in the index');
      assert.strictEqual(
        realm.realmIndexUpdater.stats.modulesIndexed,
        2,
        'indexed correct number of files',
      );
    });

    test('can write instances and modules at once', async function (assert) {
      let mapOfWrites = new Map();
      mapOfWrites.set(
        'city.gts',
        `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class City extends CardDef {
          @field name = contains(StringField);
        }
      `,
      );
      mapOfWrites.set(
        'city.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: { name: 'Paris' },
            meta: {
              adoptsFrom: {
                module: './city',
                name: 'City',
              },
            },
          },
        }),
      );
      let result = await realm.writeMany(mapOfWrites);
      assert.strictEqual(result.length, 2, '2 files were written');
      assert.strictEqual(result[0].path, 'city.gts');
      assert.strictEqual(result[1].path, 'city.json');

      let module = await realm.realmIndexQueryEngine.module(
        new URL(`${testRealm}city`),
      );
      assert.ok(module, 'city module is in the index');

      let instance = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}city`),
      );
      assert.ok(instance, 'city instance is in the index');
      assert.deepEqual(
        {
          instancesIndexed: realm.realmIndexUpdater.stats.instancesIndexed,
          instanceErrors: realm.realmIndexUpdater.stats.instanceErrors,
          moduleErrors: realm.realmIndexUpdater.stats.moduleErrors,
          modulesIndexed: realm.realmIndexUpdater.stats.modulesIndexed,
        },
        {
          instancesIndexed: 1,
          instanceErrors: 0,
          moduleErrors: 0,
          modulesIndexed: 0,
        },
        'indexed correct number of files',
      );
    });

    test('can tombstone deleted files when running fromScratch indexing', async function (assert) {
      await realm.write(
        'test-file.json',
        JSON.stringify({
          data: {
            attributes: {
              firstName: 'Test Person',
            },
            meta: {
              adoptsFrom: {
                module: './person',
                name: 'Person',
              },
            },
          },
        }),
      );

      let testFile = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}test-file`),
      );
      assert.strictEqual(testFile?.type, 'instance', 'test file was indexed');

      await adapter.remove('test-file.json'); // incremental doesn't get triggered (like in development) here bcos there is no filewatcher enabled
      realm.__testOnlyClearCaches();
      let fileExists = await adapter.exists('test-file.json');
      assert.false(fileExists);
      await realm.realmIndexUpdater.fullIndex();

      let deletedEntries = (await testDbAdapter.execute(
        `SELECT * FROM boxel_index where is_deleted = true and type = 'instance'`,
      )) as { url: string; is_deleted: boolean }[];

      assert.ok(
        deletedEntries.some(
          (entry) => entry.url === `${testRealm}test-file.json`,
        ),
        'found tombstone entry for deleted file',
      );
      assert.true(
        deletedEntries.every((entry) => entry.is_deleted),
        'all tombstones are marked as deleted',
      );

      // Verify the file is no longer retrievable through the query engine
      let deletedFile = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}test-file`),
      );
      assert.strictEqual(
        deletedFile,
        undefined,
        'deleted file is not retrievable',
      );
    });
  });

  module('permissioned realm', function (hooks) {
    setupBaseRealmServer(hooks, matrixURL);

    let testRealm1URL = 'http://127.0.0.1:4447/';
    let testRealm2URL = 'http://127.0.0.1:4448/';
    let testRealm2: Realm;

    function setupRealms(
      hooks: NestedHooks,
      permissions: {
        consumer: RealmPermissions;
        provider: RealmPermissions;
      },
    ) {
      setupPermissionedRealms(hooks, {
        // provider
        realms: [
          {
            realmURL: testRealm1URL,
            permissions: permissions.provider,
            fileSystem: {
              'article.gts': `
              import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
              import StringField from "https://cardstack.com/base/string";
              export class Article extends CardDef {
                @field title = contains(StringField);
              }
            `,
            },
          },
          // consumer
          {
            realmURL: testRealm2URL,
            permissions: permissions.consumer,
            fileSystem: {
              'website.gts': `
              import { contains, field, CardDef, linksTo } from "https://cardstack.com/base/card-api";
              import { Article } from "${testRealm1URL}article" // importing from another realm;
              export class Website extends CardDef {
                @field linkedArticle = linksTo(Article);
              }`,
              'website-1.json': {
                data: {
                  attributes: {},
                  meta: {
                    adoptsFrom: {
                      module: './website',
                      name: 'Website',
                    },
                  },
                },
              },
            },
          },
        ],
        onRealmSetup({ realms: [_, realm2] }) {
          testRealm2 = realm2.realm;
        },
      });
    }

    module('readable realm', function (hooks) {
      setupRealms(hooks, {
        provider: {
          ['@node-test_realm:localhost']: ['read'],
        },
        consumer: {
          '*': ['read', 'write'],
        },
      });

      test('has no module errors when trying to index a card from another realm when it has permission to read', async function (assert) {
        assert.deepEqual(
          // we splat because despite having the same shape, the constructors are different
          { ...testRealm2.realmIndexUpdater.stats },
          {
            instancesIndexed: 1,
            instanceErrors: 0,
            moduleErrors: 0,
            modulesIndexed: 1,
            totalIndexEntries: 2,
          },
          'has no module errors',
        );
      });
    });

    module('un-readable realm', function (hooks) {
      setupRealms(hooks, {
        provider: {
          nobody: ['read', 'write'], // Consumer's matrix user not authorized to read from provider
        },
        consumer: {
          '*': ['read', 'write'],
        },
      });

      test('has a module error when trying to index a module from another realm when it has no permission to read', async function (assert) {
        // Error during indexing will be: "Authorization error: Insufficient
        // permissions to perform this action"
        assert.deepEqual(
          // we splat because despite having the same shape, the constructors are different
          { ...testRealm2.realmIndexUpdater.stats },
          {
            instanceErrors: 1,
            instancesIndexed: 0,
            moduleErrors: 1,
            modulesIndexed: 0,
            totalIndexEntries: 0,
          },
          'has a module error',
        );
      });
    });
  });
});
