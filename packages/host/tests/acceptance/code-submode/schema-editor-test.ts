import {
  click,
  waitFor,
  fillIn,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, Deferred } from '@cardstack/runtime-common';

import MonacoService from '@cardstack/host/services/monaco-service';

import {
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  setupOnSave,
  getMonacoContent,
  visitOperatorMode,
  waitForCodeEditor,
  setupUserSubscription,
  type TestContextWithSave,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

const indexCardSource = `
  import { CardDef, Component } from "https://cardstack.com/base/card-api";

  export class Index extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-index-card>
          Hello, world!
        </div>
      </template>
    };
  }
`;

const personCardSource = `
  import { contains, containsMany, field, linksToMany, CardDef, Component, StringField } from "https://cardstack.com/base/card-api";
  import { Friend } from './friend';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field friends = linksToMany(Friend);
    @field address = containsMany(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
          <p>Address List: <@fields.address /></p>
          <p>Friends: <@fields.friends /></p>
        </div>
        <style scoped>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

const employeeCardSource = `
  import {
    contains,
    field,
    Component,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { Person } from './person';

  export class Employee extends Person {
    static displayName = 'Employee';
    @field employeeId = contains(StringField);
    @field department = contains(StringField);

    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <@fields.firstName /> <@fields.lastName />

        Department: <@fields.department />
      </template>
    };
  }
`;

const inThisFileSource = `
  import {
    contains,
    field,
    CardDef,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export const exportedVar = 'exported var';

  const localVar = 'local var';

  class LocalClass {}
  export class ExportedClass {}

  export class ExportedClassInheritLocalClass extends LocalClass {}

  function localFunction() {}
  export function exportedFunction() {}

  export { LocalClass as AClassWithExportName };

  class LocalCard extends CardDef {
    static displayName = 'local card';
  }

  export class ExportedCard extends CardDef {
    static displayName = 'exported card';
    @field someString = contains(StringField);
  }

  export class ExportedCardInheritLocalCard extends LocalCard {
    static displayName = 'exported card extends local card';
  }

  class LocalField extends FieldDef {
    static displayName = 'local field';
  }
  export class ExportedField extends FieldDef {
    static displayName = 'exported field';
    @field someString = contains(StringField);
  }

  export class ExportedFieldInheritLocalField extends LocalField {
    static displayName = 'exported field extends local field';
  }

  export default class DefaultClass {}
`;

const friendCardSource = `
  import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Friend extends CardDef {
    static displayName = 'Friend';
    @field name = contains(StringField);
    @field friend = linksTo(() => Friend);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return name;
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
        </div>
        <style scoped>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }
`;

const ambiguousDisplayNamesCardSource = `
  import {
    CardDef,
    field,
    linksTo,
    Component,
  } from 'https://cardstack.com/base/card-api';

  export class Editor extends CardDef {
    static displayName = 'Author Bio';
  }

  export class Author extends CardDef {
    static displayName = 'Author Bio';
  }

  export class BlogPost extends CardDef {
    static displayName = 'Blog Post';
    @field authorBio = linksTo(Author);
    @field editorBio = linksTo(Editor);
  }
`;

let matrixRoomId: string;
module('Acceptance | code submode | schema editor tests', function (hooks) {
  let monacoService: MonacoService;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.gts': indexCardSource,
        'empty.gts': ' ',
        'pet-person.gts': personCardSource,
        'person.gts': personCardSource,
        'friend.gts': friendCardSource,
        'employee.gts': employeeCardSource,
        'in-this-file.gts': inThisFileSource,
        'ambiguous-display-names.gts': ambiguousDisplayNamesCardSource,
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Person',
              description: 'Spec',
              specType: 'card',
              ref: {
                module: `./person`,
                name: 'Person',
              },
            },
            meta: {
              adoptsFrom: {
                module: `${baseRealm.url}spec`,
                name: 'Spec',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: './index',
                name: 'Index',
              },
            },
          },
        },
        'not-json.json': 'I am not JSON.',
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
        'z00.json': '{}',
        'z01.json': '{}',
        'z02.json': '{}',
        'z03.json': '{}',
        'z04.json': '{}',
        'z05.json': '{}',
        'z06.json': '{}',
        'z07.json': '{}',
        'z08.json': '{}',
        'z09.json': '{}',
        'z10.json': '{}',
        'z11.json': '{}',
        'z12.json': '{}',
        'z13.json': '{}',
        'z14.json': '{}',
        'z15.json': '{}',
        'z16.json': '{}',
        'z17.json': '{}',
        'z18.json': '{}',
        'z19.json': '{}',
        'zzz/zzz/file.json': '{}',
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });

    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;
  });

  test('schema editor lists the inheritance chain', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    assert.dom('[data-test-card-schema]').exists({ count: 3 });
    assert.dom('[data-test-total-fields]').containsText('8 Fields');

    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 5 Fields');
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="lastName"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="title"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="title"] [data-test-field-types]`,
      )
      .hasText('Override, Computed');
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="title"] [data-test-computed-icon]`,
      )
      .exists();

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="friends"] [data-test-card-display-name="Friend"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="friends"] [data-test-field-types]`,
      )
      .hasText('Link, Collection');
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="friends"] [data-test-linked-icon]`,
      )
      .exists();

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="address"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="address"] [data-test-field-types]`,
      )
      .hasText('Collection');

    assert
      .dom('[data-test-card-schema="Card"] [data-test-total-fields]')
      .containsText('+ 3 Fields');
    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="title"] [data-test-overridden-field-link]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="title"] [data-test-field-types]`,
      )
      .hasText('Overridden');

    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="description"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="thumbnailURL"] [data-test-card-display-name="String"]`,
      )
      .exists();

    assert
      .dom('[data-test-card-schema="Base"] [data-test-total-fields]')
      .containsText('No Fields');
    assert.dom(`[data-test-card-schema="Base"]`).exists();

    // Check that realm icons in the schema editor are correct (card and its fields)

    let realm1IconUrl = 'https://i.postimg.cc/L8yXRvws/icon.png';
    let realm2IconUrl = 'https://boxel-images.boxel.ai/icons/cardstack.png';

    await waitFor(
      // using non test selectors to disambiguate what we are waiting for, as
      // without these the selectors are matching DOM that is not being tested
      '[data-test-card-schema="Person"] .pill .icon [data-test-realm-icon-url]',
    );
    assert
      .dom(`[data-test-card-schema="Person"] [data-test-realm-icon-url]`)
      .hasAttribute('data-test-realm-icon-url', realm1IconUrl);

    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-realm-icon-url]',
    );

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-realm-icon-url]`,
      )
      .hasAttribute('data-test-realm-icon-url', realm2IconUrl);

    await waitFor(
      // using non test selectors to disambiguate what we are waiting for, as
      // without these the selectors are matching DOM that is not being tested
      '[data-test-card-schema="Card"] .pill .icon [data-test-realm-icon-url]',
    );
    assert
      .dom(`[data-test-card-schema="Card"] [data-test-realm-icon-url]`)
      .hasAttribute('data-test-realm-icon-url', realm2IconUrl);
  });

  test('when selecting card definition from a card instance in code mode, the right hand panel changes from card preview to schema mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Person/1.json`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-code-mode-card-preview-body]');
    assert
      .dom('[data-test-code-mode-card-preview-body]')
      .containsText('Hassan');
    await waitFor(`button[data-test-clickable-definition-container`);
    await click(`button[data-test-clickable-definition-container`);
    await waitFor('[data-test-card-schema]');
    assert.dom('[data-test-card-schema]').exists({ count: 3 });
    assert.dom('[data-test-total-fields]').containsText('8 Fields');
  });

  test('shows displayName of CardResource when field refers to itself', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}friend.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    assert
      .dom('[data-test-card-schema-navigational-button]')
      .containsText('Friend');
    assert
      .dom(
        `[data-test-card-schema="Friend"] [data-test-field-name="name"] [data-test-card-display-name="String"]`,
      )
      .exists();
  });

  test('card type and fields are clickable and navigate to the correct file', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    });

    await waitForCodeEditor();
    await waitFor(
      '[data-test-card-schema="Employee"] [data-test-card-schema-navigational-button]',
    );

    // Click on card definition button
    await click(
      '[data-test-card-schema="Person"] [data-test-card-schema-navigational-button]',
    );

    await waitFor('[data-test-current-module-name="person.gts"]');

    assert.dom('[data-test-current-module-name]').hasText('person.gts');

    // Go back so that we can test clicking on a field definition button
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    });

    await waitFor(
      '[data-test-card-schema="Employee"] [data-test-field-name="department"] [data-test-card-display-name="String"]',
    );

    await click(
      '[data-test-card-schema="Employee"] [data-test-field-name="department"] [data-test-card-display-name="String"]',
    );

    await waitFor('[data-test-current-module-name="card-api.gts"]');
    assert.dom('[data-test-current-module-name]').hasText('card-api.gts');
  });

  test('adding a field from schema editor - whole flow test', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-add-field-button]');
    assert.dom('[data-test-add-field-button]').exists({ count: 1 }); // Only top level card has an option to add a field

    await click('[data-test-add-field-button]');
    assert.dom('[data-test-save-field-button]').hasAttribute('disabled');

    await click('[data-test-cancel-adding-field-button]');
    assert.dom('[data-test-edit-field-modal]').doesNotExist();

    await click('[data-test-add-field-button]');
    assert.dom('[data-test-edit-field-modal]').exists();

    await waitFor('[data-test-selected-type-display-name]');
    assert.dom('[data-test-selected-type-display-name]').hasText('String'); // String field selected by default

    await click('[data-test-choose-card-button]');
    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    // There is some additional thing we are waiting on here, probably the
    // card to load in the card resource, but I'm not too sure so using waitUntil instead
    await waitUntil(() =>
      document
        .querySelector('[data-test-selected-type-display-name]')
        ?.textContent?.includes('BigInteger'),
    );

    await assert
      .dom('[data-test-selected-type] [data-test-realm-icon-url]')
      .exists();
    await assert
      .dom('[data-test-selected-type-display-name]')
      .hasText('BigInteger');

    await click('[data-test-choose-card-button]');

    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/date-field"]',
    );

    await click(
      '[data-test-select="https://cardstack.com/base/fields/date-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    // There is some additional thing we are waiting on here, probably the
    // card to load in the card resource, but I'm not too sure so using waitUntil instead
    await waitUntil(() =>
      document
        .querySelector('[data-test-selected-type-display-name]')
        ?.textContent?.includes('Date'),
    );

    await assert.dom('[data-test-selected-type-display-name]').hasText('Date');
    assert.dom('[data-test-save-field-button]').hasAttribute('disabled');

    await fillIn('[data-test-field-name-input]', ' birth date');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Field names cannot contain spaces');
    await fillIn('[data-test-field-name-input]', 'Birth');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Field names must start with a lowercase letter');
    await fillIn('[data-test-field-name-input]', 'birth-date');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText(
        'Field names can only contain letters, numbers, and underscores',
      );

    await fillIn('[data-test-field-name-input]', 'firstName');
    await click('[data-test-save-field-button]');
    await waitFor('[data-test-boxel-input-error-message]');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('the field "firstName" already exists');
    assert.dom('[data-test-save-field-button]').hasAttribute('disabled');

    await fillIn('[data-test-field-name-input]', 'birthdate');

    assert
      .dom('[data-test-save-field-button]')
      .doesNotHaveAttribute('disabled');

    await click('[data-test-save-field-button]');
    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="birthdate"] [data-test-card-display-name="Date"]',
    );

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="birthdate"] [data-test-card-display-name="Date"]`,
      )
      .exists();

    assert.ok(getMonacoContent().includes('birthdate = contains(DateField)'));
  });

  test('adding a field from schema editor - cardinality test', async function (assert) {
    let waitForOpts = { timeout: 2000 }; // Helps mitigating flaky tests since Writing to a file + reflecting that in the UI can be a bit slow
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-add-field-button]');

    // Field is a card descending from FieldDef
    await click('[data-test-add-field-button]');
    await click('[data-test-choose-card-button]');
    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    await fillIn('[data-test-field-name-input]', 'luckyNumbers');
    await click('[data-test-boxel-radio-option-id="many"]');
    await waitFor('.card-chooser-area [data-test-selected-type-display-name]');
    assert
      .dom('.card-chooser-area [data-test-selected-type-display-name]')
      .containsText('BigInteger');
    await click('[data-test-save-field-button]');

    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="luckyNumbers"] [data-test-card-display-name="BigInteger"]',
      waitForOpts,
    );
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="luckyNumbers"] [data-test-field-types]`,
      )
      .hasText('Collection');

    assert.ok(
      getMonacoContent().includes(
        'luckyNumbers = containsMany(BigIntegerField)',
      ),
      "code editor contains line 'luckyNumbers = containsMany(BigIntegerField)'",
    );

    // Field is a definition descending from FieldDef (cardinality: one)
    await waitFor('[data-test-add-field-button]');
    await click('[data-test-add-field-button]');
    await click('[data-test-choose-card-button]');
    await waitFor('[data-test-select="http://test-realm/test/person-entry"]');
    await click('[data-test-select="http://test-realm/test/person-entry"]');
    await click('[data-test-card-catalog-go-button]');
    await fillIn('[data-test-field-name-input]', 'favPerson');
    await click('[data-test-boxel-radio-option-id="one"]');

    await click('[data-test-save-field-button]');
    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="favPerson"] [data-test-card-display-name="Person"]',
      waitForOpts,
    );
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="favPerson"] [data-test-field-types]`,
      )
      .hasText('Link');

    assert.ok(
      getMonacoContent().includes('favPerson = linksTo(() => Person);'),
      "code editor contains line 'favPerson = linksTo(() => Person);'",
    );

    // Field is a definition descending from FieldDef (cardinality: many)
    await waitFor('[data-test-add-field-button]');
    await click('[data-test-add-field-button]');
    await click('[data-test-choose-card-button]');
    await waitFor(
      '[data-test-select="http://test-realm/test/person-entry"]',
      waitForOpts,
    );
    await click('[data-test-select="http://test-realm/test/person-entry"]');
    await click('[data-test-card-catalog-go-button]');
    await fillIn('[data-test-field-name-input]', 'favPeople');
    await click('[data-test-boxel-radio-option-id="many"]');
    await click('[data-test-save-field-button]');
    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="favPeople"] [data-test-card-display-name="Person"]',
      waitForOpts,
    );
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="favPeople"] [data-test-field-types]`,
      )
      .hasText('Link, Collection');
    assert.ok(
      getMonacoContent().includes('favPeople = linksToMany(() => Person);'),
    );
  });

  test<TestContextWithSave>('deleting a field from schema editor', async function (assert) {
    assert.expect(9);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    await click(
      '[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-schema-editor-field-contextual-button]',
    );

    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 5 Fields');

    assert.true(
      getMonacoContent().includes('firstName = contains(StringField)'),
    );

    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.false(
        content.includes('firstName = contains(StringField)'),
        'firstName field removed from saved module',
      );
    });
    assert.dom('[data-test-remove-field-modal]').doesNotExist();
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
    await click('[data-test-boxel-menu-item-text="Remove Field"]');

    assert.dom('[data-test-remove-field-modal]').exists();

    // Test closing the modal works (cancel removing a field)
    await click('[data-test-cancel-remove-field-button]');
    assert.dom('[data-test-remove-field-modal]').doesNotExist();

    // Open the modal again
    await click(
      '[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-schema-editor-field-contextual-button]',
    );
    await click('[data-test-boxel-menu-item-text="Remove Field"]');

    await click('[data-test-remove-field-button]');
    await waitFor('[data-test-card-schema]');

    await waitUntil(() => {
      return document
        .querySelector(
          '[data-test-card-schema="Person"] [data-test-total-fields]',
        )
        ?.textContent?.includes('4');
    });
    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 4 Fields'); // One field less
    assert
      .dom(
        '[data-test-card-schema="Person"] [data-test-field-name="firstName"]',
      )
      .doesNotExist();
  });

  test<TestContextWithSave>('editing a field from schema editor', async function (assert) {
    assert.expect(2);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    // Let's edit a "linksToMany" Friend field, named friends
    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="friends"] [data-test-field-types]`,
      )
      .hasText('Link, Collection');

    await click(
      '[data-test-card-schema="Person"] [data-test-field-name="friends"] [data-test-schema-editor-field-contextual-button]',
    );
    await click('[data-test-boxel-menu-item-text="Edit Field Settings"]');

    // Edit the field to be a "contains" BigInteger field, named friendCount
    await click('[data-test-choose-card-button]');
    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    await fillIn('[data-test-field-name-input]', 'friendCount');
    await click('[data-test-boxel-radio-option-id="one"]');

    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.ok(content.includes('friendCount = contains(BigIntegerField)'));
    });
    await click('[data-test-save-field-button]');

    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="friendCount"] [data-test-card-display-name="BigInteger"]',
    );
  });

  test<TestContextWithSave>('adding a "default" field type from the schema editor', async function (assert) {
    assert.expect(1);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');
    await click('[data-test-add-field-button]');

    await fillIn('[data-test-field-name-input]', 'middleName');
    let deferred = new Deferred<void>();
    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.codeEqual(
        content,
        `
  import { contains, containsMany, field, linksToMany, CardDef, Component, StringField } from "https://cardstack.com/base/card-api";
  import { Friend } from './friend';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field friends = linksToMany(Friend);
    @field address = containsMany(StringField);
    @field middleName = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
          <p>Address List: <@fields.address /></p>
          <p>Friends: <@fields.friends /></p>
        </div>
        <style scoped>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }`,
      );
      deferred.fulfill();
    });
    await click('[data-test-save-field-button]');
    await deferred.promise;
  });

  test<TestContextWithSave>('renaming a field from the schema editor', async function (assert) {
    assert.expect(1);
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    await click(
      '[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-schema-editor-field-contextual-button]',
    );
    await click('[data-test-boxel-menu-item-text="Edit Field Settings"]');

    await fillIn('[data-test-field-name-input]', 'givenName');

    let deferred = new Deferred<void>();
    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error('expected string save data');
      }
      assert.codeEqual(
        content,
        `
  import { contains, containsMany, field, linksToMany, CardDef, Component, StringField } from "https://cardstack.com/base/card-api";
  import { Friend } from './friend';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field givenName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field friends = linksToMany(Friend);
    @field address = containsMany(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
          <p>Address List: <@fields.address /></p>
          <p>Friends: <@fields.friends /></p>
        </div>
        <style scoped>
          div {
            color: green;
            content: '';
          }
        </style>
      </template>
    };
  }`,
      );
      deferred.fulfill();
    });
    await click('[data-test-save-field-button]');
    await deferred.promise;
  });

  test('tooltip is displayed when hovering over a pill', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}ambiguous-display-names.gts`,
    });

    await waitForCodeEditor();
    await waitFor(`[data-test-boxel-selector-item-text="BlogPost"]`);
    await click(`[data-test-boxel-selector-item-text="BlogPost"]`);

    // hover over card type pill
    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-card-schema-navigational-button]',
    );
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-card-schema-navigational-button]',
      'mouseenter',
    );

    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('http://test-realm/test/ambiguous-display-names (BlogPost)');
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-card-schema-navigational-button]',
      'mouseleave',
    );
    // hover over card type pill (Base)
    await waitFor(
      '[data-test-card-schema="Base"] [data-test-card-schema-navigational-button]',
    );
    await triggerEvent(
      '[data-test-card-schema="Base"] [data-test-card-schema-navigational-button]',
      'mouseenter',
    );
    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('https://cardstack.com/base/card-api (BaseDef)');

    await triggerEvent(
      '[data-test-card-schema="Base"] [data-test-card-schema-navigational-button]',
      'mouseleave',
    );

    // hover over authorBio and editorBio -- tooltip should be different altho they have same display names
    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="authorBio"] [data-test-card-display-name="Author Bio"]',
    );
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="authorBio"] [data-test-card-display-name="Author Bio"]',
      'mouseenter',
    );
    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('http://test-realm/test/ambiguous-display-names (Author)'); //shows Author
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="authorBio"] [data-test-card-display-name="Author Bio"]',
      'mouseleave',
    );

    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-card-display-name="Author Bio"]',
    );
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-card-display-name="Author Bio"]',
      'mouseenter',
    );
    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('http://test-realm/test/ambiguous-display-names (Editor)'); //shows Editor
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-card-display-name="Author Bio"]',
      'mouseleave',
    );
  });

  test('an empty file is detected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}empty.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-syntax-errors]');

    assert.dom('[data-test-boxel-copy-button]').exists();
    await triggerEvent(`[data-test-boxel-copy-button]`, 'mouseenter');
    assert.dom('[data-test-tooltip-content]').hasText('Copy to clipboard');
    assert.dom('[data-test-syntax-errors]').hasText('File is empty');
  });

  test<TestContextWithSave>('updates cursor position in monaco editor when field row clicked', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-schema]');

    assert.false(
      monacoService.getLineCursorOn()?.includes('@field department'),
    );
    await click(
      `[data-test-card-schema="Employee"] [data-test-field-name-button="department"]`,
    );
    assert.true(monacoService.getLineCursorOn()?.includes('@field department'));

    await click(
      `[data-test-card-schema="Employee"] [data-test-field-name-button="employeeId"]`,
    );
    assert.true(monacoService.getLineCursorOn()?.includes('@field employeeId'));

    assert.dom('[data-test-current-module-name="employee.gts"]').exists();
    assert.dom('[data-test-current-module-name="person.gts"]').doesNotExist();

    await click(
      `[data-test-card-schema="Person"] [data-test-field-name-button="address"]`,
    );
    assert.dom('[data-test-current-module-name="employee.gts"]').doesNotExist();
    assert.dom('[data-test-current-module-name="person.gts"]').exists();
    assert.true(monacoService.getLineCursorOn()?.includes('@field address'));
  });
});
