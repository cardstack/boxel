import { module, test } from 'qunit';
import {
  visit,
  currentURL,
  click,
  waitFor,
  fillIn,
  waitUntil,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealm,
  TestRealmAdapter,
  setupMockLocalRealm,
  setupMockMessageService,
  testRealmURL,
} from '../helpers';
import { Realm } from '@cardstack/runtime-common/realm';
import { shimExternals } from '@cardstack/host/lib/externals';
import type LoaderService from '@cardstack/host/services/loader-service';

function getMonacoContent(): string {
  return (window as any).monaco.editor.getModels()[0].getValue();
}

const personCardSource = `
  import { contains, field, Card } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Person extends Card {
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
  }
`;

module('Acceptance | basic tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupMockLocalRealm(hooks);
  setupMockMessageService(hooks);

  hooks.beforeEach(async function () {
    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
    adapter = new TestRealmAdapter({
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
    realm = await TestRealm.createWithAdapter(adapter, this.owner, {
      isAcceptanceTest: true,
    });

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

  test('visiting /', async function (assert) {
    await visit('/');

    assert.strictEqual(currentURL(), '/');
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

  test('Can view a card instance', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');

    await click('[data-test-file="Person/1.json"]');
    assert.strictEqual(
      currentURL(),
      '/code?openDirs=Person%2F&path=Person%2F1.json'
    );
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    assert
      .dom('[data-test-boxel-card-container]')
      .containsText('Hassan Abdel-Rahman');
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
  });

  test('Can view a card schema', async function (assert) {
    await visit('/code');
    await waitFor('[data-test-file]');
    await click('[data-test-file="person.gts"]');
    await waitFor('[data-test-card-id]');

    assert.strictEqual(currentURL(), '/code?path=person.gts');
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
      'the monaco content is correct'
    );
  });

  test('can create a new card', async function (assert) {
    await visit('/code');
    await click('[data-test-create-new-card-button]');
    await waitFor('[data-test-card-catalog-modal] [data-test-ref]');

    await click(`[data-test-select="${testRealmURL}person-entry"]`);
    await waitFor(`[data-test-create-new-card="Person"]`);
    await waitFor(`[data-test-field="firstName"] input`);

    await fillIn('[data-test-field="firstName"] input', 'Mango');
    await fillIn('[data-test-field="lastName"] input', 'Abdel-Rahman');
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.strictEqual(currentURL(), '/code?path=Person%2F2.json');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/2.json"]');
    assert
      .dom('[data-test-file="Person/2.json"]')
      .exists('Person/2.json file entry is rendered');
    assert
      .dom('[data-test-boxel-card-container]')
      .containsText('Mango Abdel-Rahman');
    assert.deepEqual(JSON.parse(getMonacoContent()), {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
          lastName: 'Abdel-Rahman',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
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
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct'
    );
  });
});
