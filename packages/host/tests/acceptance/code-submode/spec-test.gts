import { click, waitFor, fillIn } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Realm, baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  setupServerSentEvents,
  visitOperatorMode,
  setupUserSubscription,
  percySnapshot,
  type TestContextWithSSE,
  type TestContextWithSave,
  setupOnSave,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

const testRealm2URL = `http://test-realm/test2/`;

const personCardSource = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    @field title = contains(StringCard, {
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

const petCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringCard);
    @field title = contains(StringCard, {
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
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
        <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/> <br/>
      </template>
    }
  }
`;

const employeeCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export default class Employee extends CardDef {
    static displayName = 'Employee';
    @field name = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
  }
`;

const newSkillCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import { SkillCard } from 'https://cardstack.com/base/skill-card';

  export class NewSkill extends CardDef {
    static displayName = 'NewSkill';
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

let matrixRoomId: string;
module('Acceptance | Spec preview', function (hooks) {
  let realm: Realm;
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupOnSave(hooks);

  let { setRealmPermissions, setActiveRealms, createAndJoinRoom } =
    setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL, testRealm2URL],
    });

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    ({ realm } = await setupAcceptanceTestRealm({
      realmURL: testRealmURL,
      contents: {
        'person.gts': personCardSource,
        'pet.gts': petCardSource,
        'employee.gts': employeeCardSource,
        'new-skill.gts': newSkillCardSource,
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
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    }));
    await setupAcceptanceTestRealm({
      realmURL: testRealm2URL,
      contents: {
        'new-skill.gts': newSkillCardSource,
        'person.gts': personCardSource,
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
    await waitFor('[data-test-accordion-item="spec-preview"]');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-has-spec]').containsText('card');
    await click('[data-test-accordion-item="spec-preview"] button');
    await waitFor('[data-test-spec-selector]');
    assert.dom('[data-test-spec-selector]').exists();
    assert
      .dom('[data-test-spec-selector-item-path]')
      .hasText('person-entry.json');
    await percySnapshot(assert);
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Person');
    assert
      .dom('[data-test-description] [data-test-boxel-input]')
      .hasValue('Spec for Person');
    assert.dom('[data-test-module-href]').containsText(`${testRealmURL}person`);
    assert.dom('[data-test-exported-name]').containsText('Person');
    assert.dom('[data-test-exported-type]').containsText('card');
    await waitFor('[data-test-view-spec-instance]');
    assert.dom('[data-test-view-spec-instance]').exists();
  });
  test('view when there are multiple spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-has-spec]').containsText('2 instances');
    await click('[data-test-accordion-item="spec-preview"] button');
    await waitFor('[data-test-spec-selector]');
    assert.dom('[data-test-spec-selector]').exists();
    assert.dom('[data-test-caret-down]').exists();
    assert
      .dom('[data-test-spec-selector-item-path]')
      .hasText('pet-entry-2.json');
    await waitFor('[data-test-view-spec-instance]');
    assert.dom('[data-test-view-spec-instance]').exists();
  });
  test('view when there are no spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-create-spec-button]').exists();
    assert.dom('[data-test-create-spec-intent-message]').exists();
    await percySnapshot(assert);
  });
  test('view when users cannot write but has NO spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealm2URL}new-skill.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-create-spec-button]').doesNotExist();
    assert.dom('[data-test-create-spec-intent-message]').doesNotExist();
    assert.dom('[data-test-cannot-write-intent-message]').exists();
    await percySnapshot(assert);
  });

  test('view when users cannot write but there exists spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealm2URL}person.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-create-spec-button]').doesNotExist();
    assert.dom('[data-test-create-spec-intent-message]').doesNotExist();
    assert.dom('[data-test-cannot-write-intent-message]').doesNotExist();
    await percySnapshot(assert);
  });
  test<TestContextWithSSE>('have ability to create new spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    assert.dom('[data-test-create-spec-button]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');
    await this.expectEvents({
      assert,
      realm,
      expectedNumberOfEvents: 2,
      callback: async () => {
        await click('[data-test-create-spec-button]');
      },
    });
    assert
      .dom('[data-test-title] [data-test-boxel-input]')
      .hasValue('NewSkill');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('NewSkill');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}new-skill`);
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
    await waitFor('[data-test-accordion-item="spec-preview"]');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('');
    assert.dom('[data-test-exported-name]').containsText('default');
  });

  test<TestContextWithSave>('spec auto saved', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    let readMeInput = 'This is a spec for a person';
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.readMe, readMeInput);
    });
    await fillIn('[data-test-readme] [data-test-boxel-input]', readMeInput);
  });

  test('clicking view instance button correctly navigates to spec file and displays content in editor', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitFor('[data-test-view-spec-instance]');
    assert.dom('[data-test-view-spec-instance]').exists();
    await click('[data-test-view-spec-instance]');

    await waitFor('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person-entry.json`);

    await waitFor('[data-test-editor]');
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

  test<TestContextWithSave>('can render containedExamples for spec for field', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}polymorphic-field.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    const elementName = 'SubTestField';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    assert.dom('[data-test-has-spec]').containsText('field');
    await click('[data-test-accordion-item="spec-preview"] button');
    await waitFor('[data-test-spec-selector]');
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
});
