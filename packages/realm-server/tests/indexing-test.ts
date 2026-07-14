import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  internalKeyFor,
  rri,
  SupportedMimeType,
  Deferred,
  IndexWriter,
  VirtualNetwork,
  userInitiatedPriority,
  diffDoc,
} from '@cardstack/runtime-common';
import type {
  DBAdapter,
  DefinitionLookup,
  LooseSingleCardDocument,
  Prerenderer,
  Realm,
  RealmPermissions,
  RealmAdapter,
} from '@cardstack/runtime-common';
import type {
  IndexedInstance,
  QueuePublisher,
  QueueRunner,
} from '@cardstack/runtime-common';
import type { runTestRealmServer } from './helpers/index.ts';
import {
  cleanWhiteSpace,
  waitUntil,
  cardInfo,
  getTestPrerenderer,
  setupPermissionedRealmCached,
  setupPermissionedRealmsCached,
  searchCardsForTest,
} from './helpers/index.ts';
import {
  depsForIndexEntry,
  errorDocForIndexEntry,
  indexedAtForIndexEntry,
  settlePrerenderHtmlJobs,
  typeForIndexEntry,
} from './helpers/indexing.ts';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';

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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";

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
      import { contains, linksTo, field, CardDef, Component, StringField } from "@cardstack/base/card-api";
      import { Pet } from "./pet";

      export class PetPerson extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(() => Pet, { searchable: true });
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
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
    `,
    'fancy-person.gts': `
      import { contains, field, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
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
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { Person } from "./person";

      export class Post extends CardDef {
        static displayName = 'Post';
        @field author = linksTo(Person, { searchable: true });
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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
            module: rri('./person'),
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
            module: rri('./person'),
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
            module: rri('./pet-person'),
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
            module: rri('./pet'),
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
            module: rri('./post'),
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
            module: rri('./post'),
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
            module: rri('./boom'),
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
            module: rri('./boom2'),
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
            module: rri('./atom-boom'),
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
            module: rri('./embedded-boom'),
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
            module: rri('./fitted-boom'),
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
            module: rri('@cardstack/base/card-api'),
            name: 'CardDef',
          },
        },
      },
    },
    'address.gts': `
      import { contains, field, FieldDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Address extends FieldDef {
        @field street = contains(StringField);
        @field city = contains(StringField);
      }
    `,
    'order-page.gts': `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import { Address } from "./address";

      export class OrderPage extends CardDef {
        @field shippingAddress = contains(Address);
      }
    `,
    'fieldof-address.json': {
      data: {
        attributes: {
          street: '123 Main St',
          city: 'Anytown',
        },
        meta: {
          adoptsFrom: {
            type: 'fieldOf',
            field: 'shippingAddress',
            card: {
              module: rri('./order-page'),
              name: 'OrderPage',
            },
          },
        },
      },
    },
    'filedef-mismatch.gts': `
      import {
        FileDef as BaseFileDef,
        FileContentMismatchError,
      } from "@cardstack/base/file-api";

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

module(basename(import.meta.filename), function () {
  module('indexing (read only)', function (hooks) {
    let realm: Realm;

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

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: {
        '*': ['read'],
      },
      fileSystem: makeTestRealmFileSystem(),
      onRealmSetup({ dbAdapter, testRealm }) {
        testDbAdapter = dbAdapter;
        realm = testRealm;
      },
    });

    // Guards the contract that a brand-new realm (empty boxel_index state)
    // always full-indexes on first boot — independent of
    // REALM_SERVER_FULL_INDEX_ON_STARTUP. `createRealm` (the test helper)
    // never passes `fullIndexOnStartup`, so the realm here has it set to
    // false; the from-scratch job below is produced by the `isNewIndex`
    // branch in Realm.start(), not by the env-var-driven branch.
    test('newly-created realm full-indexes on first boot', async function (assert) {
      let jobs = await testDbAdapter.execute('select * from jobs order by id');
      assert.strictEqual(
        jobs.length,
        2,
        'the boot produced an index job and its spawned prerender_html job',
      );
      let [indexJob, prerenderJob] = jobs;
      assert.strictEqual(
        indexJob.job_type,
        'from-scratch-index',
        'the first job is a from scratch index job',
      );
      assert.strictEqual(
        indexJob.concurrency_group,
        `indexing:${testRealm}`,
        'the job is an index of the test realm',
      );
      assert.strictEqual(
        indexJob.status,
        'resolved',
        'the job completed successfully',
      );
      assert.ok(indexJob.finished_at, 'the job was marked with a finish time');

      // The between-visit phase decomposition rides on the job result so the
      // ~one-in-four of the wall the job spends outside the per-row server
      // render is queryable per job (`jobs.result.phaseTimings`).
      let indexResult = indexJob.result as {
        phaseTimings?: Record<string, unknown>;
      } | null;
      let phaseTimings = indexResult?.phaseTimings;
      assert.ok(
        phaseTimings,
        `the from-scratch index job result carries a phaseTimings breakdown, got: ${JSON.stringify(
          indexResult,
        )}`,
      );
      // The module pre-warm sweep runs on the from-scratch-spawned
      // prerender_html job, not the index job, so `preWarmMs` is absent here
      // and asserted on the prerender job's result below.
      for (let phase of [
        'totalMs',
        'setupMs',
        'mtimesMs',
        'discoverMs',
        'orderMs',
        'visitLoopMs',
        'writeMs',
        'swapMs',
      ]) {
        assert.strictEqual(
          typeof phaseTimings?.[phase],
          'number',
          `phaseTimings.${phase} is measured on the from-scratch job result, got: ${JSON.stringify(
            phaseTimings?.[phase],
          )}`,
        );
      }
      assert.strictEqual(
        (phaseTimings as Record<string, unknown>)?.preWarmMs,
        undefined,
        'the index job does not record preWarmMs — the sweep runs on the prerender job',
      );

      assert.strictEqual(
        prerenderJob.job_type,
        'prerender_html',
        'the index pass spawned an HTML prerender job',
      );
      assert.strictEqual(
        prerenderJob.concurrency_group,
        `prerender-html:${testRealm}`,
        'HTML work runs in its own per-realm concurrency group',
      );
      assert.strictEqual(
        prerenderJob.status,
        'resolved',
        'the prerender_html job completed successfully',
      );
      let prerenderArgs = prerenderJob.args as {
        generation: number;
        spawningJobId: number | null;
        changes: { url: string; operation: string }[];
      };
      assert.strictEqual(
        prerenderArgs.generation,
        1,
        'the job carries the generation the index pass anticipated',
      );
      assert.strictEqual(
        prerenderArgs.spawningJobId,
        indexJob.id,
        'the job is correlated back to the index pass that spawned it',
      );
      assert.true(
        prerenderArgs.changes.every((change) => change.operation === 'update'),
        'the job carries the invalidation set as update operations',
      );
      assert.true(
        prerenderArgs.changes.some(
          (change) => change.url === `${testRealm}mango.json`,
        ),
        'the invalidation set covers the realm content',
      );
      assert.true(
        (prerenderJob.args as { preWarm?: boolean }).preWarm,
        'a from-scratch-spawned prerender job carries the pre-warm bit',
      );

      // The module pre-warm sweep's wall-clock is attributed to the job that
      // pays it: the prerender job records `preWarmMs`, the index job does not.
      let prerenderResult = prerenderJob.result as {
        phaseTimings?: { preWarmMs?: unknown } | null;
      } | null;
      assert.strictEqual(
        typeof prerenderResult?.phaseTimings?.preWarmMs,
        'number',
        `the prerender job result records the pre-warm wall-clock, got: ${JSON.stringify(
          prerenderResult,
        )}`,
      );
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

    test('a card whose linksTo target fails to load indexes successfully with the broken target captured in deps', async function (assert) {
      let entry = await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealm}bad-link`),
      );
      assert.strictEqual(
        entry?.type,
        'instance',
        'card with an unreachable linksTo target indexes as a clean instance — the broken slot renders the placeholder, the entry itself is not in error',
      );
      let deps = (entry?.deps ?? []).map((d) =>
        d.endsWith('.json') ? d.slice(0, -5) : d,
      );
      assert.ok(deps.includes(`${testRealm}post`), 'deps include post module');
      assert.ok(
        deps.includes(`http://localhost:9000/this-is-a-link-to-nowhere`),
        'deps include the unreachable link target so invalidation can reach this card if it becomes reachable',
      );

      // The broken slot is also recorded as searchable metadata on the
      // (successful) index row: the render.meta scan runs getBrokenLinks
      // after the store settles and the finding rides the diagnostics
      // channel into `boxel_index.diagnostics.brokenLinks`. This is
      // the direct, indexed signal that lets a consumer enumerate
      // cards-with-broken-links without parsing HTML or re-running the scan.
      let [diagRow] = (await testDbAdapter.execute(
        `SELECT diagnostics FROM boxel_index WHERE realm_url = $1 AND url = $2 AND type = 'instance'`,
        { bind: [realm.url, `${testRealm}bad-link.json`] },
      )) as { diagnostics: { brokenLinks?: unknown } | null }[];
      let brokenLinks = diagRow?.diagnostics?.brokenLinks as
        | { fieldName: string; reference: string; kind: string }[]
        | undefined;
      assert.strictEqual(
        brokenLinks?.length,
        1,
        `diagnostics.brokenLinks records the single broken slot, got: ${JSON.stringify(
          brokenLinks,
        )}`,
      );
      assert.strictEqual(
        brokenLinks?.[0]?.fieldName,
        'author',
        'broken-link finding names the linksTo field',
      );
      assert.strictEqual(
        brokenLinks?.[0]?.reference,
        'http://localhost:9000/this-is-a-link-to-nowhere',
        'broken-link finding carries the unreachable reference',
      );
      // An unreachable external host fails as a generic fetch error rather
      // than a 404; either is a valid terminal broken-link kind.
      assert.ok(
        ['error', 'not-found'].includes(brokenLinks?.[0]?.kind ?? ''),
        `broken-link finding carries a terminal kind, got: ${brokenLinks?.[0]?.kind}`,
      );

      // The search-doc settle aggregates ride the same channel onto the
      // persisted row: render.meta stamps them on every card visit.
      let diagnostics = diagRow?.diagnostics as
        | { searchDocSettleMs?: unknown; searchDocSettlePasses?: unknown }
        | null
        | undefined;
      assert.strictEqual(
        typeof diagnostics?.searchDocSettleMs,
        'number',
        `diagnostics.searchDocSettleMs persists on boxel_index, got: ${JSON.stringify(diagnostics?.searchDocSettleMs)}`,
      );
      assert.strictEqual(
        typeof diagnostics?.searchDocSettlePasses,
        'number',
        `diagnostics.searchDocSettlePasses persists on boxel_index, got: ${JSON.stringify(diagnostics?.searchDocSettlePasses)}`,
      );

      // The per-visit client overhead (file read, render round-trip transport,
      // post-render bookkeeping) rides the same channel — the part of the index
      // job's between-render wall attributable to this row.
      let clientMs = (
        diagRow?.diagnostics as {
          indexVisitClientMs?: {
            read?: unknown;
            renderRpc?: unknown;
            bookkeeping?: unknown;
          };
        } | null
      )?.indexVisitClientMs;
      for (let bucket of ['read', 'renderRpc', 'bookkeeping'] as const) {
        assert.strictEqual(
          typeof clientMs?.[bucket],
          'number',
          `diagnostics.indexVisitClientMs.${bucket} persists on boxel_index, got: ${JSON.stringify(clientMs?.[bucket])}`,
        );
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
            // Only `pet` appears: it is the relationship this card actually
            // has (a set target). The base-card `cardInfo.theme` /
            // `cardInfo.cardThumbnail` links are never authored here, so they
            // drop from the pristine doc — this filtering is data-driven, not
            // searchable-driven (they still appear in the search doc, which
            // enumerates every declared field).
            pet: {
              links: {
                self: './ringo',
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
        // The searchable-driven generator is authoritative: every relationship
        // is present (an unset link is `null`, a set one expands per its
        // `searchable` annotation), and every card carries its base-card fields
        // (`cardTheme`, `cardInfo.cardThumbnail`). The expected doc is the exact
        // generator output; `diffDoc(..., false)` reports any deviation.
        assert.deepEqual(
          diffDoc(
            {
              id: hassanId,
              pet: {
                id: `${testRealm}ringo`,
                cardTitle: 'Untitled Card',
                firstName: 'Ringo',
                cardTheme: null,
                cardInfo: {
                  cardThumbnail: null,
                  theme: null,
                },
              },
              nickName: "Ringo's buddy",
              _cardType: 'PetPerson',
              firstName: 'Hassan',
              cardTitle: 'Untitled Card',
              cardTheme: null,
              cardInfo: {
                cardThumbnail: null,
                theme: null,
              },
            },
            hassanEntry.searchDoc ?? {},
            false,
          ),
          [],
          'searchData is correct',
        );
      } else {
        assert.ok(false, `could not find ${hassanId} in the index`);
      }
    });

    test('it can index a card whose adoptsFrom is a fieldOf CodeRef', async function (assert) {
      const cardId = `${testRealm}fieldof-address`;
      let entry = await getInstance(realm, new URL(cardId));
      if (entry) {
        assert.strictEqual(entry.searchDoc?.street, '123 Main St');
        assert.strictEqual(entry.searchDoc?.city, 'Anytown');
      } else {
        assert.ok(false, `could not find ${cardId} in the index`);
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
                module: rri('./fancy-person'),
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
            /@cardstack\/base\/default-templates\/embedded\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/embedded.gts',
        },
        {
          pattern:
            /@cardstack\/base\/default-templates\/isolated-and-edit\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/isolated-and-edit.gts',
        },
        {
          pattern:
            /@cardstack\/base\/default-templates\/missing-template\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/missing-template.gts',
        },
        {
          pattern:
            /@cardstack\/base\/default-templates\/field-edit\.gts.*\.glimmer-scoped\.css$/,
          fileName: 'default-templates/field-edit.gts',
        },
        {
          pattern:
            /@cardstack\/base\/links-to-many-component.gts.*\.glimmer-scoped\.css$/,
          fileName: 'links-to-many-component.gts',
        },
        {
          pattern:
            /@cardstack\/base\/links-to-editor.gts.*\.glimmer-scoped\.css$/,
          fileName: 'links-to-editor.gts',
        },
        {
          pattern:
            /@cardstack\/base\/contains-many-component.gts.*\.glimmer-scoped\.css$/,
          fileName: 'contains-many-component.gts',
        },
        {
          pattern:
            /@cardstack\/base\/field-component.gts.*\.glimmer-scoped\.css$/,
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
      assert.strictEqual(
        typeof entry?.searchDoc?.contentSize,
        'number',
        'search_doc includes contentSize',
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

      // CS-11171: executable modules are FileDef subclasses — `person.gts`
      // resolves to GtsFileDef, which inherits its fitted/isolated/etc.
      // templates (and their `data-test-ts-*` markers) from TsFileDef.
      // CardsGrid's "All Files" group renders those formats. Before the
      // fix, the fused visit gated fileRender behind `!isModule`, so every
      // HTML column on these rows was NULL and the grid showed nothing.
      // The FileDef FileRender pass now runs for modules too.
      assert.ok(
        entry?.isolatedHtml?.includes('data-test-ts-isolated'),
        'executable file entry has FileDef isolated HTML (GtsFileDef, via the inherited TsFileDef template)',
      );
      let fittedHtml = Object.values(entry?.fittedHtml ?? {}).join('');
      assert.ok(
        fittedHtml.includes('data-test-ts-fitted'),
        'executable file entry has FileDef fitted HTML (GtsFileDef, via the inherited TsFileDef template)',
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
      assert.strictEqual(
        typeof entry?.searchDoc?.contentSize,
        'number',
        'file entry includes contentSize',
      );
      assert.true(
        entry?.searchDoc?._isCardInstance,
        'file entry for a card instance json is marked _isCardInstance',
      );
      assert.strictEqual(
        entry?.searchDoc?._title,
        'mango.json',
        'file entry _title is the file name',
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
      assert.strictEqual(
        typeof searchDoc.contentSize,
        'number',
        'search_doc includes contentSize',
      );
      assert.strictEqual(
        searchDoc._title,
        'random-file.txt',
        'search_doc _title is the file name',
      );
      assert.false(
        '_isCardInstance' in searchDoc,
        'non-card file search_doc does not carry _isCardInstance',
      );
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
      assert.strictEqual(
        typeof searchDoc.contentSize,
        'number',
        'fallback search_doc includes contentSize',
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
        deps.includes('@cardstack/base/file-api'),
        'deps include base file-api for fallback',
      );
    });

    test('serves FileMeta from index entries', async function (assert) {
      // Mutate the index row so we can validate that the response must come from the index,
      // not from filesystem metadata.
      await testDbAdapter.execute(
        `UPDATE boxel_index SET search_doc = '{"name":"from-index.txt","contentType":"application/x-index-test"}'::jsonb, pristine_doc = '{"id":"${testRealm}random-file.txt","type":"file-meta","attributes":{"name":"from-pristine.txt","contentType":"application/x-pristine","custom":"present"},"meta":{"adoptsFrom":{"module":"https://cardstack.com/base/card-api","name":"FileDef"}}}'::jsonb WHERE url = '${testRealm}random-file.txt'`,
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
          module: rri('@cardstack/base/text-file-def'),
          name: 'TextFileDef',
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
        { module: rri(fileDefModule), name: 'FileDef' },
        undefined,
        realm.virtualNetwork,
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

    module('permissioned realm', function () {
      let testRealm1URL = 'http://127.0.0.1:4447/test/';
      let testRealm2URL = 'http://127.0.0.1:4448/test/';
      let permissionedDbAdapter: PgAdapter;

      function setupRealms(
        hooks: NestedHooks,
        permissions: {
          consumer: RealmPermissions;
          provider: RealmPermissions;
        },
      ) {
        setupPermissionedRealmsCached(hooks, {
          mode: 'before',
          // provider
          realms: [
            {
              realmURL: testRealm1URL,
              permissions: permissions.provider,
              fileSystem: {
                'article.gts': `
                import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
                import StringField from "@cardstack/base/string";
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
                import { contains, field, CardDef, linksTo } from "@cardstack/base/card-api";
                import { Article } from "${testRealm1URL}article" // importing from another realm;
                export class Website extends CardDef {
                  @field linkedArticle = linksTo(Article);
                }`,
                'website-1.json': {
                  data: {
                    attributes: {},
                    meta: {
                      adoptsFrom: {
                        module: rri('./website'),
                        name: 'Website',
                      },
                    },
                  },
                },
              },
            },
          ],
          onRealmSetup({ dbAdapter }) {
            permissionedDbAdapter = dbAdapter;
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
            '@node-test_realm:localhost': ['read', 'realm-owner'],
          },
        });

        test('indexes a card from another realm when it has permission to read', async function (assert) {
          let rows = (await permissionedDbAdapter.execute(
            `SELECT type, has_error
             FROM boxel_index
             WHERE realm_url = $1
               AND (is_deleted = FALSE OR is_deleted IS NULL)`,
            { bind: [testRealm2URL] },
          )) as { type: string; has_error: boolean | null }[];
          let fileRows = rows.filter((row) => row.type === 'file');
          let instanceRows = rows.filter((row) => row.type === 'instance');

          assert.true(
            rows.every((row) => !row.has_error),
            'no index rows have errors',
          );
          assert.strictEqual(fileRows.length, 2, 'indexed all files');
          assert.strictEqual(instanceRows.length, 1, 'indexed instances');
          assert.strictEqual(rows.length, 3, 'total entries are correct');
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
          let rows = (await permissionedDbAdapter.execute(
            `SELECT type, has_error
             FROM boxel_index
             WHERE realm_url = $1
               AND (is_deleted = FALSE OR is_deleted IS NULL)`,
            { bind: [testRealm2URL] },
          )) as { type: string; has_error: boolean | null }[];
          let instanceRows = rows.filter((row) => row.type === 'instance');
          let erroredInstanceRows = instanceRows.filter((row) =>
            Boolean(row.has_error),
          );

          assert.strictEqual(
            erroredInstanceRows.length,
            1,
            'instance errors surfaced',
          );
          assert.strictEqual(
            instanceRows.length - erroredInstanceRows.length,
            0,
            'no successfully indexed instances',
          );
        });
      });
    });
  });

  module('indexing (mutating)', function () {
    function hasErrorDetail(
      error: {
        message?: string;
        additionalErrors?: { message?: string }[] | null;
      },
      needle: string,
    ): boolean {
      let additionalErrors = Array.isArray(error.additionalErrors)
        ? error.additionalErrors
        : [];
      return (
        String(error.message ?? '').includes(needle) ||
        additionalErrors.some((additionalError) =>
          String(additionalError.message ?? '').includes(needle),
        )
      );
    }

    module('batch and incremental operations', function (hooks) {
      let realm: Realm;
      let queuePublisher: QueuePublisher;
      let queueRunner: QueueRunner;
      let testRealmServer: TestRealmServerResult | undefined;
      let virtualNetwork: VirtualNetwork;

      hooks.beforeEach(function () {
        virtualNetwork = new VirtualNetwork();
      });

      setupPermissionedRealmCached(hooks, {
        mode: 'beforeEach',
        realmURL: testRealm,
        permissions: {
          '*': ['read'],
        },
        fileSystem: makeTestRealmFileSystem(),
        onRealmSetup({
          dbAdapter,
          publisher,
          runner,
          testRealmServer: server,
          testRealm: r,
        }) {
          testDbAdapter = dbAdapter;
          queuePublisher = publisher;
          queueRunner = runner;
          testRealmServer = server;
          realm = r;
        },
      });

      async function startIndexingGroupBlocker() {
        let started = new Deferred<void>();
        let release = new Deferred<void>();
        queueRunner.register('blocking-indexing-group', async () => {
          started.fulfill();
          await release.promise;
          return null;
        });
        let blocker = await queuePublisher.publish<void>({
          jobType: 'blocking-indexing-group',
          concurrencyGroup: `indexing:${realm.url}`,
          timeout: 30,
          args: null,
        });
        await started.promise;
        return { blocker, release };
      }

      test('batch invalidation resolves alias-like seeds via file_alias matching', async function (assert) {
        let batch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );

        await batch.invalidate([new URL(`${testRealm}mango`)]);

        assert.ok(
          batch.invalidations.includes(`${testRealm}mango.json`),
          'instance-id style seed resolves to concrete indexed URL',
        );

        let jsonSeedBatch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );
        await jsonSeedBatch.invalidate([new URL(`${testRealm}mango.json`)]);
        assert.ok(
          jsonSeedBatch.invalidations.includes(`${testRealm}mango.json`),
          '.json seed resolves to concrete indexed URL',
        );
      });

      test('batch invalidation resolves alias-like seeds from staged working rows', async function (assert) {
        let stagedOnlyURL = new URL(`${testRealm}staged-only.json`);
        let stagedAliasURL = new URL(`${testRealm}staged-only`);

        let stagingBatch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );
        await stagingBatch.updateEntry(stagedOnlyURL, {
          type: 'file',
          deps: new Set<string>(),
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
        });

        let invalidationBatch = await new IndexWriter(
          testDbAdapter,
        ).createBatch(new URL(realm.url), virtualNetwork);
        await invalidationBatch.invalidate([stagedAliasURL]);

        assert.ok(
          invalidationBatch.invalidations.includes(stagedOnlyURL.href),
          'instance-id style seed resolves via boxel_index_working row before production commit',
        );
      });

      test('batch invalidation tombstones all rows that share a matching file_alias', async function (assert) {
        let batch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );

        await batch.invalidate([new URL(`${testRealm}mango`)]);
        await batch.done();

        let rows = (await testDbAdapter.execute(
          `SELECT type, is_deleted
         FROM boxel_index
         WHERE realm_url = $1
           AND url = $2
           AND type IN ('instance', 'file')
         ORDER BY type`,
          {
            bind: [realm.url, `${testRealm}mango.json`],
          },
        )) as { type: 'instance' | 'file'; is_deleted: boolean }[];

        assert.deepEqual(
          rows.map((row) => row.type),
          ['file', 'instance'],
          'both file and instance rows were selected',
        );
        assert.true(
          rows.every((row) => row.is_deleted === true),
          'all matching rows were tombstoned',
        );
      });

      test('batch invalidation clears has_error and error_doc when tombstoning a previously-errored row', async function (assert) {
        // The primary key is `(url, realm_url, type)` — no `generation` —
        // so a tombstone upsert always collides with the prior row for the
        // same URL. Any column NOT in the tombstone upsert's SET list keeps
        // its previous value. Before this guard, `has_error` and `error_doc`
        // were not in that list, so an errored row stayed errored across
        // every subsequent reindex even after the file was deleted —
        // producing a "has_error = true, error_doc = jsonb null" shape
        // that propagates forever and is invisible to UI / DB triage.
        let mangoURL = new URL(`${testRealm}mango.json`);

        // 1. Plant an error row in boxel_index by writing an
        //    instance-error entry and committing the batch.
        let errorBatch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );
        await errorBatch.updateEntry(mangoURL, {
          type: 'instance-error',
          error: {
            id: mangoURL.href,
            status: 500,
            title: 'synthetic test error',
            message: 'synthetic test error to verify tombstone clears it',
            additionalErrors: null,
          },
        });
        await errorBatch.done();

        let plantedRows = (await testDbAdapter.execute(
          `SELECT has_error, error_doc
             FROM boxel_index
             WHERE realm_url = $1 AND url = $2 AND type = 'instance'`,
          { bind: [realm.url, mangoURL.href] },
        )) as { has_error: boolean; error_doc: unknown }[];
        assert.strictEqual(plantedRows.length, 1, 'planted row is present');
        assert.true(
          plantedRows[0].has_error,
          'planted row carries has_error = true',
        );
        assert.ok(plantedRows[0].error_doc, 'planted row has an error_doc');

        // 2. Tombstone the URL.
        let tombstoneBatch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );
        await tombstoneBatch.invalidate([mangoURL]);
        await tombstoneBatch.done();

        // 3. The resulting row must be tombstoned AND have the stale
        //    error state cleared, not preserved by the upsert.
        let postRows = (await testDbAdapter.execute(
          `SELECT is_deleted, has_error, error_doc
             FROM boxel_index
             WHERE realm_url = $1 AND url = $2 AND type = 'instance'`,
          { bind: [realm.url, mangoURL.href] },
        )) as {
          is_deleted: boolean;
          has_error: boolean;
          error_doc: unknown;
        }[];
        assert.strictEqual(postRows.length, 1, 'tombstone row is present');
        assert.true(postRows[0].is_deleted, 'row is marked is_deleted');
        assert.false(
          postRows[0].has_error,
          'tombstone clears has_error from prior errored state',
        );
        assert.strictEqual(
          postRows[0].error_doc,
          null,
          'tombstone clears error_doc from prior errored state',
        );
      });

      test('updateEntry refuses to write an instance-error entry with no error.message', async function (assert) {
        // Defense at the write boundary: a row with `has_error = true`
        // and `error_doc` that lacks a human-readable message is a
        // black hole for triage (the UI surface, the worker stderr,
        // and the DB all show nothing useful). Throw here so the
        // worker reservation can finalize against the per-job cap
        // instead of silently writing the unusable row.
        let batch = await new IndexWriter(testDbAdapter).createBatch(
          new URL(realm.url),
          virtualNetwork,
        );

        for (let badError of [
          undefined,
          {},
          { status: 500, additionalErrors: null },
          { message: '', status: 500, additionalErrors: null },
        ]) {
          await assert.rejects(
            batch.updateEntry(new URL(`${testRealm}mango.json`), {
              type: 'instance-error',
              // The cast is required because the type system already
              // forbids these shapes — the runtime guard exists for
              // the path where bad data slips past TypeScript.
              error: badError as never,
            }),
            /indexer refused instance-error entry/,
            `rejected error shape: ${JSON.stringify(badError)}`,
          );
        }
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
                  module: rri('./person.gts'),
                  name: 'Person',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let { data: result } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: {
                module: rri(`${testRealm}person`),
                name: 'Person',
              },
              eq: { firstName: 'Mang-Mang' },
            },
          },
        );
        assert.strictEqual(result.length, 1, 'found updated document');
        assert.strictEqual(
          realm.realmIndexUpdater.stats.instancesIndexed,
          1,
          'indexed updated instance',
        );
      });

      test('burst incremental updates coalesce into one pending canonical job payload', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let update1 = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            {
              clientRequestId: 'burst-1',
            },
          );
          let update2 = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}vangogh`), new URL(`${testRealm}post-1`)],
            { clientRequestId: 'burst-2' },
          );

          let expectedUrls = [
            `${testRealm}mango`,
            `${testRealm}post-1`,
            `${testRealm}vangogh`,
          ];
          let row = (await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT id, priority, args
             FROM jobs
             WHERE job_type = 'incremental-index'
               AND concurrency_group = $1
               AND status = 'unfulfilled'`,
                { bind: [`indexing:${realm.url}`] },
              )) as {
                id: number;
                priority: number;
                args: {
                  changes: { url: string; operation: 'update' | 'delete' }[];
                };
              }[];
              if (rows.length !== 1) {
                return undefined;
              }
              let urls = rows[0].args.changes
                .map((change) => change.url)
                .sort();
              return urls.length === expectedUrls.length &&
                urls.every((url, i) => url === expectedUrls[i])
                ? rows[0]
                : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage:
                'expected exactly one pending incremental canonical job with all coalesced URLs',
            },
          )) as {
            id: number;
            priority: number;
            args: {
              changes: { url: string; operation: 'update' | 'delete' }[];
            };
          };

          let urls = row.args.changes.map((change) => change.url).sort();
          assert.deepEqual(
            urls,
            expectedUrls,
            'pending canonical incremental args include union of burst invalidations',
          );
          assert.strictEqual(
            row.priority,
            userInitiatedPriority,
            'incremental indexing enqueues canonical pending job at user-initiated priority',
          );

          release.fulfill();
          await Promise.all([blocker.done, update1, update2]);
        } finally {
          release.fulfill();
        }
      });

      test('mixed incremental operations coalesce with delete dominance in pending canonical payload', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let update = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            {
              clientRequestId: 'mixed-update',
            },
          );
          let remove = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            {
              delete: true,
              clientRequestId: 'mixed-delete',
            },
          );

          let row = (await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT args
             FROM jobs
             WHERE job_type = 'incremental-index'
               AND concurrency_group = $1
               AND status = 'unfulfilled'`,
                { bind: [`indexing:${realm.url}`] },
              )) as {
                args: {
                  changes: { url: string; operation: 'update' | 'delete' }[];
                };
              }[];
              return rows.length === 1 ? rows[0] : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage:
                'expected one pending incremental job during mixed-op burst',
            },
          )) as {
            args: {
              changes: { url: string; operation: 'update' | 'delete' }[];
            };
          };

          let operationByUrl = new Map(
            row.args.changes.map((change) => [change.url, change.operation]),
          );
          assert.strictEqual(
            operationByUrl.get(`${testRealm}mango`),
            'delete',
            'delete dominates update for same URL in canonical pending payload',
          );

          release.fulfill();
          await Promise.all([blocker.done, update, remove]);
        } finally {
          release.fulfill();
        }
      });

      test('pending incremental followed by full index keeps separate pending jobs by type', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let incremental = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            { clientRequestId: 'mixed-types-incremental' },
          );
          let full = realm.realmIndexUpdater.fullIndex();

          let rows = (await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT job_type
             FROM jobs
             WHERE concurrency_group = $1
               AND status = 'unfulfilled'
               AND job_type IN ('incremental-index', 'from-scratch-index')`,
                { bind: [`indexing:${realm.url}`] },
              )) as { job_type: string }[];
              return rows.length === 2 ? rows : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage:
                'expected separate pending incremental/from-scratch jobs',
            },
          )) as { job_type: string }[];

          assert.deepEqual(
            rows.map((row) => row.job_type).sort(),
            ['from-scratch-index', 'incremental-index'],
            'mixed indexing job types remain separate pending jobs',
          );

          release.fulfill();
          await Promise.all([blocker.done, incremental, full]);
        } finally {
          release.fulfill();
        }
      });

      test('realm.indexing waits for all queued indexing operations', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let incremental = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            { clientRequestId: 'indexing-race-incremental' },
          );
          let indexingDuringIncremental = realm.indexing();
          let full = realm.realmIndexUpdater.fullIndex();
          let indexingAfterFull = realm.indexing();
          let indexingDuringIncrementalResolved = false;
          let indexingAfterFullResolved = false;
          indexingDuringIncremental?.then(() => {
            indexingDuringIncrementalResolved = true;
          });
          indexingAfterFull?.then(() => {
            indexingAfterFullResolved = true;
          });

          assert.ok(
            indexingDuringIncremental,
            'indexing promise is exposed for the first queued operation',
          );
          assert.ok(
            indexingAfterFull,
            'indexing promise is exposed for the later queued operation',
          );

          release.fulfill();
          await Promise.all([
            blocker.done,
            incremental,
            full,
            indexingDuringIncremental,
            indexingAfterFull,
          ]);
          assert.true(
            indexingDuringIncrementalResolved,
            'indexing promise captured before a later queued operation still resolves',
          );
          assert.true(
            indexingAfterFullResolved,
            'indexing promise captured after the later queued operation resolves too',
          );
        } finally {
          release.fulfill();
        }
      });

      test('realm.incrementalIndexing does not block on a queued from-scratch job', async function (assert) {
        // Regression: the realm write-path gate uses incrementalIndexing(),
        // not indexing(). A from-scratch job sitting in the queue (e.g.
        // behind a system-wide reindex storm) must not block PATCHes — it
        // has no file/index race with realm-server writes, and can be queued
        // for hours.
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let full = realm.realmIndexUpdater.fullIndex();

          await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT id
               FROM jobs
               WHERE concurrency_group = $1
                 AND status = 'unfulfilled'
                 AND job_type = 'from-scratch-index'`,
                { bind: [`indexing:${realm.url}`] },
              )) as { id: number }[];
              return rows.length === 1 ? rows[0] : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage: 'expected one pending from-scratch job',
            },
          );

          assert.ok(
            realm.realmIndexUpdater.indexing(),
            'indexing() still tracks the queued from-scratch (callers wanting "all settled" semantics rely on this)',
          );
          assert.strictEqual(
            realm.realmIndexUpdater.incrementalIndexing(),
            undefined,
            'incrementalIndexing() returns undefined while only a from-scratch job is queued',
          );

          release.fulfill();
          await Promise.all([blocker.done, full]);
        } finally {
          release.fulfill();
        }
      });

      test('realm.incrementalIndexing tracks only the incremental when both incremental and from-scratch are queued', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let incremental = realm.realmIndexUpdater.update(
            [new URL(`${testRealm}mango`)],
            { clientRequestId: 'indexing-mixed-incremental' },
          );
          let full = realm.realmIndexUpdater.fullIndex();

          // Wait until both jobs are pending so the queue state is stable.
          await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT job_type
               FROM jobs
               WHERE concurrency_group = $1
                 AND status = 'unfulfilled'
                 AND job_type IN ('incremental-index', 'from-scratch-index')`,
                { bind: [`indexing:${realm.url}`] },
              )) as { job_type: string }[];
              return rows.length === 2 ? rows : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage:
                'expected one pending incremental and one pending from-scratch',
            },
          );

          let incrementalGate = realm.realmIndexUpdater.incrementalIndexing();
          assert.ok(
            incrementalGate,
            'incrementalIndexing() exposes a promise driven by the incremental',
          );

          release.fulfill();
          await Promise.all([blocker.done, incremental, incrementalGate]);

          // After the incremental drains, the from-scratch may still be
          // running; incrementalIndexing() should already be resolved while
          // indexing() continues to track the from-scratch.
          assert.strictEqual(
            realm.realmIndexUpdater.incrementalIndexing(),
            undefined,
            'incrementalIndexing() returns undefined after the incremental drains, regardless of from-scratch state',
          );

          await full;
        } finally {
          release.fulfill();
        }
      });

      test('burst full-index requests dedupe to one pending canonical from-scratch job', async function (assert) {
        let { blocker, release } = await startIndexingGroupBlocker();
        try {
          let full1 = realm.realmIndexUpdater.fullIndex();
          let full2 = realm.realmIndexUpdater.fullIndex();

          let row = (await waitUntil(
            async () => {
              let rows = (await testDbAdapter.execute(
                `SELECT id, job_type
               FROM jobs
               WHERE concurrency_group = $1
                 AND status = 'unfulfilled'
                 AND job_type = 'from-scratch-index'`,
                { bind: [`indexing:${realm.url}`] },
              )) as { id: number; job_type: string }[];
              return rows.length === 1 ? rows[0] : undefined;
            },
            {
              timeout: 3000,
              interval: 50,
              timeoutMessage:
                'expected one pending canonical from-scratch job during full-index burst',
            },
          )) as {
            id: number;
            job_type: string;
          };
          assert.strictEqual(
            row.job_type,
            'from-scratch-index',
            'canonical pending full-index job remains from-scratch',
          );

          release.fulfill();
          await Promise.all([blocker.done, full1, full2]);
        } finally {
          release.fulfill();
        }
      });

      test('can recover from a card error after error is removed from card source', async function (assert) {
        // introduce errors into 2 cards and observe that invalidation doesn't
        // blindly invalidate all cards are in an error state
        await realm.write(
          'pet.gts',
          `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
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
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        let { data: result } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              type: {
                module: rri(`${testRealm}person`),
                name: 'Person',
              },
            },
          },
        );
        assert.deepEqual(
          result,
          [],
          'the broken type results in no instance results',
        );
        await realm.write(
          'person.gts',
          `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
          }
        `,
        );
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        result = (
          await searchCardsForTest(realm.realmIndexQueryEngine, {
            filter: {
              type: {
                module: rri(`${testRealm}person`),
                name: 'Person',
              },
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
          import { FileDef as BaseFileDef } from "@cardstack/base/file-api";
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
            module: rri(fileDefAlias),
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
          let moduleEntries = await definitionLookup.getCachedDefinitionsBatch({
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

      test('the full-realm module pre-warm sweep runs on the from-scratch-spawned prerender job but not on incrementals', async function (assert) {
        // `fancy-person.gts` is an orphan card module: it defines a CardDef
        // (FancyPerson) but no instance adopts it and no other module
        // imports it. Because nothing ever invalidates it, the only code
        // path that can land it in the module cache is the realm-wide
        // pre-warm sweep — which runs on the prerender_html job a from-scratch
        // index spawns, and is skipped on incremental-spawned prerender jobs.
        // Its presence in the `modules` table is therefore a deterministic
        // signal of whether the sweep ran.
        let orphanAlias = `${testRealm}fancy-person`;

        async function isCached(moduleAlias: string): Promise<boolean> {
          let rows = (await testDbAdapter.execute(
            `SELECT url FROM modules WHERE url = $1 OR file_alias = $1`,
            { bind: [moduleAlias] },
          )) as { url: string }[];
          return rows.length > 0;
        }

        // The realm was from-scratch indexed during setup, and its spawned
        // prerender job (drained before the template snapshot) ran the
        // realm-wide sweep, warming every card module — including the orphan
        // that no instance references.
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        assert.true(
          await isCached(orphanAlias),
          'the from-scratch-spawned prerender job caches the orphan module via the full-realm sweep',
        );

        // Clear the cache, then run an incremental on an unrelated instance.
        // The incremental-spawned prerender job has no realm-wide sweep, and
        // the orphan is neither rendered nor a dependency of the change, so it
        // does not come back — only the realm-wide sweep (from-scratch) would
        // re-cache a module that no instance consumes.
        await testDbAdapter.execute('DELETE FROM modules');
        await realm.write(
          'vangogh.json',
          JSON.stringify({
            data: {
              attributes: { firstName: 'Van Gogh', hourlyRate: 51 },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          }),
        );
        // Drain the incremental-spawned prerender job so its renders have had
        // every chance to touch the cache: it re-warms only what vangogh
        // consumes (Person), never the orphan.
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        assert.false(
          await isCached(orphanAlias),
          'incremental skips the full-realm sweep, leaving the orphan module uncached',
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
                  module: rri('./deep-card'),
                  name: 'DeepCard',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
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
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import { MiddleField } from "./middle-field";

          export class DeepCard extends CardDef {
            @field middle = contains(MiddleField);
          }
        `,
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
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
          await searchCardsForTest(realm.realmIndexQueryEngine, {
            filter: {
              on: {
                module: rri(`${testRealm}deep-card`),
                name: 'DeepCard',
              },
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
          let deepModuleEntry = await definitionLookup.getCachedDefinitions(
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
              additionalErrors.some((error: { message?: string }) =>
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
          import { contains, field, FieldDef } from "@cardstack/base/card-api";
          import { LeafField } from "./leaf-field";

          export class MiddleField extends FieldDef {
            @field leaf = contains(LeafField);
          }
        `,
          );

          try {
            await definitionLookup.lookupDefinition({
              module: rri(`${testRealm}middle-field`),
              name: 'MiddleField',
            });
          } catch (_error) {
            // expected while dependencies are missing
          }

          await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
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
            await searchCardsForTest(realm.realmIndexQueryEngine, {
              filter: {
                on: {
                  module: rri(`${testRealm}deep-card`),
                  name: 'DeepCard',
                },
                eq: { 'middle.leaf.value': 'Root' },
              },
            });
          } catch (_error) {
            // definition lookup errors are expected while dependencies are missing
          }

          deepModuleEntry = await definitionLookup.getCachedDefinitions(
            `${testRealm}deep-card`,
          );
          if (deepModuleEntry?.error?.error) {
            let additionalErrors = Array.isArray(
              deepModuleEntry.error.error.additionalErrors,
            )
              ? deepModuleEntry.error.error.additionalErrors
              : [];
            assert.ok(
              additionalErrors.some((error: { message?: string }) =>
                String(error.message ?? '').includes('leaf-field'),
              ),
              'deep-card module error includes leaf-field error details',
            );
          } else {
            assert.ok(false, 'expected deep-card module error details');
          }

          let middleModuleEntry = await definitionLookup.getCachedDefinitions(
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
              additionalErrors.some((error: { message?: string }) =>
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
          import { contains, field, FieldDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

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
        assert.true(
          rows[0].is_sql_null,
          'error_doc is SQL NULL after recovery',
        );
      });

      test('handles babel duplicate-export error in a consumed module without crashing', async function (assert) {
        await testDbAdapter.execute('DELETE FROM modules');

        // The consumed module has the same top-level class declared twice.
        // Babel rejects this with "Identifier 'X' has already been declared" —
        // this is the exact failure shape we see in staging job 388477 against
        // crypto-portfolio.gts.
        await realm.write(
          'address.gts',
          `
          import { contains, field, FieldDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          export class AddressField extends FieldDef {
            @field address = contains(StringField);
          }
          // duplicate top-level declaration — Babel parse error
          export class AddressField extends FieldDef {
            @field other = contains(StringField);
          }
        `,
        );

        await realm.write(
          'trade.json',
          JSON.stringify({
            data: {
              attributes: {
                title: 'Trade card depending on broken AddressField module',
              },
              meta: {
                adoptsFrom: {
                  module: rri('./address'),
                  name: 'AddressField',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        // Instance should be in an error state, not stale / missing.
        let entry = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}trade`),
        );
        assert.strictEqual(
          entry?.type,
          'instance-error',
          'instance is in error state when its consumed module has a Babel parse error',
        );
        if (entry?.type === 'instance-error') {
          let combinedMessages = [
            String(entry.error.message ?? ''),
            ...(Array.isArray(entry.error.additionalErrors)
              ? entry.error.additionalErrors.map((e: { message?: string }) =>
                  String(e?.message ?? ''),
                )
              : []),
          ].join(' || ');
          assert.ok(
            combinedMessages.includes('already been declared'),
            `error chain mentions the duplicate declaration. saw: ${combinedMessages}`,
          );
          assert.ok(
            entry.error.deps?.some((d) => d.includes('address')),
            'error deps include the broken module',
          );
        }

        // The broken module file lands in boxel_index as a healthy `file`
        // row (has_error=false), not as a `file-error`. fileExtract's
        // metadata-level parse succeeds on the module — the duplicate-
        // declaration only blows up in full Babel transform during card
        // render. The compilation failure surfaces on the consumer card's
        // error doc (asserted above), not on the module's own file row.
        // Pin the current behavior so a future change to where module
        // errors are recorded surfaces here rather than silently
        // downstream.
        let moduleRows = (await testDbAdapter.execute(
          `SELECT type, has_error
             FROM boxel_index
            WHERE realm_url = '${testRealm}'
              AND (
                url = '${testRealm}address.gts'
                OR file_alias = '${testRealm}address'
              )`,
        )) as { type: string; has_error: boolean | null }[];
        assert.strictEqual(
          moduleRows.length,
          1,
          'broken module has exactly one row in boxel_index',
        );
        assert.strictEqual(
          moduleRows[0].type,
          'file',
          'broken module is indexed as a `file` row (not `file-error`) — see comment',
        );
        assert.notOk(
          moduleRows[0].has_error,
          'broken module file row currently has has_error=false — see comment',
        );
      });
    });

    module('additive writes', function (hooks) {
      let realm: Realm;
      let testRealmServer: TestRealmServerResult | undefined;

      async function depsFor(
        url: string,
        type: 'instance' | 'file' = 'instance',
      ): Promise<string[]> {
        return depsForIndexEntry(testDbAdapter, url, type);
      }

      async function indexedAtFor(
        url: string,
        type: 'instance' | 'file' = 'instance',
      ): Promise<string | null> {
        return indexedAtForIndexEntry(testDbAdapter, url, type);
      }

      setupPermissionedRealmCached(hooks, {
        mode: 'before',
        realmURL: testRealm,
        permissions: {
          '*': ['read'],
        },
        fileSystem: makeTestRealmFileSystem(),
        onRealmSetup({ dbAdapter, testRealmServer: server, testRealm: r }) {
          testDbAdapter = dbAdapter;
          testRealmServer = server;
          realm = r;
        },
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
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
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
                  module: rri('./module-a'),
                  name: 'ModuleCard',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let definitionLookup = (testRealmServer?.testRealmServer as any)
          ?.definitionLookup as DefinitionLookup | undefined;
        if (definitionLookup) {
          let moduleBEntry = await definitionLookup.getCachedDefinitions(
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

          let moduleAEntry = await definitionLookup.getCachedDefinitions(
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
              additionalErrors.some((error: { message?: string }) =>
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

      test('collects deep relationship deps from rendered links including field-def linksToMany', async function (assert) {
        await realm.write(
          'person-rel.gts',
          `
          import { CardDef, Component, contains, field, linksTo } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class PersonRel extends CardDef {
            @field name = contains(StringField);
            @field next = linksTo(() => PersonRel);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
                <@fields.next />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'connection-field.gts',
          `
          import { Component, FieldDef, field, linksTo, linksToMany } from "@cardstack/base/card-api";
          import { PersonRel } from "./person-rel";

          export class ConnectionField extends FieldDef {
            @field bestFriend = linksTo(() => PersonRel);
            @field teammates = linksToMany(() => PersonRel);
            @field hiddenFriend = linksTo(() => PersonRel);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <@fields.bestFriend />
                <@fields.teammates />
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.bestFriend />
                <@fields.teammates />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.bestFriend />
                <@fields.teammates />
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <@fields.bestFriend />
                <@fields.teammates />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'relationship-consumer.gts',
          `
          import { CardDef, Component, contains, field } from "@cardstack/base/card-api";
          import { ConnectionField } from "./connection-field";

          export class RelationshipConsumer extends CardDef {
            @field connection = contains(ConnectionField);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.connection />
              </template>
            }
          }
        `,
        );

        let personType = {
          module: rri('./person-rel'),
          name: 'PersonRel',
        };

        await realm.write(
          'deep-1.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Deep One' },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'hidden-deep.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Hidden Deep' },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'friend-a.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Friend A' },
              relationships: {
                next: { links: { self: './deep-1' } },
              },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'friend-b.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Friend B' },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'friend-c.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Friend C' },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'hidden-friend.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Hidden Friend' },
              relationships: {
                next: { links: { self: './hidden-deep' } },
              },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'consumer-relationship.json',
          JSON.stringify({
            data: {
              attributes: {
                connection: {},
              },
              relationships: {
                'connection.bestFriend': { links: { self: './friend-a' } },
                'connection.teammates.0': { links: { self: './friend-b' } },
                'connection.teammates.1': { links: { self: './friend-c' } },
                'connection.hiddenFriend': {
                  links: { self: './hidden-friend' },
                },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./relationship-consumer'),
                  name: 'RelationshipConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let deps = await depsFor(`${testRealm}consumer-relationship.json`);
        let entryType = await typeForIndexEntry(
          testDbAdapter,
          `${testRealm}consumer-relationship.json`,
        );
        assert.ok(true, `consumer-relationship entry type: ${entryType}`);
        assert.ok(true, `relationship deps debug: ${JSON.stringify(deps)}`);
        assert.ok(
          deps.includes(`${testRealm}friend-a.json`),
          `deps include first-degree linksTo relationship (deps: ${JSON.stringify(
            deps,
          )})`,
        );
        assert.ok(
          deps.includes(`${testRealm}friend-b.json`),
          'deps include first linksToMany relationship target',
        );
        assert.ok(
          deps.includes(`${testRealm}friend-c.json`),
          'deps include second linksToMany relationship target',
        );
        assert.ok(
          deps.includes(`${testRealm}deep-1.json`),
          'deps include second-degree relationship exposed by first-degree embedded template',
        );
        assert.notOk(
          deps.includes(`${testRealm}hidden-friend.json`),
          `deps do not include hidden first-degree relationship that is not rendered (type=${entryType}; deps: ${JSON.stringify(
            deps,
          )})`,
        );
        assert.notOk(
          deps.includes(`${testRealm}hidden-deep.json`),
          `deps do not include hidden second-degree relationship that is not rendered (type=${entryType}; deps: ${JSON.stringify(
            deps,
          )})`,
        );
        assert.notOk(
          deps.includes(`${testRealm}friend-a`),
          'instance relationship deps use concrete .json URL form',
        );

        let beforeLinksToInvalidation = await indexedAtFor(
          `${testRealm}consumer-relationship.json`,
        );
        await realm.write(
          'friend-a.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Friend A Updated' },
              relationships: {
                next: { links: { self: './deep-1' } },
              },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        let afterLinksToInvalidation = await indexedAtFor(
          `${testRealm}consumer-relationship.json`,
        );
        assert.notStrictEqual(
          afterLinksToInvalidation,
          beforeLinksToInvalidation,
          'updating linksTo relationship target invalidates consumer instance',
        );

        let beforeLinksToManyInvalidation = afterLinksToInvalidation;
        await realm.write(
          'friend-b.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Friend B Updated' },
              meta: { adoptsFrom: personType },
            },
          } as LooseSingleCardDocument),
        );
        let afterLinksToManyInvalidation = await indexedAtFor(
          `${testRealm}consumer-relationship.json`,
        );
        assert.notStrictEqual(
          afterLinksToManyInvalidation,
          beforeLinksToManyInvalidation,
          'updating linksToMany relationship target invalidates consumer instance',
        );
      });

      // remove this once we have a query based relationship invalidation strategy
      test('does not capture deps from query-backed relationships', async function (assert) {
        await realm.write(
          'query-rel-target.gts',
          `
            import { CardDef, Component, contains, field } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class QueryRelTarget extends CardDef {
              @field cardTitle = contains(StringField);

              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <span><@fields.cardTitle /></span>
                </template>
              }
            }
          `,
        );

        await realm.write(
          'query-rel-consumer.gts',
          `
            import { CardDef, Component, contains, field, linksTo, linksToMany } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class QueryRelConsumer extends CardDef {
              @field cardTitle = contains(StringField);
              @field favorite = linksTo(() => CardDef, {
                query: {
                  filter: {
                    eq: {
                      cardTitle: 'target',
                    },
                  },
                },
              });
              @field matches = linksToMany(() => CardDef, {
                query: {
                  filter: {
                    eq: {
                      cardTitle: 'target',
                    },
                  },
                  page: {
                    size: 10,
                    number: 0,
                  },
                },
              });

              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <@fields.favorite />
                  <@fields.matches />
                </template>
              }
            }
          `,
        );

        await realm.write(
          'query-rel-target-1.json',
          JSON.stringify({
            data: {
              attributes: { cardTitle: 'target' },
              meta: {
                adoptsFrom: {
                  module: rri('./query-rel-target'),
                  name: 'QueryRelTarget',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await realm.write(
          'query-rel-consumer-1.json',
          JSON.stringify({
            data: {
              attributes: { cardTitle: 'consumer' },
              meta: {
                adoptsFrom: {
                  module: rri('./query-rel-consumer'),
                  name: 'QueryRelConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let queryConsumerDoc = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}query-rel-consumer-1`),
          { loadLinks: true },
        );
        if (queryConsumerDoc?.type === 'doc') {
          let relationships = queryConsumerDoc.doc.data.relationships ?? {};
          let favorite = relationships.favorite as
            | {
                links?: Record<string, string | null>;
                data?: { type: string; id: string } | null;
              }
            | undefined;
          let matches = relationships.matches as
            | {
                links?: Record<string, string | null>;
                data?: { type: string; id: string }[];
              }
            | undefined;
          assert.strictEqual(
            typeof favorite?.links?.search,
            'string',
            'query linksTo relationship is present',
          );
          assert.deepEqual(
            favorite?.data,
            {
              type: 'card',
              id: `${testRealm}query-rel-target-1`,
            },
            'query linksTo relationship contains matched target',
          );
          assert.strictEqual(
            typeof matches?.links?.search,
            'string',
            'query linksToMany relationship is present',
          );
          assert.deepEqual(
            matches?.data,
            [
              {
                type: 'card',
                id: `${testRealm}query-rel-target-1`,
              },
            ],
            'query linksToMany relationship contains matched targets',
          );
        } else {
          assert.ok(false, 'expected query-backed consumer document');
        }

        let deps = await depsFor(`${testRealm}query-rel-consumer-1.json`);
        assert.true(deps.length > 0, 'consumer instance has deps');
        assert.notOk(
          deps.includes(`${testRealm}query-rel-target-1.json`),
          'query-backed relationship target is not tracked as a dependency',
        );
        assert.notOk(
          deps.includes(`${testRealm}query-rel-target`),
          'query-backed relationship target module is not tracked as a dependency',
        );
      });

      test('retains deps that are consumed in both query and non-query contexts', async function (assert) {
        await realm.write(
          'query-rel-overlap-target.gts',
          `
            import { CardDef, Component, contains, field } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class QueryRelOverlapTarget extends CardDef {
              @field cardTitle = contains(StringField);

              static embedded = class Embedded extends Component<typeof this> {
                <template>
                  <span><@fields.cardTitle /></span>
                </template>
              }
            }
          `,
        );

        await realm.write(
          'query-rel-overlap-consumer.gts',
          `
            import { CardDef, Component, field, linksTo, linksToMany } from "@cardstack/base/card-api";

            export class QueryRelOverlapConsumer extends CardDef {
              @field direct = linksTo(() => CardDef);
              @field matches = linksToMany(() => CardDef, {
                query: {
                  filter: {
                    eq: {
                      cardTitle: 'overlap-target',
                    },
                  },
                  page: {
                    size: 10,
                    number: 0,
                  },
                },
              });

              static isolated = class Isolated extends Component<typeof this> {
                <template>
                  <@fields.direct />
                  <@fields.matches />
                </template>
              }
            }
          `,
        );

        await realm.write(
          'query-rel-overlap-target-1.json',
          JSON.stringify({
            data: {
              attributes: { cardTitle: 'overlap-target' },
              meta: {
                adoptsFrom: {
                  module: rri('./query-rel-overlap-target'),
                  name: 'QueryRelOverlapTarget',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await realm.write(
          'query-rel-overlap-consumer-1.json',
          JSON.stringify({
            data: {
              relationships: {
                direct: { links: { self: './query-rel-overlap-target-1' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./query-rel-overlap-consumer'),
                  name: 'QueryRelOverlapConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let overlapConsumerDoc = await realm.realmIndexQueryEngine.cardDocument(
          new URL(`${testRealm}query-rel-overlap-consumer-1`),
          { loadLinks: true },
        );
        if (overlapConsumerDoc?.type === 'doc') {
          let relationships = overlapConsumerDoc.doc.data.relationships ?? {};
          let direct = relationships.direct as
            | {
                data?: { type: string; id: string } | null;
              }
            | undefined;
          let matches = relationships.matches as
            | {
                links?: Record<string, string | null>;
                data?: { type: string; id: string }[];
              }
            | undefined;
          assert.deepEqual(
            direct?.data,
            {
              type: 'card',
              id: `${testRealm}query-rel-overlap-target-1`,
            },
            'non-query linksTo relationship contains target',
          );
          assert.strictEqual(
            typeof matches?.links?.search,
            'string',
            'query linksToMany relationship is present',
          );
          assert.deepEqual(
            matches?.data,
            [
              {
                type: 'card',
                id: `${testRealm}query-rel-overlap-target-1`,
              },
            ],
            'query linksToMany relationship matched the overlapping target',
          );
        } else {
          assert.ok(false, 'expected overlap consumer document');
        }

        let deps = await depsFor(
          `${testRealm}query-rel-overlap-consumer-1.json`,
        );
        assert.ok(
          deps.includes(`${testRealm}query-rel-overlap-target-1.json`),
          'target instance is retained in deps because it is also consumed via non-query relationship',
        );
        assert.ok(
          deps.includes(`${testRealm}query-rel-overlap-target`),
          'target module is retained in deps because it is also consumed via non-query relationship',
        );
      });

      test('collects glimmer scoped CSS deps from first-degree and second-degree relationship instances', async function (assert) {
        await realm.write(
          'second-rel.gts',
          `
          import { CardDef, Component, contains, field } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class SecondRel extends CardDef {
            @field name = contains(StringField);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <span class="second-name"><@fields.name /></span>
                <style scoped>
                  .second-name {
                    color: teal;
                  }
                </style>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <span class="second-name"><@fields.name /></span>
                <style scoped>
                  .second-name {
                    color: teal;
                  }
                </style>
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <span class="second-name"><@fields.name /></span>
                <style scoped>
                  .second-name {
                    color: teal;
                  }
                </style>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <span class="second-name"><@fields.name /></span>
                <style scoped>
                  .second-name {
                    color: teal;
                  }
                </style>
              </template>
            }
          }
        `,
        );

        await realm.write(
          'first-rel.gts',
          `
          import { CardDef, Component, contains, field, linksTo } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          import { SecondRel } from "./second-rel";

          export class FirstRel extends CardDef {
            @field name = contains(StringField);
            @field next = linksTo(() => SecondRel);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <span class="first-name"><@fields.name /></span>
                <@fields.next />
                <style scoped>
                  .first-name {
                    color: olive;
                  }
                </style>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <span class="first-name"><@fields.name /></span>
                <@fields.next />
                <style scoped>
                  .first-name {
                    color: olive;
                  }
                </style>
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <span class="first-name"><@fields.name /></span>
                <@fields.next />
                <style scoped>
                  .first-name {
                    color: olive;
                  }
                </style>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <span class="first-name"><@fields.name /></span>
                <@fields.next />
                <style scoped>
                  .first-name {
                    color: olive;
                  }
                </style>
              </template>
            }
          }
        `,
        );

        await realm.write(
          'css-relationship-consumer.gts',
          `
          import { CardDef, Component, field, linksTo } from "@cardstack/base/card-api";
          import { FirstRel } from "./first-rel";

          export class CssRelationshipConsumer extends CardDef {
            @field first = linksTo(() => FirstRel);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.first />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'second-rel-1.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Second One' },
              meta: {
                adoptsFrom: {
                  module: rri('./second-rel'),
                  name: 'SecondRel',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await realm.write(
          'first-rel-1.json',
          JSON.stringify({
            data: {
              attributes: { name: 'First One' },
              relationships: {
                next: { links: { self: './second-rel-1' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./first-rel'),
                  name: 'FirstRel',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await realm.write(
          'css-relationship-consumer-1.json',
          JSON.stringify({
            data: {
              relationships: {
                first: { links: { self: './first-rel-1' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./css-relationship-consumer'),
                  name: 'CssRelationshipConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let deps = await depsFor(
          `${testRealm}css-relationship-consumer-1.json`,
        );
        assert.ok(
          deps.includes(`${testRealm}first-rel-1.json`),
          'deps include first-degree relationship instance',
        );
        assert.ok(
          deps.includes(`${testRealm}second-rel-1.json`),
          'deps include second-degree relationship instance via delegated first-degree rendering',
        );

        let assertCssDependency = (
          depList: string[],
          pattern: RegExp,
          fileName: string,
        ) => {
          assert.true(
            depList.some((dep) => pattern.test(dep)),
            `deps include glimmer scoped css for ${fileName}`,
          );
        };

        assertCssDependency(
          deps,
          /first-rel\.gts.*\.glimmer-scoped\.css$/,
          'first-rel.gts',
        );
        assertCssDependency(
          deps,
          /second-rel\.gts.*\.glimmer-scoped\.css$/,
          'second-rel.gts',
        );
      });

      test('handles relationship cycles in deps and invalidation', async function (assert) {
        await realm.write(
          'loop-card.gts',
          `
          import { CardDef, Component, contains, field, linksTo } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class LoopCard extends CardDef {
            @field name = contains(StringField);
            @field next = linksTo(() => LoopCard);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
                <p>next <@fields.next @format='atom'/></p>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
                <p>next <@fields.next @format='atom'/></p>
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <p><@fields.name /></p>
                <@fields.next />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'loop-consumer.gts',
          `
          import { CardDef, Component, field, linksTo } from "@cardstack/base/card-api";
          import { LoopCard } from "./loop-card";

          export class LoopConsumer extends CardDef {
            @field root = linksTo(() => LoopCard);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.root />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'loop-a.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Loop A' },
              relationships: {
                next: { links: { self: './loop-b' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./loop-card'),
                  name: 'LoopCard',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'loop-b.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Loop B' },
              relationships: {
                next: { links: { self: './loop-a' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./loop-card'),
                  name: 'LoopCard',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'loop-consumer.json',
          JSON.stringify({
            data: {
              relationships: {
                root: { links: { self: './loop-a' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./loop-consumer'),
                  name: 'LoopConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let deps = await depsFor(`${testRealm}loop-consumer.json`);
        assert.ok(
          deps.includes(`${testRealm}loop-a.json`),
          'deps include first node in relationship cycle',
        );
        assert.ok(
          deps.includes(`${testRealm}loop-b.json`),
          'deps include second node in relationship cycle',
        );

        let beforeIndexedAt = await indexedAtFor(
          `${testRealm}loop-consumer.json`,
        );
        await realm.write(
          'loop-b.json',
          JSON.stringify({
            data: {
              attributes: { name: 'Loop B Updated' },
              relationships: {
                next: { links: { self: './loop-a' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./loop-card'),
                  name: 'LoopCard',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
        let afterIndexedAt = await indexedAtFor(
          `${testRealm}loop-consumer.json`,
        );
        assert.notStrictEqual(
          afterIndexedAt,
          beforeIndexedAt,
          'updating one cycle node invalidates and reindexes consumer',
        );

        let loopA = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}loop-a`),
        );
        assert.strictEqual(
          loopA?.type,
          'instance',
          'first cycle node remains indexable after cycle invalidation',
        );
        let loopB = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}loop-b`),
        );
        assert.strictEqual(
          loopB?.type,
          'instance',
          'second cycle node remains indexable after cycle invalidation',
        );

        let loopConsumer = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}loop-consumer`),
        );
        assert.strictEqual(
          loopConsumer?.type,
          'instance',
          'consumer remains indexable after cycle invalidation',
        );
      });

      test('repairs relationship consumers when an errored relationship target is fixed', async function (assert) {
        await realm.write(
          'relationship-parent.gts',
          `
          import { CardDef, Component, field, linksTo } from "@cardstack/base/card-api";

          export class RelationshipParent extends CardDef {
            @field child = linksTo(() => CardDef);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <@fields.child />
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.child />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.child />
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <@fields.child />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'relationship-grandparent.gts',
          `
          import { CardDef, Component, field, linksTo } from "@cardstack/base/card-api";

          export class RelationshipGrandParent extends CardDef {
            @field parent = linksTo(() => CardDef);

            static atom = class Atom extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'child-error.json',
          JSON.stringify({
            data: {
              attributes: {
                title: 'Broken Child',
              },
              meta: {
                adoptsFrom: {
                  module: rri('./missing-child'),
                  name: 'MissingChild',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'parent-rel.json',
          JSON.stringify({
            data: {
              relationships: {
                child: { links: { self: './child-error' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./relationship-parent'),
                  name: 'RelationshipParent',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
        await realm.write(
          'grandparent-rel.json',
          JSON.stringify({
            data: {
              relationships: {
                parent: { links: { self: './parent-rel' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./relationship-grandparent'),
                  name: 'RelationshipGrandParent',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        // child-error is the only entry in indexing-error state — its
        // adoptsFrom module is missing, so module → instance propagation
        // demotes it. parent-rel and grandparent-rel each linksTo a
        // downstream card; instance → instance propagation terminates at
        // the first hop, so the consumers stay indexable. The broken slot
        // renders the placeholder inline.
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        let childError = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}child-error`),
        );
        assert.strictEqual(
          childError?.type,
          'instance-error',
          'child-error inherits its missing adoptsFrom module via module → instance propagation',
        );
        let parentBefore = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}parent-rel`),
        );
        assert.strictEqual(
          parentBefore?.type,
          'instance',
          'parent stays indexable while its linksTo target is broken — broken slot renders the placeholder',
        );
        let grandParentBefore = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}grandparent-rel`),
        );
        assert.strictEqual(
          grandParentBefore?.type,
          'instance',
          'grandparent stays indexable while its downstream linksTo chain reaches a broken card',
        );

        await realm.write(
          'missing-child.gts',
          `
          import { CardDef, contains, field } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class MissingChild extends CardDef {
            @field title = contains(StringField);
          }
        `,
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        let childErrorAfter = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}child-error`),
        );
        assert.strictEqual(
          childErrorAfter?.type,
          'instance',
          'child-error recovers once the missing adoptsFrom module is created',
        );
        let parentAfter = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}parent-rel`),
        );
        assert.strictEqual(
          parentAfter?.type,
          'instance',
          'parent stays a clean instance after the relationship target recovers',
        );
        let grandParentAfter = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}grandparent-rel`),
        );
        assert.strictEqual(
          grandParentAfter?.type,
          'instance',
          'grandparent stays a clean instance after the downstream target recovers',
        );

        let parentDeps = await depsFor(`${testRealm}parent-rel.json`);
        assert.ok(
          parentDeps.includes(`${testRealm}child-error.json`),
          'parent deps include direct relationship target URL',
        );
        let grandParentDeps = await depsFor(`${testRealm}grandparent-rel.json`);
        assert.ok(
          grandParentDeps.includes(`${testRealm}parent-rel.json`),
          'grandparent deps include direct relationship target URL',
        );
        assert.ok(
          grandParentDeps.includes(`${testRealm}child-error.json`),
          'grandparent deps include transitive relationship target URL',
        );
      });
    });

    module('error recovery and deletion', function (hooks) {
      let realm: Realm;
      let adapter: RealmAdapter;

      async function depsFor(
        url: string,
        type: 'instance' | 'file' = 'instance',
      ): Promise<string[]> {
        return depsForIndexEntry(testDbAdapter, url, type);
      }

      async function indexedAtFor(
        url: string,
        type: 'instance' | 'file' = 'instance',
      ): Promise<string | null> {
        return indexedAtForIndexEntry(testDbAdapter, url, type);
      }

      setupPermissionedRealmCached(hooks, {
        mode: 'beforeEach',
        realmURL: testRealm,
        permissions: {
          '*': ['read'],
        },
        fileSystem: makeTestRealmFileSystem(),
        onRealmSetup({ dbAdapter, testRealm: r, testRealmAdapter }) {
          testDbAdapter = dbAdapter;
          realm = r;
          adapter = testRealmAdapter;
        },
      });

      test('repairs relationship consumers when an errored second-degree FileDef target is fixed', async function (assert) {
        await realm.write(
          'filedef-mismatch.gts',
          `
          import { FileDef as BaseFileDef } from "@cardstack/base/file-api";
          import { MissingChild } from "./missing-child";

          export class FileDef extends BaseFileDef {
            static missingChild = MissingChild;
          }
        `,
        );

        await realm.write(
          'relationship-file-parent.gts',
          `
          import { CardDef, Component, field, linksTo, linksToMany } from "@cardstack/base/card-api";
          import { FileDef } from "@cardstack/base/file-api";

          export class RelationshipFileParent extends CardDef {
            @field attachment = linksTo(() => FileDef);
            @field attachments = linksToMany(() => FileDef);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.attachment />
                <@fields.attachments />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.attachment />
                <@fields.attachments />
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <@fields.attachment />
                <@fields.attachments />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'relationship-file-grandparent.gts',
          `
          import { CardDef, Component, field, linksTo } from "@cardstack/base/card-api";

          export class RelationshipFileGrandParent extends CardDef {
            @field parent = linksTo(() => CardDef);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                <@fields.parent />
              </template>
            }
          }
        `,
        );

        await realm.write(
          'parent-file-rel.json',
          JSON.stringify({
            data: {
              relationships: {
                attachment: { links: { self: './random-file.mismatch' } },
                'attachments.0': {
                  links: { self: './random-file.mismatch' },
                },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./relationship-file-parent'),
                  name: 'RelationshipFileParent',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        await realm.write(
          'grandparent-file-rel.json',
          JSON.stringify({
            data: {
              relationships: {
                parent: { links: { self: './parent-file-rel' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./relationship-file-grandparent'),
                  name: 'RelationshipFileGrandParent',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let fileTargetBeforeType = await typeForIndexEntry(
          testDbAdapter,
          `${testRealm}random-file.mismatch`,
        );
        assert.strictEqual(
          fileTargetBeforeType,
          'file',
          'FileDef relationship target keeps file type in the index while errored',
        );
        let fileTargetBeforeError = await errorDocForIndexEntry(
          testDbAdapter,
          `${testRealm}random-file.mismatch`,
          'file',
        );
        assert.true(
          Boolean(fileTargetBeforeError?.hasError),
          'FileDef relationship target is marked errored in the index',
        );
        let fileTargetHasExpectedErrorDetail =
          hasErrorDetail(
            (fileTargetBeforeError?.errorDoc ?? {}) as {
              message?: string;
              additionalErrors?: { message?: string }[] | null;
            },
            'Received HTTP 404 from server',
          ) ||
          hasErrorDetail(
            (fileTargetBeforeError?.errorDoc ?? {}) as {
              message?: string;
              additionalErrors?: { message?: string }[] | null;
            },
            'missing-child',
          );
        assert.ok(
          fileTargetHasExpectedErrorDetail,
          'FileDef target error doc includes file extract failure details',
        );

        // Relationship consumers stay indexable while a target is broken —
        // the same first-hop termination card targets have: the error lives
        // on the target's own rows and the consumer's broken slot renders
        // the placeholder inline.
        let parentBefore = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}parent-file-rel`),
        );
        assert.strictEqual(
          parentBefore?.type,
          'instance',
          'first-degree relationship consumer stays indexable while FileDef target is broken',
        );
        let grandParentBefore = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}grandparent-file-rel`),
        );
        assert.strictEqual(
          grandParentBefore?.type,
          'instance',
          'second-degree relationship consumer stays indexable while delegated FileDef target is broken',
        );

        await realm.write(
          'filedef-mismatch.gts',
          `
          import {
            FileDef as BaseFileDef,
            FileContentMismatchError,
          } from "@cardstack/base/file-api";

          export class FileDef extends BaseFileDef {
            static async extractAttributes() {
              throw new FileContentMismatchError('content mismatch');
            }
          }
        `,
        );

        let fileTargetAfterError = await errorDocForIndexEntry(
          testDbAdapter,
          `${testRealm}random-file.mismatch`,
          'file',
        );
        assert.false(
          Boolean(fileTargetAfterError?.hasError),
          'FileDef relationship target clears error state after FileDef module is fixed',
        );

        let parentAfter = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}parent-file-rel`),
        );
        assert.strictEqual(
          parentAfter?.type,
          'instance',
          'first-degree relationship consumer repairs after FileDef target is fixed',
        );
        let grandParentAfter = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}grandparent-file-rel`),
        );
        assert.strictEqual(
          grandParentAfter?.type,
          'instance',
          'delegated second-degree relationship consumer repairs after FileDef target is fixed',
        );

        let parentDeps = await depsFor(`${testRealm}parent-file-rel.json`);
        assert.ok(
          parentDeps.includes(`${testRealm}random-file.mismatch`),
          'first-degree consumer deps include direct FileDef linksTo target URL',
        );
        assert.ok(
          parentDeps.includes(`${testRealm}random-file.mismatch`),
          'first-degree consumer deps include direct FileDef linksToMany target URL',
        );

        let grandParentDeps = await depsFor(
          `${testRealm}grandparent-file-rel.json`,
        );
        assert.ok(
          grandParentDeps.includes(`${testRealm}parent-file-rel.json`),
          'delegated second-degree consumer deps include first-degree relationship target URL',
        );
        assert.ok(
          grandParentDeps.includes(`${testRealm}random-file.mismatch`),
          'delegated second-degree consumer deps include transitive FileDef linksTo target URL',
        );
        assert.ok(
          grandParentDeps.includes(`${testRealm}random-file.mismatch`),
          'delegated second-degree consumer deps include transitive FileDef linksToMany target URL',
        );
      });

      test('tracks and invalidates FileDef relationship deps for linksTo and linksToMany', async function (assert) {
        await realm.write(
          'file-relationship-consumer.gts',
          `
          import { CardDef, Component, field, linksTo, linksToMany } from "@cardstack/base/card-api";
          import { FileDef } from "@cardstack/base/file-api";

          export class FileRelationshipConsumer extends CardDef {
            @field primaryFile = linksTo(() => FileDef);
            @field attachments = linksToMany(() => FileDef);

            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <@fields.primaryFile />
                <@fields.attachments />
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.primaryFile />
                <@fields.attachments />
              </template>
            }
          }
        `,
        );

        await realm.write('primary-note.txt', 'primary note v1');
        await realm.write('attachment-a.txt', 'attachment a v1');
        await realm.write('attachment-b.txt', 'attachment b v1');

        await realm.write(
          'file-relationship-consumer.json',
          JSON.stringify({
            data: {
              relationships: {
                primaryFile: { links: { self: './primary-note.txt' } },
                'attachments.0': { links: { self: './attachment-a.txt' } },
                'attachments.1': { links: { self: './attachment-b.txt' } },
              },
              meta: {
                adoptsFrom: {
                  module: rri('./file-relationship-consumer'),
                  name: 'FileRelationshipConsumer',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let deps = await depsFor(`${testRealm}file-relationship-consumer.json`);
        assert.ok(
          deps.includes(`${testRealm}primary-note.txt`),
          'deps include FileDef linksTo relationship target URL',
        );
        assert.ok(
          deps.includes(`${testRealm}attachment-a.txt`),
          'deps include first FileDef linksToMany relationship target URL',
        );
        assert.ok(
          deps.includes(`${testRealm}attachment-b.txt`),
          'deps include second FileDef linksToMany relationship target URL',
        );

        let beforeLinksToInvalidation = await indexedAtFor(
          `${testRealm}file-relationship-consumer.json`,
        );
        await realm.write('primary-note.txt', 'primary note v2');
        let afterLinksToInvalidation = await indexedAtFor(
          `${testRealm}file-relationship-consumer.json`,
        );
        assert.notStrictEqual(
          afterLinksToInvalidation,
          beforeLinksToInvalidation,
          'updating FileDef linksTo target invalidates consumer instance',
        );

        let beforeLinksToManyInvalidation = afterLinksToInvalidation;
        await realm.write('attachment-a.txt', 'attachment a v2');
        let afterLinksToManyInvalidation = await indexedAtFor(
          `${testRealm}file-relationship-consumer.json`,
        );
        assert.notStrictEqual(
          afterLinksToManyInvalidation,
          beforeLinksToManyInvalidation,
          'updating FileDef linksToMany target invalidates consumer instance',
        );
      });

      test('can incrementally index deleted instance', async function (assert) {
        await realm.delete('mango.json');

        let { data: result } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: {
                module: rri(`${testRealm}person`),
                name: 'Person',
              },
              eq: { firstName: 'Mango' },
            },
          },
        );
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
        import { contains, linksTo, field, CardDef, Component } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
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

        let { data: result } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: {
                module: rri(`${testRealm}post`),
                name: 'Post',
              },
              eq: { nickName: 'Van Gogh-poo' },
            },
          },
        );
        assert.strictEqual(result.length, 1, 'found updated document');
      });

      test('can recover from a module sequence error', async function (assert) {
        await realm.write(
          'pet.gts',
          `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
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
                  module: rri('./pet'),
                  name: 'Pet',
                },
              },
            },
          }),
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
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
          import { contains, field, FieldDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Name extends FieldDef {
            @field firstName = contains(StringField);
            @field lastName = contains(StringField);
          }
        `,
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
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
          import { contains, field, CardDef } from "@cardstack/base/card-api";
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
                  module: rri('./pet'),
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
          import { contains, field, FieldDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

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
                  module: rri('./pet'),
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
          import { contains, field, Component, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

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

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        let { data: result } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: {
                module: rri(`${testRealm}post`),
                name: 'Post',
              },
              eq: { 'author.nickName': 'Van Gogh-poo' },
            },
          },
        );
        assert.strictEqual(result.length, 1, 'found updated document');
      });

      test('can incrementally index instance that depends on deleted card source', async function (assert) {
        await realm.delete('post.gts');
        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        {
          let { data: result } = await searchCardsForTest(
            realm.realmIndexQueryEngine,
            {
              filter: {
                type: {
                  module: rri(`${testRealm}post`),
                  name: 'Post',
                },
              },
            },
          );
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
          // The render surfaces the module 404 both as the primary error and
          // as a captured browser console entry; only the latter may ride in
          // additionalErrors — never a dependency error document.
          let additionalErrors = Array.isArray(
            actual.error.errorDetail.additionalErrors,
          )
            ? (actual.error.errorDetail.additionalErrors as {
                title?: string;
              }[])
            : [];
          assert.true(
            additionalErrors.every(
              (additionalError) => additionalError.title === 'Console error',
            ),
            `no additional dependency errors are present: ${JSON.stringify(
              additionalErrors,
            )}`,
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
        import { contains, linksTo, field, CardDef, Component } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
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
          let { data: result } = await searchCardsForTest(
            realm.realmIndexQueryEngine,
            {
              filter: {
                on: {
                  module: rri(`${testRealm}post`),
                  name: 'Post',
                },
                eq: { nickName: 'Van Gogh-poo' },
              },
            },
          );
          assert.strictEqual(result.length, 1, 'found the post instance');
        }
      });

      test('terminates instance→instance error doc propagation at the first linksTo hop', async function (assert) {
        // Baseline: hassan (PetPerson, linksTo Pet, links to ringo) indexes
        // cleanly against the as-built fixture. Used as the post-recovery
        // reference state below.
        let hassanBaseline = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}hassan`),
        );
        assert.strictEqual(
          hassanBaseline?.type,
          'instance',
          'hassan is a clean instance before any breakage',
        );

        // Put ringo into instance-error state by pointing its `adoptsFrom` at
        // a module that does not exist. Pet.gts itself stays clean, so the
        // only error in play is at the instance level.
        await realm.write(
          'ringo.json',
          JSON.stringify({
            data: {
              attributes: { firstName: 'Ringo' },
              meta: {
                adoptsFrom: {
                  module: rri('./missing-pet-target'),
                  name: 'MissingPet',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let ringoErrored = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}ringo`),
        );
        assert.strictEqual(
          ringoErrored?.type,
          'instance-error',
          'ringo is in error state once its adoptsFrom module is missing',
        );
        if (ringoErrored?.type === 'instance-error') {
          assert.ok(
            hasErrorDetail(ringoErrored.error, 'missing-pet-target'),
            'ringo error doc names the missing module — used below as the inheritance probe',
          );
        }

        // hassan (linksTo ringo) must NOT inherit ringo's error doc — and
        // critically, must NOT itself be in error. The broken slot renders
        // the placeholder inline; hassan stays a fully indexable instance.
        let hassanWithBrokenLink = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}hassan`),
        );
        assert.strictEqual(
          hassanWithBrokenLink?.type,
          'instance',
          'hassan with a broken linksTo target is a clean instance, not instance-error — broken slot renders the placeholder inline',
        );
        let hassanDeps = hassanWithBrokenLink?.deps ?? [];
        assert.ok(
          hassanDeps.some(
            (dep) =>
              dep === `${testRealm}ringo.json` || dep === `${testRealm}ringo`,
          ),
          'hassan deps still include ringo so invalidation fan-out continues to reach hassan when ringo changes',
        );

        // Recovery: restoring ringo re-indexes hassan via the
        // `itemsThatReference` fan-out, and hassan returns to a clean
        // instance entry.
        await realm.write(
          'ringo.json',
          JSON.stringify({
            data: {
              attributes: { firstName: 'Ringo' },
              meta: {
                adoptsFrom: { module: rri('./pet'), name: 'Pet' },
              },
            },
          } as LooseSingleCardDocument),
        );

        let hassanRecovered = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}hassan`),
        );
        assert.strictEqual(
          hassanRecovered?.type,
          'instance',
          'hassan recovers to a clean instance once ringo is restored',
        );
      });

      test('preserves module→instance error propagation alongside the instance→instance terminator', async function (assert) {
        // Companion to the instance→instance terminator above: when a module
        // breaks, instances backed by that module must still inherit the
        // module error in `additionalErrors`. Only the instance→instance hop
        // terminates.
        await realm.write(
          'pet.gts',
          `import { OnlyExistsInDreams } from "./does-not-exist";
           export class Pet extends OnlyExistsInDreams {}`,
        );

        await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
        let ringoAfterModuleBreak = await realm.realmIndexQueryEngine.instance(
          new URL(`${testRealm}ringo`),
        );
        assert.strictEqual(
          ringoAfterModuleBreak?.type,
          'instance-error',
          'ringo cascades to instance-error via module→instance propagation',
        );
        if (ringoAfterModuleBreak?.type === 'instance-error') {
          assert.ok(
            hasErrorDetail(ringoAfterModuleBreak.error, 'does-not-exist'),
            'module→instance: ringo inherits Pet module error in additionalErrors',
          );
        }
      });

      test('can write several module files at once', async function (assert) {
        let mapOfWrites = new Map();
        mapOfWrites.set(
          'place.gts',
          `
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        export class Place extends CardDef {
          @field name = contains(StringField);
        }
      `,
        );
        mapOfWrites.set(
          'country.gts',
          `
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
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
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
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
                  module: rri('./city'),
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
        assert.ok(
          instanceFileEntry,
          'file entry for city.json is in the index',
        );
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
                  module: rri('./person'),
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

    module('per-file failure isolation', function (hooks) {
      let realm: Realm;
      let testDbAdapter: PgAdapter;
      // URL substring the wrapper fails prerender visits for; unset =
      // pass everything through to the real test prerenderer.
      let failVisitsFor: string | undefined;

      let delegatePromise: Promise<Prerenderer> | undefined;
      let delegate = () => (delegatePromise ??= getTestPrerenderer());
      // A transport-level failure (the prerender request aborting before a
      // response exists) can only be simulated at the Prerenderer seam —
      // the in-band error paths all require a response document.
      let interceptingPrerenderer: Prerenderer = {
        async prerenderModule(args) {
          return (await delegate()).prerenderModule(args);
        },
        async prerenderVisit(args) {
          if (failVisitsFor && args.url.includes(failVisitsFor)) {
            throw new Error(
              'Prerender request to /prerender-visit aborted after 120000ms (simulated transport failure)',
            );
          }
          return (await delegate()).prerenderVisit(args);
        },
        async runCommand(args) {
          return (await delegate()).runCommand(args);
        },
        async releaseBatch(args) {
          await (await delegate()).releaseBatch?.(args);
        },
      };

      hooks.beforeEach(function () {
        failVisitsFor = undefined;
      });

      setupPermissionedRealmCached(hooks, {
        mode: 'beforeEach',
        realmURL: testRealm,
        permissions: {
          '*': ['read'],
        },
        fileSystem: makeTestRealmFileSystem(),
        prerenderer: interceptingPrerenderer,
        onRealmSetup({ dbAdapter, testRealm: r }) {
          testDbAdapter = dbAdapter;
          realm = r;
        },
      });

      function mangoDoc(firstName: string): LooseSingleCardDocument {
        return {
          data: {
            attributes: { firstName },
            meta: {
              adoptsFrom: {
                module: rri('./person'),
                name: 'Person',
              },
            },
          },
        };
      }

      async function mangoIndexRows() {
        return (await testDbAdapter.execute(
          `SELECT type, has_error, is_deleted,
                  (pristine_doc IS NOT NULL) as has_pristine_doc,
                  error_doc->>'message' as error_message
           FROM boxel_index
           WHERE url = '${testRealm}mango.json'
           ORDER BY type`,
        )) as {
          type: string;
          has_error: boolean;
          is_deleted: boolean | null;
          has_pristine_doc: boolean;
          error_message: string | null;
        }[];
      }

      test('a transport-level visit failure isolates to its file: the batch still commits and the card keeps last-known-good state under an error row', async function (assert) {
        failVisitsFor = 'mango.json';
        await realm.write('mango.json', JSON.stringify(mangoDoc('Mang-Mang')));

        let rows = await mangoIndexRows();
        assert.deepEqual(
          rows.map((row) => row.type).sort(),
          ['file', 'instance'],
          'both the file and instance rows exist for the failed card',
        );
        for (let row of rows) {
          assert.true(
            row.has_error,
            `the ${row.type} row carries the failure as an error`,
          );
          assert.notOk(
            row.is_deleted,
            `the ${row.type} row is not tombstoned by the transient failure`,
          );
          assert.ok(
            row.error_message?.includes('simulated transport failure'),
            `the ${row.type} row's error_doc carries the underlying failure text`,
          );
        }
        let instanceRow = rows.find((row) => row.type === 'instance')!;
        assert.true(
          instanceRow.has_pristine_doc,
          'the instance row preserves the last-known-good serialization',
        );

        // The failure was isolated: the same job's other work still
        // committed. A sibling card written in the same realm version
        // remains searchable, proving batch.done() ran.
        let { data: others } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: { module: rri(`${testRealm}person`), name: 'Person' },
              eq: { firstName: 'Van Gogh' },
            },
          },
        );
        assert.strictEqual(
          others.length,
          1,
          'sibling cards are still searchable after the failed visit',
        );

        // Recovery: once the transport failure clears, a rewrite indexes
        // normally and the error state washes out.
        failVisitsFor = undefined;
        await realm.write(
          'mango.json',
          JSON.stringify(mangoDoc('Mango Recovered')),
        );
        rows = await mangoIndexRows();
        assert.true(
          rows.every((row) => !row.has_error),
          'the error state clears once the visit succeeds',
        );
        let { data: recovered } = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              on: { module: rri(`${testRealm}person`), name: 'Person' },
              eq: { firstName: 'Mango Recovered' },
            },
          },
        );
        assert.strictEqual(
          recovered.length,
          1,
          'the recovered card is searchable with its new content',
        );
      });

      test('a failed visit for a brand-new card records an instance error via the source-parse fallback', async function (assert) {
        // A brand-new file has no prior index row, so the batch's
        // tombstoned-types oracle can't identify it as a card — this is
        // the path where the source re-parse fallback must decide.
        failVisitsFor = 'pistachio.json';
        await realm.write(
          'pistachio.json',
          JSON.stringify({
            data: {
              attributes: { firstName: 'Pistachio' },
              meta: {
                adoptsFrom: {
                  module: rri('./person'),
                  name: 'Person',
                },
              },
            },
          } as LooseSingleCardDocument),
        );

        let rows = (await testDbAdapter.execute(
          `SELECT type, has_error, is_deleted,
                  error_doc->>'message' as error_message
           FROM boxel_index
           WHERE url = '${testRealm}pistachio.json'
           ORDER BY type`,
        )) as {
          type: string;
          has_error: boolean;
          is_deleted: boolean | null;
          error_message: string | null;
        }[];
        assert.deepEqual(
          rows.map((row) => row.type).sort(),
          ['file', 'instance'],
          'both file and instance error rows are recorded for the new card',
        );
        for (let row of rows) {
          assert.true(
            row.has_error,
            `the ${row.type} row carries the failure as an error`,
          );
          assert.notOk(row.is_deleted, `the ${row.type} row is not deleted`);
          assert.ok(
            row.error_message?.includes('simulated transport failure'),
            `the ${row.type} row's error_doc carries the underlying failure text`,
          );
        }
      });
    });
  });
});
