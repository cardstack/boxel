import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';
import {
  baseRealm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { type Loader } from '@cardstack/runtime-common/loader';
import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { shimExternals } from '@cardstack/host/lib/externals';
import {
  saveCard,
  setupCardLogs,
  setupLocalIndexing,
  shimModule,
  TestRealm,
  testRealmURL,
  type CardDocFiles,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

module('Integration | card/field separation test', function (hooks) {
  let loader: Loader;
  let cardApi: typeof import('https://cardstack.com/base/card-api');
  let string: typeof import('https://cardstack.com/base/string');
  let number: typeof import('https://cardstack.com/base/number');

  let createTestRealm: (
    files: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
  ) => Promise<void>;

  let setCardInOperatorModeState: (
    card: string,
    format: 'isolated' | 'edit',
  ) => Promise<void>;

  const noop = () => {};
  const OperatorModeComponent = <template>
    <OperatorMode @onClose={{noop}} />
    <CardPrerender />
  </template>;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    shimExternals(loader);
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);

    createTestRealm = async (files) => {
      let realm = await TestRealm.create(loader, files, this.owner);
      await realm.ready;
    };

    setCardInOperatorModeState = async (cardURL, format = 'isolated') => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      await operatorModeStateService.restore({
        stacks: [[{ id: cardURL, format }]],
      });
    };
  });

  test('render a CardDef field (singular) linked to from FieldDef (edit mode)', async function (assert) {
    let { field, contains, linksTo, CardDef, FieldDef, Component } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class CurrencyCard extends CardDef {
      static displayName = 'Currency';
      @field denomination = contains(StringField);
      @field currencyName = contains(StringField);
      @field icon = contains(StringField);

      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div class='currency' data-test-currency-embedded>
            <@fields.icon />
            <@fields.denomination />
            -
            <@fields.currencyName />
          </div>
          <style>
            .currency {
              display: flex;
              font-weight: bold;
            }
          </style>
        </template>
      };
    }

    class TxAmountField extends FieldDef {
      @field quantity = contains(NumberField);
      @field denomination = linksTo(CurrencyCard);
    }

    class TxCard extends CardDef {
      static displayName = 'Transaction';
      @field name = contains(StringField);
      @field transferAmount = contains(TxAmountField);
    }

    let usdCard = new CurrencyCard({
      denomination: 'USD',
      currencyName: 'United States Dollar',
      icon: '🇺🇸',
    });

    let txCard = new TxCard({
      name: 'Transfer',
      transferAmount: new TxAmountField({
        quantity: 250,
        denomination: usdCard,
      }),
    });

    await shimModule(`${testRealmURL}currency`, { CurrencyCard }, loader);
    await shimModule(`${testRealmURL}tx`, { TxCard }, loader);

    let usdCardDoc = await saveCard(usdCard, `${testRealmURL}usd`, loader);
    let txCardDoc = await saveCard(txCard, `${testRealmURL}Tx/1`, loader);

    await createTestRealm({
      '.realm.json': `{ "name": "Local Workspace" }`,
      'usd.json': usdCardDoc,
      'Tx/1.json': txCardDoc,
    });
    await renderComponent(OperatorModeComponent);
    await setCardInOperatorModeState(`${testRealmURL}Tx/1`, 'edit');

    assert
      .dom('[data-test-card-format="edit"][data-test-field-component-card]')
      .exists();
    assert
      .dom('[data-test-field="transferAmount"] > [data-test-boxel-field-label]')
      .hasText('Transfer Amount');
    assert
      .dom(
        '[data-test-field="transferAmount"] > [data-test-compound-field-format="edit"] [data-test-field="quantity"] input',
      )
      .hasValue('250');
    assert.dom('[data-test-field="quantity"]').hasClass('vertical');

    assert
      .dom(
        '[data-test-field="transferAmount"] [data-test-field="denomination"]',
      )
      .exists('linked card is present');
    assert
      .dom(
        '[data-test-field="denomination"] [data-test-links-to-editor] [data-test-currency-embedded]',
      )
      .containsText(
        '🇺🇸 USD - United States Dollar',
        'linked card content is correct',
      );

    assert
      .dom(`[data-test-overlay-card="${testRealmURL}usd"]`)
      .containsText('Currency');
    assert
      .dom(
        `[data-test-overlay-card="${testRealmURL}usd"] [data-test-embedded-card-edit-button]`,
      )
      .exists()
      .isNotDisabled();
    assert
      .dom(
        `[data-test-overlay-card="${testRealmURL}usd"] [data-test-embedded-card-options-button]`,
      )
      .exists()
      .isNotDisabled();

    await click(
      '[data-test-field="denomination"] [data-test-links-to-editor] [data-test-remove-card]',
    );
    assert
      .dom('[data-test-currency-embedded]')
      .doesNotExist('currency card is removed');
    assert
      .dom('[data-test-field="denomination"] [data-test-links-to-editor]')
      .containsText('Link Currency', 'empty state is correct');
  });
});
