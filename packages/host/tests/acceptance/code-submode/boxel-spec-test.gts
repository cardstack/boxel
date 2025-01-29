import { click, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  setupServerSentEvents,
  visitOperatorMode,
  setupUserSubscription,
  percySnapshot,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

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

let matrixRoomId: string;
module('boxel spec preview', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  let { setActiveRealms, createAndJoinRoom } = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom('@testuser:staging', 'room-test');
    setupUserSubscription(matrixRoomId);

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      contents: {
        'person.gts': personCardSource,
        'pet.gts': petCardSource,
        'employee.gts': employeeCardSource,
        'new-skill.gts': newSkillCardSource,
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Person',
              description: 'Boxel spec',
              specType: 'card',
              ref: {
                module: `./person`,
                name: 'Person',
              },
            },
            meta: {
              adoptsFrom: {
                module: `${baseRealm.url}boxel-spec`,
                name: 'BoxelSpec',
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
                module: `${baseRealm.url}boxel-spec`,
                name: 'BoxelSpec',
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
                module: `${baseRealm.url}boxel-spec`,
                name: 'BoxelSpec',
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
                module: `${baseRealm.url}boxel-spec`,
                name: 'BoxelSpec',
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
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
    setActiveRealms([testRealmURL]);
  });
  test('view when there is a single boxel spec instance', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });
    await waitFor('[data-test-accordion-item="boxel-spec-preview"]');
    assert.dom('[data-test-accordion-item="boxel-spec-preview"]').exists();
    assert.dom('[data-test-has-boxel-spec]').containsText('card');
    await click('[data-test-accordion-item="boxel-spec-preview"] button');
    await waitFor('[data-test-boxel-spec-selector]');
    assert.dom('[data-test-boxel-spec-selector]').exists();
    await percySnapshot(assert);
    assert.dom('[data-test-title]').containsText('Person');
    assert.dom('[data-test-description]').containsText('Boxel spec');
    assert.dom('[data-test-module-href]').containsText(`${testRealmURL}person`);
    assert.dom('[data-test-exported-name]').containsText('Person');
    assert.dom('[data-test-exported-type]').containsText('card');
  });
  test('view when there are multiple boxel spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });
    await waitFor('[data-test-accordion-item="boxel-spec-preview"]');
    assert.dom('[data-test-accordion-item="boxel-spec-preview"]').exists();
    assert.dom('[data-test-has-boxel-spec]').containsText('2 instances');
    await click('[data-test-accordion-item="boxel-spec-preview"] button');
    await waitFor('[data-test-boxel-spec-selector]');
    assert.dom('[data-test-boxel-spec-selector]').exists();
    assert.dom('[data-test-caret-down]').exists();
  });
  test('view when there are no boxel spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    await waitFor('[data-test-accordion-item="boxel-spec-preview"]');
    assert.dom('[data-test-accordion-item="boxel-spec-preview"]').exists();
    assert.dom('[data-test-create-boxel-spec-button]').exists();
    assert.dom('[data-test-create-boxel-spec-intent-message]').exists();
  });
  test('have ability to create new boxel spec instances', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}new-skill.gts`,
    });
    assert.dom('[data-test-create-boxel-spec-button]').exists();
    await click('[data-test-create-boxel-spec-button]');
    assert.dom('[data-test-create-file-modal]').exists();
    await waitFor('[data-test-create-boxel-spec-instance]');
    assert.dom('[data-test-selected-type="NewSkill"]').exists();
    await click('[data-test-create-boxel-spec-instance]');
    await waitFor('[data-test-field="specType"]');
    assert.dom('[data-test-field="specType"] input').hasValue('card');
  });
  test('title does not default to "default"', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}employee.gts`,
    });
    await waitFor('[data-test-accordion-item="boxel-spec-preview"]');
    assert.dom('[data-test-accordion-item="boxel-spec-preview"]').exists();
    await click('[data-test-accordion-item="boxel-spec-preview"] button');
    assert.dom('[data-test-title]').doesNotContainText('default');
    assert.dom('[data-test-exported-name]').containsText('default');
  });
});
