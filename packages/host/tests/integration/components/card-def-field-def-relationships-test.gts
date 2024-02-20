import { click, waitFor } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { type Loader } from '@cardstack/runtime-common/loader';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
  setupIntegrationTestRealm,
} from '../../helpers';
import { setupMatrixServiceMock } from '../../helpers/mock-matrix-service';
import { setupSessionServiceMock } from '../../helpers/mock-session-service';
import { renderComponent, renderCard } from '../../helpers/render-component';

module('Integration | CardDef-FieldDef relationships test', function (hooks) {
  let loader: Loader;
  let cardApi: typeof import('https://cardstack.com/base/card-api');
  let string: typeof import('https://cardstack.com/base/string');
  let number: typeof import('https://cardstack.com/base/number');

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
  setupMatrixServiceMock(hooks);
  setupSessionServiceMock(hooks);

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);

    setCardInOperatorModeState = async (cardURL, format = 'isolated') => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      await operatorModeStateService.restore({
        stacks: [[{ id: cardURL, format }]],
      });
      await waitFor('[data-test-stack-item-content]');
    };
  });

  test('render a primitive field (singular) contained in a FieldDef', async function (assert) {
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
      .hasClass('edit-format', 'edit card is rendered');
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

  test('render a compound field (singular) contained in a FieldDef', async function (assert) {
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

  test('primitive field (plural) contained in a FieldDef is read-only', async function (assert) {
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

  test('compound field (plural) contained in a FieldDef renders in atom format (read-only)', async function (assert) {
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

  test('render a CardDef field (singular) linked to from a FieldDef', async function (assert) {
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

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'currency.gts': { CurrencyCard },
        'tx.gts': { TxCard },
        '.realm.json': `{ "name": "Local Workspace" }`,
        'usd.json': usdCard,
        'Tx/1.json': txCard,
      },
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

  test('CardDef field (plural) linked to from a FieldDef renders in atom format', async function (assert) {
    let { field, contains, linksToMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class Country extends CardDef {
      static displayName = 'Country';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia(this: Country) {
          return this.name;
        },
      });
    }
    class Trips extends FieldDef {
      static displayName = 'Trips';
      @field countries = linksToMany(Country);
    }
    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field trips = contains(Trips);
    }

    let usa = new Country({ name: 'United States' });
    let japan = new Country({ name: 'Japan' });
    let fadhlan = new Person({
      firstName: 'Fadhlan',
    });

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'country.gts': { Country },
        'person.gts': { Person },
        'usa.json': usa,
        'japan.json': japan,
        'Person/fadhlan.json': fadhlan,
      },
    });

    await renderComponent(OperatorModeComponent);
    await setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`, 'edit');

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    assert.dom('[data-test-field="trips"] [data-test-add-new]').exists();

    await click('[data-test-links-to-many="countries"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}japan"]`);
    await click(`[data-test-select="${testRealmURL}japan"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitFor('[card-catalog-modal]', { count: 0 });
    assert.dom('[data-test-pill-item]').exists({ count: 1 });
    assert.dom('[data-test-field="trips"]').containsText('Japan');

    await click('[data-test-links-to-many="countries"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}usa"]`);
    await click(`[data-test-select="${testRealmURL}usa"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitFor('[card-catalog-modal]', { count: 0 });
    assert.dom('[data-test-pill-item]').exists({ count: 2 });
    assert.dom('[data-test-field="trips"]').containsText('Japan United States');

    await click('[data-test-pill-item] [data-test-remove-card]');
    assert.dom('[data-test-pill-item]').exists({ count: 1 });
    await click('[data-test-pill-item] [data-test-remove-card]');
    assert.dom('[data-test-pill-item]').exists({ count: 0 });
  });
});
