import {
  visit,
  click,
  waitFor,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';

import { setupApplicationTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import stringify from 'safe-stable-stringify';

import { baseRealm } from '@cardstack/runtime-common';

import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  testRealmURL,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
  setupServerSentEvents,
  getMonacoContent,
  type TestContextWithSSE,
} from '../../helpers';

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
  import { contains, containsMany, field, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";
  import { Friend } from './friend';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field friends = linksToMany(() => Friend);
    @field address = containsMany(StringCard);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.title /></p>
          <p>Address List: <@fields.address /></p>
          <p>Friends: <@fields.friends /></p>
        </div>
        <style>
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
  import StringCard from 'https://cardstack.com/base/string';
  import { Person } from './person';

  export class Employee extends Person {
    static displayName = 'Employee';
    @field department = contains(StringCard);

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
  import StringCard from 'https://cardstack.com/base/string';

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
    @field someString = contains(StringCard);
  }

  export class ExportedCardInheritLocalCard extends LocalCard {
    static displayName = 'exported card extends local card';
  }

  class LocalField extends FieldDef {
    static displayName = 'local field';
  }
  export class ExportedField extends FieldDef {
    static displayName = 'exported field';
    @field someString = contains(StringCard);
  }

  export class ExportedFieldInheritLocalField extends LocalField {
    static displayName = 'exported field extends local field';
  }

  export default class DefaultClass {}
`;

const friendCardSource = `
  import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Friend extends CardDef {
    static displayName = 'Friend';
    @field name = contains(StringCard);
    @field friend = linksTo(() => Friend);
    @field title = contains(StringCard, {
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
        <style>
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

module('Acceptance | code submode | schema editor tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  async function saveField(
    context: TestContextWithSSE,
    assert: Assert,
    expectedEvents: { type: string; data: Record<string, any> }[],
  ) {
    await context.expectEvents(
      assert,
      realm,
      adapter,
      expectedEvents,
      async () => {
        await click('[data-test-save-field-button]');
      },
    );
  }
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupWindowMock(hooks);

  hooks.afterEach(async function () {
    window.localStorage.removeItem('recent-files');
  });

  hooks.beforeEach(async function () {
    window.localStorage.removeItem('recent-files');

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    adapter = new TestRealmAdapter({
      'index.gts': indexCardSource,
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
    });

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
      overridingHandlers: [
        async (req: Request) => {
          return sourceFetchRedirectHandle(req, adapter, testRealmURL);
        },
        async (req: Request) => {
          return sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm));
        },
      ],
    });
    await realm.ready;
  });

  test('schema editor lists the inheritance chain', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

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
    let realm2IconUrl = 'https://i.postimg.cc/d0B9qMvy/icon.png';

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
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}Person/1.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-code-mode-card-preview-body]');
    assert
      .dom('[data-test-code-mode-card-preview-body]')
      .containsText('Hassan');
    await waitFor(
      `button[data-test-definition-container="${testRealmURL}person"]`,
    );
    await click(
      `button[data-test-definition-container="${testRealmURL}person"]`,
    );
    await waitFor('[data-test-card-schema]');
    assert.dom('[data-test-card-schema]').exists({ count: 3 });
    assert.dom('[data-test-total-fields]').containsText('8 Fields');
  });

  test('shows displayName of CardResource when field refers to itself', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}friend.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

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
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

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
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor(
      '[data-test-card-schema="Employee"] [data-test-field-name="department"] [data-test-card-display-name="String"]',
    );

    await click(
      '[data-test-card-schema="Employee"] [data-test-field-name="department"] [data-test-card-display-name="String"]',
    );

    await waitFor('[data-test-current-module-name="card-api.gts"]');
    assert.dom('[data-test-current-module-name]').hasText('card-api.gts');
  });

  test<TestContextWithSSE>('adding a field from schema editor - whole flow test', async function (assert) {
    assert.expect(18);
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [
            `${testRealmURL}person.gts`,
            `${testRealmURL}Person/1`,
            `${testRealmURL}employee`,
          ],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-add-field-button]');
    assert.dom('[data-test-add-field-button]').exists({ count: 1 }); // Only top level card has an option to add a field

    await click('[data-test-add-field-button]');
    assert.dom('[data-test-save-field-button]').hasAttribute('disabled');

    await click('[data-test-cancel-adding-field-button]');
    assert.dom('[data-test-add-field-modal]').doesNotExist();

    await click('[data-test-add-field-button]');
    assert.dom('[data-test-add-field-modal]').exists();

    await waitFor('[data-test-selected-field-display-name]');
    assert.dom('[data-test-selected-field-display-name]').hasText('String'); // String field selected by default

    await click('[data-test-choose-card-button]');
    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click(
      '[data-test-select="https://cardstack.com/base/fields/biginteger-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    await assert.dom('[data-test-selected-field-realm-icon] img').exists();
    await assert
      .dom('[data-test-selected-field-display-name]')
      .hasText('BigInteger');

    await click('[data-test-choose-card-button]');

    await waitFor(
      '[data-test-select="https://cardstack.com/base/fields/date-field"]',
    );

    await click(
      '[data-test-select="https://cardstack.com/base/fields/date-field"]',
    );
    await click('[data-test-card-catalog-go-button]');
    await assert.dom('[data-test-selected-field-display-name]').hasText('Date');
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

    await saveField(this, assert, expectedEvents);
    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="birthdate"] [data-test-card-display-name="Date"]',
    );

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="birthdate"] [data-test-card-display-name="Date"]`,
      )
      .exists();

    assert.ok(getMonacoContent().includes('birthdate = contains(DateCard)'));
  });

  test<TestContextWithSSE>('adding a field from schema editor - cardinality test', async function (assert) {
    assert.expect(9);
    let waitForOpts = { timeout: 2000 }; // Helps mitigating flaky tests since Writing to a file + reflecting that in the UI can be a bit slow
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [
            `${testRealmURL}person.gts`,
            `${testRealmURL}Person/1`,
            `${testRealmURL}employee`,
          ],
        },
      },
    ];
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

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
    await saveField(this, assert, expectedEvents);

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
        'luckyNumbers = containsMany(BigIntegerCard)',
      ),
      "code editor contains line 'luckyNumbers = containsMany(BigIntegerCard)'",
    );

    // Field is a card descending from CardDef (cardinality: one)
    await waitFor('[data-test-add-field-button]');
    await click('[data-test-add-field-button]');
    await click('[data-test-choose-card-button]');
    +(await waitFor(
      '[data-test-select="http://test-realm/test/person-entry"]',
    ));
    await click('[data-test-select="http://test-realm/test/person-entry"]');
    await click('[data-test-card-catalog-go-button]');
    await fillIn('[data-test-field-name-input]', 'favPerson');
    await click('[data-test-boxel-radio-option-id="one"]');

    await saveField(this, assert, expectedEvents);
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

    // Field is a card descending from CardDef (cardinality: many)
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
    await saveField(this, assert, expectedEvents);
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

  test('deleting a field from schema editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-card-schema]');

    await click(
      '[data-test-card-schema="Person"] [data-test-field-name="firstName"] [data-test-schema-editor-field-contextual-button]',
    );

    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 5 Fields');

    assert.true(
      getMonacoContent().includes('firstName = contains(StringCard)'),
    );

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

    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 4 Fields'); // One field less

    assert.false(
      getMonacoContent().includes('firstName = contains(StringCard)'),
    );

    assert
      .dom(
        `[data-test-card-schema="Person"] [data-test-field-name="firstName"]`,
      )
      .doesNotExist();
  });

  test('editing a field from schema editor', async function (assert) {
    assert.expect(2);
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

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

    await click('[data-test-save-field-button]');

    await waitFor(
      '[data-test-card-schema="Person"] [data-test-field-name="friendCount"] [data-test-card-display-name="BigInteger"]',
    );

    assert.ok(
      getMonacoContent().includes('friendCount = contains(BigIntegerCard)'),
    );
  });

  test('tooltip is displayed when hovering over a pill', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}ambiguous-display-names.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
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

    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-tooltip-content]',
    );
    assert
      .dom('[data-test-card-schema="Blog Post"] [data-test-tooltip-content]')
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
    await waitFor('[data-test-card-schema="Base"] [data-test-tooltip-content]');
    assert
      .dom('[data-test-card-schema="Base"] [data-test-tooltip-content]')
      .hasText('https://cardstack.com/base/card-api');

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
    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="authorBio"] [data-test-tooltip-content]',
    );
    assert
      .dom(
        '[data-test-card-schema="Blog Post"] [data-test-field-name="authorBio"] [data-test-tooltip-content]',
      )
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
    await waitFor(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-tooltip-content]',
    );
    assert
      .dom(
        '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-tooltip-content]',
      )
      .hasText('http://test-realm/test/ambiguous-display-names (Editor)'); //shows Editor
    await triggerEvent(
      '[data-test-card-schema="Blog Post"] [data-test-field-name="editorBio"] [data-test-card-display-name="Author Bio"]',
      'mouseleave',
    );
  });
});
