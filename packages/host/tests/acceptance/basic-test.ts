import {
  find,
  visit,
  currentURL,
  click,
  waitFor,
  fillIn,
  waitUntil,
} from '@ember/test-helpers';

import percySnapshot from '@percy/ember';
import { setupApplicationTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, skip, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupServerSentEvents,
  testRealmURL,
  getMonacoContent,
  sourceFetchReturnUrlHandle,
  waitForSyntaxHighlighting,
  type TestContextWithSSE,
} from '../helpers';

const indexCardSource = `
  import { CardDef, Component } from "https://cardstack.com/base/card-api";

  export class Index extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-index-card>
          Hello, world!
        </div>
      </template>
    };
  }
`;

const personCardSource = `
  import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
        </div>
        <style>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

module('Acceptance | basic tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    adapter = new TestRealmAdapter({
      'index.gts': indexCardSource,
      'person.gts': personCardSource,
      'person-entry.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Person',
            description: 'Catalog entry',
            ref: {
              module: `./person`,
              name: 'Person',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'index.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: './index',
              name: 'Index',
            },
          },
        },
      },
      'Person/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
    });

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
      overridingHandlers: [
        async (req: Request) => {
          return sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm));
        },
      ],
    });
    await realm.ready;
  });

  test('visiting / (there is no realm here)', async function (assert) {
    await visit('/');

    assert.strictEqual(currentURL(), '/');
    assert
      .dom('[data-test-moved]')
      .containsText('The card code editor has moved to /code');
    await click('[data-test-code-link]');
    assert.strictEqual(currentURL(), '/code');
  });

  test('visiting realm root', async function (assert) {
    await visit('/test/');

    assert.strictEqual(currentURL(), '/test/');
    assert.dom('[data-test-index-card]').containsText('Hello, world');
    assert
      .dom('[data-test-moved]')
      .containsText('The card code editor has moved to /code');
    await click('[data-test-code-link]');
    assert.strictEqual(currentURL(), '/code');
  });

  test('Can expand/collapse directories file tree', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    assert
      .dom('[data-test-directory="Person/"]')
      .exists('Person/ directory entry is rendered');
    assert
      .dom('[data-test-file="person.gts"]')
      .exists('person.gts file entry is rendered');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    await click('[data-test-directory="Person/"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .doesNotExist('Person/1.json file entry is not rendered');
  });

  skip('Can view a card instance', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');

    await click('[data-test-file="Person/1.json"]');

    assert.strictEqual(
      currentURL(),
      '/code?openDirs=Person%2F&openFile=Person%2F1.json',
    );
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    assert.dom('[data-test-person]').containsText('First name: Hassan');
    assert.dom('[data-test-person]').containsText('Last name: Abdel-Rahman');
    assert.dom('[data-test-person]').containsText('Title: Hassan Abdel-Rahman');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
        },
        meta: {
          adoptsFrom: {
            module: `../person`,
            name: 'Person',
          },
        },
      },
    });

    assert.dom('[data-test-person]').hasStyle(
      {
        color: 'rgb(0, 128, 0)',
      },
      'expected scoped CSS to apply to card instance',
    );

    await waitForSyntaxHighlighting('"Person"', 'rgb(4, 81, 165)');
    await percySnapshot(assert);
  });

  test<TestContextWithSSE>('Card instance live updates when index changes', async function (assert) {
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}Person/1`],
        },
      },
    ];

    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');
    await click('[data-test-file="Person/1.json"]');

    await this.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await realm.write(
          'Person/1.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                firstName: 'HassanXXX',
              },
              meta: {
                adoptsFrom: {
                  module: '../person',
                  name: 'Person',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-person]')!
          .textContent?.includes('HassanXXX'),
    );
    assert.dom('[data-test-person]').containsText('First name: HassanXXX');
  });

  skip('Can view a card schema', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-file="person.gts"]');
    await waitFor('[data-test-card-id]');

    assert.strictEqual(currentURL(), '/code?openFile=person.gts');
    assert
      .dom('[data-test-card-id]')
      .containsText(`${testRealmURL}person/Person`);
    assert
      .dom('[data-test-adopts-from]')
      .containsText(`${baseRealm.url}card-api/Card`);
    assert.dom('[data-test-field="firstName"]').exists();
    assert.dom('[data-test-field="lastName"]').exists();
    assert.strictEqual(
      getMonacoContent(),
      personCardSource,
      'the monaco content is correct',
    );

    // Syntax highlighting is breadth-first, this is the latest and deepest token
    await waitForSyntaxHighlighting("''", 'rgb(163, 21, 21)');
    await waitFor('[data-test-boxel-card-container] [data-test-description]');

    await percySnapshot(assert);
  });

  test('glimmer-scoped-css smoke test', async function (assert) {
    await visit('/code');

    const buttonElement = find('[data-test-create-new-card-button]');

    assert.ok(buttonElement);

    if (!buttonElement) {
      throw new Error('[data-test-create-new-card-button] element not found');
    }

    const buttonElementScopedCssAttribute = Array.from(buttonElement.attributes)
      .map((attribute) => attribute.localName)
      .find((attributeName) => attributeName.startsWith('data-scopedcss'));

    if (!buttonElementScopedCssAttribute) {
      throw new Error(
        'Scoped CSS attribute not found on [data-test-create-new-card-button]',
      );
    }

    assert.dom('[data-test-create-new-card-button] + style').doesNotExist();
  });

  skip('can create a new card', async function (assert) {
    await visit('/code');
    await click('[data-test-create-new-card-button]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a CatalogEntry card');
    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Mango');
    await fillIn('[data-test-field="lastName"] input', 'Abdel-Rahman');
    await fillIn('[data-test-field="description"] input', 'Person');
    await fillIn('[data-test-field="thumbnailURL"] input', './mango.png');
    await click('[data-test-save-card]');
    await waitUntil(() => currentURL() === '/code?openFile=Person%2F2.json');

    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/2.json"]');
    assert
      .dom('[data-test-file="Person/2.json"]')
      .exists('Person/2.json file entry is rendered');
    assert.dom('[data-test-person]').containsText('First name: Mango');
    assert.dom('[data-test-person]').containsText('Last name: Abdel-Rahman');
    assert.dom('[data-test-person]').containsText('Title: Mango Abdel-Rahman');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
          lastName: 'Abdel-Rahman',
          description: 'Person',
          thumbnailURL: './mango.png',
        },
        meta: {
          adoptsFrom: {
            module: `../person`,
            name: 'Person',
          },
        },
      },
    });
    let fileRef = await adapter.openFile('Person/2.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
            description: 'Person',
            thumbnailURL: './mango.png',
          },
          meta: {
            adoptsFrom: {
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct',
    );
  });
});
