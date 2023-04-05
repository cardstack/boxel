import { module, test } from 'qunit';
import { visit, currentURL, click, waitFor } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealm,
  TestRealmAdapter,
  setupMockLocalRealm,
  setupMockMessageService,
} from '../helpers';
import { Realm } from '@cardstack/runtime-common/realm';
import { shimExternals } from '@cardstack/host/lib/externals';
import type LoaderService from '@cardstack/host/services/loader-service';

module('Acceptance | foo', function (hooks) {
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
      'person.gts': `
        import { contains, field, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";

        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
        }
      `,
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
});
