import {
  click,
  waitFor,
  fillIn,
  triggerEvent,
  find,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  setupUserSubscription,
  percySnapshot,
  type TestContextWithSave,
  setupOnSave,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

const testRealm2URL = `http://test-realm/test2/`;

const personCardSource = `
  import { contains, containsMany, field, linksTo, linksToMany, CardDef, FieldDef, Component } from "https://cardstack.com/base/card-api";
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
  export class PersonField extends FieldDef {
    static displayName = 'PersonField';
  }
`;

const person1CardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export class Person1 extends CardDef {
    static displayName = 'Person1';
  }
`;

const petCardSource = `
  import { contains, field, Component, CardDef, FieldDef} from "https://cardstack.com/base/card-api";
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
      </template>
    }
  }

  export class PetField extends FieldDef {
    static displayName = 'PetField';
  }
`;

const employeeCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringCard from "https://cardstack.com/base/string";

  export default class Employee extends CardDef {
    static displayName = 'Employee';
    @field name = contains(StringCard);
    @field title = contains(StringCard, {
      computeVia: function (this: Employee) {
        return this.name;
      },
    });
  }
`;

const newSkillCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import { SkillCard } from 'https://cardstack.com/base/skill-card';

  export class NewSkill extends SkillCard {
    static displayName = 'NewSkill';
  }

  export class ExtendedNewSkill extends NewSkill {
    static displayName = 'ExtendedNewSkill';
  }
`;

let matrixRoomId: string;
module('Acceptance | Spec preview', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  let { setRealmPermissions, setActiveRealms, createAndJoinRoom } =
    mockMatrixUtils;

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
      realmURL: testRealmURL,
      contents: {
        'person.gts': personCardSource,
        'person-1.gts': person1CardSource,
        'pet.gts': petCardSource,
        'employee.gts': employeeCardSource,
        'new-skill.gts': newSkillCardSource,
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
        'person-field-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'PersonField',
              description: 'Spec',
              specType: 'field',
              ref: {
                module: `./person`,
                name: 'PersonField',
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
    assert.dom('[data-test-spec-selector-item-path]').hasText('person-entry');
    await percySnapshot(assert);
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Person');
    assert
      .dom('[data-test-description] [data-test-boxel-input]')
      .hasValue('Spec');
    assert.dom('[data-test-module-href]').containsText(`${testRealmURL}person`);
    assert.dom('[data-test-exported-name]').containsText('Person');
    assert.dom('[data-test-exported-type]').containsText('card');
    assert.dom('[data-test-spec-tag]').containsText('card');
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
    assert.dom('[data-test-spec-selector-item-path]').hasText('pet-entry-2');
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
  test('have ability to create new spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person-1.gts`,
    });
    assert.dom('[data-test-create-spec-button]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');
    await click('[data-test-create-spec-button]');

    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Person1');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Person1');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}person-1`);
  });
  test('have ability to create new skill spec type instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    assert.dom('[data-test-create-spec-button]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');
    await click('[data-test-create-spec-button]');

    assert
      .dom('[data-test-title] [data-test-boxel-input]')
      .hasValue('NewSkill');
    assert.dom('[data-test-exported-type]').hasText('skill');
    assert.dom('[data-test-spec-tag]').hasText('skill');
    assert.dom('[data-test-exported-name]').hasText('NewSkill');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}new-skill`);
  });
  test('have ability to create new extended skill spec type instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    await click('[data-boxel-selector-item-text="ExtendedNewSkill"]');
    assert.dom('[data-test-create-spec-button]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');
    await click('[data-test-create-spec-button]');

    assert
      .dom('[data-test-title] [data-test-boxel-input]')
      .hasValue('ExtendedNewSkill');
    assert.dom('[data-test-exported-type]').hasText('skill');
    assert.dom('[data-test-spec-tag]').hasText('skill');
    assert.dom('[data-test-exported-name]').hasText('ExtendedNewSkill');
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
    assert.dom('[data-test-spec-tag]').hasText('card');
  });

  test<TestContextWithSave>('spec auto saved (but with stability)', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    await this.pauseTest();
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

  test<TestContextWithSave>('adhoc', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    await this.pauseTest();
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

  test('navigation: spec preview updates when changing between different declarations inside inspector', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    await click('[data-test-accordion-item="spec-preview"] button');
    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Pet2');
    assert.dom('[data-test-number-of-instance]').hasText('2 instances');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Pet');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);
    await click('[data-test-boxel-selector-item-text="PetField"]');
    assert
      .dom('[data-test-title] [data-test-boxel-input]')
      .hasValue('PetField');
    assert.dom('[data-test-exported-type]').hasText('field');
    assert.dom('[data-test-exported-name]').hasText('PetField');
    assert.dom('[data-test-spec-tag]').hasText('field');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);

    await click('[data-test-boxel-selector-item-text="Pet"]');

    assert
      .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
      .containsText('pet-entry');
    await click('[data-test-spec-selector] > div');
    await click('[data-option-index="1"]');

    assert.dom('[data-test-title] [data-test-boxel-input]').hasValue('Pet');
    assert.dom('[data-test-number-of-instance]').hasText('2 instances');
    assert.dom('[data-test-exported-type]').hasText('card');
    assert.dom('[data-test-exported-name]').hasText('Pet');
    assert.dom('[data-test-module-href]').hasText(`${testRealmURL}pet`);
  });

  test('show overlay on examples card', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitFor('[data-test-accordion-item="spec-preview"]');
    assert.dom('[data-test-accordion-item="spec-preview"]').exists();
    await click('[data-test-accordion-item="spec-preview"] button');

    await waitFor('[data-test-spec-selector]');
    assert.dom('[data-test-spec-selector]').exists();

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
});
