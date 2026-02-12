import { module, test } from 'qunit';
import { dirSync } from 'tmp';
import { internalKeyFor, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  DBAdapter,
  DefinitionLookup,
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
    'filedef-mismatch.gts': `
      import {
        FileDef as BaseFileDef,
        FileContentMismatchError,
      } from "https://cardstack.com/base/file-api";

      export class FileDef extends BaseFileDef {
        static async extractAttributes() {
          throw new FileContentMismatchError('content mismatch');
        }
      }
    `,
    'random-file.txt': 'hello',
    'random-file.mismatch': 'mismatch content',
    'random-image.png': 'i am an image',
    '🎉hello.txt': 'emoji filename content',
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
      if (maybeInstance?.type === 'instance-error') {
        return undefined;
      }
      return maybeInstance as IndexedInstance | undefined;
    }

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

        let cleanedHead = cleanWhiteSpace(entry.headHtml!);
        assert.ok(entry.headHtml, 'pre-rendered head format html is present');
        assert.ok(
          cleanedHead.includes('<title data-test-card-head-title>'),
          `head html includes cardTitle: ${cleanedHead}`,
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
        assert.ok(
          entry.error.errorDetail.deps?.includes(`${testRealm}atom-boom`),
          'error deps include atom-boom',
        );
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
        assert.ok(
          entry.error.errorDetail.deps?.includes(`${testRealm}embedded-boom`),
          'error deps include embedded-boom',
        );
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
        assert.ok(
          entry.error.errorDetail.deps?.includes(`${testRealm}fitted-boom`),
          'error deps include fitted-boom',
        );
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
          assert.ok(
            entry.error.errorDetail.deps?.includes(`${testRealm}boom`),
            'error deps include boom',
          );
        } else {
          assert.ok(false, 'expected search entry to be an error document');
        }
      }
      {
        let entry = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}boom2`),
        );
        if (entry?.type === 'error') {
          assert.ok(
            /Attempted to resolve a modifier in a strict mode template, but that value was not in scope: did-insert/.test(
              entry.error.errorDetail.message,
            ),
            'error text is about did-insert not being in scope',
          );
          assert.ok(
            entry.error.errorDetail.deps?.includes(`${testRealm}boom2`),
            'error deps include boom2',
          );
        } else {
          assert.ok(false, 'expected search entry to be an error document');
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
        assert.ok(
          actualDeps.includes(`${testRealm}post`),
          'deps include post module',
        );
        assert.ok(
          actualDeps.includes(
            `http://localhost:9000/this-is-a-link-to-nowhere`,
          ),
          'deps include missing link target',
        );
      } else {
        assert.ok(false, 'expected search entry to be an error document');
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
            cardTitle: 'Untitled Card',
            nickName: "Ringo's buddy",
            firstName: 'Hassan',
            cardDescription: null,
            cardThumbnailURL: null,
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
              cardTitle: 'Untitled Card',
              firstName: 'Ringo',
              cardInfo: {
                theme: null,
              },
            },
            nickName: "Ringo's buddy",
            _cardType: 'PetPerson',
            firstName: 'Hassan',
            cardTitle: 'Untitled Card',
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

    test('sets resource_created_at for files and instances', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}fancy-person.gts`),
      );

      assert.ok(entry?.resourceCreatedAt, 'resourceCreatedAt is set');

      let instance = (await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}mango`),
      )) as { resourceCreatedAt: number };

      assert.ok(instance!.resourceCreatedAt, 'resourceCreatedAt is set');
    });

    test('sets urls containing encoded CSS for deps for an instance', async function (assert) {
      await realm.write(
        'fancy.json',
        JSON.stringify({
          data: {
            attributes: {
              firstName: 'Fancy',
            },
            meta: {
              adoptsFrom: {
                module: './fancy-person',
                name: 'FancyPerson',
              },
            },
          },
        }),
      );

      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}fancy`),
      );
      assert.strictEqual(entry?.type, 'instance', 'fancy instance is indexed');
      let deps = entry?.type === 'instance' ? (entry.deps ?? []) : [];

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
        assertCssDependency(deps, pattern, fileName);
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

    test('indexes non-card files as file entries', async function (assert) {
      let rows = (await testDbAdapter.execute(
        `SELECT url, type, last_modified FROM boxel_index WHERE url = '${testRealm}random-file.txt'`,
      )) as { url: string; type: string; last_modified: string | null }[];
      assert.strictEqual(rows.length, 1, 'file entry is in the index');
      assert.strictEqual(rows[0].type, 'file', 'file entry type is file');
      assert.ok(rows[0].last_modified, 'file entry has last_modified');
    });

    test('indexes files with emoji in filename', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}%F0%9F%8E%89hello.txt`),
      );
      assert.ok(entry, 'file entry exists for emoji filename');
      assert.strictEqual(entry?.type, 'file', 'file entry type is file');
      assert.strictEqual(
        entry?.searchDoc?.name,
        '🎉hello.txt',
        'search_doc name contains decoded emoji filename',
      );
      assert.strictEqual(
        entry?.searchDoc?.contentType,
        'text/plain',
        'search_doc includes contentType',
      );
      assert.ok(
        entry?.searchDoc?.contentHash,
        'search_doc includes contentHash',
      );
    });

    test('indexes executable files as file entries too', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}person.gts`),
      );
      assert.ok(entry, 'file entry exists for executable file');
      assert.strictEqual(
        entry?.searchDoc?.name,
        'person.gts',
        'file entry includes name',
      );
      assert.strictEqual(
        entry?.searchDoc?.contentType,
        'text/typescript+glimmer',
        'file entry includes contentType',
      );
    });

    test('indexes card json resources as file entries too', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}mango.json`),
      );
      assert.ok(entry, 'file entry exists for card json resource');
      assert.strictEqual(
        entry?.searchDoc?.name,
        'mango.json',
        'file entry includes name',
      );
      assert.ok(
        entry?.searchDoc?.contentHash,
        'file entry includes contentHash',
      );
    });

    test('keeps instance entries when indexing card json files as file entries', async function (assert) {
      let instanceEntry = await getInstance(
        realm,
        new URL(`${testRealm}mango`),
      );
      let fileEntry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}mango.json`),
      );
      assert.ok(instanceEntry, 'instance entry exists for card json resource');
      assert.ok(fileEntry, 'file entry exists for card json resource');
      assert.strictEqual(
        instanceEntry?.canonicalURL,
        fileEntry?.canonicalURL,
        'instance and file entries can share the same url',
      );
      assert.strictEqual(
        instanceEntry?.type,
        'instance',
        'instance entry keeps instance type',
      );
      assert.strictEqual(fileEntry?.type, 'file', 'file entry keeps file type');
    });

    test('file extractor populates search_doc', async function (assert) {
      let rows = (await testDbAdapter.execute(
        `SELECT search_doc FROM boxel_index WHERE url = '${testRealm}random-file.txt'`,
      )) as { search_doc: Record<string, unknown> | string | null }[];
      let raw = rows[0]?.search_doc;
      let searchDoc = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
      assert.strictEqual(
        searchDoc.name,
        'random-file.txt',
        'search_doc includes name',
      );
      assert.strictEqual(
        searchDoc.contentType,
        'text/plain',
        'search_doc includes contentType',
      );
      assert.ok(searchDoc.contentHash, 'search_doc includes contentHash');
    });

    test('file extractor mismatch falls back to base extractor', async function (assert) {
      let rows = (await testDbAdapter.execute(
        `SELECT search_doc, deps FROM boxel_index WHERE url = '${testRealm}random-file.mismatch'`,
      )) as {
        search_doc: Record<string, unknown> | string | null;
        deps: string[] | string | null;
      }[];
      let rawDoc = rows[0]?.search_doc;
      let searchDoc =
        typeof rawDoc === 'string' ? JSON.parse(rawDoc) : (rawDoc ?? {});
      assert.strictEqual(
        searchDoc.name,
        'random-file.mismatch',
        'fallback search_doc includes name',
      );
      assert.ok(
        searchDoc.contentHash,
        'fallback search_doc includes contentHash',
      );

      let rawDeps = rows[0]?.deps ?? [];
      let deps = Array.isArray(rawDeps)
        ? rawDeps
        : typeof rawDeps === 'string'
          ? JSON.parse(rawDeps)
          : [];
      assert.ok(
        deps.includes(`${testRealm}filedef-mismatch`),
        'deps include mismatch extractor module',
      );
      assert.ok(
        deps.includes('https://cardstack.com/base/file-api'),
        'deps include base file-api for fallback',
      );
    });

    test('serves FileMeta from index entries', async function (assert) {
      // Mutate the index row so we can validate that the response must come from the index,
      // not from filesystem metadata.
      await testDbAdapter.execute(
        `UPDATE boxel_index SET search_doc = '{"name":"from-index.txt","contentType":"application/x-index-test"}'::jsonb, pristine_doc = '{"id":"${testRealm}random-file.txt","type":"file-meta","attributes":{"name":"from-pristine.txt","contentType":"application/x-pristine","custom":"present"},"meta":{"adoptsFrom":{"module":"https://cardstack.com/base/file-api","name":"FileDef"}}}'::jsonb WHERE url = '${testRealm}random-file.txt'`,
      );
      let response = await fetch(`${testRealm}random-file.txt`, {
        headers: { Accept: SupportedMimeType.FileMeta },
      });
      assert.strictEqual(response.status, 200, 'file meta response is ok');
      let doc = (await response.json()) as LooseSingleCardDocument;
      assert.strictEqual(doc.data.id, `${testRealm}random-file.txt`);
      assert.strictEqual(doc.data.type, 'file-meta');
      assert.strictEqual(
        doc.data.attributes?.name,
        'from-pristine.txt',
        'name sourced from pristine file resource',
      );
      assert.strictEqual(
        doc.data.attributes?.contentType,
        'application/x-pristine',
        'contentType sourced from pristine file resource',
      );
      assert.strictEqual(
        doc.data.attributes?.custom,
        'present',
        'custom attributes sourced from pristine file resource',
      );
      assert.deepEqual(
        doc.data.meta?.adoptsFrom,
        {
          module: 'https://cardstack.com/base/file-api',
          name: 'FileDef',
        },
        'adoptsFrom sourced from pristine file resource',
      );
      assert.ok(
        doc.data.attributes?.lastModified,
        'lastModified sourced from response attributes',
      );
    });

    test('file meta adoptsFrom prefers index types', async function (assert) {
      let fileDefModule = new URL('filedef-mismatch', testRealm).href;
      let fileDefKey = internalKeyFor(
        { module: fileDefModule, name: 'FileDef' },
        undefined,
      );
      await testDbAdapter.execute(
        `UPDATE boxel_index SET types = '${JSON.stringify([
          fileDefKey,
        ])}'::jsonb, pristine_doc = NULL WHERE url = '${testRealm}random-file.txt'`,
      );

      let response = await fetch(`${testRealm}random-file.txt`, {
        headers: { Accept: SupportedMimeType.FileMeta },
      });
      assert.strictEqual(response.status, 200, 'file meta response is ok');
      let doc = (await response.json()) as LooseSingleCardDocument;
      let adoptsFrom = doc.data.meta?.adoptsFrom as
        | { module?: string; name?: string }
        | undefined;
      assert.strictEqual(
        adoptsFrom?.module,
        fileDefModule,
        'adoptsFrom module sourced from index types',
      );
      assert.strictEqual(
        adoptsFrom?.name,
        'FileDef',
        'adoptsFrom name sourced from index types',
      );
    });
  });

  module('indexing (mutating)', function (hooks) {
    let realm: Realm;
    let adapter: RealmAdapter;
    let testRealmServer: TestRealmServerResult | undefined;

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

      let { data: result } = await realm.realmIndexQueryEngine.searchCards({
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
      let { data: result } = await realm.realmIndexQueryEngine.searchCards({
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
        await realm.realmIndexQueryEngine.searchCards({
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

    test('expands file deps using module cache for file defs', async function (assert) {
      await realm.write(
        'filedef-helper.gts',
        `
          export function buildName(name: string) {
            return name.toUpperCase();
          }
        `,
      );

      await realm.write(
        'filedef-mismatch.gts',
        `
          import { FileDef as BaseFileDef } from "https://cardstack.com/base/file-api";
          import { buildName } from "./filedef-helper";

          export class FileDef extends BaseFileDef {
            static async extractAttributes(url: string) {
              let name = new URL(url).pathname.split('/').pop() ?? url;
              return { name: buildName(name) };
            }
          }
        `,
      );

      let visibility = await realm.visibility();
      assert.strictEqual(visibility, 'public', 'realm is public');

      let fileDefAlias = `${testRealm}filedef-mismatch`;
      let helperUrl = `${testRealm}filedef-helper`;
      let definitionLookup = (testRealmServer?.testRealmServer as any)
        ?.definitionLookup as DefinitionLookup | undefined;
      if (definitionLookup) {
        await definitionLookup.lookupDefinition({
          module: fileDefAlias,
          name: 'FileDef',
        });
      } else {
        assert.ok(false, 'definition lookup is available');
      }

      let moduleRows = (await testDbAdapter.execute(
        `SELECT url, file_alias, deps, cache_scope, auth_user_id, resolved_realm_url
         FROM modules
         WHERE url = $1 OR file_alias = $1`,
        {
          bind: [fileDefAlias],
          coerceTypes: { deps: 'JSON' },
        },
      )) as {
        url: string;
        file_alias: string | null;
        deps: string[] | string | null;
        cache_scope: string | null;
        auth_user_id: string | null;
        resolved_realm_url: string | null;
      }[];
      assert.ok(
        moduleRows.length > 0,
        'module cache entry exists for file def',
      );
      assert.strictEqual(
        moduleRows[0]?.url,
        `${fileDefAlias}.gts`,
        'module cache entry URL matches file def module URL',
      );
      assert.strictEqual(
        moduleRows[0]?.file_alias,
        fileDefAlias,
        'module cache entry file_alias matches file def alias',
      );
      let moduleDeps = moduleRows[0]?.deps;
      assert.ok(Array.isArray(moduleDeps), 'module cache deps are an array');
      assert.ok(
        moduleDeps?.includes(helperUrl),
        'module cache deps include helper module',
      );
      assert.strictEqual(
        moduleRows[0]?.cache_scope,
        'public',
        'module cache entry uses public scope',
      );
      assert.strictEqual(
        moduleRows[0]?.auth_user_id,
        '',
        'module cache entry uses empty auth_user_id for public scope',
      );
      assert.strictEqual(
        moduleRows[0]?.resolved_realm_url,
        `${testRealm}`,
        'module cache entry uses resolved realm URL',
      );
      let moduleQueryRows = (await testDbAdapter.execute(
        `SELECT url FROM modules
         WHERE resolved_realm_url = $1
           AND cache_scope = $2
           AND auth_user_id = $3
           AND (url = $4 OR file_alias = $4)`,
        {
          bind: [`${testRealm}`, 'public', '', fileDefAlias],
        },
      )) as { url: string }[];
      assert.ok(
        moduleQueryRows.length > 0,
        'module cache entry is returned for indexer query context',
      );

      if (definitionLookup) {
        let moduleEntries = await definitionLookup.getModuleCacheEntries({
          moduleUrls: [fileDefAlias],
          cacheScope: 'public',
          authUserId: '',
          resolvedRealmURL: `${testRealm}`,
        });
        assert.ok(
          moduleEntries[fileDefAlias],
          'definition lookup can read module cache entry',
        );
      } else {
        assert.ok(false, 'definition lookup is available');
      }

      await realm.write('random-file.mismatch', 'mismatch content updated');

      let rows = (await testDbAdapter.execute(
        `SELECT deps FROM boxel_index WHERE url = '${testRealm}random-file.mismatch' AND type = 'file'`,
      )) as { deps: string[] | string | null }[];
      let rawDeps = rows[0]?.deps ?? [];
      let deps = Array.isArray(rawDeps)
        ? rawDeps
        : typeof rawDeps === 'string'
          ? JSON.parse(rawDeps)
          : [];
      assert.ok(
        deps.includes(`${testRealm}filedef-mismatch`),
        'deps include filedef module',
      );
      assert.ok(
        deps.includes(`${testRealm}filedef-helper`),
        `deps include helper module (deps: ${JSON.stringify(deps)})`,
      );
    });

    test('propagates module errors to dependent instances and recovers after missing modules are added', async function (assert) {
      await testDbAdapter.execute('DELETE FROM modules');

      await realm.write(
        'deep-card.json',
        JSON.stringify({
          data: {
            attributes: {
              middle: {
                leaf: {
                  value: 'Root',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './deep-card',
                name: 'DeepCard',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      let brokenInstance = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}deep-card`),
      );
      assert.strictEqual(
        brokenInstance?.type,
        'instance-error',
        'instance is in an error state when DeepCard module is missing',
      );
      if (brokenInstance?.type === 'instance-error') {
        assert.ok(
          brokenInstance.error.deps?.includes(`${testRealm}deep-card`),
          'error deps include missing DeepCard module',
        );
      } else {
        assert.ok(false, 'expected instance error details');
      }

      await realm.write(
        'deep-card.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import { MiddleField } from "./middle-field";

          export class DeepCard extends CardDef {
            @field middle = contains(MiddleField);
          }
        `,
      );

      brokenInstance = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}deep-card`),
      );
      assert.strictEqual(
        brokenInstance?.type,
        'instance-error',
        'instance is in an error state when MiddleField module is missing',
      );
      if (brokenInstance?.type === 'instance-error') {
        let additionalErrors = Array.isArray(
          brokenInstance.error.additionalErrors,
        )
          ? brokenInstance.error.additionalErrors
          : [];
        assert.ok(
          additionalErrors.some((error: { message?: string }) =>
            String(error.message ?? '').includes('middle-field'),
          ),
          'missing MiddleField details are included in dependency errors',
        );
      } else {
        assert.ok(false, 'expected instance error details');
      }

      try {
        await realm.realmIndexQueryEngine.searchCards({
          filter: {
            on: { module: `${testRealm}deep-card`, name: 'DeepCard' },
            eq: { 'middle.leaf.value': 'Root' },
          },
        });
      } catch (_error) {
        // definition lookup errors are expected while dependencies are missing
      }

      let definitionLookup = (testRealmServer?.testRealmServer as any)
        ?.definitionLookup as DefinitionLookup | undefined;
      if (!definitionLookup) {
        assert.ok(false, 'definition lookup is available');
      } else {
        let deepModuleEntry = await definitionLookup.getModuleCacheEntry(
          `${testRealm}deep-card`,
        );
        assert.strictEqual(
          deepModuleEntry?.error?.type,
          'module-error',
          'deep-card module error is cached',
        );
        if (deepModuleEntry?.error?.error) {
          let additionalErrors = Array.isArray(
            deepModuleEntry.error.error.additionalErrors,
          )
            ? deepModuleEntry.error.error.additionalErrors
            : [];
          assert.ok(
            additionalErrors.some((error) =>
              String(error.message ?? '').includes('middle-field'),
            ),
            'deep-card module error includes middle-field error details',
          );
        } else {
          assert.ok(false, 'expected deep-card module error details');
        }

        await realm.write(
          'middle-field.gts',
          `
          import { contains, field, FieldDef } from "https://cardstack.com/base/card-api";
          import { LeafField } from "./leaf-field";

          export class MiddleField extends FieldDef {
            @field leaf = contains(LeafField);
          }
        `,
        );

        try {
          await definitionLookup.lookupDefinition({
            module: `${testRealm}middle-field`,
            name: 'MiddleField',
          });
        } catch (_error) {
          // expected while dependencies are missing
        }

        brokenInstance = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}deep-card`),
        );
        assert.strictEqual(
          brokenInstance?.type,
          'instance-error',
          'instance is in an error state when LeafField module is missing',
        );
        if (brokenInstance?.type === 'instance-error') {
          let additionalErrors = Array.isArray(
            brokenInstance.error.additionalErrors,
          )
            ? brokenInstance.error.additionalErrors
            : [];
          assert.ok(
            additionalErrors.some((error: { message?: string }) =>
              String(error.message ?? '').includes('leaf-field'),
            ),
            'missing LeafField details are included in dependency errors',
          );
        } else {
          assert.ok(false, 'expected instance error details');
        }

        try {
          await realm.realmIndexQueryEngine.searchCards({
            filter: {
              on: { module: `${testRealm}deep-card`, name: 'DeepCard' },
              eq: { 'middle.leaf.value': 'Root' },
            },
          });
        } catch (_error) {
          // definition lookup errors are expected while dependencies are missing
        }

        deepModuleEntry = await definitionLookup.getModuleCacheEntry(
          `${testRealm}deep-card`,
        );
        if (deepModuleEntry?.error?.error) {
          let additionalErrors = Array.isArray(
            deepModuleEntry.error.error.additionalErrors,
          )
            ? deepModuleEntry.error.error.additionalErrors
            : [];
          assert.ok(
            additionalErrors.some((error) =>
              String(error.message ?? '').includes('leaf-field'),
            ),
            'deep-card module error includes leaf-field error details',
          );
        } else {
          assert.ok(false, 'expected deep-card module error details');
        }

        let middleModuleEntry = await definitionLookup.getModuleCacheEntry(
          `${testRealm}middle-field`,
        );
        assert.strictEqual(
          middleModuleEntry?.error?.type,
          'module-error',
          'middle-field module error is cached',
        );
        if (middleModuleEntry?.error?.error) {
          let additionalErrors = Array.isArray(
            middleModuleEntry.error.error.additionalErrors,
          )
            ? middleModuleEntry.error.error.additionalErrors
            : [];
          assert.ok(
            additionalErrors.some((error) =>
              String(error.message ?? '').includes('leaf-field'),
            ),
            'middle-field module error includes leaf-field error details',
          );
        } else {
          assert.ok(false, 'expected middle-field module error details');
        }
      }

      await realm.write(
        'leaf-field.gts',
        `
          import { contains, field, FieldDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class LeafField extends FieldDef {
            @field value = contains(StringField);
          }
        `,
      );

      let healedInstance = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}deep-card`),
      );
      assert.strictEqual(
        healedInstance?.type,
        'instance',
        'instance is repaired when missing module is added',
      );
      let rows = (await testDbAdapter.execute(
        `SELECT error_doc IS NULL AS is_sql_null
         FROM boxel_index
         WHERE realm_url = '${testRealm}'
           AND (
             url = '${testRealm}deep-card.json'
             OR file_alias = '${testRealm}deep-card'
           )
           AND type = 'instance'`,
      )) as { is_sql_null: boolean }[];
      assert.strictEqual(
        rows.length,
        1,
        'index row exists for deep-card instance',
      );
      assert.true(rows[0].is_sql_null, 'error_doc is SQL NULL after recovery');
    });

    test('propagates module cache errors through intermediate modules to instances', async function (assert) {
      await realm.write(
        'module-b.gts',
        `
          export const value = (() => {
            throw new Error('module-b exploded');
          })();
        `,
      );

      await realm.write(
        'module-a.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";
          import { value } from "./module-b";

          export class ModuleCard extends CardDef {
            static moduleBValue = value;
            @field title = contains(StringField);
          }
        `,
      );

      await realm.write(
        'module-a.json',
        JSON.stringify({
          data: {
            attributes: {
              title: 'Hello',
            },
            meta: {
              adoptsFrom: {
                module: './module-a',
                name: 'ModuleCard',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      let definitionLookup = (testRealmServer?.testRealmServer as any)
        ?.definitionLookup as DefinitionLookup | undefined;
      if (definitionLookup) {
        let moduleBEntry = await definitionLookup.getModuleCacheEntry(
          `${testRealm}module-b`,
        );
        assert.strictEqual(
          moduleBEntry?.error?.type,
          'module-error',
          'module-b error is cached',
        );
        if (moduleBEntry?.error?.error) {
          assert.ok(
            String(moduleBEntry.error.error.message ?? '').includes(
              'module-b exploded',
            ),
            'module-b error message is cached',
          );
        } else {
          assert.ok(false, 'expected module-b error details');
        }

        let moduleAEntry = await definitionLookup.getModuleCacheEntry(
          `${testRealm}module-a`,
        );
        assert.strictEqual(
          moduleAEntry?.error?.type,
          'module-error',
          'module-a error is cached',
        );
        if (moduleAEntry?.error?.error) {
          let additionalErrors = Array.isArray(
            moduleAEntry.error.error.additionalErrors,
          )
            ? moduleAEntry.error.error.additionalErrors
            : [];
          let hasModuleBDetail =
            String(moduleAEntry.error.error.message ?? '').includes(
              'module-b exploded',
            ) ||
            additionalErrors.some((error) =>
              String(error.message ?? '').includes('module-b exploded'),
            );
          assert.ok(
            hasModuleBDetail,
            'module-a error includes module-b error details',
          );
        } else {
          assert.ok(false, 'expected module-a error details');
        }
      } else {
        assert.ok(false, 'definition lookup is available');
      }

      let instanceEntry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}module-a`),
      );
      assert.strictEqual(
        instanceEntry?.type,
        'instance-error',
        'instance is in an error state when module-b explodes',
      );
      if (instanceEntry?.type === 'instance-error') {
        let additionalErrors = Array.isArray(
          instanceEntry.error.additionalErrors,
        )
          ? instanceEntry.error.additionalErrors
          : [];
        let hasModuleBDetail =
          String(instanceEntry.error.message ?? '').includes(
            'module-b exploded',
          ) ||
          additionalErrors.some((error: { message?: string }) =>
            String(error.message ?? '').includes('module-b exploded'),
          );
        assert.ok(
          hasModuleBDetail,
          'instance error includes module-b error details',
        );
      } else {
        assert.ok(false, 'expected instance error details');
      }
    });

    test('can incrementally index deleted instance', async function (assert) {
      await realm.delete('mango.json');

      let { data: result } = await realm.realmIndexQueryEngine.searchCards({
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
        realm.realmIndexUpdater.stats.instanceErrors,
        0,
        'no instance errors occurred',
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

      let { data: result } = await realm.realmIndexQueryEngine.searchCards({
        filter: {
          on: { module: `${testRealm}post`, name: 'Post' },
          eq: { nickName: 'Van Gogh-poo' },
        },
      });
      assert.strictEqual(result.length, 1, 'found updated document');
    });

    test('can recover from a module sequence error', async function (assert) {
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

      let response = await fetch(`${testRealm}pet-apple`, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      assert.strictEqual(
        response.status,
        500,
        'card endpoint returns error before dependency exists',
      );
      let errorDoc = await response.json();
      assert.strictEqual(
        errorDoc.errors?.[0]?.id,
        `${testRealm}pet-apple`,
        'error response references the card url',
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

      response = await fetch(`${testRealm}pet-apple`, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      assert.strictEqual(
        response.status,
        200,
        'card endpoint succeeds after dependency exists',
      );
      let doc = await response.json();
      assert.strictEqual(
        doc.data?.attributes?.name?.firstName,
        'Apple',
        'card response includes the resolved data',
      );
    });

    test('can successfully create instance after module sequence error is resolved', async function (assert) {
      await realm.write(
        'pet.gts',
        `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import { Name } from "./name";

          export class Pet extends CardDef {
            @field name = contains(Name);
          }
        `,
      );

      await realm.write(
        'pet-ember.json',
        JSON.stringify({
          data: {
            attributes: {
              name: {
                firstName: 'Ember',
                lastName: 'Glow',
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

      let response = await fetch(`${testRealm}pet-ember`, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      assert.strictEqual(
        response.status,
        500,
        'card endpoint returns error before dependency exists',
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

      await realm.write(
        'pet-puffin.json',
        JSON.stringify({
          data: {
            attributes: {
              name: {
                firstName: 'Puffin',
                lastName: 'Light',
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

      let createdResponse = await fetch(`${testRealm}pet-puffin`, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      assert.strictEqual(
        createdResponse.status,
        200,
        'created card can be fetched after dependency exists',
      );
      let fetchedDoc =
        (await createdResponse.json()) as LooseSingleCardDocument;
      assert.strictEqual(
        fetchedDoc.data?.attributes?.name?.lastName,
        'Light',
        'fetched card includes the expected attributes',
      );
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

      let { data: result } = await realm.realmIndexQueryEngine.searchCards({
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
        let { data: result } = await realm.realmIndexQueryEngine.searchCards({
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
        assert.strictEqual(
          actual.error.errorDetail.id,
          `${testRealm}post`,
          'error id is post module URL',
        );
        assert.true(
          actual.error.errorDetail.isCardError,
          'error is marked as a card error',
        );
        assert.strictEqual(
          actual.error.errorDetail.additionalErrors,
          null,
          'no additional dependency errors are present',
        );
        assert.strictEqual(
          actual.error.errorDetail.message,
          `missing file ${testRealm}post`,
          'error message identifies missing module',
        );
        assert.strictEqual(
          actual.error.errorDetail.status,
          404,
          'error status is 404',
        );
        assert.strictEqual(
          actual.error.errorDetail.title,
          'Link Not Found',
          'error title is Link Not Found',
        );
        assert.ok(
          actual.error.errorDetail.deps?.includes(`${testRealm}post`),
          'error deps include missing module',
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
        let { data: result } = await realm.realmIndexQueryEngine.searchCards({
          filter: {
            on: { module: `${testRealm}post`, name: 'Post' },
            eq: { nickName: 'Van Gogh-poo' },
          },
        });
        assert.strictEqual(result.length, 1, 'found the post instance');
      }
    });

    test('can write several module files at once', async function (assert) {
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
      mapOfWrites.set('notes.txt', 'Hello from writeMany');
      let result = await realm.writeMany(mapOfWrites);
      assert.strictEqual(result.length, 3, '3 files were written');
      assert.strictEqual(result[0].path, 'place.gts');
      assert.strictEqual(result[1].path, 'country.gts');
      assert.strictEqual(result[2].path, 'notes.txt');

      let place = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}place.gts`),
      );
      assert.ok(place, 'place file is in the index');

      let country = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}country.gts`),
      );
      assert.ok(country, 'country file is in the index');
      let fileEntry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}notes.txt`),
      );
      assert.ok(fileEntry, 'file entry is in the index');
      assert.strictEqual(
        realm.realmIndexUpdater.stats.filesIndexed,
        3,
        'indexed correct number of files',
      );
    });

    test('can write instances and module files and files at once', async function (assert) {
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
      mapOfWrites.set('notes.txt', 'Hello from mixed writeMany');
      let result = await realm.writeMany(mapOfWrites);
      assert.strictEqual(result.length, 3, '3 files were written');
      assert.strictEqual(result[0].path, 'city.gts');
      assert.strictEqual(result[1].path, 'city.json');
      assert.strictEqual(result[2].path, 'notes.txt');

      let moduleFile = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}city.gts`),
      );
      assert.ok(moduleFile, 'city file is in the index');

      let instance = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}city`),
      );
      assert.ok(instance, 'city instance is in the index');
      let fileEntry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}notes.txt`),
      );
      assert.ok(fileEntry, 'file entry for notes.txt is in the index');
      let instanceFileEntry = await realm.realmIndexQueryEngine.file(
        new URL(`${testRealm}city.json`),
      );
      assert.ok(instanceFileEntry, 'file entry for city.json is in the index');
      assert.deepEqual(
        {
          filesIndexed: realm.realmIndexUpdater.stats.filesIndexed,
          fileErrors: realm.realmIndexUpdater.stats.fileErrors,
          instancesIndexed: realm.realmIndexUpdater.stats.instancesIndexed,
          instanceErrors: realm.realmIndexUpdater.stats.instanceErrors,
        },
        {
          filesIndexed: 2,
          fileErrors: 0,
          instancesIndexed: 1,
          instanceErrors: 0,
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

  module('permissioned realm', function () {
    let testRealm1URL = 'http://127.0.0.1:4447/test/';
    let testRealm2URL = 'http://127.0.0.1:4448/test/';
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

      test('indexes a card from another realm when it has permission to read', async function (assert) {
        let stats = { ...testRealm2.realmIndexUpdater.stats };
        assert.strictEqual(stats.fileErrors, 0, 'no file errors');
        assert.strictEqual(stats.instanceErrors, 0, 'no instance errors');
        assert.strictEqual(stats.filesIndexed, 2, 'indexed all files');
        assert.strictEqual(stats.instancesIndexed, 1, 'indexed instances');
        assert.strictEqual(
          stats.totalIndexEntries,
          3,
          'total entries are correct',
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

      test('surfaces instance errors when lacking permission to read from another realm', async function (assert) {
        // Error during indexing will be: "Authorization error: Insufficient
        // permissions to perform this action"
        let stats = { ...testRealm2.realmIndexUpdater.stats };
        let surfacedAuthorizationError =
          stats.instanceErrors === 1 && stats.instancesIndexed === 0;
        let indexingFailedBeforeStatsWereProduced =
          stats.instanceErrors === 0 &&
          stats.instancesIndexed === 0 &&
          stats.fileErrors === 0 &&
          stats.filesIndexed === 0 &&
          stats.totalIndexEntries === 0;

        if (surfacedAuthorizationError) {
          assert.strictEqual(
            stats.instanceErrors,
            1,
            'instance errors surfaced',
          );
          assert.strictEqual(stats.instancesIndexed, 0, 'no instances indexed');
        } else {
          assert.true(
            indexingFailedBeforeStatsWereProduced,
            `indexing failed before stats were produced: ${JSON.stringify(
              stats,
            )}`,
          );
        }
      });
    });
  });
});
