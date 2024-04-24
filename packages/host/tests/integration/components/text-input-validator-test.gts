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
  saveCard,
  setupIntegrationTestRealm,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

let cardApi: typeof import('https://cardstack.com/base/card-api');

let loader: Loader;

module('Integration | text-input-validator', function (hooks) {
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

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    let bigInteger: typeof import('https://cardstack.com/base/big-integer');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    bigInteger = await loader.import(`${baseRealm.url}big-integer`);

    let { field, contains, CardDef } = cardApi;
    let { default: BigIntegerField } = bigInteger;
    let { default: NumberField } = (await loader.import(
      `${baseRealm.url}number`,
    )) as typeof import('https://cardstack.com/base/number');

    class Sample extends CardDef {
      static displayName = 'Sample';
      @field someBigInt = contains(BigIntegerField);
      @field anotherBigInt = contains(BigIntegerField);
      @field someNumber = contains(NumberField);
    }
    ({ realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'sample.gts': { Sample },
        'Sample/1.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}Sample/1`,
            attributes: {
              someBigInt: null,
              anotherBigInt: '123',
              someNumber: 0,
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}sample`,
                name: 'Sample',
              },
            },
          },
        },
      },
    }));
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
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      'a-string-text',
    );
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
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
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      '1000000',
    );
    await typeIn(
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      'extra',
    );
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
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
      .dom('[data-test-field="anotherBigInt"] [data-test-boxel-input]')
      .hasText('');
    assert
      .dom(
        '[data-test-field="anotherBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="anotherBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
  });

  test('when a user inserts wrong input and saves, it should not save the value', async function (assert) {
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
      '[data-test-field="anotherBigInt"] [data-test-boxel-input]',
      'invalid-big-int',
    );
    assert
      .dom(
        '[data-test-field="anotherBigInt"] [data-test-boxel-input-error-message]',
      )
      .hasText('Not a valid big int');
    assert
      .dom('[data-test-field="anotherBigInt"] input[aria-invalid="true"]')
      .exists();

    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));

    assert.dom('[data-test-field="anotherBigInt"]').includesText('123'); // Unchanged

    assert.equal((card as any).anotherBigInt, 123); // Unchanged
  });

  // -- below here are happy path test --
  test('when user inserts field with correct values and saves, the saved document should insert a serialized value into the field', async function (assert) {
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
      '[data-test-field="someBigInt"] [data-test-boxel-input]',
      '333',
    );
    assert
      .dom(
        '[data-test-field="someBigInt"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
      .doesNotExist();
    await click('[data-test-save-card]');
    await waitUntil(() => !document.querySelector('[data-test-saving]'));
    await assert.dom('[data-test-field="someBigInt"]').containsText('333');
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
    await focus('[data-test-field="someBigInt"] [data-test-boxel-input]');
    assert
      .dom('[data-test-field="someBigInt"] input[aria-invalid="true"]')
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
      .dom('[data-test-field="someBigInt"] [data-test-boxel-input]')
      .hasValue('444');
  });

  test('number input validation gymnastics', async function (assert) {
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

    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    assert
      .dom('[data-test-field="someNumber"] [data-test-boxel-input]')
      .hasText('');

    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '-');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .hasText('Input must be a valid number.');

    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();

    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3.',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .hasText('Input cannot end with a decimal point.');
    await fillIn(
      '[data-test-field="someNumber"] [data-test-boxel-input]',
      '-3.6',
    );
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
    await fillIn('[data-test-field="someNumber"] [data-test-boxel-input]', '1');
    assert
      .dom(
        '[data-test-field="someNumber"] [data-test-boxel-input-error-message]',
      )
      .doesNotExist();
  });
});
