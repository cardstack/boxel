import type { RenderingTestContext } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  baseCardRef,
  internalKeyFor,
  skillCardRef,
  type LooseSingleCardDocument,
  type IndexedInstance,
  type Realm,
} from '@cardstack/runtime-common';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import type { Loader } from '@cardstack/runtime-common/loader';

import { windowErrorHandler } from '@cardstack/host/lib/window-error-handler';

import {
  testRealmURL,
  testRealmInfo,
  cleanWhiteSpace,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  testModuleRealm,
  cardInfo,
  getFileCreatedAt,
} from '../helpers';
import {
  CardDef,
  Component,
  contains,
  linksTo,
  containsMany,
  DatetimeField,
  field,
  FieldDef,
  NumberField,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;
let onError: (event: Event) => void;

function unwrap(html: string): string {
  return html
    .trim()
    .replace(/^<div ([^>]*>)/, '')
    .trim()
    .replace(/^<!---->/, '')
    .replace(/<\/div>$/, '')
    .trim();
}

function assertInnerHtmlMatches(
  assert: Assert,
  actual: string | null | undefined,
  expected: string | null | undefined,
  message?: string,
) {
  let cleanedActual = cleanWhiteSpace(
    stripScopedCSSAttributes(unwrap(actual!)),
  );
  let cleanedExpected = cleanWhiteSpace(expected!);
  assert.strictEqual(cleanedActual, cleanedExpected, message);
}

module(`Integration | realm indexing`, function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    onError = function (event: Event) {
      let localIndexer = getService('local-indexer');
      windowErrorHandler({
        event,
        setStatusToUnusable() {
          localIndexer.prerenderStatus = 'unusable';
        },
        setError(error) {
          localIndexer.renderError = error;
        },
      });
    };
    window.addEventListener('boxel-render-error', onError);
  });

  hooks.afterEach(function (this: RenderingTestContext) {
    window.removeEventListener('boxel-render-error', onError);
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

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

  test('full indexing discovers card instances', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });
    let queryEngine = realm.realmIndexQueryEngine;
    let { data: cards } = await queryEngine.search({});
    assert.deepEqual(cards, [
      {
        id: `${testRealmURL}empty`,
        type: 'card',
        attributes: {
          cardInfo,
          title: 'Untitled Card',
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
          realmURL: 'http://test-realm/test/',
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}empty.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'empty.json'),
          realmInfo: testRealmInfo,
        },
        links: {
          self: `${testRealmURL}empty`,
        },
      },
    ]);
  });

  test('full indexing skips over unchanged items in index', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test1.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'test2.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'pet.gts': `
          import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

          export class Pet extends CardDef {
            @field firstName = contains(StringField);
          }
        `,
      },
    });
    assert.deepEqual(
      realm.realmIndexUpdater.stats,
      {
        instanceErrors: 0,
        instancesIndexed: 2,
        moduleErrors: 0,
        modulesIndexed: 1,
        totalIndexEntries: 3,
      },
      'indexer stats are correct',
    );

    // the lastModified resolution is 1 second, so need to
    // wait at least that long to see a difference
    await new Promise((r) => setTimeout(r, 1000));
    await adapter.write(
      'test2.json',
      JSON.stringify({
        data: {
          attributes: {
            title: 'test',
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    await realm.fullIndex();

    assert.deepEqual(
      realm.realmIndexUpdater.stats,
      {
        instanceErrors: 0,
        instancesIndexed: 1,
        moduleErrors: 0,
        modulesIndexed: 0,
        totalIndexEntries: 3,
      },
      'indexer stats are correct',
    );
  });

  test('can recover from indexing a card with a broken link', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Pet/mango.json': {
          data: {
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testRealmURL}Person/owner`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let queryEngine = realm.realmIndexQueryEngine;
    {
      let mango = await queryEngine.cardDocument(
        new URL(`${testRealmURL}Pet/mango`),
      );
      if (mango?.type === 'error') {
        assert.deepEqual(
          mango.error.errorDetail.message,
          `missing file ${testRealmURL}Person/owner.json`,
        );
        assert.deepEqual(mango.error.errorDetail.deps, [
          `${testRealmURL}Person/owner.json`,
          'http://localhost:4202/test/pet',
        ]);
      } else {
        assert.ok(false, `expected search entry to be an error doc`);
      }
    }
    await realm.write(
      'Person/owner.json',
      JSON.stringify({
        data: {
          id: `${testRealmURL}Person/owner`,
          attributes: {
            firstName: 'Hassan',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );
    {
      let mango = await queryEngine.cardDocument(
        new URL(`${testRealmURL}Pet/mango`),
      );
      if (mango?.type === 'doc') {
        assert.deepEqual(mango.doc.data, {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          links: {
            self: `${testRealmURL}Pet/mango`,
          },
          attributes: {
            description: null,
            firstName: 'Mango',
            title: 'Mango',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            owner: {
              links: {
                self: `../Person/owner`,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Pet/mango.json`,
            ),
            resourceCreatedAt: await getFileCreatedAt(realm, 'Pet/mango.json'),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        });
      } else {
        assert.ok(
          false,
          `search entry was an error: ${mango?.error.errorDetail.message}`,
        );
      }
    }
  });

  test('can query the "production" index while performing indexing operations', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Pet/mango.json': {
          data: {
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let queryEngine = realm.realmIndexQueryEngine;
    // intentionally not awaiting here
    let updateCard = realm.write(
      'Pet/mango.json',
      JSON.stringify({
        data: {
          id: `${testRealmURL}Pet/mango`,
          attributes: {
            firstName: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      } as LooseSingleCardDocument),
    );
    let getCard = queryEngine.cardDocument(new URL(`${testRealmURL}Pet/mango`));
    let [_, entry] = await Promise.all([updateCard, getCard]);
    if (entry?.type === 'doc') {
      // we see the "production" version of this card while it is being indexed
      delete entry.doc.data.meta.lastModified;
      delete entry.doc.data.meta.resourceCreatedAt;
      assert.deepEqual(entry.doc.data, {
        id: `${testRealmURL}Pet/mango`,
        type: 'card',
        links: {
          self: `${testRealmURL}Pet/mango`,
        },
        attributes: {
          description: null,
          firstName: 'Mango',
          title: 'Mango',
          thumbnailURL: null,
          cardInfo,
        },
        relationships: {
          owner: {
            links: {
              self: null,
            },
          },
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${entry?.error.errorDetail.message}`,
      );
    }
    {
      // after the card has been indexed, the update is moved from the WIP version
      // of the index to the production version of the index
      let entry = await queryEngine.cardDocument(
        new URL(`${testRealmURL}Pet/mango`),
      );
      if (entry?.type === 'doc') {
        // we see the "production" version of this card while it is being indexed
        delete entry.doc.data.meta.lastModified;
        delete entry.doc.data.meta.resourceCreatedAt;
        assert.deepEqual(entry.doc.data, {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          links: {
            self: `${testRealmURL}Pet/mango`,
          },
          attributes: {
            description: null,
            firstName: 'Van Gogh',
            title: 'Van Gogh',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            owner: {
              links: {
                self: null,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        });
      } else {
        assert.ok(
          false,
          `search entry was an error: ${entry?.error.errorDetail.message}`,
        );
      }
    }
  });

  test('can index card with linkTo field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Person/owner.json': {
          data: {
            id: `${testRealmURL}Person/owner`,
            attributes: {
              firstName: 'Hassan',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testRealmURL}Person/owner`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let queryEngine = realm.realmIndexQueryEngine;
    let mango = await queryEngine.cardDocument(
      new URL(`${testRealmURL}Pet/mango`),
    );
    if (mango?.type === 'doc') {
      assert.deepEqual(mango.doc.data, {
        id: `${testRealmURL}Pet/mango`,
        type: 'card',
        links: {
          self: `${testRealmURL}Pet/mango`,
        },
        attributes: {
          description: null,
          firstName: 'Mango',
          title: 'Mango',
          thumbnailURL: null,
          cardInfo,
        },
        relationships: {
          owner: {
            links: {
              self: `../Person/owner`,
            },
          },
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}Pet/mango.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'Pet/mango.json'),
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${mango?.error.errorDetail.message}`,
      );
    }
  });

  test('can index card with a relative linkTo field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Person/owner.json': {
          data: {
            id: `${testRealmURL}Person/owner`,
            attributes: {
              firstName: 'Hassan',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            id: `${testRealmURL}Pet/mango`,
            attributes: {
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `../Person/owner`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let mango = await indexer.cardDocument(new URL(`${testRealmURL}Pet/mango`));
    if (mango?.type === 'doc') {
      assert.deepEqual(mango.doc.data, {
        id: `${testRealmURL}Pet/mango`,
        type: 'card',
        links: {
          self: `${testRealmURL}Pet/mango`,
        },
        attributes: {
          description: null,
          firstName: 'Mango',
          title: 'Mango',
          thumbnailURL: null,
          cardInfo,
        },
        relationships: {
          owner: {
            links: {
              self: `../Person/owner`,
            },
          },
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}Pet/mango.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'Pet/mango.json'),
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${mango?.error.errorDetail.message}`,
      );
    }
  });

  test('can index a card with relative code-ref fields', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'person-spec.json': {
          data: {
            attributes: {
              title: 'Person Card',
              description: 'Spec for Person card',
              specType: 'card',
              ref: {
                module: './person',
                name: 'Person',
              },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let entry = await indexer.cardDocument(
      new URL(`${testRealmURL}person-spec`),
    );
    if (entry?.type === 'doc') {
      assert.deepEqual(entry.doc.data, {
        id: `${testRealmURL}person-spec`,
        type: 'card',
        links: {
          self: `${testRealmURL}person-spec`,
        },
        attributes: {
          title: 'Person Card',
          description: 'Spec for Person card',
          moduleHref: `${testRealmURL}person`,
          readMe: null,
          specType: 'card',
          isCard: true,
          isComponent: false,
          isField: false,
          thumbnailURL: null,
          ref: {
            module: `./person`,
            name: 'Person',
          },
          containedExamples: [],
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
          linkedExamples: { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}person-spec.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'person-spec.json'),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      });
      let instance = await indexer.instance(
        new URL(`${testRealmURL}person-spec`),
      );
      assert.deepEqual(instance?.searchDoc, {
        _cardType: 'Spec',
        description: 'Spec for Person card',
        id: `${testRealmURL}person-spec`,
        specType: 'card',
        moduleHref: `${testRealmURL}person`,
        ref: `${testRealmURL}person/Person`,
        title: 'Person Card',
        containedExamples: null,
        linkedExamples: null,
        isCard: true,
        isComponent: false,
        isField: false,
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${entry?.error.errorDetail.message}`,
      );
    }
  });

  test('absolute urls will be serialised into relative into relative code-ref fields', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }

    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'person-spec.json': {
          data: {
            attributes: {
              title: 'Person Card',
              description: 'Spec for Person card',
              specType: 'card',
              ref: {
                module: `${testRealmURL}person`,
                name: 'Person',
              },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'people-skill.json': {
          data: {
            attributes: {
              instructions: 'How to win friends and influence people',
              commands: [
                {
                  codeRef: {
                    module: `@cardstack/boxel-host/commands/switch-submode`,
                    name: 'default',
                  },
                },
              ],
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let entry = await indexer.cardDocument(
      new URL(`${testRealmURL}person-spec`),
    );
    if (entry?.type === 'doc') {
      assert.deepEqual(entry.doc.data, {
        id: `${testRealmURL}person-spec`,
        type: 'card',
        links: {
          self: `${testRealmURL}person-spec`,
        },
        attributes: {
          title: 'Person Card',
          description: 'Spec for Person card',
          moduleHref: `${testRealmURL}person`,
          readMe: null,
          specType: 'card',
          isCard: true,
          isComponent: false,
          isField: false,
          thumbnailURL: null,
          ref: {
            module: `./person`,
            name: 'Person',
          },
          containedExamples: [],
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
          linkedExamples: { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}person-spec.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'person-spec.json'),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      });
      let instance = await indexer.instance(
        new URL(`${testRealmURL}person-spec`),
      );
      assert.deepEqual(instance?.searchDoc, {
        _cardType: 'Spec',
        description: 'Spec for Person card',
        id: `${testRealmURL}person-spec`,
        specType: 'card',
        moduleHref: `${testRealmURL}person`,
        ref: `${testRealmURL}person/Person`,
        title: 'Person Card',
        containedExamples: null,
        linkedExamples: null,
        isCard: true,
        isComponent: false,
        isField: false,
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${entry?.error.errorDetail.message}`,
      );
    }
    entry = await indexer.cardDocument(new URL(`${testRealmURL}people-skill`));
    if (entry?.type === 'doc') {
      assert.deepEqual(entry.doc.data, {
        id: `${testRealmURL}people-skill`,
        type: 'card',
        links: {
          self: `${testRealmURL}people-skill`,
        },
        attributes: {
          commands: [
            {
              codeRef: {
                module: '@cardstack/boxel-host/commands/switch-submode',
                name: 'default',
              },
              functionName: 'switch-submode_dd88',
              requiresApproval: false,
            },
          ],
          description: null,
          instructions: 'How to win friends and influence people',
          thumbnailURL: null,
          title: null,
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: skillCardRef,
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}people-skill.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'people-skill.json'),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      });
      let instance = await indexer.instance(
        new URL(`${testRealmURL}people-skill`),
      );
      assert.deepEqual(instance?.searchDoc, {
        _cardType: 'Skill',
        id: `${testRealmURL}people-skill`,
        instructions: 'How to win friends and influence people',
        commands: [
          {
            codeRef: `@cardstack/boxel-host/commands/switch-submode/default`,
            functionName: 'switch-submode_dd88',
            requiresApproval: false,
          },
        ],
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${entry?.error.errorDetail.message}`,
      );
    }
  });

  test('can recover from rendering a card that has a template error', async function (assert) {
    {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /></h1>
          </template>
        };
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1> Person Embedded Card: <@fields.firstName /></h1>
          </template>
        };
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1> Person Fitted Card: <@fields.firstName /></h1>
          </template>
        };
      }

      class Boom extends CardDef {
        @field firstName = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName />{{this.boom}}</h1>
          </template>
          get boom() {
            throw new Error('intentional error');
          }
        };
      }

      let { realm } = await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'boom.gts': { Boom },
          'vangogh.json': {
            data: {
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
        },
      });
      let queryEngine = realm.realmIndexQueryEngine;
      let realmIndexUpdater = realm.realmIndexUpdater;
      {
        let entry = await queryEngine.cardDocument(
          new URL(`${testRealmURL}boom`),
        );
        if (entry?.type === 'error') {
          assert.strictEqual(
            entry.error.errorDetail.message,
            'Encountered error rendering HTML for card: intentional error',
          );
          assert.deepEqual(entry.error.errorDetail.deps, [
            `${testRealmURL}boom`,
          ]);
        } else {
          assert.ok('false', 'expected search entry to be an error document');
        }
      }
      {
        let entry = await queryEngine.cardDocument(
          new URL(`${testRealmURL}vangogh`),
        );
        if (entry?.type === 'doc') {
          assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
          let { isolatedHtml, embeddedHtml, fittedHtml } =
            (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};
          assertInnerHtmlMatches(assert, isolatedHtml, `<h1> Van Gogh </h1>`);
          assertInnerHtmlMatches(
            assert,
            embeddedHtml![`${testRealmURL}person/Person`],
            `<h1> Person Embedded Card: Van Gogh </h1>`,
          );
          assertInnerHtmlMatches(
            assert,
            fittedHtml![`${testRealmURL}person/Person`],
            `<h1> Person Fitted Card: Van Gogh </h1>`,
          );
        } else {
          assert.ok(
            false,
            `expected search entry to be a document but was: ${entry?.error.errorDetail.message}`,
          );
        }
      }
      // perform a new index to assert that render stack is still consistent
      await realmIndexUpdater.fullIndex();
      {
        let entry = await queryEngine.cardDocument(
          new URL(`${testRealmURL}vangogh`),
        );
        if (entry?.type === 'doc') {
          assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
          let { isolatedHtml, embeddedHtml, fittedHtml } =
            (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};
          assertInnerHtmlMatches(assert, isolatedHtml, `<h1> Van Gogh </h1>`);
          assertInnerHtmlMatches(
            assert,
            embeddedHtml![`${testRealmURL}person/Person`],
            `<h1> Person Embedded Card: Van Gogh </h1>`,
          );
          assertInnerHtmlMatches(
            assert,
            fittedHtml![`${testRealmURL}person/Person`],
            `<h1> Person Fitted Card: Van Gogh </h1>`,
          );
        } else {
          assert.ok(
            false,
            `expected search entry to be a document but was: ${entry?.error.errorDetail.message}`,
          );
        }
      }
    }
  });

  test('can recover from rendering a card that has a nested card with a template error', async function (assert) {
    class Boom extends FieldDef {
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1><@fields.firstName />{{this.boom}}</h1>
        </template>
        get boom() {
          throw new Error('intentional error');
        }
      };
    }

    class BoomPerson extends CardDef {
      @field firstName = contains(StringField);
      @field boom = contains(Boom);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
          <h2><@fields.boom /></h2>
        </template>
      };
    }

    class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1> Person Embedded Card: <@fields.firstName /></h1>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h1> Person Fitted Card: <@fields.firstName /></h1>
        </template>
      };
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'boom-person.gts': { BoomPerson },
        'boom.gts': { Boom },
        'person.gts': { Person },
        'vangogh.json': {
          data: {
            attributes: {
              firstName: 'Van Gogh',
              boom: {
                firstName: 'Mango',
              },
            },
            meta: {
              adoptsFrom: {
                module: './boom-person',
                name: 'BoomPerson',
              },
            },
          },
        },
        'working-van-gogh.json': {
          data: {
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
      },
    });
    let indexer = realm.realmIndexQueryEngine;

    let entry = await indexer.cardDocument(new URL(`${testRealmURL}vangogh`));
    if (entry?.type === 'error') {
      assert.strictEqual(
        entry.error.errorDetail.message,
        'Encountered error rendering HTML for card: intentional error',
      );
    } else {
      assert.ok('false', 'expected search entry to be an error document');
    }

    // Reindex to assert that the broken card has been indexed before the working one
    await realm.reindex();

    entry = await indexer.cardDocument(
      new URL(`${testRealmURL}working-van-gogh`),
    );
    if (entry?.type === 'doc') {
      assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
      let { isolatedHtml, embeddedHtml, fittedHtml } =
        (await getInstance(
          realm,
          new URL(`${testRealmURL}working-van-gogh`),
        )) ?? {};
      assertInnerHtmlMatches(assert, isolatedHtml!, `<h1> Van Gogh </h1>`);
      assertInnerHtmlMatches(
        assert,
        embeddedHtml![`${testRealmURL}person/Person`],
        `<h1> Person Embedded Card: Van Gogh </h1>`,
      );
      assertInnerHtmlMatches(
        assert,
        fittedHtml![`${testRealmURL}person/Person`],
        `<h1> Person Fitted Card: Van Gogh </h1>`,
      );
    } else {
      assert.ok(
        false,
        `expected search entry to be a document but was: ${entry?.error.errorDetail.message}`,
      );
    }
  });

  test('can recover from rendering a card that encounters a template error in its own custom component', async function (assert) {
    class Custom extends GlimmerComponent {
      <template>
        {{this.boom}}
      </template>
      get boom() {
        throw new Error('intentional error');
      }
    }
    class CustomBoom extends FieldDef {
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /><Custom /></h1>
        </template>
      };
    }

    class BoomPerson2 extends CardDef {
      @field firstName = contains(StringField);
      @field boom = contains(CustomBoom);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
          <h2><@fields.boom /></h2>
        </template>
      };
    }
    class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1> Person Embedded Card: <@fields.firstName /></h1>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h1> Person Fitted Card: <@fields.firstName /></h1>
        </template>
      };
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'boom-person2.gts': { BoomPerson2 },
        'custom-boom.gts': { CustomBoom },
        'person.gts': { Person },

        'vangogh.json': {
          data: {
            attributes: {
              firstName: 'Van Gogh',
              boom: {
                firstName: 'Mango',
              },
            },
            meta: {
              adoptsFrom: {
                module: './boom-person2',
                name: 'BoomPerson2',
              },
            },
          },
        },
        'working-vangogh.json': {
          data: {
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
      },
    });

    let indexer = realm.realmIndexQueryEngine;
    let entry = await indexer.cardDocument(new URL(`${testRealmURL}vangogh`));
    if (entry?.type === 'error') {
      assert.strictEqual(
        entry.error.errorDetail.message,
        'Encountered error rendering HTML for card: intentional error',
      );
    } else {
      assert.ok('false', 'expected search entry to be an error document');
    }

    // Reindex to assert that the broken card has been indexed before the working one
    await realm.reindex();

    entry = await indexer.cardDocument(
      new URL(`${testRealmURL}working-vangogh`),
    );
    if (entry?.type === 'doc') {
      assert.deepEqual(entry.doc.data.attributes?.firstName, 'Van Gogh');
      let { isolatedHtml, embeddedHtml, fittedHtml } =
        (await getInstance(realm, new URL(`${testRealmURL}working-vangogh`))) ??
        {};
      assertInnerHtmlMatches(assert, isolatedHtml!, `<h1> Van Gogh </h1>`);
      assert.false(
        isolatedHtml!.includes('id="ember'),
        `isolated HTML does not include ember ID's`,
      );
      assertInnerHtmlMatches(
        assert,
        embeddedHtml![`${testRealmURL}person/Person`],
        `<h1> Person Embedded Card: Van Gogh </h1>`,
      );
      assertInnerHtmlMatches(
        assert,
        fittedHtml![`${testRealmURL}person/Person`],
        `<h1> Person Fitted Card: Van Gogh </h1>`,
      );
      assert.false(
        Object.values(embeddedHtml!).join('').includes('id="ember'),
        `embeddedHtml HTML does not include ember ID's`,
      );
      assert.false(
        Object.values(fittedHtml!).join('').includes('id="ember'),
        `fittedHtml HTML does not include ember ID's`,
      );
    } else {
      assert.ok(
        false,
        `expected search entry to be a document but was: ${entry?.error.errorDetail.message}`,
      );
    }
  });

  test('can incrementally index a card', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
        </template>
      };
      static atom = class Atom extends Component<typeof this> {
        <template>
          <div class='atom'>{{@model.firstName}}</div>
        </template>
      };
    }
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'vangogh.json': {
          data: {
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
      },
    });

    await realm.write(
      'vangogh.json',
      JSON.stringify({
        data: {
          id: `${testRealmURL}vangogh`,
          attributes: {
            firstName: 'Van Van',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );
    let { instance } =
      (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};
    assert.deepEqual(
      instance,
      {
        id: `${testRealmURL}vangogh`,
        type: 'card',
        attributes: {
          cardInfo: {
            description: null,
            notes: null,
            thumbnailURL: null,
            title: null,
          },
          description: null,
          firstName: 'Van Van',
          thumbnailURL: null,
          title: 'Untitled Card',
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
            module: './person',
            name: 'Person',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}vangogh.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(realm, 'vangogh.json'),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      },
      'serialized instance is correct',
    );
  });

  test('can capture search doc when indexing a card', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
        </template>
      };
      static atom = class Atom extends Component<typeof this> {
        <template>
          <div class='atom'>{{@model.firstName}}</div>
        </template>
      };
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'vangogh.json': {
          data: {
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
      },
    });
    let { searchDoc } =
      (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};
    assert.deepEqual(
      searchDoc,
      {
        _cardType: 'Person',
        cardInfo: {
          theme: null,
        },
        firstName: 'Van Gogh',
        id: `${testRealmURL}vangogh`,
        title: 'Untitled Card',
      },
      'search doc is correct',
    );
  });

  test('can capture atom html when indexing a card', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /></h1>
        </template>
      };
      static atom = class Atom extends Component<typeof this> {
        <template>
          <div class='atom'>{{@model.firstName}}</div>
        </template>
      };
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'vangogh.json': {
          data: {
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
      },
    });
    let { atomHtml } =
      (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};

    assert.strictEqual(
      cleanWhiteSpace(stripScopedCSSAttributes(atomHtml!)),
      cleanWhiteSpace(`<div class="atom">Van Gogh</div>`),
      'atom html is correct',
    );
    assert.false(
      atomHtml!.includes('id="ember'),
      `atom HTML does not include ember ID's`,
    );
  });

  test('can capture head html when indexing a card', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);

      static head = class Head extends Component<typeof this> {
        <template>
          <title>{{@model.firstName}}!</title>
        </template>
      };
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'vangogh.json': {
          data: {
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
      },
    });

    let { headHtml } =
      (await getInstance(realm, new URL(`${testRealmURL}vangogh`))) ?? {};

    assert.strictEqual(
      cleanWhiteSpace(stripScopedCSSAttributes(headHtml!)),
      cleanWhiteSpace(`<title>Van Gogh!</title>`),
      'head html is correct',
    );
  });

  test(`can generate embedded HTML for instance's card class hierarchy`, async function (assert) {
    class Person extends CardDef {
      static displayName = 'Person';
      @field description = contains(StringField);
      @field firstName = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1> Person Embedded Card: <@fields.firstName /></h1>
        </template>
      };
    }

    class FancyPerson extends Person {
      static displayName = 'Fancy Person';
      @field favoriteColor = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h1>
            Fancy Person Embedded Card:
            <@fields.firstName />
            -
            <@fields.favoriteColor /></h1>
        </template>
      };
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'fancy-person.gts': { FancyPerson },
        'germaine.json': {
          data: {
            attributes: {
              firstName: 'Germaine',
              favoriteColor: 'hot pink',
              description: 'Fancy Germaine',
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
    });

    let { embeddedHtml } =
      (await getInstance(realm, new URL(`${testRealmURL}germaine`))) ?? {};
    assert.false(
      Object.values(embeddedHtml!).join('').includes('id="ember'),
      `Embedded HTML does not include ember ID's`,
    );
    assert.strictEqual(
      cleanWhiteSpace(
        stripScopedCSSAttributes(
          embeddedHtml![`${testRealmURL}fancy-person/FancyPerson`],
        ),
      ),
      cleanWhiteSpace(
        `<div
          class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card embedded-format display-container-true"
          data-test-boxel-card-container
          style
          data-test-card="http://test-realm/test/germaine"
          data-test-card-format="embedded"
          data-test-field-component-card> <h1> Fancy Person Embedded Card: Germaine - hot pink </h1> </div>`,
      ),
      'default embedded HTML is correct',
    );

    let cardDefRefURL = internalKeyFor(baseCardRef, undefined);
    assert.deepEqual(
      Object.keys(embeddedHtml!),
      [
        `${testRealmURL}fancy-person/FancyPerson`,
        `${testRealmURL}person/Person`,
        cardDefRefURL,
      ],
      'embedded class hierarchy is correct',
    );

    assert.strictEqual(
      cleanWhiteSpace(
        stripScopedCSSAttributes(embeddedHtml![`${testRealmURL}person/Person`]),
      ),
      cleanWhiteSpace(`<div
        class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card embedded-format display-container-true"
        data-test-boxel-card-container
        style
        data-test-card="http://test-realm/test/germaine"
        data-test-card-format="embedded"
        data-test-field-component-card> <h1> Person Embedded Card: Germaine </h1> </div>`),
      `${testRealmURL}person/Person embedded HTML is correct`,
    );
    assert.false(
      embeddedHtml![`${testRealmURL}person/Person`].includes('id="ember'),
      `${testRealmURL}person/Person embedded HTML does not include ember ID's`,
    );

    assert.strictEqual(
      cleanWhiteSpace(stripScopedCSSAttributes(embeddedHtml![cardDefRefURL])),
      cleanWhiteSpace(`<div
        class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card embedded-format display-container-true"
        data-test-boxel-card-container
        style
        data-test-card="http://test-realm/test/germaine"
        data-test-card-format="embedded"
        data-test-field-component-card>
          <div class="embedded-template">
            <div class="thumbnail-section">
              <div class="card-thumbnail">
                <div class="card-thumbnail-placeholder" data-test-card-thumbnail-placeholder></div>
              </div>
            </div>
            <div class="info-section">
              <h3 class="card-title" data-test-card-title>Untitled Fancy Person</h3>
              <h4 class="card-display-name" data-test-card-display-name>
                Fancy Person
              </h4>
            </div>
            <div class="card-description" data-test-card-description>Fancy Germaine</div>
          </div>
        </div>
      `),
      `${cardDefRefURL} embedded HTML is correct`,
    );

    assert.false(
      embeddedHtml![cardDefRefURL].includes('id="ember'),
      `${cardDefRefURL} fitted HTML does not include ember ID's`,
    );
  });

  test(`can generate fitted HTML for instance's card class hierarchy`, async function (assert) {
    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field description = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h1> Person Fitted Card: <@fields.firstName /></h1>
        </template>
      };
    }

    class FancyPerson extends Person {
      static displayName = 'Fancy Person';
      @field favoriteColor = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h1>
            Fancy Person Fitted Card:
            <@fields.firstName />
            -
            <@fields.favoriteColor /></h1>
        </template>
      };
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'fancy-person.gts': { FancyPerson },
        'germaine.json': {
          data: {
            attributes: {
              firstName: 'Germaine',
              favoriteColor: 'hot pink',
              description: 'Fancy Germaine',
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
    });

    let { embeddedHtml, fittedHtml } =
      (await getInstance(realm, new URL(`${testRealmURL}germaine`))) ?? {};
    assert.false(
      Object.values(fittedHtml!).join('').includes('id="ember'),
      `Fitted HTML does not include ember ID's`,
    );
    assert.strictEqual(
      cleanWhiteSpace(
        stripScopedCSSAttributes(
          fittedHtml![`${testRealmURL}fancy-person/FancyPerson`],
        ),
      ),
      cleanWhiteSpace(
        `<div
          class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card fitted-format display-container-true"
          data-test-boxel-card-container
          style
          data-test-card="http://test-realm/test/germaine"
          data-test-card-format="fitted"
          data-test-field-component-card> <h1> Fancy Person Fitted Card: Germaine - hot pink </h1> </div>`,
      ),
      'default fitted HTML is correct',
    );

    let cardDefRefURL = internalKeyFor(baseCardRef, undefined);
    assert.deepEqual(
      Object.keys(fittedHtml!),
      [
        `${testRealmURL}fancy-person/FancyPerson`,
        `${testRealmURL}person/Person`,
        cardDefRefURL,
      ],
      'fitted class hierarchy is correct',
    );

    assert.strictEqual(
      cleanWhiteSpace(
        stripScopedCSSAttributes(fittedHtml![`${testRealmURL}person/Person`]),
      ),
      cleanWhiteSpace(`<div
      class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card fitted-format display-container-true"
      data-test-boxel-card-container
      style
      data-test-card="http://test-realm/test/germaine"
      data-test-card-format="fitted"
      data-test-field-component-card> <h1> Person Fitted Card: Germaine </h1> </div>`),
      `${testRealmURL}person/Person fitted HTML is correct`,
    );
    assert.false(
      fittedHtml![`${testRealmURL}person/Person`].includes('id="ember'),
      `${testRealmURL}person/Person fitted HTML does not include ember ID's`,
    );

    assert.strictEqual(
      cleanWhiteSpace(stripScopedCSSAttributes(embeddedHtml![cardDefRefURL])),
      cleanWhiteSpace(`<div
      class="ember-view boxel-card-container boxel-card-container--boundaries field-component-card embedded-format display-container-true"
      data-test-boxel-card-container
      style
      data-test-card="http://test-realm/test/germaine"
      data-test-card-format="embedded"
      data-test-field-component-card>
        <div class="embedded-template">
          <div class="thumbnail-section">
            <div class="card-thumbnail">
              <div class="card-thumbnail-placeholder" data-test-card-thumbnail-placeholder></div>
            </div>
          </div>
          <div class="info-section">
            <h3 class="card-title" data-test-card-title>Untitled Fancy Person</h3>
            <h4 class="card-display-name" data-test-card-display-name> Fancy Person </h4>
          </div>
          <div class="card-description" data-test-card-description>Fancy Germaine</div>
        </div>
      </div>`),
      `${cardDefRefURL} embedded HTML is correct`,
    );

    assert.false(
      embeddedHtml![cardDefRefURL].includes('id="ember'),
      `${cardDefRefURL} embedded HTML does not include ember ID's`,
    );
  });

  test('can index a card that has a cyclic relationship with the field of a card in its fields', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field pet = linksTo(() => PetCard);
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
    }
    class Appointment extends FieldDef {
      @field title = contains(StringField);
      @field contact = contains(Person);
    }

    class PetCard extends CardDef {
      @field firstName = contains(StringField);
      @field appointment = contains(Appointment);
      @field title = contains(StringField, {
        computeVia: function (this: PetCard) {
          return this.firstName;
        },
      });
      @field description = contains(StringField);
      @field thumbnailURL = contains(StringField);
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person-card.gts': { Person },
        'appointment.gts': { Appointment },
        'pet-card.gts': { PetCard },
        'jackie.json': {
          data: {
            attributes: {
              firstName: 'Jackie',
              appointment: {
                title: 'Vet visit',
                contact: { firstName: 'Burcu' },
              },
              description: 'Dog',
              thumbnailURL: './jackie.jpg',
            },
            meta: {
              adoptsFrom: { module: `./pet-card`, name: 'PetCard' },
            },
            relationships: {
              'appointment.contact.pet': {
                links: { self: `${testRealmURL}mango` },
              },
            },
          },
        },
        'mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: { module: `./pet-card`, name: 'PetCard' },
            },
          },
        },
      },
    });

    let indexer = realm.realmIndexQueryEngine;
    let card = await indexer.cardDocument(new URL(`${testRealmURL}jackie`));

    if (card?.type === 'doc') {
      assert.deepEqual(card.doc.data.attributes, {
        firstName: 'Jackie',
        title: 'Jackie',
        appointment: {
          title: 'Vet visit',
          contact: {
            firstName: 'Burcu',
          },
        },
        description: 'Dog',
        thumbnailURL: `./jackie.jpg`,
        cardInfo,
      });
      assert.deepEqual(card.doc.data.relationships, {
        'appointment.contact.pet': {
          links: { self: `${testRealmURL}mango` },
        },
        'cardInfo.theme': { links: { self: null } },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${card?.error.errorDetail.message}`,
      );
    }
  });

  test('can index a card with a containsMany composite containing a linkTo field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Vendor/vendor1.json': {
          data: {
            id: `${testRealmURL}Vendor/vendor1`,
            attributes: {
              name: 'Acme Industries',
              paymentMethods: [
                {
                  type: 'crypto',
                  payment: {
                    address: '0x1111',
                  },
                },
                {
                  type: 'crypto',
                  payment: {
                    address: '0x2222',
                  },
                },
              ],
            },
            relationships: {
              'paymentMethods.0.payment.chain': {
                links: {
                  self: `${testRealmURL}Chain/1`,
                },
              },
              'paymentMethods.1.payment.chain': {
                links: {
                  self: `${testRealmURL}Chain/2`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/vendor`,
                name: 'Vendor',
              },
            },
          },
        },
        'Chain/1.json': {
          data: {
            id: `${testRealmURL}Chain/1`,
            attributes: {
              name: 'Ethereum Mainnet',
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/chain`,
                name: 'Chain',
              },
            },
          },
        },
        'Chain/2.json': {
          data: {
            id: `${testRealmURL}Chain/2`,
            attributes: {
              name: 'Polygon',
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/chain`,
                name: 'Chain',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let vendor = await indexer.cardDocument(
      new URL(`${testRealmURL}Vendor/vendor1`),
      {
        loadLinks: true,
      },
    );
    if (vendor?.type === 'doc') {
      assert.deepEqual(vendor.doc, {
        data: {
          id: `${testRealmURL}Vendor/vendor1`,
          type: 'card',
          links: {
            self: `${testRealmURL}Vendor/vendor1`,
          },
          attributes: {
            name: 'Acme Industries',
            title: 'Acme Industries',
            description: 'Vendor',
            thumbnailURL: null,
            paymentMethods: [
              {
                type: 'crypto',
                payment: {
                  address: '0x1111',
                },
              },
              {
                type: 'crypto',
                payment: {
                  address: '0x2222',
                },
              },
            ],
            cardInfo,
          },
          relationships: {
            'paymentMethods.0.payment.chain': {
              data: {
                id: `${testRealmURL}Chain/1`,
                type: 'card',
              },
              links: {
                self: `${testRealmURL}Chain/1`,
              },
            },
            'paymentMethods.1.payment.chain': {
              data: {
                id: `${testRealmURL}Chain/2`,
                type: 'card',
              },
              links: {
                self: `${testRealmURL}Chain/2`,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: `http://localhost:4202/test/vendor`,
              name: 'Vendor',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Vendor/vendor1.json`,
            ),
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Vendor/vendor1.json',
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        },
        included: [
          {
            id: `${testRealmURL}Chain/1`,
            type: 'card',
            links: {
              self: `${testRealmURL}Chain/1`,
            },
            attributes: {
              name: 'Ethereum Mainnet',
              title: 'Ethereum Mainnet',
              chainId: 1,
              description: `Chain 1`,
              thumbnailURL: `Ethereum Mainnet-icon.png`,
              cardInfo,
            },
            relationships: {
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/chain`,
                name: 'Chain',
              },
              lastModified: adapter.lastModifiedMap.get(
                `${testRealmURL}Chain/1.json`,
              ),
              resourceCreatedAt: await getFileCreatedAt(realm, 'Chain/1.json'),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
            },
          },
          {
            id: `${testRealmURL}Chain/2`,
            type: 'card',
            links: {
              self: `${testRealmURL}Chain/2`,
            },
            attributes: {
              name: 'Polygon',
              title: 'Polygon',
              chainId: 137,
              description: `Chain 137`,
              thumbnailURL: `Polygon-icon.png`,
              cardInfo,
            },
            relationships: {
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/chain`,
                name: 'Chain',
              },
              lastModified: adapter.lastModifiedMap.get(
                `${testRealmURL}Chain/2.json`,
              ),
              resourceCreatedAt: await getFileCreatedAt(realm, 'Chain/2.json'),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
            },
          },
        ],
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${vendor?.error.errorDetail.message}`,
      );
    }
  });

  test('can tolerate a card whose computed throws an exception', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Boom/boom.json': {
          data: {
            id: `${testRealmURL}Boom/boom`,
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/card-with-error',
                name: 'Boom',
              },
            },
          },
        },
        'Person/owner.json': {
          data: {
            id: `${testRealmURL}Person/owner`,
            attributes: {
              firstName: 'Hassan',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}Boom/boom`),
      );
      if (card?.type === 'error') {
        assert.ok(
          card.error.errorDetail.message.includes('intentional error thrown'),
          'error doc includes raised error message',
        );
      } else {
        assert.ok(false, `expected search entry to be an error doc`);
      }
    }

    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}Person/owner`),
      );
      if (card?.type === 'doc') {
        assert.strictEqual(card.doc.data.attributes?.firstName, 'Hassan');
      } else {
        assert.ok(
          false,
          `search entry was an error: ${card?.error.errorDetail.message}`,
        );
      }
    }
  });

  test(`search doc includes 'contains' and used 'linksTo' fields, including contained computed fields`, async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Pet/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            relationships: {
              owner: {
                links: { self: `${testRealmURL}Person/hassan` },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Person/hassan.json': {
          data: {
            id: `${testRealmURL}Person/hassan`,
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
              email: 'hassan@cardstack.com',
              posts: 100,
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let entry = await getInstance(
      realm,
      new URL(`${testRealmURL}Person/hassan`),
    );
    assert.deepEqual(
      entry?.searchDoc,
      {
        id: `${testRealmURL}Person/hassan`,
        firstName: 'Hassan',
        lastName: 'Abdel-Rahman',
        email: 'hassan@cardstack.com',
        posts: 100,
        title: 'Hassan Abdel-Rahman',
        description: 'Person',
        fullName: 'Hassan Abdel-Rahman',
        _cardType: 'Person',
        cardInfo: { theme: null },
      },
      `search doc includes fullName field`,
    );
  });

  test(`search doc includes unused 'linksTo' field if isUsed option is set to true`, async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Publication/pacific.json': {
          data: {
            id: `${testRealmURL}Publication/pacific`,
            attributes: { title: 'Pacific Weekly' },
            relationships: {
              'featuredPosts.0': { links: { self: `../Post/1` } },
              'featuredPosts.1': { links: { self: `../Post/2` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}publication`,
                name: 'Publication',
              },
            },
          },
        },
        'Post/1.json': {
          data: {
            id: `${testRealmURL}Post/1`,
            attributes: {
              title: '50 Ways to Leave Your Laptop',
              views: 5,
            },
            relationships: {
              publication: {
                links: { self: `../Publication/pacific` },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/post',
                name: 'Post',
              },
            },
          },
        },
        'Post/2.json': {
          data: {
            id: `${testRealmURL}Post/2`,
            attributes: {
              title: '49 Shades of Mauve',
              views: 24,
            },
            relationships: {
              publication: {
                links: { self: `../Publication/pacific` },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/post',
                name: 'Post',
              },
            },
          },
        },
      },
    });
    let entry = await getInstance(realm, new URL(`${testRealmURL}Post/1`));
    assert.deepEqual(
      entry?.searchDoc,
      {
        _cardType: 'Post',
        author: {
          description: 'Person',
          fullName: ' ',
          title: ' ',
        },
        id: `${testRealmURL}Post/1`,
        title: '50 Ways to Leave Your Laptop',
        publication: {
          id: `${testRealmURL}Publication/pacific`,
        },
        views: 5,
        cardInfo: { theme: null },
      },
      `post 1 search doc includes publication relationship`,
    );
    let entry2 = await getInstance(
      realm,
      new URL(`${testRealmURL}Publication/pacific`),
    );
    assert.deepEqual(
      entry2?.searchDoc,
      {
        _cardType: 'Publication',
        id: `${testRealmURL}Publication/pacific`,
        title: 'Pacific Weekly',
        featuredPosts: [
          {
            author: {
              description: 'Person',
              fullName: ' ',
              title: ' ',
            },
            cardInfo: {
              theme: null,
            },
            id: `${testRealmURL}Post/1`,
            publication: {
              id: `${testRealmURL}Publication/pacific`,
            },
            title: '50 Ways to Leave Your Laptop',
            views: 5,
          },
          {
            author: {
              description: 'Person',
              fullName: ' ',
              title: ' ',
            },
            cardInfo: {
              theme: null,
            },
            id: `${testRealmURL}Post/2`,
            publication: {
              id: `${testRealmURL}Publication/pacific`,
            },
            title: '49 Shades of Mauve',
            views: 24,
          },
        ],
        cardInfo: { theme: null },
      },
      `publication search doc includes featuredPosts relationship via isUsed=true`,
    );
  });

  test('search doc normalizes containsMany composite fields', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field email = contains(StringField);
      @field posts = contains(NumberField);
      @field fullName = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
        },
      });
      @field description = contains(StringField, {
        computeVia: () => 'Person',
      });
    }
    class Post extends FieldDef {
      @field title = contains(StringField);
      @field description = contains(StringField);
      @field author = contains(Person);
      @field views = contains(NumberField);
      @field createdAt = contains(DatetimeField);
    }
    class Booking extends FieldDef {
      @field title = contains(StringField);
      @field venue = contains(StringField);
      @field startTime = contains(DatetimeField);
      @field endTime = contains(DatetimeField);
      @field hosts = containsMany(Person);
      @field sponsors = containsMany(StringField);
      @field posts = containsMany(Post);
      @field description = contains(StringField, {
        computeVia: function (this: Booking) {
          return this.venue;
        },
      });
      @field thumbnailURL = contains(StringField, { computeVia: () => null });
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'booking.gts': { Booking },
        'person.gts': { Person },
        'post.gts': { Post },
        'Spec/booking.json': {
          data: {
            attributes: {
              title: 'Booking',
              description: 'Spec for Booking',
              specType: 'card',
              ref: {
                module: 'http://localhost:4202/test/booking',
                name: 'Booking',
              },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
      },
    });
    let entry = await getInstance(
      realm,
      new URL(`${testRealmURL}Spec/booking`),
    );
    assert.deepEqual(entry?.searchDoc, {
      _cardType: 'Spec',
      id: `${testRealmURL}Spec/booking`,
      description: 'Spec for Booking',
      specType: 'card',
      moduleHref: 'http://localhost:4202/test/booking',
      containedExamples: null,
      linkedExamples: null,
      ref: 'http://localhost:4202/test/booking/Booking',
      title: 'Booking',
      isCard: true,
      isComponent: false,
      isField: false,
      cardInfo: { theme: null },
    });
    // we should be able to perform a structured clone of the search doc (this
    // emulates the limitations of the postMessage used to communicate between
    // DOM and worker). Success is not throwing an error
    structuredClone(entry?.searchDoc);
  });

  test('can index a card with linksToMany field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Pet/vanGogh.json': {
          data: {
            attributes: { firstName: 'Van Gogh' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'PetPerson/hassan.json': {
          data: {
            attributes: { firstName: 'Hassan' },
            relationships: {
              'pets.0': {
                links: { self: `${testRealmURL}Pet/mango` },
              },
              'pets.1': {
                links: { self: `${testRealmURL}Pet/vanGogh` },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let indexer = realm.realmIndexQueryEngine;
    let hassan = await indexer.cardDocument(
      new URL(`${testRealmURL}PetPerson/hassan`),
      { loadLinks: true },
    );

    if (hassan?.type === 'doc') {
      assert.deepEqual(hassan.doc.data, {
        id: `${testRealmURL}PetPerson/hassan`,
        type: 'card',
        links: { self: `${testRealmURL}PetPerson/hassan` },
        attributes: {
          firstName: 'Hassan',
          title: 'Hassan Pet Person',
          description: 'A person with pets',
          thumbnailURL: null,
          cardInfo,
        },
        relationships: {
          friend: {
            links: {
              self: null,
            },
          },
          'pets.0': {
            links: { self: `../Pet/mango` },
            data: { id: `${testRealmURL}Pet/mango`, type: 'card' },
          },
          'pets.1': {
            links: { self: `../Pet/vanGogh` },
            data: { id: `${testRealmURL}Pet/vanGogh`, type: 'card' },
          },
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}pet-person`,
            name: 'PetPerson',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}PetPerson/hassan.json`,
          ),
          resourceCreatedAt: await getFileCreatedAt(
            realm,
            'PetPerson/hassan.json',
          ),
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
        },
      });
      assert.deepEqual(hassan.doc.included, [
        {
          id: `${testRealmURL}Pet/mango`,
          type: 'card',
          links: { self: `${testRealmURL}Pet/mango` },
          attributes: {
            description: null,
            firstName: 'Mango',
            title: 'Mango',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            owner: { links: { self: null } },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}pet`, name: 'Pet' },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Pet/mango.json`,
            ),
            resourceCreatedAt: await getFileCreatedAt(realm, 'Pet/mango.json'),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        },
        {
          id: `${testRealmURL}Pet/vanGogh`,
          type: 'card',
          links: { self: `${testRealmURL}Pet/vanGogh` },
          attributes: {
            description: null,
            firstName: 'Van Gogh',
            title: 'Van Gogh',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            owner: { links: { self: null } },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: { module: `${testModuleRealm}pet`, name: 'Pet' },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Pet/vanGogh.json`,
            ),
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Pet/vanGogh.json',
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        },
      ]);
    } else {
      assert.ok(
        false,
        `search entry was an error: ${hassan?.error.errorDetail.message}`,
      );
    }

    let hassanEntry = await getInstance(
      realm,
      new URL(`${testRealmURL}PetPerson/hassan`),
    );
    if (hassanEntry) {
      assert.deepEqual(hassanEntry.searchDoc, {
        _cardType: 'Pet Person',
        id: `${testRealmURL}PetPerson/hassan`,
        firstName: 'Hassan',
        pets: [
          {
            id: `${testRealmURL}Pet/mango`,
            firstName: 'Mango',
            owner: null,
            title: 'Mango',
            cardInfo: { theme: null },
          },
          {
            id: `${testRealmURL}Pet/vanGogh`,
            firstName: 'Van Gogh',
            owner: null,
            title: 'Van Gogh',
            cardInfo: { theme: null },
          },
        ],
        friend: null,
        title: 'Hassan Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}PetPerson/hassan in the index`,
      );
    }
  });

  test('can index a card with empty linksToMany field value', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'PetPerson/burcu.json': {
          data: {
            attributes: { firstName: 'Burcu' },
            relationships: {
              pets: { links: { self: null } },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let card = await indexer.cardDocument(
      new URL(`${testRealmURL}PetPerson/burcu`),
      {
        loadLinks: true,
      },
    );

    if (card?.type === 'doc') {
      assert.deepEqual(card.doc, {
        data: {
          id: `${testRealmURL}PetPerson/burcu`,
          type: 'card',
          links: { self: `${testRealmURL}PetPerson/burcu` },
          attributes: {
            firstName: 'Burcu',
            title: 'Burcu Pet Person',
            description: 'A person with pets',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            pets: { links: { self: null } },
            friend: { links: { self: null } },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}pet-person`,
              name: 'PetPerson',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}PetPerson/burcu.json`,
            ),
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'PetPerson/burcu.json',
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
          },
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${card?.error.errorDetail.message}`,
      );
    }

    let entry = await getInstance(
      realm,
      new URL(`${testRealmURL}PetPerson/burcu`),
    );
    if (entry) {
      assert.deepEqual(entry.searchDoc, {
        _cardType: 'Pet Person',
        id: `${testRealmURL}PetPerson/burcu`,
        firstName: 'Burcu',
        pets: null,
        friend: null,
        title: 'Burcu Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}PetPerson/burcu in the index`,
      );
    }
  });

  test('can index a card that contains a field with a linksToMany field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Pet/vanGogh.json': {
          data: {
            attributes: { firstName: 'Van Gogh' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'pet-person-spec.json': {
          data: {
            attributes: {
              title: 'PetPerson',
              description: 'Spec for PetPerson',
              specType: 'card',
              ref: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
            relationships: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Pet/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let indexer = realm.realmIndexQueryEngine;
    let spec = await indexer.cardDocument(
      new URL(`${testRealmURL}pet-person-spec`),
      { loadLinks: true },
    );

    if (spec?.type === 'doc') {
      assert.deepEqual(spec.doc.data, {
        id: `${testRealmURL}pet-person-spec`,
        type: 'card',
        links: { self: `${testRealmURL}pet-person-spec` },
        attributes: {
          title: 'PetPerson',
          description: 'Spec for PetPerson',
          readMe: null,
          thumbnailURL: null,
          ref: {
            module: `${testModuleRealm}pet-person`,
            name: 'PetPerson',
          },
          specType: 'card',
          moduleHref: `${testModuleRealm}pet-person`,
          containedExamples: [],
          isCard: true,
          isComponent: false,
          isField: false,
          cardInfo,
        },
        relationships: {
          'cardInfo.theme': { links: { self: null } },
          linkedExamples: { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}pet-person-spec.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
          resourceCreatedAt: await getFileCreatedAt(
            realm,
            'pet-person-spec.json',
          ),
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${spec?.error.errorDetail.message}`,
      );
    }

    let entry = await getInstance(
      realm,
      new URL(`${testRealmURL}pet-person-spec`),
    );
    if (entry) {
      assert.deepEqual(entry.searchDoc, {
        _cardType: 'Spec',
        id: `${testRealmURL}pet-person-spec`,
        title: 'PetPerson',
        description: 'Spec for PetPerson',
        containedExamples: null,
        linkedExamples: null,
        moduleHref: `${testModuleRealm}pet-person`,
        ref: `${testModuleRealm}pet-person/PetPerson`,
        specType: 'card',
        isCard: true,
        isComponent: false,
        isField: false,
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}pet-person-spec in the index`,
      );
    }
  });

  test('can index a card that has nested linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Friend/hassan.json': {
          data: {
            id: `${testRealmURL}Friend/hassan`,
            attributes: {
              firstName: 'Hassan',
              description: 'Friend of dogs',
            },
            relationships: {
              friend: {
                links: {
                  self: `${testRealmURL}Friend/mango`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
        'Friend/mango.json': {
          data: {
            id: `${testRealmURL}Friend/mango`,
            attributes: {
              firstName: 'Mango',
              description: 'Dog friend',
            },
            relationships: {
              friend: {
                links: {
                  self: `${testRealmURL}Friend/vanGogh`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
        'Friend/vanGogh.json': {
          data: {
            id: `${testRealmURL}Friend/vanGogh`,
            attributes: {
              firstName: 'Van Gogh',
              description: 'Dog friend',
              thumbnailURL: 'van-gogh.jpg',
            },
            relationships: {
              friend: {
                links: {
                  self: null,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let hassan = await indexer.cardDocument(
      new URL(`${testRealmURL}Friend/hassan`),
    );
    if (hassan?.type === 'doc') {
      assert.deepEqual(hassan.doc.data, {
        id: `${testRealmURL}Friend/hassan`,
        type: 'card',
        links: {
          self: `${testRealmURL}Friend/hassan`,
        },
        attributes: {
          firstName: 'Hassan',
          title: 'Hassan',
          description: 'Friend of dogs',
          thumbnailURL: null,
          cardInfo,
        },
        relationships: {
          friend: {
            links: {
              self: `./mango`,
            },
          },
          'cardInfo.theme': { links: { self: null } },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/friend',
            name: 'Friend',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}Friend/hassan.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: 'http://test-realm/test/',
          resourceCreatedAt: await getFileCreatedAt(
            realm,
            'Friend/hassan.json',
          ),
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${hassan?.error.errorDetail.message}`,
      );
    }

    let hassanEntry = await getInstance(
      realm,
      new URL(`${testRealmURL}Friend/hassan`),
    );
    if (hassanEntry) {
      assert.deepEqual(hassanEntry.searchDoc, {
        _cardType: 'Friend',
        id: `${testRealmURL}Friend/hassan`,
        firstName: 'Hassan',
        title: 'Hassan',
        description: 'Friend of dogs',
        friend: {
          id: `${testRealmURL}Friend/mango`,
          firstName: 'Mango',
          title: 'Mango',
          description: 'Dog friend',
          friend: {
            id: `${testRealmURL}Friend/vanGogh`,
          },
          cardInfo: { theme: null },
        },
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}Friend/hassan in the index`,
      );
    }
  });

  test('can index a field with a cycle in the linksTo field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Friend/hassan.json': {
          data: {
            id: `${testRealmURL}Friend/hassan`,
            attributes: {
              firstName: 'Hassan',
              description: 'Dog owner',
            },
            relationships: {
              friend: {
                links: {
                  self: `${testRealmURL}Friend/mango`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
        'Friend/mango.json': {
          data: {
            id: `${testRealmURL}Friend/mango`,
            attributes: {
              firstName: 'Mango',
              description: 'Dog friend',
            },
            relationships: {
              friend: {
                links: {
                  self: `${testRealmURL}Friend/hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let hassan = await indexer.cardDocument(
      new URL(`${testRealmURL}Friend/hassan`),
      {
        loadLinks: true,
      },
    );
    if (hassan?.type === 'doc') {
      assert.deepEqual(hassan.doc, {
        data: {
          id: `${testRealmURL}Friend/hassan`,
          type: 'card',
          links: { self: `${testRealmURL}Friend/hassan` },
          attributes: {
            firstName: 'Hassan',
            title: 'Hassan',
            description: 'Dog owner',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            friend: {
              links: {
                self: `./mango`,
              },
              data: {
                type: 'card',
                id: `${testRealmURL}Friend/mango`,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/friend',
              name: 'Friend',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Friend/hassan.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friend/hassan.json',
            ),
          },
        },
        included: [
          {
            id: `${testRealmURL}Friend/mango`,
            type: 'card',
            links: { self: `${testRealmURL}Friend/mango` },
            attributes: {
              firstName: 'Mango',
              title: 'Mango',
              description: 'Dog friend',
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              friend: {
                links: {
                  self: `./hassan`,
                },
                data: {
                  type: 'card',
                  id: `${testRealmURL}Friend/hassan`,
                },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
              lastModified: adapter.lastModifiedMap.get(
                `${testRealmURL}Friend/mango.json`,
              ),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friend/mango.json',
              ),
            },
          },
        ],
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${hassan?.error.errorDetail.message}`,
      );
    }

    let hassanEntry = await getInstance(
      realm,
      new URL(`${testRealmURL}Friend/hassan`),
    );
    if (hassanEntry) {
      assert.deepEqual(hassanEntry.searchDoc, {
        _cardType: 'Friend',
        id: `${testRealmURL}Friend/hassan`,
        firstName: 'Hassan',
        description: 'Dog owner',
        friend: {
          id: `${testRealmURL}Friend/mango`,
          firstName: 'Mango',
          title: 'Mango',
          friend: {
            id: `${testRealmURL}Friend/hassan`,
          },
          description: 'Dog friend',
          cardInfo: { theme: null },
        },
        title: 'Hassan',
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}Friend/hassan in the index`,
      );
    }

    let mango = await indexer.cardDocument(
      new URL(`${testRealmURL}Friend/mango`),
      {
        loadLinks: true,
      },
    );
    if (mango?.type === 'doc') {
      assert.deepEqual(mango.doc, {
        data: {
          id: `${testRealmURL}Friend/mango`,
          type: 'card',
          links: { self: `${testRealmURL}Friend/mango` },
          attributes: {
            firstName: 'Mango',
            title: 'Mango',
            description: 'Dog friend',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            friend: {
              links: {
                self: `./hassan`,
              },
              data: {
                type: 'card',
                id: `${testRealmURL}Friend/hassan`,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/friend',
              name: 'Friend',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Friend/mango.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friend/mango.json',
            ),
          },
        },
        included: [
          {
            id: `${testRealmURL}Friend/hassan`,
            type: 'card',
            links: { self: `${testRealmURL}Friend/hassan` },
            attributes: {
              firstName: 'Hassan',
              title: 'Hassan',
              description: 'Dog owner',
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              friend: {
                links: {
                  self: `./mango`,
                },
                data: {
                  type: 'card',
                  id: `${testRealmURL}Friend/mango`,
                },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
              lastModified: adapter.lastModifiedMap.get(
                `${testRealmURL}Friend/hassan.json`,
              ),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friend/hassan.json',
              ),
            },
          },
        ],
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${mango?.error.errorDetail.message}`,
      );
    }

    let mangoEntry = await getInstance(
      realm,
      new URL(`${testRealmURL}Friend/mango`),
    );
    if (mangoEntry) {
      assert.deepEqual(mangoEntry.searchDoc, {
        _cardType: 'Friend',
        id: `${testRealmURL}Friend/mango`,
        firstName: 'Mango',
        title: 'Mango',
        description: 'Dog friend',
        friend: {
          id: `${testRealmURL}Friend/hassan`,
          title: 'Hassan',
          firstName: 'Hassan',
          friend: {
            id: `${testRealmURL}Friend/mango`,
          },
          description: 'Dog owner',
          cardInfo: { theme: null },
        },
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}Friend/mango in the index`,
      );
    }
  });

  test('can index a card that has a linksTo relationship to itself', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Friend/hassan.json': {
          data: {
            id: `${testRealmURL}Friend/hassan`,
            attributes: {
              firstName: 'Hassan',
              description: 'Dog owner',
            },
            relationships: {
              friend: {
                links: {
                  self: `${testRealmURL}Friend/hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/friend',
                name: 'Friend',
              },
            },
          },
        },
      },
    });
    let indexer = realm.realmIndexQueryEngine;
    let hassan = await indexer.cardDocument(
      new URL(`${testRealmURL}Friend/hassan`),
      {
        loadLinks: true,
      },
    );
    if (hassan?.type === 'doc') {
      assert.deepEqual(hassan.doc, {
        data: {
          id: `${testRealmURL}Friend/hassan`,
          type: 'card',
          links: { self: `${testRealmURL}Friend/hassan` },
          attributes: {
            firstName: 'Hassan',
            title: 'Hassan',
            description: 'Dog owner',
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            friend: {
              links: {
                self: `./hassan`,
              },
              data: {
                type: 'card',
                id: `${testRealmURL}Friend/hassan`,
              },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/friend',
              name: 'Friend',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}Friend/hassan.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friend/hassan.json',
            ),
          },
        },
      });
    } else {
      assert.ok(
        false,
        `search entry was an error: ${hassan?.error.errorDetail.message}`,
      );
    }

    let hassanEntry = await getInstance(
      realm,
      new URL(`${testRealmURL}Friend/hassan`),
    );
    if (hassanEntry) {
      assert.deepEqual(hassanEntry.searchDoc, {
        _cardType: 'Friend',
        id: `${testRealmURL}Friend/hassan`,
        firstName: 'Hassan',
        description: 'Dog owner',
        friend: {
          id: `${testRealmURL}Friend/hassan`,
        },
        title: 'Hassan',
        cardInfo: { theme: null },
      });
    } else {
      assert.ok(
        false,
        `could not find ${testRealmURL}Friend/hassan in the index`,
      );
    }
  });

  test('can index a field with a cycle in the linksToMany field', async function (assert) {
    let hassanID = `${testRealmURL}Friends/hassan`;
    let mangoID = `${testRealmURL}Friends/mango`;
    let vanGoghID = `${testRealmURL}Friends/vanGogh`;
    let friendsRef = {
      module: `${testModuleRealm}friends`,
      name: 'Friends',
    };
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'Friends/vanGogh.json': {
          data: {
            attributes: { firstName: 'Van Gogh' },
            relationships: { 'friends.0': { links: { self: hassanID } } },
            meta: { adoptsFrom: friendsRef },
          },
        },
        'Friends/hassan.json': {
          data: {
            attributes: { firstName: 'Hassan' },
            relationships: {
              'friends.0': { links: { self: mangoID } },
              'friends.1': { links: { self: vanGoghID } },
            },
            meta: { adoptsFrom: friendsRef },
          },
        },
        'Friends/mango.json': {
          data: {
            attributes: { firstName: 'Mango' },
            relationships: { 'friends.0': { links: { self: hassanID } } },
            meta: { adoptsFrom: friendsRef },
          },
        },
      },
    });
    let queryEngine = realm.realmIndexQueryEngine;
    let realmIndexUpdater = realm.realmIndexUpdater;
    assert.deepEqual(
      realmIndexUpdater.stats,
      {
        instanceErrors: 0,
        instancesIndexed: 3,
        moduleErrors: 0,
        modulesIndexed: 0,
        totalIndexEntries: 3,
      },
      'instances are indexed without error',
    );

    let hassan = await queryEngine.cardDocument(new URL(hassanID), {
      loadLinks: true,
    });
    if (hassan?.type === 'doc') {
      assert.deepEqual(
        hassan.doc.data,
        {
          id: hassanID,
          type: 'card',
          links: { self: hassanID },
          attributes: {
            firstName: 'Hassan',
            title: 'Hassan',
            description: null,
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            'friends.0': {
              links: { self: './mango' },
              data: { type: 'card', id: mangoID },
            },
            'friends.1': {
              links: { self: './vanGogh' },
              data: { type: 'card', id: vanGoghID },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: friendsRef,
            lastModified: adapter.lastModifiedMap.get(`${hassanID}.json`),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friends/hassan.json',
            ),
          },
        },
        'hassan doc.data is correct',
      );

      assert.deepEqual(
        hassan.doc.included,
        [
          {
            id: mangoID,
            type: 'card',
            links: { self: mangoID },
            attributes: {
              firstName: 'Mango',
              title: 'Mango',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './hassan' },
                data: { type: 'card', id: hassanID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${mangoID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/mango.json',
              ),
            },
          },
          {
            id: vanGoghID,
            type: 'card',
            links: { self: vanGoghID },
            attributes: {
              firstName: 'Van Gogh',
              title: 'Van Gogh',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './hassan' },
                data: { type: 'card', id: hassanID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${vanGoghID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/vanGogh.json',
              ),
            },
          },
        ],
        'hassan doc.included is correct',
      );
    } else {
      assert.ok(
        false,
        `search entry was an error: ${hassan?.error.errorDetail.message}`,
      );
    }

    let hassanEntry = await getInstance(realm, new URL(hassanID));
    if (hassanEntry) {
      assert.deepEqual(
        hassanEntry.searchDoc,
        {
          _cardType: 'Friends',
          id: hassanID,
          firstName: 'Hassan',
          title: 'Hassan',
          friends: [
            {
              id: mangoID,
              firstName: 'Mango',
              title: 'Mango',
              friends: [{ id: hassanID }],
              cardInfo: { theme: null },
            },
            {
              id: vanGoghID,
              firstName: 'Van Gogh',
              friends: [{ id: hassanID }],
              title: 'Van Gogh',
              cardInfo: { theme: null },
            },
          ],
          cardInfo: { theme: null },
        },
        'hassan searchData is correct',
      );
    } else {
      assert.ok(false, `could not find ${hassanID} in the index`);
    }

    let mango = await queryEngine.cardDocument(new URL(mangoID), {
      loadLinks: true,
    });
    if (mango?.type === 'doc') {
      assert.deepEqual(
        mango.doc.data,
        {
          id: mangoID,
          type: 'card',
          links: { self: mangoID },
          attributes: {
            firstName: 'Mango',
            title: 'Mango',
            description: null,
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            'friends.0': {
              links: { self: './hassan' },
              data: { type: 'card', id: hassanID },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: friendsRef,
            lastModified: adapter.lastModifiedMap.get(`${mangoID}.json`),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friends/mango.json',
            ),
          },
        },
        'mango doc.data is correct',
      );
      assert.deepEqual(
        mango.doc.included,
        [
          {
            id: hassanID,
            type: 'card',
            links: { self: hassanID },
            attributes: {
              firstName: 'Hassan',
              title: 'Hassan',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './mango' },
                data: { type: 'card', id: mangoID },
              },
              'friends.1': {
                links: { self: './vanGogh' },
                data: { type: 'card', id: vanGoghID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${hassanID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/hassan.json',
              ),
            },
          },
          {
            id: vanGoghID,
            type: 'card',
            links: { self: vanGoghID },
            attributes: {
              firstName: 'Van Gogh',
              title: 'Van Gogh',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './hassan' },
                data: { type: 'card', id: hassanID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${vanGoghID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/vanGogh.json',
              ),
            },
          },
        ],
        'mango doc.included is correct',
      );
    } else {
      assert.ok(
        false,
        `search entry was an error: ${mango?.error.errorDetail.message}`,
      );
    }

    let mangoEntry = await getInstance(realm, new URL(mangoID));
    if (mangoEntry) {
      assert.deepEqual(
        mangoEntry.searchDoc,
        {
          _cardType: 'Friends',
          id: mangoID,
          firstName: 'Mango',
          title: 'Mango',
          friends: [
            {
              id: hassanID,
              firstName: 'Hassan',
              title: 'Hassan',
              friends: [
                { id: mangoID },
                {
                  id: vanGoghID,
                  firstName: 'Van Gogh',
                  title: 'Van Gogh',
                  friends: [
                    {
                      id: hassanID,
                    },
                  ],
                  cardInfo: { theme: null },
                },
              ],
              cardInfo: { theme: null },
            },
          ],
          cardInfo: { theme: null },
        },
        'mango searchData is correct',
      );
    } else {
      assert.ok(false, `could not find ${mangoID} in the index`);
    }

    let vanGogh = await queryEngine.cardDocument(new URL(vanGoghID), {
      loadLinks: true,
    });
    if (vanGogh?.type === 'doc') {
      assert.deepEqual(
        vanGogh.doc.data,
        {
          id: vanGoghID,
          type: 'card',
          links: { self: vanGoghID },
          attributes: {
            firstName: 'Van Gogh',
            title: 'Van Gogh',
            description: null,
            thumbnailURL: null,
            cardInfo,
          },
          relationships: {
            'friends.0': {
              links: { self: './hassan' },
              data: { type: 'card', id: hassanID },
            },
            'cardInfo.theme': { links: { self: null } },
          },
          meta: {
            adoptsFrom: friendsRef,
            lastModified: adapter.lastModifiedMap.get(`${vanGoghID}.json`),
            realmInfo: testRealmInfo,
            realmURL: 'http://test-realm/test/',
            resourceCreatedAt: await getFileCreatedAt(
              realm,
              'Friends/vanGogh.json',
            ),
          },
        },
        'vanGogh doc.data is correct',
      );
      assert.deepEqual(
        vanGogh.doc.included,
        [
          {
            id: hassanID,
            type: 'card',
            links: { self: hassanID },
            attributes: {
              firstName: 'Hassan',
              title: 'Hassan',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './mango' },
                data: { type: 'card', id: mangoID },
              },
              'friends.1': {
                links: { self: './vanGogh' },
                data: { type: 'card', id: vanGoghID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${hassanID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/hassan.json',
              ),
            },
          },
          {
            id: mangoID,
            type: 'card',
            links: { self: mangoID },
            attributes: {
              firstName: 'Mango',
              title: 'Mango',
              description: null,
              thumbnailURL: null,
              cardInfo,
            },
            relationships: {
              'friends.0': {
                links: { self: './hassan' },
                data: { type: 'card', id: hassanID },
              },
              'cardInfo.theme': { links: { self: null } },
            },
            meta: {
              adoptsFrom: friendsRef,
              lastModified: adapter.lastModifiedMap.get(`${mangoID}.json`),
              realmInfo: testRealmInfo,
              realmURL: 'http://test-realm/test/',
              resourceCreatedAt: await getFileCreatedAt(
                realm,
                'Friends/mango.json',
              ),
            },
          },
        ],
        'vanGogh doc.included is correct',
      );
    } else {
      assert.ok(
        false,
        `search entry was an error: ${vanGogh?.error.errorDetail.message}`,
      );
    }

    let vanGoghEntry = await getInstance(realm, new URL(vanGoghID));
    if (vanGoghEntry) {
      assert.deepEqual(
        vanGoghEntry.searchDoc,
        {
          _cardType: 'Friends',
          id: vanGoghID,
          firstName: 'Van Gogh',
          title: 'Van Gogh',
          friends: [
            {
              id: hassanID,
              firstName: 'Hassan',
              title: 'Hassan',
              friends: [
                {
                  cardInfo: {
                    theme: null,
                  },
                  firstName: 'Mango',
                  friends: [
                    {
                      id: hassanID,
                    },
                  ],
                  id: mangoID,
                  title: 'Mango',
                },
                { id: vanGoghID },
              ],
              cardInfo: { theme: null },
            },
          ],
          cardInfo: { theme: null },
        },
        'vanGogh searchData is correct',
      );
    } else {
      assert.ok(false, `could not find ${vanGoghID} in the index`);
    }
  });

  test("indexing identifies an instance's card references", async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person-1.json': {
          data: {
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let refs = (await getInstance(realm, new URL(`${testRealmURL}person-1`)))
      ?.deps;
    assert.deepEqual(
      refs!
        .sort()
        // Exclude synthetic imports that encapsulate scoped CSS
        .filter((ref) => !ref.includes('glimmer-scoped.css')),
      [
        'http://localhost:4202/test/person',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/align-box-left-middle.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/align-left.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/arrow-left.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/captions.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/code.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/eye.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/file-pencil.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/folder-pen.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/hash.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/import.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/letter-case.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/link.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/notepad-text.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/package.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/palette.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/rectangle-ellipsis.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/trash-2.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/wand.js',
        'https://cardstack.com/base/card-api',
        'https://cardstack.com/base/card-menu-items',
        'https://cardstack.com/base/card-serialization',
        'https://cardstack.com/base/contains-many-component',
        'https://cardstack.com/base/default-templates/atom',
        'https://cardstack.com/base/default-templates/card-info',
        'https://cardstack.com/base/default-templates/embedded',
        'https://cardstack.com/base/default-templates/field-edit',
        'https://cardstack.com/base/default-templates/fitted',
        'https://cardstack.com/base/default-templates/head',
        'https://cardstack.com/base/default-templates/isolated-and-edit',
        'https://cardstack.com/base/default-templates/markdown',
        'https://cardstack.com/base/default-templates/missing-template',
        'https://cardstack.com/base/field-component',
        'https://cardstack.com/base/field-support',
        'https://cardstack.com/base/helpers/sanitized-html',
        'https://cardstack.com/base/helpers/set-background-image',
        'https://cardstack.com/base/links-to-editor',
        'https://cardstack.com/base/links-to-many-component',
        'https://cardstack.com/base/number',
        'https://cardstack.com/base/query-field-support',
        'https://cardstack.com/base/shared-state',
        'https://cardstack.com/base/string',
        'https://cardstack.com/base/text-input-validator',
        'https://cardstack.com/base/watched-array',
        'https://packages/@cardstack/boxel-host/commands/copy-and-edit',
        'https://packages/@cardstack/boxel-host/commands/copy-card',
        'https://packages/@cardstack/boxel-host/commands/create-ai-assistant-room',
        'https://packages/@cardstack/boxel-host/commands/generate-example-cards',
        'https://packages/@cardstack/boxel-host/commands/listing-create',
        'https://packages/@cardstack/boxel-host/commands/open-in-interact-mode',
        'https://packages/@cardstack/boxel-host/commands/patch-theme',
        'https://packages/@cardstack/boxel-host/commands/populate-with-sample-data',
        'https://packages/@cardstack/boxel-host/commands/send-ai-assistant-message',
        'https://packages/@cardstack/boxel-host/commands/show-card',
        'https://packages/@cardstack/boxel-host/commands/switch-submode',
        'https://packages/@cardstack/boxel-ui/components',
        'https://packages/@cardstack/boxel-ui/helpers',
        'https://packages/@cardstack/boxel-ui/icons',
        'https://packages/@cardstack/boxel-ui/modifiers',
        'https://packages/@cardstack/runtime-common',
        'https://packages/@ember/component',
        'https://packages/@ember/component/template-only',
        'https://packages/@ember/helper',
        'https://packages/@ember/modifier',
        'https://packages/@ember/object',
        'https://packages/@ember/template',
        'https://packages/@ember/template-factory',
        'https://packages/@glimmer/component',
        'https://packages/@glimmer/tracking',
        'https://packages/ember-concurrency',
        'https://packages/ember-concurrency/-private/async-arrow-runtime',
        'https://packages/ember-css-url',
        'https://packages/ember-modifier',
        'https://packages/ember-provide-consume-context',
        'https://packages/lodash',
        'https://packages/tracked-built-ins',
      ],
      'the card references for the instance are correct',
    );
  });

  test("indexing identifies an instance's polymorphic contained references", async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'spec-1.json': {
          data: {
            attributes: {
              title: 'My Spec',
              containedExamples: [
                {
                  firstName: 'A',
                  lastName: 'B',
                },
              ],
            },
            meta: {
              adoptsFrom: {
                module: `${baseRealm.url}spec`,
                name: 'Spec',
              },
              fields: {
                containedExamples: [
                  {
                    adoptsFrom: {
                      module: `${testModuleRealm}person`,
                      name: 'PersonField',
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
    let refs = (await getInstance(realm, new URL(`${realm.url}spec-1`)))?.deps;
    assert.deepEqual(
      refs!
        .sort()
        // Exclude synthetic imports that encapsulate scoped CSS
        .filter((ref) => !ref.includes('glimmer-scoped.css')),
      [
        'http://localhost:4202/test/person',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/align-box-left-middle.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/align-left.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/apps.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/arrow-left.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/book-open-text.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/box-model.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/captions.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/code.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/eye.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/file-pencil.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/folder-pen.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/git-branch.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/hash.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/import.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/layers-subtract.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/layout-list.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/letter-case.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/link.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/notepad-text.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/package.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/palette.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/rectangle-ellipsis.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/stack.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/toggle-left.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/trash-2.js',
        'https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/wand.js',
        'https://cardstack.com/base/boolean',
        'https://cardstack.com/base/card-api',
        'https://cardstack.com/base/card-menu-items',
        'https://cardstack.com/base/card-serialization',
        'https://cardstack.com/base/code-ref',
        'https://cardstack.com/base/contains-many-component',
        'https://cardstack.com/base/default-templates/atom',
        'https://cardstack.com/base/default-templates/card-info',
        'https://cardstack.com/base/default-templates/embedded',
        'https://cardstack.com/base/default-templates/field-edit',
        'https://cardstack.com/base/default-templates/fitted',
        'https://cardstack.com/base/default-templates/head',
        'https://cardstack.com/base/default-templates/isolated-and-edit',
        'https://cardstack.com/base/default-templates/markdown',
        'https://cardstack.com/base/default-templates/missing-template',
        'https://cardstack.com/base/field-component',
        'https://cardstack.com/base/field-support',
        'https://cardstack.com/base/helpers/sanitized-html',
        'https://cardstack.com/base/helpers/set-background-image',
        'https://cardstack.com/base/links-to-editor',
        'https://cardstack.com/base/links-to-many-component',
        'https://cardstack.com/base/markdown',
        'https://cardstack.com/base/number',
        'https://cardstack.com/base/query-field-support',
        'https://cardstack.com/base/shared-state',
        'https://cardstack.com/base/spec',
        'https://cardstack.com/base/string',
        'https://cardstack.com/base/text-input-validator',
        'https://cardstack.com/base/watched-array',
        'https://packages/@cardstack/boxel-host/commands/copy-and-edit',
        'https://packages/@cardstack/boxel-host/commands/copy-card',
        'https://packages/@cardstack/boxel-host/commands/create-ai-assistant-room',
        'https://packages/@cardstack/boxel-host/commands/generate-example-cards',
        'https://packages/@cardstack/boxel-host/commands/generate-readme-spec',
        'https://packages/@cardstack/boxel-host/commands/listing-create',
        'https://packages/@cardstack/boxel-host/commands/open-in-interact-mode',
        'https://packages/@cardstack/boxel-host/commands/patch-theme',
        'https://packages/@cardstack/boxel-host/commands/populate-with-sample-data',
        'https://packages/@cardstack/boxel-host/commands/send-ai-assistant-message',
        'https://packages/@cardstack/boxel-host/commands/show-card',
        'https://packages/@cardstack/boxel-host/commands/switch-submode',
        'https://packages/@cardstack/boxel-ui/components',
        'https://packages/@cardstack/boxel-ui/helpers',
        'https://packages/@cardstack/boxel-ui/icons',
        'https://packages/@cardstack/boxel-ui/modifiers',
        'https://packages/@cardstack/runtime-common',
        'https://packages/@ember/component',
        'https://packages/@ember/component/template-only',
        'https://packages/@ember/helper',
        'https://packages/@ember/modifier',
        'https://packages/@ember/object',
        'https://packages/@ember/template',
        'https://packages/@ember/template-factory',
        'https://packages/@glimmer/component',
        'https://packages/@glimmer/tracking',
        'https://packages/ember-concurrency',
        'https://packages/ember-concurrency/-private/async-arrow-runtime',
        'https://packages/ember-css-url',
        'https://packages/ember-modifier',
        'https://packages/ember-provide-consume-context',
        'https://packages/ember-resources',
        'https://packages/lodash',
        'https://packages/tracked-built-ins',
      ],
      'the card references for the instance are correct',
    );
  });

  test('search index does not contain entries that match patterns in ignore files', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'ignore-me-1.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        'posts/nested.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        'posts/please-ignore-me.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        'posts/ignore-me-2.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        // we always ignore the contents of .git/
        '.git/should-not-index.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        'post.json': { data: { meta: { adoptsFrom: baseCardRef } } },
        'dir/card.json': { data: { meta: { adoptsFrom: baseCardRef } } },
        '.gitignore': `
ignore-me*.json
dir/
posts/please-ignore-me.json
      `,
      },
    });

    let indexer = realm.realmIndexQueryEngine;

    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}posts/please-ignore-me`),
      );
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored',
      );
    }
    {
      let card = await indexer.cardDocument(new URL(`${testRealmURL}dir/card`));
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored',
      );
    }
    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}ignore-me-1`),
      );
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored',
      );
    }
    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}posts/ignore-me-2`),
      );
      assert.deepEqual(
        card,
        undefined,
        'instance does not exist because file is ignored',
      );
    }
    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}.git/should-not-index`),
      );
      assert.strictEqual(card, undefined, '.git directory entries are ignored');
    }
    {
      let card = await indexer.cardDocument(new URL(`${testRealmURL}post`));
      assert.ok(card, 'instance exists');
    }
    {
      let card = await indexer.cardDocument(
        new URL(`${testRealmURL}posts/nested`),
      );
      assert.ok(card, 'instance exists');
    }
  });

  test('search index ignores .realm.json file', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        '.realm.json': `{ name: 'Example Workspace' }`,
        'post.json': { data: { meta: { adoptsFrom: baseCardRef } } },
      },
    });

    let indexer = realm.realmIndexQueryEngine;
    let card = await indexer.cardDocument(new URL(`${testRealmURL}post`));
    assert.ok(card, 'instance exists');
    let instance = await indexer.cardDocument(
      new URL(`${testRealmURL}.realm.json`),
    );
    assert.strictEqual(
      instance,
      undefined,
      'instance does not exist because file is ignored',
    );
  });

  test("incremental indexing doesn't process ignored files", async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'posts/ignore-me.json': {
          data: { meta: { adoptsFrom: baseCardRef } },
        },
        '.gitignore': `
posts/ignore-me.json
      `,
      },
    });

    let realmIndexUpdater = realm.realmIndexUpdater;
    let queryEngine = realm.realmIndexQueryEngine;
    await realmIndexUpdater.update([
      new URL(`${testRealmURL}posts/ignore-me.json`),
    ]);

    let instance = await queryEngine.cardDocument(
      new URL(`${testRealmURL}posts/ignore-me`),
    );
    assert.strictEqual(
      instance,
      undefined,
      'instance does not exist because file is ignored',
    );
    assert.strictEqual(
      realmIndexUpdater.stats.instancesIndexed,
      0,
      'no instances were processed',
    );
  });
});
