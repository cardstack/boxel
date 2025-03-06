import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import {
  waitUntil,
  waitFor,
  fillIn,
  click,
  render,
  RenderingTestContext,
  triggerEvent,
} from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import percySnapshot from '@percy/ember';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

import { module, test } from 'qunit';

import { BoxelInput } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  primitive,
  PermissionsContextName,
} from '@cardstack/runtime-common';

import { cardTypeDisplayName, type CodeRef } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type {
  BaseDef,
  SignatureFor,
} from 'https://cardstack.com/base/card-api';

import {
  cleanWhiteSpace,
  p,
  testRealmURL,
  setupCardLogs,
  saveCard,
  provideConsumeContext,
  lookupLoaderService,
} from '../../helpers';
import {
  Base64ImageField,
  BigIntegerField,
  BooleanField,
  CardDef,
  CodeRefField,
  Component,
  contains,
  containsMany,
  DateField,
  DatetimeField,
  EthereumAddressField,
  field,
  FieldDef,
  flushLogs,
  getFieldDescription,
  getQueryableValue,
  linksTo,
  linksToMany,
  MarkdownField,
  MaybeBase64Field,
  NumberField,
  queryableValue,
  setupBaseRealm,
  StringField,
  subscribeToChanges,
  TextAreaField,
  unsubscribeFromChanges,
  ReadOnlyField,
} from '../../helpers/base-realm';
import { mango } from '../../helpers/image-fixture';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;
const testModuleRealm = 'http://localhost:4202/test/';

module('Integration | card-basics', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = lookupLoaderService().loader;
  });

  setupCardLogs(hooks, async () => {
    return await loader.import(`${baseRealm.url}card-api`);
  });

  module('cards are read-only', function (_hooks) {
    test('input fields are disabled', async function (assert) {
      class Person extends CardDef {
        @field string = contains(StringField);
        @field number = contains(NumberField);
        @field bigInt = contains(BigIntegerField);
        @field boolean = contains(BooleanField);
        @field base64 = contains(Base64ImageField);
        @field date = contains(DateField);
        @field datetime = contains(DatetimeField);
        @field ethereumAddress = contains(EthereumAddressField);
        @field markdown = contains(MarkdownField);
        @field textArea = contains(TextAreaField);
      }
      let person = new Person();
      await renderCard(loader, person, 'edit');

      assert.dom('[data-test-field="string"] input').hasAttribute('disabled');
      assert.dom('[data-test-field="number"] input').hasAttribute('disabled');
      assert.dom('[data-test-field="bigInt"] input').hasAttribute('disabled');

      assert
        .dom('[data-test-field="boolean"] .boxel-radio-fieldset')
        .hasAttribute('disabled');

      assert
        .dom('[data-test-field="base64"] [data-test-field="altText"] input')
        .hasAttribute('disabled');
      assert
        .dom('[data-test-field="base64"] [data-test-field="height"] input')
        .hasAttribute('disabled');
      assert
        .dom('[data-test-field="base64"] [data-test-field="width"] input')
        .hasAttribute('disabled');

      assert.dom('[data-test-field="date"] input').hasAttribute('disabled');
      assert.dom('[data-test-field="datetime"] input').hasAttribute('disabled');
      assert
        .dom('[data-test-field="ethereumAddress"] input')
        .hasAttribute('disabled');
      assert
        .dom('[data-test-field="markdown"] textarea')
        .hasAttribute('disabled');
      assert
        .dom('[data-test-field="textArea"] textarea')
        .hasAttribute('disabled');
    });
  });

  module('cards allowed to be edited', function (hooks) {
    hooks.beforeEach(function () {
      provideConsumeContext(PermissionsContextName, {
        canWrite: true,
      });
    });

    test('primitive field type checking', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field title = contains(StringField);
        @field number = contains(NumberField);
        @field languagesSpoken = containsMany(StringField);
        @field ref = contains(CodeRefField);
        @field boolean = contains(BooleanField);

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            {{@model.firstName}}
            {{@model.title}}
            {{@model.number}}
            {{@model.ref.module}}
            {{@model.ref.name}}
            {{@model.boolean}}
            {{#each @model.languagesSpoken as |language|}}
              {{language}}
            {{/each}}
          </template>
        };
      }
      let card = new Person();
      card.firstName = 'arthur';
      card.number = 42;
      card.boolean = true;
      card.languagesSpoken = ['english', 'japanese'];
      card.ref = { module: `${testRealmURL}person`, name: 'Person' };
      let readName: string = card.firstName;
      assert.strictEqual(readName, 'arthur');
      let readNumber: number = card.number;
      assert.strictEqual(readNumber, 42);
      let readLanguages: string[] = card.languagesSpoken;
      assert.deepEqual(readLanguages, ['english', 'japanese']);
      let readRef: CodeRef = card.ref;
      assert.deepEqual(readRef, {
        module: `${testRealmURL}person`,
        name: 'Person',
      });
      let readBoolean: boolean = card.boolean;
      assert.deepEqual(readBoolean, true);
    });

    test('access @model for primitive and composite fields', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        @field subscribers = contains(NumberField);
        @field languagesSpoken = containsMany(StringField);
        @field isCool = contains(BooleanField);
      }

      class Post extends CardDef {
        @field title = contains(StringField);
        @field author = contains(Person);
        @field languagesSpoken = containsMany(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            {{@model.title}}
            by
            {{@model.author.firstName}}
            speaks
            {{#each @model.author.languagesSpoken as |language|}}
              {{language}}
            {{/each}}
            {{@model.author.subscribers}}
            subscribers is cool
            {{@model.author.isCool}}
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Post, Person });

      let helloWorld = new Post({
        title: 'First Post',
        author: new Person({
          firstName: 'Arthur',
          subscribers: 5,
          isCool: true,
          languagesSpoken: ['english', 'japanese'],
        }),
      });

      let cardRoot = await renderCard(loader, helloWorld, 'isolated');
      assert.strictEqual(
        cleanWhiteSpace(cardRoot.textContent!),
        'First Post by Arthur speaks english japanese 5 subscribers is cool true',
      );
    });

    test('render primitive field', async function (assert) {
      class EmphasizedString extends FieldDef {
        static [primitive]: string;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <em data-test='name'>{{@model}}</em>
          </template>
        };
      }

      class StrongNumber extends FieldDef {
        static [primitive]: number;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <strong data-test='number'>{{@model}}</strong>
          </template>
        };
      }

      class Person extends CardDef {
        @field firstName = contains(EmphasizedString);
        @field number = contains(StrongNumber);

        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div><@fields.firstName /><@fields.number /></div>
          </template>
        };
      }

      let arthur = new Person({ firstName: 'Arthur', number: 10 });

      await renderCard(loader, arthur, 'embedded');
      assert.dom('[data-test="name"]').containsText('Arthur');
      assert.dom('[data-test="number"]').containsText('10');
    });

    test('render a field in atom format', async function (assert) {
      class EmphasizedString extends FieldDef {
        static [primitive]: string;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <em data-test-embedded='name'>{{@model}}</em>
          </template>
        };
        static atom = class Atom extends Component<typeof this> {
          <template>
            <em data-test-atom='name'>{{@model}}</em>
          </template>
        };
      }

      class StrongNumber extends FieldDef {
        static [primitive]: number;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <strong data-test-embedded='number'>{{@model}}</strong>
          </template>
        };
        static atom = class Atom extends Component<typeof this> {
          <template>
            <strong data-test-atom='number'>{{@model}}</strong>
          </template>
        };
      }

      class Guest extends FieldDef {
        @field name = contains(EmphasizedString);
        @field additionalGuestCount = contains(StrongNumber);
        @field title = contains(StringField, {
          computeVia: function (this: Guest) {
            return `${this.name} - ${this.additionalGuestCount}`;
          },
        });
      }

      class Person extends CardDef {
        @field firstName = contains(EmphasizedString);
        @field number = contains(StrongNumber);
        @field guest = contains(Guest);
        @field specialGuest = contains(Guest, {
          computeVia(this: Person) {
            return new Guest({
              name: 'Special',
              additionalGuestCount: 1,
            });
          },
        });

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div>
              <@fields.firstName @format='atom' />
              <@fields.number />
            </div>
            Guests:
            <div class='guest'>
              <@fields.guest @format='atom' />
            </div>
            <div class='special-guest'>
              <@fields.specialGuest @format='atom' />
            </div>
          </template>
        };
      }

      let arthur = new Person({
        firstName: 'Arthur',
        number: 10,
        guest: new Guest({
          name: 'Madeleine',
          additionalGuestCount: 3,
        }),
      });

      await renderCard(loader, arthur, 'isolated');
      assert
        .dom('[data-test-atom="name"]')
        .containsText('Arthur', 'can render primitive field in atom format');
      assert
        .dom('[data-test-embedded="number"]')
        .containsText('10', 'field has default format');
      assert
        .dom('.guest [data-test-compound-field-format="atom"]')
        .hasText('Madeleine - 3', 'can render compound field in atom format');
      assert
        .dom('.special-guest [data-test-compound-field-format="atom"]')
        .hasText('Special - 1', 'can render compound field in atom format');
    });

    test('render a containsMany field in atom format', async function (assert) {
      class Guest extends FieldDef {
        @field name = contains(StringField);
        @field additionalGuestCount = contains(NumberField);
        @field title = contains(StringField, {
          computeVia: function (this: Guest) {
            return `${this.name} - ${this.additionalGuestCount}`;
          },
        });
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.name />
          </template>
        };
      }

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field number = contains(NumberField);
        @field guests = containsMany(Guest);

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            Guests: <@fields.guests @format='atom' />
          </template>
        };
      }

      let arthur = new Person({
        firstName: 'Arthur',
        number: 10,
        guests: [
          new Guest({
            name: 'Madeleine',
            additionalGuestCount: 3,
          }),
          new Guest({
            name: 'Marcus',
            additionalGuestCount: 1,
          }),
          new Guest({
            name: 'Melinda',
            additionalGuestCount: 2,
          }),
        ],
      });

      await renderCard(loader, arthur, 'isolated');
      assert
        .dom(
          '[data-test-card-format="isolated"] > [data-test-plural-view-format="atom"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-plural-view-item="0"] > [data-test-compound-field-format="atom"]',
        )
        .exists();

      assert
        .dom('[data-test-plural-view-item="0"]')
        .containsText('Madeleine - 3');
      assert.dom('[data-test-plural-view-item="1"]').containsText('Marcus - 1');
      assert.dom('[data-test-plural-view-item="2"]').hasText('Melinda - 2');
    });

    test('render a linksToMany field in atom format', async function (assert) {
      class Guest extends CardDef {
        @field name = contains(StringField);
        @field additionalGuestCount = contains(NumberField);
        @field title = contains(StringField, {
          computeVia: function (this: Guest) {
            return this.name;
          },
        });
      }

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field number = contains(NumberField);
        @field guests = linksToMany(Guest);

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            Guests: <@fields.guests @format='atom' />
          </template>
        };
      }

      loader.shimModule(`${testRealmURL}test-cards`, { Guest, Person });

      let g1 = new Guest({
        name: 'Madeleine',
        additionalGuestCount: 3,
      });
      let g2 = new Guest({
        name: 'Marcus',
        additionalGuestCount: 1,
      });

      await saveCard(g1, `${testRealmURL}Guest/g1`, loader);
      await saveCard(g2, `${testRealmURL}Guest/g2`, loader);

      let arthur = new Person({
        firstName: 'Arthur',
        number: 10,
        guests: [g1, g2],
      });

      await renderCard(loader, arthur, 'isolated');
      assert
        .dom(
          '[data-test-card-format="isolated"] > [data-test-plural-view="linksToMany"][data-test-plural-view-format="atom"]',
        )
        .exists();
      assert
        .dom('[data-test-plural-view-item="0"][data-test-card-format="atom"]')
        .containsText('Madeleine');
      assert
        .dom('[data-test-plural-view-item="1"][data-test-card-format="atom"]')
        .containsText('Marcus');
    });

    test('can render a card with an empty field', async function (assert) {
      let EmbeddedViewDriver = fittedViewDriver();

      loader.shimModule(`${testRealmURL}test-cards`, {
        EmbeddedViewDriver,
      });

      let driver = new EmbeddedViewDriver();
      await renderCard(loader, driver, 'isolated');

      assert.dom('[data-test-driver] [data-test-empty-field]').exists();

      await percySnapshot(assert);
    });

    test('renders a default (CardDef) fitted view for card with thumbnail', async function (assert) {
      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field image = contains(Base64ImageField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field thumbnailURL = contains(MaybeBase64Field, {
          computeVia: function (this: Person) {
            return this.image.base64;
          },
        });
      }

      let FittedViewDriver = fittedViewDriver();

      loader.shimModule(`${testRealmURL}test-cards`, {
        Person,
        FittedViewDriver,
      });

      let mang = new Person({
        firstName: 'Mango',
        description: 'test card',
        image: new Base64ImageField({
          altText: 'Picture of Mango',
          size: 'contain',
          width: null,
          height: 200,
          base64: `data:image/png;base64,${mango}`,
        }),
      });
      let driver = new FittedViewDriver({ card: mang });
      await renderCard(loader, driver, 'isolated');

      assert
        .dom('[data-test-driver] [data-test-card-title]')
        .containsText('Mango');
      assert
        .dom('[data-test-driver] [data-test-card-display-name]')
        .containsText('Person');
      assert
        .dom('[data-test-driver] [data-test-card-thumbnail-placeholder]')
        .doesNotExist();
      assert
        .dom('[data-test-driver] [data-test-card-title]')
        .containsText('Mango');
      assert
        .dom('[data-test-driver] [data-test-card-description]')
        .containsText('test card');

      await percySnapshot(assert);
    });

    test('renders a default (CardDef) fitted view for card without thumbnail', async function (assert) {
      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field image = contains(Base64ImageField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        @field thumbnailURL = contains(MaybeBase64Field, {
          computeVia: function (this: Person) {
            return this.image.base64;
          },
        });
      }

      let FittedViewDriver = fittedViewDriver();

      loader.shimModule(`${testRealmURL}test-cards`, {
        Person,
        FittedViewDriver,
      });

      let vang = new Person({ firstName: 'Van Gogh' });
      let driver = new FittedViewDriver({ card: vang });
      await renderCard(loader, driver, 'isolated');

      assert
        .dom('[data-test-driver] [data-test-card-title]')
        .containsText('Van Gogh');
      assert
        .dom('[data-test-driver] [data-test-card-display-name]')
        .containsText('Person');
      assert.dom('[data-test-driver] [data-test-card-type-icon]').exists();

      await percySnapshot(assert);
    });

    test('can set the ID for an unsaved card', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
      }

      let mango = new Person();
      mango.id = `${testRealmURL}Person/mango`;
      assert.strictEqual(mango.id, `${testRealmURL}Person/mango`);

      let vanGogh = new Person({ id: `${testRealmURL}Person/vanGogh` });
      assert.strictEqual(vanGogh.id, `${testRealmURL}Person/vanGogh`);
    });

    test('throws when setting the ID for a saved card', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });

      // deserialize a card with an ID to mark it as "saved"
      let card = new Person({ firstName: 'Mango' });
      await saveCard(card, `${testRealmURL}Person/mango`, loader);

      try {
        card.id = 'boom';
        throw new Error(`expected exception not thrown`);
      } catch (err: any) {
        assert.ok(
          err.message.match(
            /cannot assign a value to the field 'id' on the saved card/,
          ),
          'exception thrown when setting ID of saved card',
        );
      }
    });

    test('render codeRef field', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }

      let ref = { module: `${testRealmURL}person`, name: 'Person' };
      let driver = new DriverCard({ ref });

      await renderCard(loader, driver, 'embedded');
      assert
        .dom('[data-test-ref]')
        .containsText(`Module: ${testRealmURL}person Name: Person`);

      // is this worth an assertion? or is it just obvious?
      assert.strictEqual(
        driver.ref,
        ref,
        'The deserialized card ref constructor param is strict equal to the deserialized card ref value',
      );
    });

    test('can render a CodeRef field in edit mode with an initial value', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }

      let ref = { module: `${testModuleRealm}person`, name: 'Person' };
      let driver = new DriverCard({ ref });
      await renderCard(loader, driver, 'edit');
      await waitFor('[data-test-hasValidated]');

      assert
        .dom('[data-test-ref] input')
        .hasValue(`${testModuleRealm}person/Person`, 'input field is correct');
      assert
        .dom('[data-test-ref] [data-test-boxel-input-validation-state="valid"]')
        .exists('code ref is valid');
    });

    test('can edit a CodeRef field with a valid URL-like code ref', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }

      let driver = new DriverCard();

      await renderCard(loader, driver, 'edit');
      await fillIn('[data-test-ref] input', `${testModuleRealm}person/Person`);
      await waitFor('[data-test-hasValidated]');
      assert
        .dom('[data-test-ref] input')
        .hasValue(`${testModuleRealm}person/Person`, 'input field is correct');
      assert
        .dom('[data-test-ref] [data-test-boxel-input-validation-state="valid"]')
        .exists('code ref is valid');
      assert.deepEqual(
        driver.ref,
        {
          module: `${testModuleRealm}person`,
          name: 'Person',
        },
        'code ref field value is correct',
      );
    });

    test('can edit a CodeRef field with a valid non-URL code ref', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }

      let driver = new DriverCard();

      await renderCard(loader, driver, 'edit');
      await fillIn(
        '[data-test-ref] input',
        `@cardstack/boxel-host/commands/save-card/default`,
      );
      await waitFor('[data-test-hasValidated]');
      assert
        .dom('[data-test-ref] input')
        .hasValue(
          `@cardstack/boxel-host/commands/save-card/default`,
          'input field is correct',
        );
      assert
        .dom('[data-test-ref] [data-test-boxel-input-validation-state="valid"]')
        .exists('code ref is valid');

      assert.deepEqual(
        driver.ref,
        {
          module: `@cardstack/boxel-host/commands/save-card`,
          name: `default`,
        },
        'code ref field value is correct',
      );
    });

    test('can edit a CodeRef field with an invalid non-URL code ref', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }

      let ref = { module: `${testModuleRealm}person`, name: 'Person' };
      let driver = new DriverCard({ ref });
      await renderCard(loader, driver, 'edit');
      await waitFor('[data-test-hasValidated]');
      await fillIn(
        '[data-test-ref] input',
        `@cardstack/boxel-host/commands/save-card/doesNotExist`,
      );
      await waitFor('[data-test-hasValidated]');
      assert
        .dom('[data-test-ref] input')
        .hasValue(
          `@cardstack/boxel-host/commands/save-card/doesNotExist`,
          'input field is correct',
        );
      assert
        .dom(
          '[data-test-ref] [data-test-boxel-input-validation-state="invalid"]',
        )
        .exists('code ref is invalid');

      assert.deepEqual(
        driver.ref,
        {
          module: `${testModuleRealm}person`,
          name: 'Person',
        },
        'code ref field value is correct',
      );
    });

    test('can edit a CodeRef field with an invalid URL-like code ref', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }
      let ref = { module: `${testModuleRealm}person`, name: 'Person' };
      let driver = new DriverCard({ ref });
      await renderCard(loader, driver, 'edit');
      await waitFor('[data-test-hasValidated]');

      await fillIn(
        '[data-test-ref] input',
        `${testModuleRealm}doesNotExist/Nothing`,
      );
      await waitFor('[data-test-hasValidated]');
      assert
        .dom('[data-test-ref] input')
        .hasValue(
          `${testModuleRealm}doesNotExist/Nothing`,
          'input field is correct',
        );
      assert
        .dom(
          '[data-test-ref] [data-test-boxel-input-validation-state="invalid"]',
        )
        .exists('code ref is invalid');
      assert.deepEqual(
        driver.ref,
        {
          module: `${testModuleRealm}person`,
          name: 'Person',
        },
        'code ref field value is correct',
      );
    });

    test('can edit a CodeRef field with a code ref that is invalid because its too short', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }
      let ref = { module: `${testModuleRealm}person`, name: 'Person' };
      let driver = new DriverCard({ ref });
      await renderCard(loader, driver, 'edit');
      await waitFor('[data-test-hasValidated]');

      await fillIn('[data-test-ref] input', `@cardstack`);
      await waitFor('[data-test-hasValidated]');
      assert
        .dom('[data-test-ref] input')
        .hasValue(`@cardstack`, 'input field is correct');
      assert
        .dom(
          '[data-test-ref] [data-test-boxel-input-validation-state="invalid"]',
        )
        .exists('code ref is invalid');
      assert.deepEqual(
        driver.ref,
        {
          module: `${testModuleRealm}person`,
          name: 'Person',
        },
        'code ref field value is correct',
      );
    });

    test('can clear a CodeRef field in edit mode', async function (assert) {
      class DriverCard extends CardDef {
        @field ref = contains(CodeRefField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <div data-test-ref><@fields.ref /></div>
          </template>
        };
      }
      let ref = { module: `${testModuleRealm}person`, name: 'Person' };
      let driver = new DriverCard({ ref });
      await renderCard(loader, driver, 'edit');
      await waitFor('[data-test-hasValidated]');
      await fillIn('[data-test-ref] input', '');
      assert
        .dom('[data-test-ref] input')
        .hasValue('', 'input field is correct');
      assert.deepEqual(driver.ref, undefined, 'code ref can be unset');
    });

    test('render base64 image card', async function (assert) {
      class DriverCard extends CardDef {
        @field image = contains(Base64ImageField);
      }

      let driver = new DriverCard();
      await renderCard(loader, driver, 'edit');
      triggerEvent('[data-test-base64-field]', 'change', {
        files: [base64ToBlob(mango, 'image/png')],
      });
      await waitFor('[data-test-actual-img]');
      await fillIn('[data-test-field="altText"] input', 'picture of mango');
      assert
        .dom('[data-test-actual-img]')
        .hasAttribute('src', `data:image/png;base64,${mango}`);
      assert
        .dom('[data-test-actual-img]')
        .hasAttribute('alt', 'picture of mango');

      await click(getRadioQuerySelector('size', 'contain'));
      assert.dom('[data-test-height-warning]').exists('height warning exists');
      await fillIn('[data-test-field="height"] input', '200');
      assert
        .dom('[data-test-height-warning]')
        .doesNotExist('warning dismissed');
      assert
        .dom('[data-test-contain-cover-img]')
        .hasAttribute(
          'style',
          `background-image: url("data:image/png;base64,${mango}"); background-size: contain; height: 200px;`,
        );
      assert.dom('[data-test-contain-cover-img]').hasAttribute('role', 'img');
      assert
        .dom('[data-test-contain-cover-img]')
        .hasAttribute('aria-label', 'picture of mango');

      await percySnapshot(assert);

      await renderCard(loader, driver, 'isolated');
      assert
        .dom('[data-test-contain-cover-img]')
        .hasAttribute(
          'style',
          `background-image: url("data:image/png;base64,${mango}"); background-size: contain; height: 200px;`,
        );
      assert.dom('[data-test-contain-cover-img]').hasAttribute('role', 'img');
      assert
        .dom('[data-test-contain-cover-img]')
        .hasAttribute('aria-label', 'picture of mango');
    });

    test('render card typeDisplayName', async function (assert) {
      class DriverCard extends CardDef {
        static displayName = 'Driver';
      }
      let card = new DriverCard();

      await render(<template>
        <div data-test-type-display-name>{{cardTypeDisplayName card}}</div>
      </template>);
      assert.dom('[data-test-type-display-name]').containsText(`Driver`);
    });

    test('can subscribe and unsubscribe to card instance contains field changes', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field favoriteColor = contains(StringField);
      }

      let mango = new Person({
        firstName: 'Mango',
        favoriteColor: 'brown',
      });

      let changeEvent:
        | { instance: BaseDef; fieldName: string; value: any }
        | undefined;
      let eventCount = 0;
      let subscriber = (instance: BaseDef, fieldName: string, value: any) => {
        eventCount++;
        changeEvent = {
          instance,
          fieldName,
          value,
        };
      };
      subscribeToChanges(mango, subscriber);

      try {
        mango.firstName = 'Van Gogh';
        assert.strictEqual(
          eventCount,
          1,
          'the change event was fired the correct amount of times',
        );
        assert.deepEqual(
          changeEvent?.instance,
          mango,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'firstName',
          'the fieldName was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.value,
          'Van Gogh',
          'the field value was correctly specified in change event',
        );
      } finally {
        unsubscribeFromChanges(mango, subscriber);
      }

      mango.firstName = 'Paper';
      assert.strictEqual(
        eventCount,
        1,
        'the change event was fired the correct amount of times',
      );
      assert.strictEqual(
        changeEvent?.fieldName,
        'firstName',
        'the fieldName was correctly specified in change event',
      );
      assert.strictEqual(
        changeEvent?.value,
        'Van Gogh',
        'the field value was correctly specified in change event',
      );
    });

    test('can subscribe and unsubscribe to card instance containsMany field changes', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field favoriteColors = containsMany(StringField);
      }

      let mango = new Person({
        firstName: 'Mango',
        favoriteColors: ['brown'],
      });

      let changeEvent:
        | { instance: BaseDef; fieldName: string; value: any }
        | undefined;
      let eventCount = 0;
      let subscriber = (instance: BaseDef, fieldName: string, value: any) => {
        eventCount++;
        changeEvent = {
          instance,
          fieldName,
          value,
        };
      };
      subscribeToChanges(mango, subscriber);

      try {
        mango.favoriteColors.push('green');
        await flushLogs();
        assert.strictEqual(
          eventCount,
          1,
          'the change event was fired the correct amount of times',
        );
        assert.deepEqual(
          changeEvent?.instance,
          mango,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'favoriteColors',
          'the fieldName was correctly specified in change event',
        );
        assert.deepEqual(
          changeEvent?.value,
          ['brown', 'green'],
          'the field value was correctly specified in change event',
        );
      } finally {
        unsubscribeFromChanges(mango, subscriber);
      }

      mango.favoriteColors.push('red');
      await flushLogs();
      assert.strictEqual(
        eventCount,
        1,
        'the change event was fired the correct amount of times',
      );
      assert.strictEqual(
        changeEvent?.fieldName,
        'favoriteColors',
        'the fieldName was correctly specified in change event',
      );
      assert.deepEqual(
        changeEvent?.value,
        ['brown', 'green'],
        'the field value was correctly specified in change event',
      );
    });

    test('can subscribe and unsubscribe to changes of field instance within a composite containsMany field', async function (assert) {
      class WorkExperience extends FieldDef {
        @field company = contains(StringField);
        @field startDate = contains(DateField);
        @field endDate = contains(DateField);
      }

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field workExperiences = containsMany(WorkExperience);
      }

      let mango = new Person({
        firstName: 'Mango',
        workExperiences: [],
      });

      let changeEvent:
        | { instance: BaseDef; fieldName: string; value: any }
        | undefined;
      let eventCount = 0;
      let subscriber = (instance: BaseDef, fieldName: string, value: any) => {
        eventCount++;
        changeEvent = {
          instance,
          fieldName,
          value,
        };
      };
      subscribeToChanges(mango, subscriber);

      try {
        let firstWorkExperience = new WorkExperience();
        mango.workExperiences.push(firstWorkExperience);
        await flushLogs();
        await waitUntil(() => eventCount === 1);
        assert.deepEqual(
          changeEvent?.instance,
          mango,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'workExperiences',
          'the fieldName was correctly specified in change event',
        );
        assert.deepEqual(
          changeEvent?.value[0],
          firstWorkExperience,
          'the field value was correctly specified in change event',
        );

        firstWorkExperience.company = 'First Company';
        await waitUntil(() => eventCount === 2);
        assert.deepEqual(
          changeEvent?.instance,
          firstWorkExperience,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'company',
          'the fieldName was correctly specified in change event',
        );
        assert.deepEqual(
          changeEvent?.value,
          'First Company',
          'the field value was correctly specified in change event',
        );

        mango.workExperiences.pop();
        await waitUntil(() => eventCount === 3);
        assert.deepEqual(
          changeEvent?.instance,
          mango,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'workExperiences',
          'the fieldName was correctly specified in change event',
        );
        assert.deepEqual(
          changeEvent?.value.length,
          0,
          'the field value was correctly specified in change event',
        );
      } finally {
        unsubscribeFromChanges(mango, subscriber);
      }
    });

    test('can subscribe and unsubscribe to card instance linksTo field changes', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({
        firstName: 'Mango',
      });
      let vanGogh = new Pet({
        firstName: 'Van Gogh',
      });
      let paper = new Pet({
        firstName: 'Paper',
      });
      let hassan = new Person({
        firstName: 'Hassan',
        pet: mango,
      });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);
      await saveCard(paper, `${testRealmURL}Pet/paper`, loader);

      let changeEvent:
        | { instance: BaseDef; fieldName: string; value: any }
        | undefined;
      let eventCount = 0;
      let subscriber = (instance: BaseDef, fieldName: string, value: any) => {
        eventCount++;
        changeEvent = {
          instance,
          fieldName,
          value,
        };
      };
      subscribeToChanges(hassan, subscriber);

      try {
        hassan.pet = vanGogh;
        assert.strictEqual(
          eventCount,
          1,
          'the change event was fired the correct amount of times',
        );
        assert.deepEqual(
          changeEvent?.instance,
          hassan,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'pet',
          'the fieldName was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.value,
          vanGogh,
          'the field value was correctly specified in change event',
        );
      } finally {
        unsubscribeFromChanges(hassan, subscriber);
      }

      hassan.pet = paper;
      assert.strictEqual(
        eventCount,
        1,
        'the change event was fired the correct amount of times',
      );
      assert.strictEqual(
        changeEvent?.fieldName,
        'pet',
        'the fieldName was correctly specified in change event',
      );
      assert.strictEqual(
        changeEvent?.value,
        vanGogh,
        'the field value was correctly specified in change event',
      );
    });

    test('can subscribe and unsubscribe to card instance linksToMany field changes', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }

      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pets = linksToMany(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let mango = new Pet({
        firstName: 'Mango',
      });
      let vanGogh = new Pet({
        firstName: 'Van Gogh',
      });
      let paper = new Pet({
        firstName: 'Paper',
      });
      let hassan = new Person({
        firstName: 'Hassan',
        pets: [mango],
      });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);
      await saveCard(paper, `${testRealmURL}Pet/paper`, loader);

      let changeEvent:
        | { instance: BaseDef; fieldName: string; value: any }
        | undefined;
      let eventCount = 0;
      let subscriber = (instance: BaseDef, fieldName: string, value: any) => {
        eventCount++;
        changeEvent = {
          instance,
          fieldName,
          value,
        };
      };
      subscribeToChanges(hassan, subscriber);

      try {
        hassan.pets.push(vanGogh);
        await flushLogs();
        assert.strictEqual(
          eventCount,
          1,
          'the change event was fired the correct amount of times',
        );
        assert.deepEqual(
          changeEvent?.instance,
          hassan,
          'the instance was correctly specified in change event',
        );
        assert.strictEqual(
          changeEvent?.fieldName,
          'pets',
          'the fieldName was correctly specified in change event',
        );
        assert.deepEqual(
          (changeEvent?.value as Pet[]).map((p) => p.firstName),
          ['Mango', 'Van Gogh'],
          'the field value was correctly specified in change event',
        );
      } finally {
        unsubscribeFromChanges(hassan, subscriber);
      }

      hassan.pets.push(paper);
      await flushLogs();
      assert.strictEqual(
        eventCount,
        1,
        'the change event was fired the correct amount of times',
      );
      assert.strictEqual(
        changeEvent?.fieldName,
        'pets',
        'the fieldName was correctly specified in change event',
      );
      assert.deepEqual(
        (changeEvent?.value as Pet[]).map((p) => p.firstName),
        ['Mango', 'Van Gogh'],
        'the field value was correctly specified in change event',
      );
    });

    test('throws when assigning a value to a linksTo field with a primitive card', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        // @ts-expect-error Have to purposefully bypass type-checking in order to get into this runtime error state
        @field pet = linksTo(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });

      try {
        new Person({ firstName: 'Hassan', pet: 'Mango' });
        throw new Error('expected error was not thrown');
      } catch (err: any) {
        assert.ok(
          err.message.match(/linksTo field 'pet' contains a primitive card/),
          'cannot have a linkTo field that uses a primitive card',
        );
      }

      let hassan = new Person({ firstName: 'Hassan' });
      try {
        // @ts-expect-error Have to purposefully bypass type-checking in order to get into this runtime error state
        hassan.pet = 'Mango';
        throw new Error('expected error was not thrown');
      } catch (err: any) {
        assert.ok(
          err.message.match(/linksTo field 'pet' contains a primitive card/),
          'cannot have a linkTo field that uses a primitive card',
        );
      }
    });

    test('throws assigning linksTo field to a card that is not an instance of the field card', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
      }
      class NotAPet extends CardDef {
        @field firstName = contains(StringField);
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet, NotAPet });

      let door = new NotAPet({ firstName: 'door' });
      try {
        new Person({ firstName: 'Hassan', pet: door });
        throw new Error('expected error was not thrown');
      } catch (err: any) {
        assert.ok(
          err.message.match(/it is not an instance of Pet/),
          'cannot assign a linksTo field to a value that is not instance of the field card',
        );
      }

      let hassan = new Person({ firstName: 'Hassan' });
      try {
        hassan.pet = door;
        throw new Error('expected error was not thrown');
      } catch (err: any) {
        assert.ok(
          err.message.match(/it is not an instance of Pet/),
          'cannot assign a linksTo field to a value that is not instance of the field card',
        );
      }
    });

    test('can render a linksTo field', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Pet);
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-pet={{@model.firstName}}>
              <@fields.firstName />
              {{! template-lint-disable no-inline-styles }}
              <@fields.friend style='margin: 10px' />
            </div>
          </template>
        };
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-person>
              <h1><@fields.firstName /></h1>
              {{! template-lint-disable no-inline-styles }}
              <@fields.pet style='margin: 10px' />
            </div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person, Pet });

      let vanGogh = new Pet({ firstName: 'Van Gogh' });
      let mango = new Pet({ firstName: 'Mango', friend: vanGogh });
      let hassan = new Person({ firstName: 'Hassan', pet: mango });
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await renderCard(loader, hassan, 'embedded');

      assert.dom('[data-test-person]').containsText('Hassan');
      assert.dom('[data-test-pet="Mango"]').containsText('Mango');
      assert.dom('[data-test-pet="Van Gogh"]').containsText('Van Gogh');
      assert
        .dom('[data-test-card-format="fitted"]')
        .hasStyle({ margin: '10px' });
    });

    test('render whole composite contains field', async function (assert) {
      class Person extends FieldDef {
        @field title = contains(StringField);
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        @field number = contains(NumberField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-embedded-person><@fields.title />
              <@fields.firstName />
              <@fields.lastName />
              <@fields.number /></div>
          </template>
        };
      }

      class Post extends CardDef {
        @field author = contains(Person);
        @field body = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div data-test-title><@fields.title /></div>
            {{! template-lint-disable no-inline-styles }}
            <div data-test-author><@fields.author style='width: 120px' /></div>
            <div data-test-body><@fields.body /></div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Post, Person });

      let helloWorld = new Post({
        title: 'This is My First Post',
        author: new Person({
          firstName: 'Arthur',
          lastName: 'Mephistophoclesiasticallious',
          title: 'Mr',
          number: 10,
        }),
        body: 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      });
      await renderCard(loader, helloWorld, 'isolated');
      assert
        .dom(
          '[data-test-compound-field-format="embedded"] [data-test-embedded-person]',
        )
        .exists();
      assert
        .dom('[data-test-compound-field-format="embedded"]')
        .hasStyle({ width: '120px' });
      assert
        .dom('[data-test-embedded-person]')
        .containsText('Mr Arthur Mephistophoclesiasticallious 10');
    });

    test('render nested composite field', async function (assert) {
      class TestString extends FieldDef {
        static [primitive]: string;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <em data-test='string'>{{@model}}</em>
          </template>
        };
      }

      class TestNumber extends FieldDef {
        static [primitive]: number;
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <strong data-test='number'>{{@model}}</strong>
          </template>
        };
      }

      class Person extends FieldDef {
        @field firstName = contains(TestString);
        @field number = contains(TestNumber);
      }

      class Post extends CardDef {
        @field title = contains(TestString);
        @field author = contains(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div><@fields.author.firstName /><@fields.author.number /></div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, {
        Post,
        Person,
        TestNumber,
        TestString,
      });

      let helloWorld = new Post({
        author: new Person({ firstName: 'Arthur', number: 10 }),
      });

      await renderCard(loader, helloWorld, 'isolated');
      assert.dom('[data-test="string"]').containsText('Arthur');
      assert.dom('[data-test="number"]').containsText('10');
    });

    test('render default isolated template', async function (assert) {
      let firstName = await testString('first-name');
      class Person extends FieldDef {
        @field firstName = contains(firstName);

        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <span><@fields.firstName /></span>
          </template>
        };
      }

      let title = await testString('title');
      class Post extends CardDef {
        @field title = contains(title);
        @field author = contains(Person);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Post, Person });

      let helloWorld = new Post({
        title: 'First Post',
        author: new Person({ firstName: 'Arthur' }),
      });

      await renderCard(loader, helloWorld, 'isolated');
      assert.dom('[data-test="first-name"]').containsText('Arthur');
      assert.dom('[data-test="title"]').containsText('First Post');
    });

    test('render default atom view template', async function (assert) {
      class Person extends FieldDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        @field age = contains(NumberField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return `${this.firstName} ${this.lastName}`;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let person = new Person({
        firstName: 'Arthur',
        lastName: 'M',
        age: 10,
      });

      await renderCard(loader, person, 'atom');
      assert.dom('[data-test-compound-field-component]').hasText('Arthur M');
      assert
        .dom('[data-test-compound-field-component]')
        .doesNotContainText('10');
      assert.dom('[data-test-compound-field-format="atom"]').exists();

      person.firstName = '';
      person.lastName = '';
      await renderCard(loader, person, 'atom');
      assert.dom('[data-test-compound-field-component]').hasNoText();
    });

    test('render user-provided atom view template', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        @field age = contains(NumberField);
        @field title = contains(StringField, {
          computeVia: function (this: Person) {
            return this.firstName;
          },
        });
        static atom = class Atom extends Component<typeof this> {
          <template>
            <div class='name' data-test-template>
              <@fields.firstName />
              <@fields.age />
            </div>
            <style scoped>
              .name {
                color: red;
                font-weight: bold;
              }
            </style>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let helloWorld = new Person({ firstName: 'Arthur', age: 10 });

      await renderCard(loader, helloWorld, 'atom');
      assert
        .dom('[data-test-compound-field-format="atom"] [data-test-template]')
        .hasText('Arthur 10');
      assert.dom('[data-test-template]').hasClass('name');
    });

    test('render a containsMany primitive field', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field languagesSpoken = containsMany(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <@fields.firstName /> speaks <@fields.languagesSpoken />
          </template>
        };
      }

      let mango = new Person({
        firstName: 'Mango',
        languagesSpoken: ['english', 'japanese'],
      });

      let root = await renderCard(loader, mango, 'isolated');
      assert.strictEqual(
        cleanWhiteSpace(root.textContent!),
        'Mango speaks english japanese',
      );
    });

    test('supports an empty containsMany primitive field', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field languagesSpoken = containsMany(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <@fields.firstName /> speaks <@fields.languagesSpoken />
          </template>
        };
      }
      let mango = new Person({ firstName: 'Mango' });
      assert.deepEqual(
        mango.languagesSpoken,
        [],
        'empty containsMany field is initialized to an empty array',
      );
    });

    test('can render empty linksTo and linksToMany fields in default atom format', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.firstName;
          },
        });
      }
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field pet = linksTo(Pet);
        @field pets = linksToMany(Pet);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h3 data-test-person><@fields.firstName /></h3>
            <div data-test-pet>
              Pet:
              <@fields.pet @format='atom' />
            </div>
            <div data-test-pets>
              Pets:
              <@fields.pets @format='atom' />
            </div>
          </template>
        };
      }
      let hassan = new Person({ firstName: 'Hassan' });
      await renderCard(loader, hassan, 'isolated');

      assert.dom('[data-test-person]').hasText('Hassan');
      assert.dom('[data-test-pet]').hasText('Pet:');
      assert.dom('[data-test-pet] span').hasClass('empty-field');
      assert.dom('[data-test-pets]').hasText('Pets:');
      assert
        .dom(
          '[data-test-pets] > [data-test-plural-view="linksToMany"][data-test-plural-view-format="atom"]',
        )
        .hasClass('empty');
    });

    test('render a containsMany composite field', async function (this: RenderingTestContext, assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            {{! template-lint-disable no-inline-styles }}
            <div
              data-test-person-firstName
              style='height: 12px'
            ><@fields.firstName /></div>
            <div
              data-test-person-lastName
              style='height: 20px'
            ><@fields.lastName /></div>
          </template>
        };
      }

      class Family extends CardDef {
        @field people = containsMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div><@fields.people /></div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Family, Person });

      let abdelRahmans = new Family({
        people: [
          new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' }),
          new Person({ firstName: 'Van Gogh', lastName: 'Abdel-Rahman' }),
          new Person({ firstName: 'Hassan', lastName: 'Abdel-Rahman' }),
          new Person({ firstName: 'Mariko', lastName: 'Abdel-Rahman' }),
          new Person({ firstName: 'Yume', lastName: 'Abdel-Rahman' }),
          new Person({ firstName: 'Sakura', lastName: 'Abdel-Rahman' }),
        ],
      });

      await renderCard(loader, abdelRahmans, 'isolated');
      assert.deepEqual(
        [...this.element.querySelectorAll('[data-test-person-firstName]')].map(
          (element) => element.textContent?.trim(),
        ),
        ['Mango', 'Van Gogh', 'Hassan', 'Mariko', 'Yume', 'Sakura'],
      );
      assert
        .dom('[data-test-compound-field-format="embedded"]')
        .exists({ count: 6 });
      assert
        .dom('[data-test-plural-view-item="1"]')
        .hasStyle({ height: '32px' });
    });

    test('can #each over a containsMany primitive @fields', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field languagesSpoken = containsMany(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <@fields.firstName />
            speaks
            {{#each @fields.languagesSpoken as |Language|}}
              <Language />
            {{/each}}
          </template>
        };
      }

      let mango = new Person({
        firstName: 'Mango',
        languagesSpoken: ['english', 'japanese'],
      });

      let root = await renderCard(loader, mango, 'isolated');
      assert.strictEqual(
        cleanWhiteSpace(root.textContent!),
        'Mango speaks english japanese',
      );
    });

    test('can #each over a containsMany composite @fields', async function (this: RenderingTestContext, assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-person-firstName><@fields.firstName /></div>
          </template>
        };
      }

      class Family extends CardDef {
        @field people = containsMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div>
              {{#each @fields.people as |Person|}}
                <Person />
              {{/each}}
            </div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Family, Person });

      let abdelRahmans = new Family({
        people: [
          new Person({ firstName: 'Mango' }),
          new Person({ firstName: 'Van Gogh' }),
          new Person({ firstName: 'Hassan' }),
          new Person({ firstName: 'Mariko' }),
          new Person({ firstName: 'Yume' }),
          new Person({ firstName: 'Sakura' }),
        ],
      });

      await renderCard(loader, abdelRahmans, 'isolated');
      assert.deepEqual(
        [...this.element.querySelectorAll('[data-test-person-firstName]')].map(
          (element) => element.textContent?.trim(),
        ),
        ['Mango', 'Van Gogh', 'Hassan', 'Mariko', 'Yume', 'Sakura'],
      );
    });

    test('can render a linksToMany field', async function (this: RenderingTestContext, assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-person-firstName><@fields.firstName /></div>
          </template>
        };
      }

      class Family extends CardDef {
        @field people = linksToMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div>
              {{! template-lint-disable no-inline-styles }}
              <@fields.people style='margin: 5px' />
            </div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Family, Person });
      let mango = new Person({
        firstName: 'Mango',
      });
      let vanGogh = new Person({
        firstName: 'Van Gogh',
      });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);
      let abdelRahmanDogs = new Family({
        people: [mango, vanGogh],
      });
      await renderCard(loader, abdelRahmanDogs, 'isolated');
      assert.deepEqual(
        [...this.element.querySelectorAll('[data-test-person-firstName]')].map(
          (element) => element.textContent?.trim(),
        ),
        ['Mango', 'Van Gogh'],
      );
      assert
        .dom('[data-test-plural-view="linksToMany"]')
        .hasStyle({ margin: '5px' });
      assert.dom('[data-test-card-format="fitted"]').exists({ count: 2 });
      assert
        .dom('[data-test-card-format="fitted"]:nth-child(2)')
        .hasStyle({ marginTop: '16px' });
    });

    test('can #each over a linksToMany @fields', async function (this: RenderingTestContext, assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-person-firstName><@fields.firstName /></div>
          </template>
        };
      }

      class Family extends CardDef {
        @field people = linksToMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div>
              {{#each @fields.people as |Person|}}
                {{! template-lint-disable no-inline-styles }}
                <Person style='margin: 10px' />
              {{/each}}
            </div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Family, Person });
      let mango = new Person({
        firstName: 'Mango',
      });
      let vanGogh = new Person({
        firstName: 'Van Gogh',
      });
      await saveCard(mango, `${testRealmURL}Pet/mango`, loader);
      await saveCard(vanGogh, `${testRealmURL}Pet/vanGogh`, loader);
      let abdelRahmanDogs = new Family({
        people: [mango, vanGogh],
      });
      await renderCard(loader, abdelRahmanDogs, 'isolated');
      assert.deepEqual(
        [...this.element.querySelectorAll('[data-test-person-firstName]')].map(
          (element) => element.textContent?.trim(),
        ),
        ['Mango', 'Van Gogh'],
      );
      assert.dom('[data-test-card-format="fitted"]').exists({ count: 2 });
      assert
        .dom('[data-test-card-format="fitted"]')
        .hasStyle({ margin: '10px' });
    });

    // note that polymorphic "contains" field rendering is inherently tested via the spec tests
    test('renders a card with a polymorphic "containsMany" field', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
      }

      class Employee extends Person {
        @field department = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-employee-firstName><@fields.firstName /></div>
            <div data-test-employee-department><@fields.department /></div>
          </template>
        };
      }

      class Customer extends Person {
        @field billAmount = contains(NumberField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test-customer-firstName><@fields.firstName /></div>
            <div data-test-customer-billAmount><@fields.billAmount /></div>
          </template>
        };
      }

      class Group extends CardDef {
        @field people = containsMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div><@fields.people /></div>
          </template>
        };
      }

      loader.shimModule(`${testRealmURL}test-cards`, {
        Person,
        Employee,
        Customer,
        Group,
      });

      let group = new Group({
        people: [
          new Employee({
            firstName: 'Mango',
            department: 'begging',
          }),
          new Customer({
            firstName: 'Van Gogh',
            billAmount: 100,
          }),
        ],
      });
      await renderCard(loader, group, 'isolated');
      assert.dom('[data-test-employee-firstName]').containsText('Mango');
      assert.dom('[data-test-employee-department]').containsText('begging');
      assert.dom('[data-test-customer-firstName]').containsText('Van Gogh');
      assert.dom('[data-test-customer-billAmount]').containsText('100');
    });

    test('re-renders a card with a polymorphic "contains" field when the field instance changes', async function (assert) {
      class TestField extends FieldDef {
        static displayName = 'TestField';
        @field firstName = contains(StringField);

        static fitted = class TestFieldFitted extends Component<typeof this> {
          <template>
            <div data-test-baseclass>
              BaseClass
              <@fields.firstName />
            </div>
          </template>
        };
      }
      class SubTestField extends TestField {
        static displayName = 'SubTestField';

        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-subclass>
              SubClass
              <@fields.firstName />
            </div>
          </template>
        };
      }
      class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field specialField = contains(TestField);

        static isolated = class Isolated extends Component<typeof TestCard> {
          setSubclass = () => {
            this.args.model.specialField = new SubTestField({
              firstName: 'New Name',
            });
          };
          <template>
            <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
              Subclass From Outside</button>
            <@fields.specialField @format='fitted' />
          </template>
        };
      }

      let card = new TestCard({
        specialField: new TestField({
          firstName: 'Old Name',
        }),
      });

      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-baseclass]').hasText('BaseClass Old Name');
      assert.dom('[data-test-subclass]').doesNotExist();

      await click('[data-test-set-subclass]');

      assert.dom('[data-test-baseclass]').doesNotExist();
      assert.dom('[data-test-subclass]').hasText('SubClass New Name');

      assert.ok(true);
    });

    test('re-renders a card with linked card that has a polymorphic field', async function (assert) {
      class TestField extends FieldDef {
        static displayName = 'TestField';

        static fitted = class TestFieldFitted extends Component<typeof this> {
          <template>
            <div data-test-baseclass>
              BaseClass
            </div>
          </template>
        };
      }
      class SubTestField extends TestField {
        static displayName = 'SubTestField';

        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-subclass>
              SubClass
            </div>
          </template>
        };
      }

      class TestCardWithField extends CardDef {
        static displayName = 'TestCardWithField';
        @field specialField = contains(TestField);

        static fitted = class Fitted extends Component<typeof this> {
          setSubclass = () => {
            this.args.model.specialField = new SubTestField();
          };
          <template>
            <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
              Subclass From Outside</button>
            <div data-test-subclass>
              <@fields.specialField @format='fitted' />
            </div>
          </template>
        };
      }

      class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field cardWithSpecialField = linksToMany(TestCardWithField);

        static isolated = class Isolated extends Component<typeof TestCard> {
          <template>
            <@fields.cardWithSpecialField @format='fitted' />
          </template>
        };
      }

      loader.shimModule(`${testRealmURL}test-cards`, {
        TestCardWithField,
        TestCard,
      });
      let cardWithField1 = new TestCardWithField({});
      let cardWithField2 = new TestCardWithField({});
      await saveCard(
        cardWithField1,
        `${testRealmURL}Pet/cardWithField1`,
        loader,
      );
      await saveCard(
        cardWithField2,
        `${testRealmURL}Pet/cardWithField2`,
        loader,
      );
      let card = new TestCard({
        cardWithSpecialField: [cardWithField1, cardWithField2],
      });

      await renderCard(loader, card, 'isolated');
      assert
        .dom('[data-test-plural-view-item="0"] [data-test-baseclass]')
        .hasText('BaseClass');
      assert
        .dom('[data-test-plural-view-item="1"] [data-test-baseclass]')
        .hasText('BaseClass');
      await click('[data-test-plural-view-item="1"] [data-test-set-subclass]');
      assert
        .dom('[data-test-plural-view-item="0"] [data-test-subclass]')
        .hasText('BaseClass');
      assert
        .dom('[data-test-plural-view-item="1"] [data-test-subclass]')
        .hasText('SubClass');
    });

    test('re-renders a card with a polymorphic "containsMany" field when field instance changes', async function (assert) {
      class TestField extends FieldDef {
        static displayName = 'TestField';
        @field firstName = contains(StringField);

        static fitted = class TestFieldFitted extends Component<typeof this> {
          <template>
            <div data-test-baseclass>
              BaseClass
              <@fields.firstName />
            </div>
          </template>
        };
      }
      class SubTestField extends TestField {
        static displayName = 'SubTestField';

        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-subclass>
              SubClass
              <@fields.firstName />
            </div>
          </template>
        };
      }

      class SubTestField2 extends TestField {
        static displayName = 'SubTestField2';

        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div data-test-subclass2>
              SubClass2
              <@fields.firstName />
            </div>
          </template>
        };
      }
      class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field specialField = containsMany(TestField);

        static isolated = class Isolated extends Component<typeof TestCard> {
          setSubclass = () => {
            this.args.model.specialField = [
              new SubTestField({
                firstName: 'New Name',
              }),
              new SubTestField2({
                firstName: 'New Name 2',
              }),
            ];
          };
          <template>
            <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
              Subclass From Outside</button>
            <@fields.specialField @format='fitted' />
          </template>
        };
      }

      let card = new TestCard({
        specialField: [
          new TestField({
            firstName: 'Old Name',
          }),
        ],
      });

      await renderCard(loader, card, 'isolated');

      assert.dom('[data-test-baseclass]').hasText('BaseClass Old Name');
      assert.dom('[data-test-subclass]').doesNotExist();
      assert.dom('[data-test-subclass2]').doesNotExist();

      await click('[data-test-set-subclass]');

      assert.dom('[data-test-baseclass]').doesNotExist();
      assert.dom('[data-test-subclass]').hasText('SubClass New Name');
      assert.dom('[data-test-subclass2]').hasText('SubClass2 New Name 2');
    });

    test('rerender when a primitive field changes', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-test='firstName'><@fields.firstName /></div>
          </template>
        };
      }
      let child = new Person({ firstName: 'Arthur' });
      let root = await renderCard(loader, child, 'embedded');
      assert.dom(root.children[0]).containsText('Arthur');
      child.firstName = 'Quint';
      await waitUntil(() => cleanWhiteSpace(root.textContent!) === 'Quint');
    });

    test('Re-order linksToMany fields action will use the cached template that UI state', async function (assert) {
      class Fitted extends Component<typeof Pet1> {
        @tracked counter = 0;

        incrementCounter = () => {
          this.counter++;
        };
        <template>
          {{@model.name}}
          <button
            {{on 'click' this.incrementCounter}}
            data-test-increment-counter
          >Increment</button>
          <div data-test-counter>
            {{this.counter}}
          </div>
        </template>
      }

      class FittedPrime extends Component<typeof Pet1Prime> {
        @tracked counter = 0;

        incrementCounter = () => {
          this.counter++;
        };
        <template>
          <div data-test-different-template>Different Template</div>
          {{@model.name}}
          <button
            {{on 'click' this.incrementCounter}}
            data-test-increment-counter
          >Increment</button>
          <div data-test-counter>
            {{this.counter}}
          </div>
        </template>
      }
      class Pet1 extends CardDef {
        @field name = contains(StringField);
        static fitted = Fitted;
      }

      class Pet1Prime extends Pet1 {
        static fitted = FittedPrime;
      }

      class Person1 extends CardDef {
        @field pets = linksToMany(Pet1);
        static isolated = class Embedded extends Component<typeof this> {
          reorder = () => {
            if (
              this.args.model.pets &&
              this.args.model.pets[0] &&
              this.args.model.pets[1]
            ) {
              this.args.model.pets = [
                this.args.model.pets[1],
                this.args.model.pets[0],
              ];
            }
          };
          <template>
            <button
              {{on 'click' this.reorder}}
              data-test-reorder
            >Reorder</button>
            <@fields.pets @format='fitted' />
          </template>
        };
      }

      loader.shimModule(`${testRealmURL}test-cards`, {
        Pet1,
        Pet1Prime,
        Person1,
      });

      let pet1 = new Pet1({ name: 'jersey' });
      let pet2 = new Pet1Prime({ name: 'boboy' });
      await saveCard(pet1, `${testRealmURL}Pet/pet1`, loader);
      await saveCard(pet2, `${testRealmURL}Pet/pet2`, loader);
      let person = new Person1({
        name: 'Mango',
        pets: [pet1, pet2],
      });
      await renderCard(loader, person, 'isolated');
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-counter]`)
        .hasText('0');
      assert
        .dom(
          `[data-test-plural-view-item="0"][data-test-card="${testRealmURL}Pet/pet1"]`,
        )
        .containsText('jersey');

      await click(
        `[data-test-plural-view-item="0"] [data-test-increment-counter]`,
      );
      await click(
        `[data-test-plural-view-item="0"] [data-test-increment-counter]`,
      );
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-counter]`)
        .hasText('2');
      assert
        .dom(
          `[data-test-plural-view-item="0"][data-test-card="${testRealmURL}Pet/pet1"]`,
        )
        .containsText('jersey');
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-different-template]`)
        .doesNotExist();
      assert
        .dom(`[data-test-plural-view-item="1"] [data-test-counter]`)
        .hasText('0');
      assert
        .dom(
          `[data-test-plural-view-item="1"][data-test-card="${testRealmURL}Pet/pet2"]`,
        )
        .containsText('boboy');
      assert
        .dom(`[data-test-plural-view-item="1"] [data-test-different-template]`)
        .exists();
      await click('[data-test-reorder]'); //Reorder
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-counter]`)
        .hasText('0');
      assert
        .dom(
          `[data-test-plural-view-item="0"][data-test-card="${testRealmURL}Pet/pet2"]`,
        )
        .containsText('boboy');
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-counter]`)
        .hasText('0');
      assert
        .dom(`[data-test-plural-view-item="0"] [data-test-different-template]`)
        .exists();
      assert
        .dom(
          `[data-test-plural-view-item="1"][data-test-card="${testRealmURL}Pet/pet1"]`,
        )
        .containsText('jersey');
      assert
        .dom(`[data-test-plural-view-item="1"] [data-test-counter]`)
        .hasText('2');
      assert
        .dom(`[data-test-plural-view-item="1"] [data-test-different-template]`)
        .doesNotExist();
    });

    test('rerender when a containsMany field is fully replaced', async function (assert) {
      class Person extends CardDef {
        @field pets = containsMany(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.pets />
          </template>
        };
      }
      let person = new Person({ pets: ['Mango', 'Van Gogh'] });
      let root = await renderCard(loader, person, 'embedded');
      assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
      person.pets = ['Van Gogh', 'Mango', 'Peachy'];
      await waitUntil(
        () => cleanWhiteSpace(root.textContent!) === 'Van Gogh Mango Peachy',
      );
    });

    test('rerender when a containsMany field is mutated via assignment', async function (assert) {
      class Person extends CardDef {
        @field pets = containsMany(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.pets />
          </template>
        };
      }
      let person = new Person({ pets: ['Mango', 'Van Gogh'] });
      let root = await renderCard(loader, person, 'embedded');
      assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
      person.pets[1] = 'Peachy';
      await waitUntil(
        () => cleanWhiteSpace(root.textContent!) === 'Mango Peachy',
      );
    });

    test('rerender when a containsMany field changes size', async function (assert) {
      class Person extends CardDef {
        @field pets = containsMany(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.pets />
          </template>
        };
      }
      let person = new Person({ pets: ['Mango', 'Van Gogh'] });
      let root = await renderCard(loader, person, 'embedded');
      assert.strictEqual(cleanWhiteSpace(root.textContent!), 'Mango Van Gogh');
      person.pets.push('Peachy');
      await waitUntil(
        () => cleanWhiteSpace(root.textContent!) === 'Mango Van Gogh Peachy',
      );
      person.pets.shift();
      await waitUntil(
        () => cleanWhiteSpace(root.textContent!) === 'Van Gogh Peachy',
      );
    });

    test('supports an empty containsMany composite field', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.firstName />
          </template>
        };
      }

      class Family extends CardDef {
        @field people = containsMany(Person);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <@fields.people />
          </template>
        };
      }

      let abdelRahmans = new Family();
      assert.deepEqual(
        abdelRahmans.people,
        [],
        'empty containsMany field is initialized to an empty array',
      );
    });

    test('throws if contains many value is set with a non-array', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field languagesSpoken = containsMany(StringField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      assert.throws(
        () => new Person({ languagesSpoken: 'english' }),
        /Expected array for field value of field 'languagesSpoken'/,
      );
      try {
        new Person({ languagesSpoken: 'english' });
        throw new Error(`expected exception to be thrown`);
      } catch (err: any) {
        assert.ok(
          err.message.match(
            /Expected array for field value of field 'languagesSpoken'/,
          ),
          'expected error received',
        );
      }
    });

    test('render default edit template', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
      }

      class Post extends CardDef {
        @field title = contains(StringField);
        @field author = contains(Person);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Post, Person });

      let helloWorld = new Post({
        title: 'My Post',
        author: new Person({ firstName: 'Arthur' }),
      });

      await renderCard(loader, helloWorld, 'edit');
      assert.dom('[data-test-field="title"]').hasText('Title');
      assert
        .dom('[data-test-field="title"] .boxel-field__icon')
        .hasClass('icon-tabler-letter-case');
      assert.dom('[data-test-field="title"] input').hasValue('My Post');
      assert
        .dom(
          '[data-test-field="author"] [data-test-field="firstName"] [data-test-boxel-field-label]',
        )
        .hasText('First Name');
      assert
        .dom('[data-test-field="author"] [data-test-field="firstName"] input')
        .hasValue('Arthur');
      assert
        .dom('[data-test-field="author"] .boxel-field__icon')
        .hasClass('lucide-rectangle-ellipsis');

      await fillIn('[data-test-field="title"] input', 'New Post');
      await fillIn('[data-test-field="firstName"] input', 'Carl Stack');

      assert.dom('[data-test-field="title"] input').hasValue('New Post');
      assert
        .dom('[data-test-field="author"] [data-test-field="firstName"] input')
        .hasValue('Carl Stack');
    });

    test('renders field name for boolean default view values', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field isCool = contains(BooleanField);
        @field title = contains(StringField, {
          computeVia(this: Person) {
            return this.firstName;
          },
        });
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });

      let mango = new Person({ firstName: 'Mango', isCool: true });
      let root = await renderCard(loader, mango, 'isolated');
      assert.strictEqual(
        cleanWhiteSpace(root.textContent!),
        'First Name Mango Is Cool true Title Mango Description Thumbnail URL',
      );
    });

    test('renders boolean edit view', async function (assert) {
      class Person extends CardDef {
        @field firstName = contains(StringField);
        @field isCool = contains(BooleanField);
        @field isHuman = contains(BooleanField);
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Person });
      let mango = new Person({
        firstName: 'Mango',
        isCool: true,
        isHuman: false,
      });

      await renderCard(loader, mango, 'edit');

      assertRadioInput(assert, 'isCool', 'true', true);
      assertRadioInput(assert, 'isCool', 'false', false);
      assertRadioInput(assert, 'isHuman', 'true', false);
      assertRadioInput(assert, 'isHuman', 'false', true);

      await click(getRadioQuerySelector('isHuman', 'true'));

      // make sure radio group changes don't bleed into one another
      assertRadioInput(assert, 'isCool', 'true', true);
      assertRadioInput(assert, 'isCool', 'false', false);
      assertRadioInput(assert, 'isHuman', 'true', true);
      assertRadioInput(assert, 'isHuman', 'false', false);

      assert.strictEqual(
        mango.isCool,
        true,
        'the isCool field has the correct value',
      );
      assert.strictEqual(
        mango.isHuman,
        true,
        'the isHuman field has the correct value',
      );
    });

    test('can adopt a card', async function (assert) {
      let species = await testString('species');
      class Animal extends CardDef {
        @field species = contains(species);
      }
      let firstName = await testString('first-name');
      class Person extends Animal {
        @field firstName = contains(firstName);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.firstName /><@fields.species />
          </template>
        };
      }

      let hassan = new Person({ firstName: 'Hassan', species: 'Homo Sapiens' });

      await renderCard(loader, hassan, 'embedded');
      assert.dom('[data-test="first-name"]').containsText('Hassan');
      assert.dom('[data-test="species"]').containsText('Homo Sapiens');
    });

    test('can edit primitive and composite fields', async function (assert) {
      class Person extends FieldDef {
        @field firstName = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.firstName />
          </template>
        };
      }

      class Post extends CardDef {
        @field title = contains(StringField);
        @field reviews = contains(NumberField);
        @field author = contains(Person);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <fieldset>
              <label data-test-field='title'>Title <@fields.title /></label>
              <label data-test-field='reviews'>Reviews
                <@fields.reviews /></label>
              <label data-test-field='author'>Author <@fields.author /></label>
            </fieldset>

            <div data-test-output='title'>{{@model.title}}</div>
            <div data-test-output='reviews'>{{@model.reviews}}</div>
            <div
              data-test-output='author.firstName'
            >{{@model.author.firstName}}</div>
          </template>
        };
      }
      loader.shimModule(`${testRealmURL}test-cards`, { Post, Person });

      let helloWorld = new Post({
        title: 'First Post',
        reviews: 1,
        author: new Person({ firstName: 'Arthur' }),
      });

      await renderCard(loader, helloWorld, 'edit');
      assert.dom('[data-test-field="title"] input').hasValue('First Post');
      assert.dom('[data-test-field="reviews"] input').hasValue('1');
      assert.dom('[data-test-field="firstName"] input').hasValue('Arthur');
      assert
        .dom('[data-test-field="id"] input')
        .doesNotExist('contained card does not have an id input field');

      await fillIn('[data-test-field="title"] input', 'New Title');
      await fillIn('[data-test-field="reviews"] input', '5');
      await fillIn('[data-test-field="firstName"] input', 'Carl Stack');

      assert.dom('[data-test-output="title"]').hasText('New Title');
      assert.dom('[data-test-output="reviews"]').hasText('5');
      assert.dom('[data-test-output="author.firstName"]').hasText('Carl Stack');
    });

    test('component stability when editing containsMany primitive field', async function (assert) {
      let counter = 0;
      class TestString extends StringField {
        static edit = class Edit extends Component<typeof this> {
          private counter: number;
          constructor(
            owner: Owner,
            args: SignatureFor<typeof TestString>['Args'],
          ) {
            super(owner, args);
            this.counter = counter++;
          }
          <template>
            <BoxelInput
              data-counter={{this.counter}}
              type='text'
              @value={{@model}}
              @onInput={{@set}}
            />
          </template>
        };
      }

      class Person extends CardDef {
        @field languagesSpoken = containsMany(TestString);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.languagesSpoken />
          </template>
        };
      }

      let card = new Person({
        languagesSpoken: ['english', 'japanese'],
      });

      await renderCard(loader, card, 'edit');
      assert
        .dom('[data-test-item="0"] [data-counter]')
        .hasAttribute('data-counter', '0');
      assert
        .dom('[data-test-item="1"] [data-counter]')
        .hasAttribute('data-counter', '1');
      await fillIn('[data-test-item="0"] [data-counter]', 'italian');
      assert
        .dom('[data-test-item="0"] [data-counter]')
        .hasAttribute('data-counter', '0');
      assert
        .dom('[data-test-item="1"] [data-counter]')
        .hasAttribute('data-counter', '1');
    });

    test('add, remove and edit items in containsMany string field', async function (assert) {
      class Person extends CardDef {
        @field languagesSpoken = containsMany(StringField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.languagesSpoken />
            <ul data-test-output>
              {{#each @model.languagesSpoken as |language|}}
                <li>{{language}}</li>
              {{/each}}
            </ul>
          </template>
        };
      }

      let card = new Person();

      await renderCard(loader, card, 'edit');
      assert.dom('[data-test-item]').doesNotExist();

      // add english
      await click('[data-test-add-new]');
      await fillIn('[data-test-item="0"] input', 'english');
      assert.dom('[data-test-item]').exists({ count: 1 });
      assert.dom('[data-test-output]').hasText('english');

      // add japanese
      await click('[data-test-add-new]');
      await fillIn('[data-test-item="1"] input', 'japanese');
      assert.dom('[data-test-item]').exists({ count: 2 });
      assert.dom('[data-test-output]').hasText('english japanese');

      // change japanese to italian
      await fillIn('[data-test-item="1"] input', 'italian');
      assert.dom('[data-test-output]').hasText('english italian');

      // remove english
      await click('[data-test-remove="0"]');
      assert.dom('[data-test-item]').exists({ count: 1 });
      assert.dom('[data-test-output]').hasText('italian');
    });

    test('add, remove and edit items in containsMany composite field', async function (assert) {
      class Post extends FieldDef {
        @field title = contains(StringField);
      }

      class Blog extends CardDef {
        @field posts = containsMany(Post);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.posts />
            <ul data-test-output>
              {{#each @model.posts as |post|}}
                <li>{{post.title}}</li>
              {{/each}}
            </ul>
          </template>
        };
      }

      let card = new Blog();

      await renderCard(loader, card, 'edit');
      assert.dom('[data-test-item]').doesNotExist();

      await click('[data-test-add-new]');
      await fillIn('[data-test-field="title"] input', 'Tail Wagging Basics');
      assert.dom('[data-test-item]').exists({ count: 1 });
      assert.dom('[data-test-output]').hasText('Tail Wagging Basics');

      await click('[data-test-add-new]');
      assert.dom('[data-test-item]').exists({ count: 2 });

      await click('[data-test-remove="0"]');
      assert.dom('[data-test-item]').exists({ count: 1 });
      assert.dom('[data-test-output]').hasText('');

      await fillIn('[data-test-field="title"] input', 'Begging for Beginners');
      assert.dom('[data-test-item]').exists({ count: 1 });
      assert.dom('[data-test-output]').hasText('Begging for Beginners');
    });

    test('can edit and reset date and datetime fields', async function (assert) {
      class Person extends CardDef {
        @field date = contains(DateField);
        @field appointment = contains(DatetimeField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.date />
            <@fields.appointment />
            <div data-test-date-output>
              <@fields.date @format='embedded' />
            </div>
            <div data-test-datetime-output>
              <@fields.appointment @format='embedded' />
            </div>
          </template>
        };
      }
      const date = '2024-11-18';
      const appt = `2024-12-01T13:00`;
      await renderCard(loader, new Person(), 'edit');

      assert.dom('[data-test-date-field-editor]').hasNoValue();
      assert.dom('[data-test-date-output]').hasText('[no date]');
      assert.dom('[data-test-datetime-field-editor]').hasNoValue();
      assert.dom('[data-test-datetime-output]').hasText('[no date-time]');

      await fillIn('[data-test-date-field-editor]', date);
      assert.dom('[data-test-date-field-editor]').hasValue(date);
      assert.dom('[data-test-date-output]').hasText('Nov 18, 2024');

      await fillIn('[data-test-datetime-field-editor]', appt);
      assert.dom('[data-test-datetime-field-editor]').hasValue(appt);
      assert.dom('[data-test-datetime-output]').hasText('Dec 1, 2024, 1:00 PM');

      await fillIn('[data-test-date-field-editor]', '');
      assert.dom('[data-test-date-field-editor]').hasNoValue();
      assert.dom('[data-test-date-output]').hasText('[no date]');

      await fillIn('[data-test-datetime-field-editor]', '');
      assert.dom('[data-test-datetime-field-editor]').hasNoValue();
      assert.dom('[data-test-datetime-output]').hasText('[no date-time]');
    });

    test('add, remove and edit items in containsMany date and datetime fields', async function (assert) {
      function toDateString(date: Date | null) {
        return date instanceof Date ? format(date, 'yyyy-MM-dd') : null;
      }

      class Person extends CardDef {
        @field dates = containsMany(DateField);
        @field appointments = containsMany(DatetimeField);
        static edit = class Edit extends Component<typeof this> {
          <template>
            <@fields.dates />
            <ul data-test-output='dates'>
              {{#each @model.dates as |date|}}
                <li>{{toDateString date}}</li>
              {{/each}}
            </ul>

            <@fields.appointments />
            <ul data-test-output='appointments'>
              {{#each @model.appointments as |appointment|}}
                <li>{{toDateString appointment}}</li>
              {{/each}}
            </ul>
          </template>
        };
      }

      let card = new Person({
        dates: [p('2022-05-12'), p('2022-05-11'), p('2021-05-13')],
        appointments: [
          parseISO('2022-05-13T13:00'),
          parseISO('2021-05-30T10:45'),
        ],
      });

      await renderCard(loader, card, 'edit');
      assert
        .dom('[data-test-contains-many="dates"] [data-test-item]')
        .exists({ count: 3 });
      assert
        .dom('[data-test-contains-many="dates"] [data-test-item="0"] input')
        .hasValue('2022-05-12');
      assert
        .dom('[data-test-output="dates"]')
        .hasText('2022-05-12 2022-05-11 2021-05-13');

      await click('[data-test-contains-many="dates"] [data-test-add-new]');
      await fillIn(
        '[data-test-contains-many="dates"] [data-test-item="3"] input',
        '2022-06-01',
      );
      assert
        .dom('[data-test-contains-many="dates"] [data-test-item]')
        .exists({ count: 4 });
      assert
        .dom('[data-test-output="dates"]')
        .hasText('2022-05-12 2022-05-11 2021-05-13 2022-06-01');

      await click('[data-test-contains-many="dates"] [data-test-remove="1"]');
      await click('[data-test-contains-many="dates"] [data-test-remove="2"]'); // note: after removing index=1, the previous indexes of the following items have shifted by 1
      assert
        .dom('[data-test-contains-many="dates"] [data-test-item]')
        .exists({ count: 2 });
      assert.dom('[data-test-output="dates"]').hasText('2022-05-12 2021-05-13');

      await fillIn(
        '[data-test-contains-many="dates"] [data-test-item="1"] input',
        '2022-04-10',
      );
      assert.dom('[data-test-output]').hasText('2022-05-12 2022-04-10');

      assert
        .dom('[data-test-contains-many="appointments"] [data-test-item]')
        .exists({ count: 2 });
      assert.strictEqual(
        getDateFromInput(
          '[data-test-contains-many="appointments"] [data-test-item="0"] input',
        )?.getTime(),
        parseISO('2022-05-13T13:00').getTime(),
      );
      assert
        .dom('[data-test-output="appointments"]')
        .hasText('2022-05-13 2021-05-30');

      await fillIn(
        '[data-test-contains-many="appointments"] [data-test-item="0"] input',
        '2022-05-01T11:01',
      );
      assert
        .dom('[data-test-output="appointments"]')
        .hasText('2022-05-01 2021-05-30');
    });

    test('nested linksToMany field items in a compound field render in atom layout', async function (assert) {
      class Country extends CardDef {
        @field countryName = contains(StringField);
        @field flag = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Country) {
            return `${this.flag} ${this.countryName}`;
          },
        });
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.countryName />
          </template>
        };
      }

      class Traveler extends FieldDef {
        @field travelerName = contains(StringField);
        @field countriesVisited = linksToMany(Country);
      }

      class ContactCard extends CardDef {
        @field name = contains(StringField);
        @field traveler = contains(Traveler);
        @field traveler2 = contains(Traveler);
        @field favoritePlaces = linksToMany(Country);
      }

      loader.shimModule(`${testRealmURL}test-cards`, { Country, ContactCard });

      let us = new Country({ countryName: 'United States', flag: '🇺🇸' });
      let canada = new Country({ countryName: 'Canada', flag: '🇨🇦' });
      let brazil = new Country({ countryName: 'Brazil', flag: '🇧🇷' });

      await saveCard(us, `${testRealmURL}Country/us`, loader);
      await saveCard(canada, `${testRealmURL}Country/canada`, loader);
      await saveCard(brazil, `${testRealmURL}Country/brazil`, loader);

      let card = new ContactCard({
        name: 'Marcelius Wilde',
        traveler: new Traveler({
          travelerName: 'Mama Leone',
          countriesVisited: [us, canada, brazil],
        }),
        traveler2: new Traveler({ travelerName: 'Papa Leone' }),
        favoritePlaces: [brazil, us, canada],
      });

      await renderCard(loader, card, 'edit');
      await percySnapshot(assert);

      assert.dom('[data-test-field="name"] input').hasValue('Marcelius Wilde');
      assert
        .dom(
          '[data-test-field="traveler"] [data-test-field="travelerName"] input',
        )
        .hasValue('Mama Leone');

      assert
        .dom(
          '[data-test-links-to-many="countriesVisited"] [data-test-pills] [data-test-pill-item] [data-test-card-format="atom"]',
        )
        .exists('atom layout is rendered');
      assert
        .dom(
          '[data-test-links-to-many="countriesVisited"] [data-test-pills] [data-test-pill-item] [data-test-card-format="atom"]',
        )
        .hasClass('atom-format', 'field has correct class');

      assert
        .dom('[data-test-field="countriesVisited"] [data-test-pill-item]')
        .exists({ count: 3 });
      assert.dom('[data-test-pill-item="0"]').hasText('🇺🇸 United States');
      assert.dom('[data-test-pill-item="1"]').hasText('🇨🇦 Canada');

      assert
        .dom(
          '[data-test-field="traveler2"] [data-test-field="travelerName"] input',
        )
        .hasValue('Papa Leone');

      assert
        .dom(
          '[data-test-field="favoritePlaces"] [data-test-links-to-many="favoritePlaces"]',
        )
        .exists('top level linksToMany field is in edit format');
    });

    test('can get a queryable value for a field', async function (assert) {
      class TestField extends FieldDef {
        static [primitive]: TestShape;
        static [queryableValue](value: TestShape) {
          return value.firstName;
        }
      }

      assert.strictEqual(
        getQueryableValue(TestField, { firstName: 'Van Gogh', age: 6 }),
        'Van Gogh',
        'The queryable value from user supplied data is correct (string)',
      );
      assert.strictEqual(
        getQueryableValue(TestField, { firstName: 1, age: 6 }),
        1,
        'The queryable value from user supplied data is correct (number)',
      );
      assert.strictEqual(
        getQueryableValue(TestField, { firstName: true, age: 6 }),
        true,
        'The queryable value from user supplied data is correct (boolean)',
      );
      assert.strictEqual(
        getQueryableValue(TestField, { firstName: undefined, age: 6 }),
        undefined,
        'The queryable value from user supplied data is correct (undefined)',
      );
      assert.strictEqual(
        getQueryableValue(TestField, { firstName: null, age: 6 }),
        null,
        'The queryable value from user supplied data is correct (null)',
      );
      assert.deepEqual(
        getQueryableValue(TestField, { firstName: ['a'], age: 6 }),
        ['a'],
        'The queryable value from user supplied data is correct (string[])',
      );
      assert.deepEqual(
        getQueryableValue(TestField, { firstName: [1], age: 6 }),
        [1],
        'The queryable value from user supplied data is correct (number[])',
      );
      assert.deepEqual(
        getQueryableValue(TestField, { firstName: [true], age: 6 }),
        [true],
        'The queryable value from user supplied data is correct (boolean[])',
      );
      assert.deepEqual(
        getQueryableValue(TestField, { firstName: [null], age: 6 }),
        [null],
        'The queryable value from user supplied data is correct (null[])',
      );
      assert.deepEqual(
        getQueryableValue(TestField, { firstName: [undefined], age: 6 }),
        [undefined],
        'The queryable value from user supplied data is correct (undefined[])',
      );
    });

    test('queryable value for a field defaults to current field value when not specified', async function (assert) {
      class StringField extends FieldDef {
        static [primitive]: string;
      }

      assert.strictEqual(
        getQueryableValue(StringField, 'Van Gogh'),
        'Van Gogh',
        'The queryable value from user supplied data is correct',
      );
    });

    test('throws when card returns non-scalar queryable value from "queryableValue" function', async function (assert) {
      class TestField1 extends FieldDef {
        static [primitive]: TestShape;
        static [queryableValue](_value: TestShape) {
          return { notAScalar: true };
        }
      }
      assert.throws(
        () =>
          getQueryableValue(TestField1, {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          }),
        /expected queryableValue for field type TestField1 to be scalar/,
      );

      class TestField2 extends FieldDef {
        static [primitive]: TestShape;
        static [queryableValue](_value: TestShape) {
          return [{ notAScalar: true }];
        }
      }
      assert.throws(
        () =>
          getQueryableValue(TestField2, {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          }),
        /expected queryableValue for field type TestField2 to be scalar/,
      );
    });

    test('throws when card returns non-scalar queryable value when there is no "queryableValue" function', async function (assert) {
      class TestField extends FieldDef {
        static [primitive]: TestShape;
      }
      assert.throws(
        () =>
          getQueryableValue(TestField, {
            firstName: 'Mango',
            lastName: 'Abdel-Rahman',
          }),
        /expected queryableValue for field type TestField to be scalar/,
      );
    });

    test('Provide field descriptions', async function (assert) {
      class Pet extends CardDef {
        @field firstName = contains(StringField, {
          description: 'The name of the pet',
        });
      }

      class Guest extends CardDef {
        @field name = contains(StringField, {
          description: 'The name of the guest',
        });
        @field additionalGuestCount = contains(NumberField, {
          description: 'The number of additional guests coming in this party',
        });
      }

      class Hometown extends FieldDef {
        @field city = contains(StringField, {
          description: 'The city where the person was born',
        });
        @field country = contains(StringField, {
          description: 'The country where the person was born',
        });
      }

      class Person extends CardDef {
        @field hometown = contains(Hometown, {
          description: 'The place where the person was born',
        });
        @field languagesSpoken = containsMany(StringField, {
          description: 'The languages the person speaks',
        });
        @field pet = linksTo(Pet, {
          description: "The person's pet",
        });
        @field guests = linksToMany(Guest, {
          description: 'The people the person has invited over',
        });
      }

      assert.strictEqual(
        'The place where the person was born',
        getFieldDescription(Person, 'hometown'),
      );
    });

    test('ReadOnlyField wont display input field', async function (assert) {
      class Person extends CardDef {
        @field readOnlyField = contains(ReadOnlyField);
        @field name = contains(StringField);

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            {{@model.readOnlyField}}
            {{@model.name}}
          </template>
        };
      }

      let person = new Person({ readOnlyField: 'Test', name: 'Mango' });
      await renderCard(loader, person, 'edit');
      assert.dom('[data-test-field="name"] input').exists({ count: 1 });
      assert
        .dom('[data-test-field="readOnlyField"] input')
        .exists({ count: 0 });
    });
  });
});

async function testString(label: string) {
  return class TestString extends FieldDef {
    static [primitive]: string;
    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <em data-test={{label}}>{{@model}}</em>
      </template>
    };
  };
}

function getDateFromInput(selector: string): Date | undefined {
  let input = document.querySelector(selector) as HTMLInputElement | undefined;
  if (input?.value) {
    return parseISO(input.value);
  }
  return undefined;
}

function base64ToBlob(base64: string, mimeType: string) {
  // Decode Base64 to binary
  let binaryString = atob(base64);

  // Convert binary to ArrayBuffer
  let arrayBuffer = new ArrayBuffer(binaryString.length);
  let uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  // Create Blob from ArrayBuffer
  let blob = new Blob([arrayBuffer], { type: mimeType });
  return blob;
}

interface TestShape {
  firstName: string;
  age: number;
}

let getRadioQuerySelector = (fieldName: string, optionVal: string) => {
  return `[data-test-radio-group="${fieldName}"]  [data-test-boxel-radio-option-id="${optionVal}"] input[type="radio"]`;
};

let assertRadioInput = (
  assert: Assert,
  fieldName: string,
  optionVal: string,
  checked: boolean,
) => {
  let querySelector = getRadioQuerySelector(fieldName, optionVal);
  if (checked === true) {
    assert
      .dom(querySelector)
      .isChecked('the isCool true radio has correct state');
  } else {
    assert
      .dom(querySelector)
      .isNotChecked('the isCool true radio has correct state');
  }
};

function fittedViewDriver() {
  class FitedViewDriver extends CardDef {
    @field card = linksTo(CardDef);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div class='group'>
          <div class='header'>Aspect ratio &lt;= 1.0</div>
          <div class='item'>
            <div class='desc'>AR 1.0: 226px x 226px</div>
            <div
              data-test-driver
              class='card'
              style='width: 226px; height: 226px'
            >
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.73: 164px x 224px</div>
            <div class='card' style='width: 164px; height: 224px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.91: 164px x 180px</div>
            <div class='card' style='width: 164px; height: 180px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.95: 140px x 148px</div>
            <div class='card' style='width: 140px; height: 148px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.94: 120px x 128px</div>
            <div class='card' style='width: 120px; height: 128px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.85: 100px x 118px</div>
            <div class='card' style='width: 100px; height: 118px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 0.2: 100px x 500px</div>
            <div class='card' style='width: 100px; height: 500px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
        </div>

        <div class='group'>
          <div class='header'>1.0 &lt; Aspect ratio &lt; 2.0</div>
          <div class='item'>
            <div class='desc'>AR 1.9: 151px x 78px</div>
            <div class='card' style='width: 151px; height: 78px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 1.99: 300px x 151px</div>
            <div class='card' style='width: 300px; height: 151px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 1.66: 300px x 180px</div>
            <div class='card' style='width: 300px; height: 180px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
        </div>

        <div class='group'>
          <div class='header'>Aspect ratio &gt; 2.0</div>
          <div class='item'>
            <div class='desc'>AR 3.4: 100px x 29px</div>
            <div class='card' style='width: 100px; height: 29px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 2.6: 150px x 58px</div>
            <div class='card' style='width: 150px; height: 58px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 3.9: 226px x 58px</div>
            <div class='card' style='width: 226px; height: 58px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
          <div class='item'>
            <div class='desc'>AR 2.6: 300px x 115px</div>
            <div class='card' style='width: 300px; height: 115px'>
              <@fields.card @format='fitted' />
            </div>
          </div>
        </div>

        <style scoped>
          .card {
            /* this is how a border would appear around a card.
             note that a card is not supposed to draw its own border
          */
            box-shadow: 0 0 0 1px var(--boxel-light-500);
            overflow: hidden;
            border-radius: var(--boxel-border-radius);
          }
          .group {
            margin: 2rem;
          }
          .header {
            font: 600 var(--boxel-font-lg);
          }
          .item {
            padding-bottom: 1rem;
          }
          .desc {
            padding-top: 1rem;
          }
        </style>
      </template>
    };
  }

  return FitedViewDriver;
}
