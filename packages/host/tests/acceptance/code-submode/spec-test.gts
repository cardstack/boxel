import {
  click,
  fillIn,
  triggerEvent,
  find,
  settled,
  waitFor,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, Deferred } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  percySnapshot,
  type TestContextWithSave,
  setupOnSave,
  setupRealmServerEndpoints,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  getPlaygroundSelections,
  assertCardExists,
  selectDeclaration,
} from '../../helpers/playground';
import { getRecentFiles } from '../../helpers/recent-files-cards';

import { setupApplicationTest } from '../../helpers/setup';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

const testRealm2URL = `http://test-realm/test2/`;

const personCardSource = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, Component, FieldDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class PersonField extends FieldDef {
    static displayName = 'PersonField';
  }
  export class DifferentField extends FieldDef {
    static displayName = 'DifferentField';
  }

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
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

const person1CardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Person1 extends CardDef {
    static displayName = 'Person1';
  }
`;

const petCardSource = `
  import { contains, field, Component, CardDef, FieldDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class PetField extends FieldDef {
    static displayName = 'PetField';
  }

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <h3 data-test-pet={{@model.name}}>
          <@fields.name/>
        </h3>
      </template>
    }
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <h1>{{@model.title}}</h1>
        <h2 data-test-pet={{@model.name}}>
          <@fields.name/>
        </h2>
      </template>
    }
  }
`;

const employeeCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export default class Employee extends CardDef {
    static displayName = 'Employee';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
  }
`;

const newSkillCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import { Skill } from 'https://cardstack.com/base/skill';

  export class NewSkill extends Skill {
    static displayName = 'NewSkill';
  }

  export class ExtendedNewSkill extends NewSkill {
    static displayName = 'ExtendedNewSkill';
  }
`;

const primitiveFieldCardSource = `
  import {
    field,
    Component,
    FieldDef,
    primitive,
  } from 'https://cardstack.com/base/card-api';

   export class PrimitiveField extends FieldDef {
    static displayName = 'PrimitiveField';
    static [primitive]: number
   }

   export class SubclassPrimitiveField extends PrimitiveField {
    static displayName = 'SubclassPrimitiveField';
   }
`;

const quoteFieldCardSource = `
  import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class QuoteField extends FieldDef {
    static displayName = 'QuoteField';
    @field text = contains(StringField);

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <blockquote data-test-quote-field-embedded>
          <@fields.text />
        </blockquote>
      </template>
    };
  }
`;

const polymorphicFieldCardSource = `
  import {
    Component,
    CardDef,
    field,
    contains,
    StringField,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';
  import { on } from '@ember/modifier';

  export class TestField extends FieldDef {
    static displayName = 'TestField';
    @field firstName = contains(StringField);

    static fitted = class Fitted extends Component<typeof this> {
      <template>
        <div data-test-baseclass>
          BaseClass
          <@fields.firstName />
        </div>
      </template>
    };

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <div data-test-baseclass>
          Embedded BaseClass
          <@fields.firstName />
        </div>
      </template>
    };
  }
  export class SubTestField extends TestField {
    static displayName = 'SubTestField';

    static fitted = class Fitted extends Component<typeof this> {
      <template>
        <div data-test-subclass>
          SubClass
          <@fields.firstName />
        </div>
      </template>
    };

    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <div data-test-subclass>
          Embedded SubClass
          <@fields.firstName />
        </div>
      </template>
    };

    static edit = class Edit extends Component<typeof this> {
      <template>
        <div data-test-edit>
          Edit
          <@fields.firstName />
        </div>
      </template>
    };
  }
  export class PolymorphicFieldExample extends CardDef {
    static displayName = 'PolymorphicFieldExample';
    @field specialField = contains(TestField);

    static isolated = class Isolated extends Component<typeof this> {
      setSubclass = () => {
        this.args.model.specialField = new SubTestField({
          firstName: 'New Name',
        });
      };
      <template>
        <button {{on 'click' this.setSubclass}} data-test-set-subclass>Set
          Subclass From Outside</button>
        <@fields.specialField />
      </template>
    };
  }
`;

module('Acceptance | Spec preview', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
    autostart: true,
  });

  let { setRealmPermissions, setActiveRealms, createAndJoinRoom } =
    mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'person.gts': personCardSource,
        'person-1.gts': person1CardSource,
        'pet.gts': petCardSource,
        'employee.gts': employeeCardSource,
        'new-skill.gts': newSkillCardSource,
        'quote-field.gts': quoteFieldCardSource,
        'primitive-field.gts': primitiveFieldCardSource,
        'polymorphic-field.gts': polymorphicFieldCardSource,
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Person',
              description: 'Spec for Person',
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
        'quote-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'QuoteField',
              specType: 'field',
              ref: {
                module: './quote-field',
                name: 'QuoteField',
              },
              containedExamples: [
                {
                  text: 'Words build worlds',
                },
              ],
            },
            meta: {
              fields: {
                containedExamples: [
                  {
                    adoptsFrom: {
                      module: './quote-field',
                      name: 'QuoteField',
                    },
                  },
                ],
              },
              adoptsFrom: {
                module: `${baseRealm.url}spec`,
                name: 'Spec',
              },
            },
          },
        },
        'employee-entry.json': {
          data: {
            type: 'card',
            attributes: {
              specType: 'card',
              ref: {
                module: `./employee`,
                name: 'default',
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
        'pet-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Pet',
              specType: 'card',
              ref: {
                module: `./pet`,
                name: 'Pet',
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
        'pet-entry-2.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Pet2',
              specType: 'card',
              ref: {
                module: `./pet`,
                name: 'Pet',
              },
            },
            relationships: {
              'linkedExamples.0': {
                links: {
                  self: `${testRealmURL}Pet/mango`,
                },
              },
              'linkedExamples.1': {
                links: {
                  self: `${testRealmURL}Pet/pudding`,
                },
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
        'Person/fadhlan.json': {
          data: {
            attributes: {
              firstName: 'Fadhlan',
              address: [
                {
                  city: 'Bandung',
                  country: 'Indonesia',
                  shippingInfo: {
                    preferredCarrier: 'DHL',
                    remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
                  },
                },
              ],
            },
            relationships: {
              pet: {
                links: {
                  self: `${testRealmURL}Pet/mango`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}person`,
                name: 'Person',
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
        'Pet/mango.json': {
          data: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'Pet/pudding.json': {
          data: {
            attributes: {
              name: 'Pudding',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'subTestField.json': {
          data: {
            type: 'card',
            attributes: {
              readMe: null,
              ref: {
                name: 'SubTestField',
                module: './polymorphic-field',
              },
              specType: 'field',
              containedExamples: [],
              description: null,
              thumbnailURL: null,
            },
            relationships: {
              linkedExamples: {
                links: {
                  self: null,
                },
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
        'pet-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'PetField',
              description: 'Spec',
              specType: 'field',
              ref: {
                module: `./pet`,
                name: 'PetField',
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
        'different-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'DifferentField',
              description: 'Spec for DifferentField',
              specType: 'field',
              ref: {
                module: `./person`,
                name: 'DifferentField',
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
        'primitve-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'PrimitiveField',
              description: 'Spec for PrimitiveField',
              specType: 'field',
              ref: {
                module: `./primitive-field`,
                name: 'PrimitiveField',
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
        'subclass-primitive-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'SubclassPrimitiveField',
              description: 'Spec for SubclassPrimitiveField',
              specType: 'field',
              ref: {
                module: `./primitive-field`,
                name: 'SubclassPrimitiveField',
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
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'new-skill.gts': newSkillCardSource,
        'person.gts': personCardSource,
        'quote-field.gts': quoteFieldCardSource,
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
        'quote-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'QuoteField',
              specType: 'field',
              ref: {
                module: './quote-field',
                name: 'QuoteField',
              },
              containedExamples: [
                {
                  text: 'Words build worlds',
                },
              ],
            },
            meta: {
              fields: {
                containedExamples: [
                  {
                    adoptsFrom: {
                      module: './quote-field',
                      name: 'QuoteField',
                    },
                  },
                ],
              },
              adoptsFrom: {
                module: `${baseRealm.url}spec`,
                name: 'Spec',
              },
            },
          },
        },
      },
    });
    setActiveRealms([testRealmURL, testRealm2URL]);
    setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
      [testRealm2URL]: ['read'],
    });
  });
  test('view when there is a single spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-spec-selector]').exists();
    assert.dom('[data-test-spec-selector-item-path]').hasText('person-entry');
    await percySnapshot(assert);
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Person');
    assert
      .dom('[data-test-description] [data-test-boxel-input]')
      .hasValue('Spec for Person');
    assert.dom('[data-test-module-href]').containsText(`${testRealmURL}person`);
    assert.dom('[data-test-exported-name]').containsText('Person');
    assert.dom('[data-test-exported-type]').containsText('card');
    assert.dom('[data-test-view-spec-instance]').exists();
  });
  test('view when there are multiple spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-spec-selector]').exists();
    assert.dom('[data-test-caret-down]').exists();
    assert.dom('[data-test-spec-selector-item-path]').hasText('pet-entry-2');
    assert.dom('[data-test-view-spec-instance]').exists();
  });
  test('view when there are no spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    assert.dom('[data-test-module-inspector-view="spec"]').exists();
    assert.dom('[data-test-create-spec-button]').exists();

    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-create-spec-intent-message]').exists();
    await percySnapshot(assert);
  });
  test('spec updates when different declaration selected in the module', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Person');
    await click('[data-boxel-selector-item-text="DifferentField"]');
    assert
      .dom('[data-test-boxel-input-id="spec-title"]')
      .hasValue('DifferentField');
    await click('[data-boxel-selector-item-text="Person"]');
    assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Person');
  });
  test('spec updates when different module selected in file tree', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Person');
    await click('[data-test-file-browser-toggle]');
    await waitFor('[data-test-file="pet.gts"]');
    await click('[data-test-file="pet.gts"]');
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Pet2');
    await click('[data-test-file="person.gts"]');
    assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Person');
  });
  test('does not lose input field focus when editing spec', async function (assert) {
    const receivedEventDeferred = new Deferred<void>();
    const messageService = getService('message-service');

    messageService.listenerCallbacks.get(testRealmURL)!.push((e) => {
      if (
        e.eventName === 'index' &&
        e.indexType === 'incremental-index-initiation'
      ) {
        return; // ignore the index initiation event
      }
      receivedEventDeferred.fulfill();
    });
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    // intentionally not awaiting fillIn
    fillIn('[data-test-readme] textarea', 'Hello World');
    let textArea = find('[data-test-readme] textarea') as HTMLTextAreaElement;
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 3);
    await receivedEventDeferred.promise;
    await settled();
    textArea = find('[data-test-readme] textarea') as HTMLTextAreaElement;
    assert.strictEqual(
      document.activeElement,
      textArea,
      'focus is preserved on the input element',
    );
    assert.strictEqual(
      document.getSelection()?.anchorOffset,
      3,
      'select is preserved',
    );
  });
  test('view when users cannot write but has NO spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealm2URL}new-skill.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-module-inspector-view="spec"]').exists();
    assert.dom('[data-test-create-spec-button]').doesNotExist();
    assert.dom('[data-test-create-spec-intent-message]').doesNotExist();
    assert.dom('[data-test-spec-exists]').doesNotExist();
    assert.dom('[data-test-cannot-write-intent-message]').exists();
    await percySnapshot(assert);
  });

  test('view when users cannot write but there exists spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealm2URL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-module-inspector-view="spec"]').exists();
    assert.dom('[data-test-create-spec-button]').doesNotExist();
    assert.dom('[data-test-create-spec-intent-message]').doesNotExist();
    assert.dom('[data-test-cannot-write-intent-message]').doesNotExist();
    await percySnapshot(assert);
  });

  test('renders linked examples in isolated spec view when user cannot write', async function (assert) {
    setRealmPermissions({
      [testRealmURL]: ['read'],
      [testRealm2URL]: ['read'],
    });

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');

    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');
    await click('[data-option-index="0"]');

    assert
      .dom(
        `[data-test-card="${testRealmURL}pet-entry-2"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert.dom(`[data-test-card="${testRealmURL}Pet/mango"]`).exists();
    assert.dom(`[data-test-card="${testRealmURL}Pet/pudding"]`).exists();
  });

  test('renders linked examples in isolated spec view when user can write (via view instance)', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');

    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');
    await click('[data-option-index="0"]');
    await click('[data-test-view-spec-instance]');

    assert
      .dom(
        `[data-test-card="${testRealmURL}pet-entry-2"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert.dom(`[data-test-card="${testRealmURL}Pet/mango"]`).exists();
    assert.dom(`[data-test-card="${testRealmURL}Pet/pudding"]`).exists();
  });

  test('renders contained examples in isolated spec view when user cannot write', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealm2URL}quote-field.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');

    assert
      .dom(
        `[data-test-card="${testRealm2URL}quote-field-entry"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert
      .dom('[data-test-quote-field-embedded]')
      .containsText('Words build worlds');
  });

  test('renders contained examples in isolated spec view when user can write (via view instance)', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}quote-field.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    await click('[data-test-view-spec-instance]');

    assert
      .dom(
        `[data-test-card="${testRealmURL}quote-field-entry"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert
      .dom('[data-test-quote-field-embedded]')
      .containsText('Words build worlds');
  });
  test<TestContextWithSave>('have ability to create new spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person-1.gts`,
    });
    assert.dom('[data-test-create-spec-button]').exists();
    await click('[data-test-create-spec-button]');
    assert.dom('[data-test-module-inspector-view="spec"]').hasClass('active');
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Person1');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Person1');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}person-1`);
  });
  test('when adding linked examples, card chooser options are narrowed to this type', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}person-entry`,
            format: 'edit',
          },
        ],
      ],
      submode: 'interact',
    });
    assert.dom('[data-test-links-to-many="linkedExamples"]').exists();
    await click('[data-test-add-new]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Person');
    assert.dom('[data-test-card-catalog-item]').exists({ count: 2 });
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}Person/1"]`)
      .exists();
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}Person/fadhlan"]`)
      .exists();
  });

  test('title does not default to "default"', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    });
    assert.dom('[data-test-module-inspector-view="spec"]').exists();
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('');
    assert.dom('[data-test-exported-name]').containsText('default');
  });

  test<TestContextWithSave>('spec auto saved (with stability)', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    let readMeInput = 'This is a spec for a person';
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.readMe, readMeInput);
    });
    let cardComponentId = find(
      `[data-test-card='${testRealmURL}person-entry']`,
    )?.id;
    await fillIn('[data-test-readme] [data-test-boxel-input]', readMeInput);
    let cardComponentIdAfter = find(
      `[data-test-card='${testRealmURL}person-entry']`,
    )?.id;
    assert.strictEqual(cardComponentIdAfter, cardComponentId);
  });

  test('clicking view instance button correctly navigates to spec file and displays content in editor', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-view-spec-instance]').exists();
    await click('[data-test-view-spec-instance]');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person-entry.json`);
    assert.dom('[data-test-editor]').hasAnyText();
    assert.dom('[data-test-editor]').containsText('Person');
    assert.dom('[data-test-editor]').containsText('Spec');
    assert.dom('[data-test-editor]').containsText('specType');

    assert
      .dom(
        `[data-test-card="${testRealmURL}person-entry"][data-test-card-format="isolated"]`,
      )
      .exists();
  });

  test('show overlay on examples card', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    assert.dom('[data-test-module-inspector-view="spec"]').exists();

    await click('[data-test-module-inspector-view="spec"]');

    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');

    await click('[data-option-index="0"]');
    assert.dom(`[data-test-links-to-many="linkedExamples"]`).exists();
    assert.dom(`[data-test-card="${testRealmURL}Pet/mango"]`).exists();

    await triggerEvent(
      `[data-test-card="${testRealmURL}Pet/mango"]`,
      'mouseenter',
    );
    assert.dom('[data-test-card-overlay]').exists();

    await triggerEvent(
      `[data-test-card="${testRealmURL}Pet/mango"]`,
      'mouseleave',
    );
    assert.dom('[data-test-card-overlay]').doesNotExist();
  });

  test<TestContextWithSave>('can render containedExamples for spec for field', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}polymorphic-field.gts`,
    });
    const elementName = 'SubTestField';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.dom('[data-test-module-inspector-view="spec"]').exists();
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-spec-selector]').exists();
    assert
      .dom('[data-test-module-href]')
      .containsText(`${testRealmURL}polymorphic-field`);
    assert.dom('[data-test-exported-name]').containsText('SubTestField');
    assert.dom('[data-test-exported-type]').containsText('field');
    await click('[data-test-add-new]');
    let firstNameToAdd = 'Tintin';
    let classExportName = 'SubTestField';

    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.containedExamples.length, 1);
      assert.strictEqual(
        json.data.attributes?.containedExamples[0].firstName,
        firstNameToAdd,
      );
      assert.strictEqual(
        json.data.attributes?.meta.fields.containedExamples[0].adoptsFrom.name,
        classExportName,
      );
      assert.strictEqual(
        json.data.attributes?.meta.fields.containedExamples[0].adoptsFrom
          .module,
        `${testRealmURL}${classExportName}`,
      );
    });
    await fillIn(
      '[data-test-item="0"] [data-test-edit] [data-test-boxel-input]',
      firstNameToAdd,
    );
    assert.dom('[data-test-edit]').exists({ count: 1 });
    assert.dom('[data-test-item="0"] [data-test-edit]').containsText('Edit');
    await percySnapshot(assert);
  });

  test('primitive fields do not have examples', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}primitive-field.gts`,
    });
    await selectDeclaration('PrimitiveField');
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-spec-example-incompatible-primitives]').exists();
    await click(
      '[data-test-boxel-selector-item-text="SubclassPrimitiveField"]',
    );
    assert.dom('[data-test-spec-example-incompatible-primitives]').exists();
  });

  test('updatePlaygroundSelections persists card selection in playground when clicking an example card', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    // Select the pet-entry-2 spec which has linked examples
    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');
    await click('[data-option-index="0"]');

    // Wait for linked examples to appear
    const petId = `${testRealmURL}Pet/mango`;
    assert.dom(`[data-test-card="${petId}"]`).exists();

    // Click on the first linked example
    await triggerEvent(`[data-test-card="${petId}"]`, 'mouseenter');
    await click(`[data-test-card="${petId}"]`);

    // Verify the card was persisted in playground selections
    const petModuleId = `${testRealmURL}pet/Pet`;
    assert.deepEqual(
      getPlaygroundSelections()?.[petModuleId],
      {
        cardId: petId,
        format: 'isolated', // Default format
        url: `${testRealmURL}pet.gts`,
      },
      'Card selection is persisted in localStorage',
    );

    // Verify the playground panel shows the selected card
    assert.dom('[data-test-selected-item]').containsText('Mango');
    assertCardExists(
      assert,
      petId,
      'isolated',
      'Card is displayed in isolated format',
    );
  });

  test('updatePlaygroundSelections adds card to recent files storage when clicking an example card', async function (assert) {
    const petId = `${testRealmURL}Pet/mango`;
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    // Select the pet-entry-2 spec which has linked examples
    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');

    await click('[data-option-index="0"]');
    assert.dom(`[data-test-card="${petId}"]`).exists();
    // Click on the first linked example
    await triggerEvent(`[data-test-card="${petId}"]`, 'mouseenter');
    await click(`[data-test-card="${petId}"]`);

    // Verify the card was added to recent files
    let recentFile = getRecentFiles()?.[0];
    assert.strictEqual(
      `${recentFile?.[0]}${recentFile?.[1]}`,
      `${testRealmURL}Pet/mango.json`,
      'Card is added to recent files storage',
    );

    // Verify the card appears in the playground
    assertCardExists(
      assert,
      petId,
      'isolated',
      'Card appears in playground panel',
    );
  });

  test('updatePlaygroundSelections preserves existing format when selecting different examples card', async function (assert) {
    const firstPetId = `${testRealmURL}Pet/mango`;
    const secondPetId = `${testRealmURL}Pet/pudding`;
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="0"] [data-test-spec-selector-item-path]')
      .hasText('pet-entry-2');
    await click('[data-option-index="0"]');
    assert.dom(`[data-test-card="${firstPetId}"]`).exists();
    assert.dom(`[data-test-card="${secondPetId}"]`).exists();

    // Click on the first linked example
    await triggerEvent(`[data-test-card="${firstPetId}"]`, 'mouseenter');
    await click(`[data-test-card="${firstPetId}"]`);
    assertCardExists(
      assert,
      firstPetId,
      'isolated',
      'First card initially shown in isolated format',
    );

    await click('[data-test-format-chooser="embedded"]');
    assertCardExists(
      assert,
      firstPetId,
      'embedded',
      'Format changed to embedded for first card',
    );

    // Verify format was changed
    const petModuleId = `${testRealmURL}pet/Pet`;
    assert.deepEqual(
      getPlaygroundSelections()?.[petModuleId],
      {
        cardId: firstPetId,
        format: 'embedded',
        url: `${testRealmURL}pet.gts`,
      },
      'Format is set to embedded',
    );

    // Go back to spec preview and click the second card
    await click('[data-test-module-inspector-view="spec"]');
    await triggerEvent(`[data-test-card="${secondPetId}"]`, 'mouseenter');
    await click(`[data-test-card="${secondPetId}"]`);

    // Verify the format was preserved when selecting the second card
    assert.deepEqual(
      getPlaygroundSelections()?.[petModuleId],
      {
        cardId: secondPetId,
        format: 'embedded',
        url: `${testRealmURL}pet.gts`,
      },
      'The embedded format is preserved when selecting another card',
    );

    // Verify the second card is shown in embedded format
    assert.dom('[data-test-selected-item]').containsText('Pudding');
    assertCardExists(
      assert,
      secondPetId,
      'embedded',
      'Second card is displayed in the embedded format',
    );
  });

  test('spec preview updates when changing between different declarations inside inspector', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await click('[data-test-module-inspector-view="spec"]');
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Pet2');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Pet');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);
    await click('[data-test-boxel-selector-item-text="PetField"]');
    assert
      .dom('[data-test-title] [data-test-boxel-input]')
      .hasValue('PetField');
    assert.dom('[data-test-exported-type]').hasText('field');
    assert.dom('[data-test-exported-name]').hasText('PetField');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);

    await click('[data-test-boxel-selector-item-text="Pet"]');

    assert
      .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
      .containsText('pet-entry');
    await click('[data-test-spec-selector] > div');
    await click('[data-option-index="1"]');

    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Pet');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Pet');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);
  });

  test('it does not set the wrong spec for field playground', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await click('[data-test-module-inspector-view="preview"]');
    await selectDeclaration('Person');
    assert.dom('[data-test-playground-panel]').exists();
    await selectDeclaration('PersonField');
    let selection =
      getPlaygroundSelections()?.[`${testRealmURL}person/PersonField`];
    assert.notStrictEqual(
      selection?.cardId,
      `${testRealmURL}person-entry`,
      'Person Spec is not set as the spec for PersonField',
    );
    await click('[data-test-module-inspector-view="spec"]');
    assert
      .dom('[data-test-create-spec-button]')
      .doesNotExist('PersonField spec is autogenerated by playground');
    assert
      .dom('[data-test-boxel-input-id="spec-title"]')
      .hasValue('PersonField');

    await click('[data-test-view-spec-instance]');
    await click('[data-test-action-button="Delete"]');
    await click('[data-test-confirm-delete-button]'); // delete PersonField spec
    assert.dom('[data-test-create-spec-button]').exists();

    await selectDeclaration('DifferentField');
    assert.dom('[data-test-create-spec-button]').doesNotExist();
    assert
      .dom('[data-test-boxel-input-id="spec-title"]')
      .hasValue('DifferentField');
    selection =
      getPlaygroundSelections()?.[`${testRealmURL}person/DifferentField`];
    assert.strictEqual(
      selection?.cardId,
      `${testRealmURL}different-field-entry`,
    );

    await click('[data-test-module-inspector-view="preview"]');
    await selectDeclaration('PersonField');
    selection =
      getPlaygroundSelections()?.[`${testRealmURL}person/PersonField`];
    assert.notStrictEqual(
      selection?.cardId,
      `${testRealmURL}different-field-entry`,
      'DifferentField Spec is not set as the spec for PersonField',
    );
    await click('[data-test-module-inspector-view="spec"]');
    assert
      .dom('[data-test-create-spec-button]')
      .doesNotExist('PersonField spec is autogenerated by playground');
    assert
      .dom('[data-test-boxel-input-id="spec-title"]')
      .hasValue('PersonField');
  });

  module('Commands that depend on Proxy endpoints', function (hooks) {
    // Setup realm server endpoints for proxy mock
    setupRealmServerEndpoints(hooks, [
      {
        route: '_request-forward',
        getResponse: async (req: Request) => {
          const body = await req.json();

          // Handle README generation requests
          if (body.url === 'https://openrouter.ai/api/v1/chat/completions') {
            const mockReadmeResponse = {
              choices: [
                {
                  message: {
                    content:
                      "# Person Card\n\nThis is a Person card that represents an individual with first and last name fields.\n\n## Fields\n- **firstName**: The person's first name\n- **lastName**: The person's last name\n- **title**: Computed field combining first and last name",
                  },
                },
              ],
            };
            return new Response(JSON.stringify(mockReadmeResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Default response for other requests
          return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    ]);
    test('generate readme button populates readme field via proxy command', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}person.gts`,
      });

      await click('[data-test-module-inspector-view="spec"]');

      await waitFor(
        `[data-test-card="${testRealmURL}person-entry"][data-test-card-format="edit"]`,
      );

      await waitFor('[data-test-generate-readme]');
      assert.dom('[data-test-generate-readme]').exists();

      assert.dom('[data-test-readme] textarea').hasValue('');

      await click('[data-test-generate-readme]');

      assert.dom('[data-test-readme] textarea').hasValue(/Person Card/);
      assert.dom('[data-test-readme] textarea').hasValue(/firstName/);
      assert.dom('[data-test-readme] textarea').hasValue(/lastName/);
    });
  });
});
