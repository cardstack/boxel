import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  baseCardRef,
  internalKeyFor,
  type LooseSingleCardDocument,
  type IndexedInstance,
  type Realm,
} from '@cardstack/runtime-common';
import stripScopedCSSAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-attributes';
import { Loader } from '@cardstack/runtime-common/loader';

import { renderErrorHandler } from '@cardstack/host/lib/render-error-handler';

import {
  testRealmURL,
  testRealmInfo,
  cleanWhiteSpace,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  cardInfo,
} from '../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

let loader: Loader;
let onError: (event: Event) => void;

// TODO Eventually this will replace the ./realm-indexing-test.gts
// but first we need to align the API's between the index writer and the renderer.
// after that port tests from ./realm-indexing-test.gts into this module.

module(`Integration | realm indexing - using /render route`, function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    (globalThis as any).__useHeadlessChromePrerender = true;
    onError = function (event: Event) {
      let localIndexer = getService('local-indexer');
      renderErrorHandler({
        event,
        setPrerenderStatus(status) {
          localIndexer.prerenderStatus = status;
        },
        setError(error) {
          localIndexer.renderError = error;
        },
      });
    };
    window.addEventListener('boxel-render-error', onError);
  });

  hooks.afterEach(function (this: RenderingTestContext) {
    delete (globalThis as any).__useHeadlessChromePrerender;
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
          resourceCreatedAt: adapter.resourceCreatedAtMap.get(
            `${testRealmURL}empty.json`,
          ),
          realmInfo: testRealmInfo,
        },
        links: {
          self: `${testRealmURL}empty`,
        },
      },
    ]);
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
          `Person/owner.json not found`,
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
            resourceCreatedAt: adapter.resourceCreatedAtMap.get(
              `${testRealmURL}Pet/mango.json`,
            ),
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
          resourceCreatedAt: adapter.resourceCreatedAtMap.get(
            `${testRealmURL}vangogh.json`,
          ),
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
          style=""
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
        style=""
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
        style=""
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
          style=""
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
      style=""
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
      style=""
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
});
