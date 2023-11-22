import {
  waitFor,
  waitUntil,
  fillIn,
  click,
  typeIn,
  focus,
  RenderingTestContext,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import CardEditor from '@cardstack/host/components/card-editor';

import CardPrerender from '@cardstack/host/components/card-prerender';
import CreateCardModal from '@cardstack/host/components/create-card-modal';
import type LoaderService from '@cardstack/host/services/loader-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  TestRealmAdapter,
  TestRealm,
  saveCard,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

let cardApi: typeof import('https://cardstack.com/base/card-api');

let loader: Loader;

module('Integration | text-input-filter', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  async function loadCard(url: string): Promise<CardDef> {
    let { createFromSerialized, recompute } = cardApi;
    let result = await realm.searchIndex.card(new URL(url));
    if (!result || result.type === 'error') {
      throw new Error(
        `cannot get instance ${url} from the index: ${
          result ? result.error.detail : 'not found'
        }`,
      );
    }
    let card = await createFromSerialized<typeof CardDef>(
      result.doc.data,
      result.doc,
      new URL(result.doc.data.id),
      loader,
    );
    await recompute(card, { loadFields: true });
    return card;
  }

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/'),
    );
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    let bigInteger: typeof import('https://cardstack.com/base/big-integer');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    bigInteger = await loader.import(`${baseRealm.url}big-integer`);

    let { field, contains, CardDef } = cardApi;
    let { default: BigIntegerField } = bigInteger;

    class Sample extends CardDef {
      static displayName = 'Sample';
      @field someBigInt = contains(BigIntegerField);
      @field anotherBigInt = contains(BigIntegerField);
    }

    adapter = new TestRealmAdapter({
      'Sample/1.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Sample/1`,
          attributes: {
            someBigInt: null,
            anotherBigInt: '123',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}sample`,
              name: 'Sample',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      shimModules: {
        'sample.gts': { Sample },
      },
    });
    await realm.ready;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('when user fills field with invalid values, the input box should show invalid state', async function (assert) {
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    await fillIn(
      'div[data-test-field="someBigInt"] [data-test-boxel-input]',
      'a-string-text',
    );
    assert
      .dom(
        'div[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('div[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .exists();
  });
  test('when user starts typing adding wrong input to the correct input, the input box should show invalid state and error message', async function (assert) {
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    await fillIn(
      'div[data-test-field="someBigInt"] [data-test-boxel-input]',
      '1000000',
    );
    await typeIn(
      'div[data-test-field="someBigInt"] [data-test-boxel-input]',
      'extra',
    );
    assert
      .dom(
        'div[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('div[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .exists();
  });

  test('if json contains undeserializable values, the input box should show empty input box', async function (assert) {
    let card = await loadCard(`${testRealmURL}Sample/1`);
    let response = await realm.handle(
      new Request(`${testRealmURL}Sample/1`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    await response.json();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    assert
      .dom('div[data-test-field="anotherBigInt"] [data-test-boxel-input]')
      .hasText('');
    assert
      .dom(
        'div[data-test-field="anotherBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('div[data-test-field="anotherBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });
  test('when a user inserts wrong input and hits save, the saved document should insert a null value. The resulting value in the isolated view is empty', async function (assert) {
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    await fillIn(
      'div[data-test-field="someBigInt"] [data-test-boxel-input]',
      'a-string-text',
    );
    assert
      .dom(
        'div[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('div[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .exists();
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));
    assert
      .dom('div[data-test-field="someBigInt"]')
      .doesNotIncludeText('a-string-text');
  });

  // -- below here are happy path test --
  test('when user inserts field with correct values and hits save, the saved document should insert a serialized value into the field', async function (assert) {
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    await fillIn(
      'div[data-test-field="someBigInt"] [data-test-boxel-input]',
      '333',
    );
    assert
      .dom(
        'div[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('div[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));
    await assert.dom('div[data-test-field="someBigInt"]').containsText('333');
  });
  test('when user starts with empty field, the input box should NOT show invalid state', async function (assert) {
    // 'when user starts typing inserting correct input, the input box should show valid state',
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    await focus('div[data-test-field="someBigInt"] [data-test-boxel-input]');
    assert
      .dom('div[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });
  test('if we modify a model from outside the input box, the input box should update with new value', async function (assert) {
    //a use case for this test is for exmplae, populating the fields with valid values once the user hits a button "fill in"
    let card = await loadCard(`${testRealmURL}Sample/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
          <CardPrerender />
        </template>
      },
    );
    (card as any).someBigInt = '444';
    await saveCard(card, `${testRealmURL}Sample/1`, loader);
    await waitFor('[data-test-field="someBigInt"]');
    await assert
      .dom('div[data-test-field="someBigInt"] [data-test-boxel-input]')
      .hasValue('444');
  });
});
