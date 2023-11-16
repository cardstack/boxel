import { visit, click, waitFor } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';
import percySnapshot from '@percy/ember';
import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { type Loader } from '@cardstack/runtime-common/loader';
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
  type CardDocFiles,
} from '../../helpers';

const realmFiles = {
  '.realm.json': {
    name: 'Test Workspace A',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
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

  let createTestRealm: (
    files: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
  ) => Promise<void>;

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

  hooks.beforeEach(async function () {
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
});
