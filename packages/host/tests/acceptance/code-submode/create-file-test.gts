import { visit, click, waitFor } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';
import percySnapshot from '@percy/ember';
import {
  baseRealm,
  type LooseSingleCardDocument,
  Deferred,
} from '@cardstack/runtime-common';
import { type Loader } from '@cardstack/runtime-common/loader';
import { type Realm } from '@cardstack/runtime-common/realm';
import { shimExternals } from '@cardstack/host/lib/externals';
import type LoaderService from '@cardstack/host/services/loader-service';
import type { OperatorModeState } from '@cardstack/host/services/operator-mode-state-service';
import type { Submode } from '@cardstack/host/components/submode-switcher';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  saveCard,
  testRealmURL,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
  setupOnSave,
  type TestContextWithSave,
  type CardDocFiles,
} from '../../helpers';

const realmFiles = {
  '.realm.json': {
    name: 'Test Workspace A',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
    iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
  },
  'index.json': {
    data: {
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  },
};

module('Acceptance | code submode | create-file tests', function (hooks) {
  let loader: Loader;
  let catalogEntry: typeof import('https://cardstack.com/base/catalog-entry');

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let createTestRealm: (
    files: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
  ) => Promise<Realm>;

  let visitFileInCodeSubmode = async (filePath: string) => {
    let state: Partial<OperatorModeState> = {
      stacks: [],
      submode: 'code' as Submode,
      codePath: new URL(filePath),
    };
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        stringify(state),
      )}`,
    );
  };

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    shimExternals(loader);

    catalogEntry = await loader.import(`${baseRealm.url}catalog-entry`);

    createTestRealm = async (files) => {
      let realm = await TestRealm.create(loader, files, this.owner, {
        realmURL: testRealmURL,
        isAcceptanceTest: true,
        overridingHandlers: [
          async (req: Request) => {
            return sourceFetchRedirectHandle(
              req,
              new TestRealmAdapter(files),
              testRealmURL,
            );
          },
          async (req: Request) => {
            return sourceFetchReturnUrlHandle(
              req,
              realm.maybeHandle.bind(realm),
            );
          },
        ],
      });
      await realm.ready;
      return realm;
    };
  });

  test('allows realm selection', async function (assert) {
    let { CatalogEntry } = catalogEntry;

    let petEntryJSON = await saveCard(
      new CatalogEntry({
        title: 'Pet',
        description: 'Catalog entry for Pet',
        ref: {
          module: `../cards`,
          name: 'Pet',
        },
      }),
      `${testRealmURL}Catalog-Entry/pet`,
      loader,
    );

    let personEntryJSON = await saveCard(
      new CatalogEntry({
        title: 'Person',
        description: 'Catalog entry for Person',
        ref: {
          module: `../cards`,
          name: 'Person',
        },
      }),
      `${testRealmURL}Catalog-Entry/person`,
      loader,
    );

    const files: Record<string, any> = {
      ...realmFiles,
      'Catalog-Entry/pet.json': petEntryJSON,
      'Catalog-Entry/person.json': personEntryJSON,
    };

    await createTestRealm(files);
    await visitFileInCodeSubmode(`${testRealmURL}index.json`);

    await waitFor('[data-test-code-mode][data-test-save-idle]');
    await waitFor('[data-test-card-resource-loaded]');
    assert
      .dom('[data-test-code-mode-card-preview-header]')
      .hasText('Test Workspace A');

    await click('[data-test-new-file-button]');
    await click('[data-test-boxel-menu-item-text="Card Instance"]');
    await waitFor('[data-test-create-file-modal]');
    await waitFor(`[data-test-realm-name="Test Workspace A"]`);
    assert
      .dom('[data-test-realm-dropdown]')
      .hasText('Test Workspace A', 'current realm is selected');

    await click(`[data-test-realm-dropdown]`);
    await waitFor(
      '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Base Workspace"]',
    );
    assert
      .dom(
        '[data-test-boxel-menu-item-selected] [data-test-boxel-menu-item-text="Test Workspace A"]',
      )
      .exists('current realm is selected');
    await percySnapshot(assert);

    await click('[data-test-boxel-menu-item-text="Base Workspace"]');
    assert.dom('[data-test-realm-name="Base Workspace"]').exists();
    assert
      .dom('[data-test-boxel-dropdown-content]')
      .doesNotExist('dropdown menu is closed');
  });

  test<TestContextWithSave>('can create new card-instance file in local realm with card type from same realm', async function (assert) {
    let { CatalogEntry } = catalogEntry;

    let petEntryJSON = await saveCard(
      new CatalogEntry({
        title: 'Pet',
        description: 'Catalog entry for Pet',
        ref: {
          module: `../pet`,
          name: 'Pet',
        },
      }),
      `${testRealmURL}Catalog-Entry/pet`,
      loader,
    );

    let personEntryJSON = await saveCard(
      new CatalogEntry({
        title: 'Person',
        description: 'Catalog entry for Person',
        ref: {
          module: `../person`,
          name: 'Person',
        },
      }),
      `${testRealmURL}Catalog-Entry/person`,
      loader,
    );

    const files: Record<string, any> = {
      ...realmFiles,
      'pet.gts': `
        import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class Pet extends CardDef {
          static displayName = 'Pet';
          @field name = contains(StringField);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <span data-test-pet><@fields.name /></span>
            </template>
          };
        }
      `,
      'person.gts': `
        import { contains, linksTo, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { Pet } from "./pet";

        export class Person extends CardDef {
          static displayName = 'Person';
          @field firstName = contains(StringField);
          @field lastName = contains(StringField);
          @field pet = linksTo(Pet);
        }
      `,
      'Catalog-Entry/pet.json': petEntryJSON,
      'Catalog-Entry/person.json': personEntryJSON,
    };

    await createTestRealm(files);
    await visitFileInCodeSubmode(`${testRealmURL}index.json`);

    await waitFor('[data-test-code-mode][data-test-save-idle]');
    await waitFor('[data-test-card-resource-loaded]');

    assert
      .dom('[data-test-code-mode-card-preview-header]')
      .hasText('Test Workspace A');

    await click('[data-test-new-file-button]');
    await click('[data-test-boxel-menu-item-text="Card Instance"]');

    await waitFor('[data-test-create-file-modal]');
    await waitFor(`[data-test-realm-name="Test Workspace A"]`);

    assert.dom('[data-test-realm-name]').hasText('Test Workspace A');

    await click('[data-test-change-card-type]');

    await waitFor('[data-test-card-catalog]');
    await waitFor(`[data-test-select="${testRealmURL}Catalog-Entry/person"]`);
    await click(`[data-test-select="${testRealmURL}Catalog-Entry/person"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitFor(`[data-test-selected-type="Person"]`);

    let deferred = new Deferred<void>();
    let fileURL = '';

    this.onSave(async (json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(
        json.data.attributes?.firstName,
        null,
        'firstName field is empty',
      );
      assert.strictEqual(
        json.data.meta.realmURL,
        testRealmURL,
        'realm url is correct',
      );
      assert.deepEqual(
        json.data.meta.adoptsFrom,
        {
          module: '../person',
          name: 'Person',
        },
        'adoptsFrom is correct',
      );
      assert.deepEqual(
        json.data.relationships,
        {
          pet: {
            links: {
              self: null,
            },
          },
        },
        'relationships data is correct',
      );
      fileURL = json.data.id;
      deferred.fulfill();
    });

    await click('[data-test-create-file]');

    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await waitFor('[data-test-card-resource-loaded]');
    assert.dom('[data-test-card-resource-loaded]').containsText('Person');
    assert.dom('[data-test-field="firstName"] input').hasValue('');
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileURL}.json`);

    await deferred.promise;
  });
});
