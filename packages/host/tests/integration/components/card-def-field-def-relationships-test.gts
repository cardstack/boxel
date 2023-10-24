import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';
import percySnapshot from '@percy/ember';
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
import { renderComponent, renderCard } from '../../helpers/render-component';

module('Integration | CardDef-FieldDef relationships test', function (hooks) {
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

  test('render a primitive `contains` field nested in an edit field', async function (assert) {
    let { field, contains, FieldDef, CardDef } = cardApi;
    let { default: StringField } = string;

    class EmergencyContactField extends FieldDef {
      @field name = contains(StringField);
      @field email = contains(StringField);
    }

    class ContactCard extends CardDef {
      @field firstName = contains(StringField);
      @field emergencyContact = contains(EmergencyContactField);
    }

    let card = new ContactCard({
      firstName: 'Marcelius',
      emergencyContact: new EmergencyContactField({
        name: 'Mama Leone',
        email: 'mama@leonesons.com',
      }),
    });

    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field-component-card]')
      .exists({ count: 1 })
      .hasClass('edit-card', 'edit card is rendered');
    assert
      .dom('[data-test-field="firstName"]')
      .hasText('First Name', 'non-nested primitive field label is rendered');
    assert
      .dom('[data-test-field="firstName"] input')
      .hasValue('Marcelius', 'non-nested primitive field input is rendered');
    assert
      .dom('[data-test-field="emergencyContact"]')
      .containsText(
        'Emergency Contact',
        'non-nested compound field label is rendered',
      );
    assert
      .dom('[data-test-field="emergencyContact"]')
      .hasClass('horizontal', 'compound field class is correct');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-compound-field-format="edit"] [data-test-field="name"]',
      )
      .exists('nested primitive field editor is rendered');
    assert
      .dom('[data-test-field="emergencyContact"] [data-test-field="name"]')
      .hasClass('vertical', 'nested primitive field class is correct');
    assert
      .dom('[data-test-field="emergencyContact"] [data-test-field="name"]')
      .containsText('Name');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="name"] input',
      )
      .hasValue('Mama Leone');
    assert
      .dom('[data-test-field="emergencyContact"] [data-test-field="email"]')
      .hasText('Email');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="email"] input',
      )
      .hasValue('mama@leonesons.com');
  });

  test('render a composite `contains` field nested in an edit field', async function (assert) {
    let { field, contains, FieldDef, CardDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class PhoneField extends FieldDef {
      @field country = contains(NumberField);
      @field area = contains(NumberField);
      @field number = contains(NumberField);
    }

    class EmergencyContactField extends FieldDef {
      @field name = contains(StringField);
      @field phoneNumber = contains(PhoneField);
    }

    class ContactCard extends CardDef {
      @field firstName = contains(StringField);
      @field emergencyContact = contains(EmergencyContactField);
    }

    let card = new ContactCard({
      firstName: 'Marcelius',
      emergencyContact: new EmergencyContactField({
        name: 'Mama Leone',
        phoneNumber: new PhoneField({
          country: 1,
          area: 212,
          number: 5551212,
        }),
      }),
    });

    await renderCard(loader, card, 'edit');

    assert.dom('[data-test-field-component-card]').exists({ count: 1 });
    assert.dom('[data-test-field="firstName"]').hasText('First Name');
    assert.dom('[data-test-field="firstName"] input').hasValue('Marcelius');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-compound-field-format="edit"] [data-test-field="phoneNumber"]',
      )
      .containsText('Phone Number', 'nested compound field is rendered');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="phoneNumber"] [data-test-compound-field-format="edit"] ',
      )
      .hasText(
        'Country Area Number',
        'fields of nested compound field are rendered',
      );
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="phoneNumber"] [data-test-field="country"]',
      )
      .hasClass('vertical');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="phoneNumber"] [data-test-field="country"] input',
      )
      .hasValue('1');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="phoneNumber"] [data-test-field="area"] input',
      )
      .hasValue('212');
    assert
      .dom(
        '[data-test-field="emergencyContact"] [data-test-field="phoneNumber"] [data-test-field="number"] input',
      )
      .hasValue('5551212');
  });

  test('render a primitive `containsMany` field nested in an edit field (read-only)', async function (assert) {
    let { field, contains, containsMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class Guest extends FieldDef {
      @field name = contains(StringField);
      @field additionalNames = containsMany(StringField);
    }

    class ContactCard extends CardDef {
      static displayName = 'Contact';
      @field name = contains(StringField);
      @field nickname = contains(StringField);
      @field vip = containsMany(StringField);
      @field banned = containsMany(StringField);
      @field guest = contains(Guest);
      @field bannedGuest = contains(Guest);
    }

    let card = new ContactCard({
      name: 'Marcelius Wilde',
      vip: ['Cornelius Wilde', 'Dominique Wilde', 'Esmeralda Wilde'],
      guest: new Guest({
        name: 'Mama Leone',
        additionalNames: ['Felicity Shaw', 'Grant Kingston', 'Valerie Storm'],
      }),
    });

    await renderCard(loader, card, 'edit');
    await percySnapshot(assert);

    assert.dom('[data-test-field-component-card]').exists();
    assert
      .dom('[data-test-contains-many="vip"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-contains-many="vip"] [data-test-item="0"] input')
      .hasValue('Cornelius Wilde');
    assert.dom('[data-test-field="nickname"] input').hasNoValue();
    assert
      .dom('[data-test-contains-many="banned"] [data-test-item]')
      .doesNotExist();
    assert
      .dom('[data-test-contains-many="banned"] [data-test-add-new]')
      .exists('empty containsMany string field has an add button');

    assert
      .dom('[data-test-field="guest"] [data-test-field="name"] input')
      .hasValue('Mama Leone');
    assert
      .dom(
        '[data-test-field="guest"] [data-test-contains-many="additionalNames"]',
      )
      .doesNotExist('edit template is not rendered');
    assert
      .dom(
        '[data-test-field="guest"] [data-test-plural-view="containsMany"] [data-test-plural-view-item]',
      )
      .exists({ count: 3 });
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view="containsMany"]')
      .containsText('Felicity Shaw Grant Kingston Valerie Storm');

    assert
      .dom('[data-test-field="bannedGuest"] [data-test-add-new]')
      .doesNotExist('edit');
    assert
      .dom(
        '[data-test-field="bannedGuest"] [data-test-plural-view="containsMany"]',
      )
      .hasClass('empty');
    assert
      .dom(
        '[data-test-field="bannedGuest"] [data-test-plural-view="containsMany"] [data-test-plural-view-item]',
      )
      .doesNotExist();
  });

  test('composite `containsMany` field nested in an edit field renders in atom format (read-only)', async function (assert) {
    let { field, contains, containsMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class PersonField extends FieldDef {
      @field fullName = contains(StringField);
      @field guestCount = contains(NumberField);
      @field title = contains(StringField, {
        computeVia: function (this: PersonField) {
          return this.guestCount
            ? `${this.fullName} + ${this.guestCount}`
            : this.fullName;
        },
      });
    }

    class Guest extends FieldDef {
      @field name = contains(StringField);
      @field additionalNames = containsMany(PersonField);
    }

    class ContactCard extends CardDef {
      static displayName = 'Contact';
      @field name = contains(StringField);
      @field guest = contains(Guest);
      @field guest2 = contains(Guest);
      @field vip = containsMany(StringField);
    }

    let card = new ContactCard({
      name: 'Marcelius Wilde',
      guest: new Guest({
        name: 'Mama Leone',
        additionalNames: [
          new PersonField({
            fullName: 'Felicity Shaw',
            guestCount: 1,
          }),
          new PersonField({
            fullName: 'Grant Kingston',
            guestCount: 1,
          }),
          new PersonField({
            fullName: 'Valerie Storm',
            guestCount: 2,
          }),
        ],
      }),
      guest2: new Guest({ name: 'Papa Leone' }),
      vip: ['Cornelius Wilde', 'Dominique Wilde', 'Esmeralda Wilde'],
    });

    await renderCard(loader, card, 'edit');
    await percySnapshot(assert);

    assert
      .dom('[data-test-field="guest"] [data-test-field="name"] input')
      .hasValue('Mama Leone');
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view-format="atom"]')
      .exists('atom layout is rendered');
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view="containsMany"]')
      .hasClass('atom-format', 'field has correct class');
    assert
      .dom(
        '[data-test-field="guest"] [data-test-plural-view="containsMany"] [data-test-plural-view-item]',
      )
      .exists({ count: 3 });
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view-item="0"]')
      .containsText('Felicity Shaw + 1');
    assert
      .dom(
        '[data-test-field="guest"] [data-test-plural-view-item="0"] > [data-test-compound-field-format="atom"]',
      )
      .exists('atom layout is rendered for items');
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view-item="1"]')
      .containsText('Grant Kingston + 1');
    assert
      .dom('[data-test-field="guest"] [data-test-plural-view-item="2"]')
      .containsText('Valerie Storm + 2');

    assert
      .dom('[data-test-field="guest2"] [data-test-field="name"] input')
      .hasValue('Papa Leone');
    assert
      .dom('[data-test-field="guest2"] [data-test-plural-view-format="atom"]')
      .hasClass('empty', 'empty containsMany field has correct class');
    assert
      .dom('[data-test-field="guest2"] [data-test-plural-view-format="atom"]')
      .hasText('', 'field is empty');

    assert
      .dom('[data-test-field="vip"] [data-test-contains-many="vip"]')
      .exists('top level containsMany field is rendered in edit format');
    assert
      .dom('[data-test-contains-many="vip"] [data-test-add-new]')
      .exists('top level containsMany field has add button');
    assert
      .dom('[data-test-contains-many="vip"] [data-test-remove="0"]')
      .exists('top level containsMany field item has remove button');
  });

  test('render a `linksTo` card nested in an edit field', async function (assert) {
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
