import {
  fillIn,
  find,
  click,
  settled,
  waitFor,
  waitUntil,
  currentURL,
  visit,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';

import stringify from 'safe-stable-stringify';

import {
  baseRealm,
  Deferred,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import type MonacoService from '@cardstack/host/services/monaco-service';
import type { SerializedState } from '@cardstack/host/services/operator-mode-state-service';

import { CodeModePanelHeights } from '@cardstack/host/utils/local-storage-keys';

import {
  elementIsVisible,
  getMonacoContent,
  percySnapshot,
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupOnSave,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  type TestContextWithSave,
  setMonacoContent,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { assertRecentFileURLs } from '../../helpers/recent-files-cards';
import { setupApplicationTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';

const testRealmURL2 = 'http://test-realm/test2/';
const realmAFiles: Record<string, any> = {
  '.realm.json': {
    name: 'Test Workspace A',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
    iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
  },
  'index.json': {
    data: {
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  },
};

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
  import StringField from "https://cardstack.com/base/string";
  import { Friend } from './friend';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field cardTitle = contains(StringField, {
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
          <p>Title: <@fields.cardTitle /></p>
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
const petCardSource = `
  import { contains, field, Component, CardDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
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
    @field department = contains(StringField);

    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <@fields.firstName /> <@fields.lastName />

        Department: <@fields.department />
      </template>
    };
  }
`;

const erroringModuleSource = `throw new Error('boom');`;

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

  class LocalCardWithoutExportRelationship extends CardDef {
    static displayName = 'local card but without export relationship';
  }

  export default class DefaultClass {}
`;

const commandModuleSource = `
  import { Command } from '@cardstack/runtime-common';

  export class SampleCommand extends Command {
    async getInputType() {
      return undefined;
    }

    protected async run(input) {
      return input;
    }
  }
`;

const friendCardSource = `
  import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Friend extends CardDef {
    static displayName = 'Friend';
    @field name = contains(StringField);
    @field friend = linksTo(() => Friend);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Person) {
        return name;
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-person>
          <p>First name: <@fields.firstName /></p>
          <p>Last name: <@fields.lastName /></p>
          <p>Title: <@fields.cardTitle /></p>
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

const exportsSource = `
  import {
    contains,
    field,
    CardDef,
    FieldDef
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class AncestorCard1 extends CardDef {
    static displayName = 'AncestorCard1';
    @field name = contains(StringField);
  }

  export class AncestorCard2 extends CardDef {
    static displayName = 'AncestorCard2';
    @field name = contains(StringField);
  }

  export class AncestorCard3 extends CardDef {
    static displayName = 'AncestorCard3';
    @field name = contains(StringField);
  }

  export class AncestorField1 extends FieldDef {
    static displayName = 'AncestorField1';
    @field name = contains(StringField);
  }
`;
const specialExportsSource = `
  import {
    contains,
    field,
    CardDef
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  class AncestorCard extends CardDef {
    static displayName = 'Ancestor';
    @field name = contains(StringField);
  }

  export default class DefaultAncestorCard extends CardDef {
    static displayName = 'DefaultAncestor';
    @field name = contains(StringField);
  }

  export { AncestorCard as RenamedAncestorCard}
`;

const importsSource = `
  import { AncestorCard2, AncestorField1 } from './exports';
  import  { AncestorCard3 as FatherCard3 } from './exports';
  import  DefaultAncestorCard from './special-exports';
  import  { RenamedAncestorCard } from './special-exports';
  import {
    contains,
    field,
    linksTo,
    linksToMany
  } from 'https://cardstack.com/base/card-api';

  export class ChildCard1 extends AncestorCard2 {
    static displayName = 'ChildCard1';
    @field field1 = contains(AncestorField1)
    @field field2 = linksTo(AncestorCard2)
    @field field3 = linksTo(()=>ChildCard2)
    @field field4 = linksToMany(AncestorCard2)
  }

  export class ChildCard2 extends DefaultAncestorCard {
    static displayName = 'ChildCard2';
  }

  export class ChildCard3 extends RenamedAncestorCard{
    static displayName = 'ChildCard3';
  }

  export class ChildCard4 extends FatherCard3{
    static displayName = 'ChildCard4';
  }

  export class ChildCard5 extends ChildCard2 {
    static displayName = 'ChildCard5';
  }

  export class ChildField1 extends AncestorField1{
    static displayName = 'ChildField1';
  }
`;

const reExportSource = `
  import {
    CardDef,
    FieldDef,
    BaseDef as BDef,
    contains,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import NumberField from 'https://cardstack.com/base/number';

  export const exportedVar = 'exported var';

  export { StringField as StrCard };

  export { FieldDef as FDef, CardDef, contains, BDef };

  export * from './in-this-file'; //Will not display inside "in-this-file"

  export default NumberField;
  export { Person as Human } from './person';

  export { default as Date } from 'https://cardstack.com/base/date';
`;

const localInheritSource = `
  import {
    contains,
    field,
    CardDef,
    FieldDef,
  } from 'https://cardstack.com/base/card-api';

  class GrandParent extends CardDef {
    static displayName = 'local grandparent';
  }

  class Parent extends GrandParent {
    static displayName = 'local parent';
  }

  class Activity extends FieldDef {
    static displayName = 'my activity';
  }
  class Hobby extends Activity {
    static displayName = 'my hobby';
  }
  class Sport extends Hobby {
    static displayName = 'my sport';
  }

  export class Child extends Parent {
    static displayName = 'exported child';
    @field sport = contains(Sport);
  }
`;

module('Acceptance | code submode | inspector tests', function (hooks) {
  let adapter: TestRealmAdapter;
  let monacoService: MonacoService;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealmURL2],
    autostart: true,
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
      [testRealmURL2]: ['read', 'write'],
    });

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
      contents: { ...SYSTEM_CARD_FIXTURE_CONTENTS, ...realmAFiles },
      realmURL: testRealmURL2,
    });
    ({ adapter } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.gts': indexCardSource,
        'pet-person.gts': personCardSource,
        'person.gts': personCardSource,
        'pet.gts': petCardSource,
        'friend.gts': friendCardSource,
        'employee.gts': employeeCardSource,
        'in-this-file.gts': inThisFileSource,
        'exports.gts': exportsSource,
        'special-exports.gts': specialExportsSource,
        'imports.gts': importsSource,
        're-export.gts': reExportSource,
        'local-inherit.gts': localInheritSource,
        'command-module.gts': commandModuleSource,
        'erroring-module.gts': erroringModuleSource,
        'empty-file.gts': '',
        'person-entry.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Person',
              cardDescription: 'Spec',
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
        'léame.md': 'hola mundo',
        'readme.md': 'hello world',
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
        'Pet/vangogh.json': {
          data: {
            attributes: {
              name: 'Van Gogh',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}pet`,
                name: 'Pet',
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
    }));

    monacoService = getService('monaco-service');
  });

  test('inspector will show json instance definition and module definition in card inheritance panel', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}Person/1.json`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-card-module-definition]');
    await waitFor('[data-test-card-instance-definition]');

    assert.dom('[data-test-card-module-definition]').includesText('Card');
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-file-extension]',
      )
      .includesText('.gts');
    await waitFor(
      '[data-test-card-module-definition] [data-test-definition-realm-name]',
    );
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-realm-name]',
      )
      .includesText('Test Workspace B');
    assert.dom('[data-test-card-module-definition]').doesNotHaveClass('active');
    assert
      .dom('[data-test-card-instance-definition]')
      .includesText('Hassan Abdel-Rahman');
    assert
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-file-extension]',
      )
      .includesText('.JSON');
    await waitFor(
      '[data-test-card-instance-definition] [data-test-definition-realm-name]',
    );
    assert
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-realm-name]',
      )
      .includesText('Test Workspace B');
    assert
      .dom('[data-test-definition-info-text]')
      .includesText('Last saved just now');
    assert
      .dom('[data-test-card-instance-definition] [data-test-definition-header]')
      .hasClass('active');
  });

  test('inspector will show module definition in card inheritance panel', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-card-module-definition]');

    assert.dom('[data-test-card-module-definition]').includesText('Card');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);

    assert
      .dom('[data-test-card-module-definition] [data-test-definition-header]')
      .hasClass('active');
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-file-extension]',
      )
      .includesText('.gts');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
    assert.dom('[data-test-card-module-definition]').includesText('Card');
    await waitFor(
      '[data-test-card-module-definition] [data-test-definition-realm-name]',
    );
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-realm-name]',
      )
      .includesText('Test Workspace B');
    assert.dom('[data-test-card-instance-definition]').doesNotExist();
  });

  test('can switch between inspector showing module definition and inspector showing json instance definition in card inheritance panel', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-card-module-definition]');

    assert.dom('[data-test-card-module-definition]').includesText('Card');
    assert.dom('[data-test-card-instance-definition]').doesNotExist();

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-directory="Person/"]');
    await waitFor('[data-test-file="Person/1.json"]');
    await click('[data-test-file="Person/1.json"]');

    await click('[data-test-inspector-toggle]');
    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-card-instance-definition]')
      .includesText('Hassan Abdel-Rahman');
    assert
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-file-extension]',
      )
      .includesText('.JSON');
  });

  test('"in-this-file" panel displays all elements and re-highlights upon selection', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the last index
    let elementName = 'default (DefaultClass) class';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(11)')
      .hasText(elementName, 'defaults to the last declaration');
    assert.true(monacoService.getLineCursorOn()?.includes('DefaultClass'));
    // elements must be ordered by the way they appear in the source code
    const expectedElementNames = [
      'AClassWithExportName (LocalClass) class',
      'ExportedClass class',
      'ExportedClassInheritLocalClass class',
      'exportedFunction function',
      'LocalCard card',
      'ExportedCard card',
      'ExportedCardInheritLocalCard card',
      'LocalField field',
      'ExportedField field',
      'ExportedFieldInheritLocalField field',
      'default (DefaultClass) class',
    ];
    expectedElementNames.forEach(async (elementName, index) => {
      await waitFor(
        `[data-test-boxel-selector-item]:nth-of-type(${index + 1})`,
      );
      assert
        .dom(`[data-test-boxel-selector-item]:nth-of-type(${index + 1})`)
        .hasText(elementName);
    });
    assert.dom('[data-test-boxel-selector-item]').exists({ count: 11 });
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(elementName);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();

    // clicking on a card
    elementName = 'ExportedCard';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);
    await waitFor('[data-test-card-module-definition]');
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert.dom('[data-test-card-module-definition]').exists();
    assert.dom('[data-test-definition-header]').includesText('Card Definition');
    assert
      .dom('[data-test-card-module-definition]')
      .includesText('exported card');
    await waitFor('[data-test-card-schema="exported card"]');
    assert.dom('[data-test-card-schema="exported card"]').exists({ count: 1 });
    assert
      .dom(
        `[data-test-card-schema="exported card"] [data-test-field-name="someString"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert.dom(`[data-test-total-fields]`).containsText('5');
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));

    // clicking on a field
    elementName = 'ExportedField';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} field`);
    await waitFor('[data-test-card-module-definition]');
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert
      .dom('[data-test-definition-header]')
      .includesText('Field Definition');
    assert
      .dom('[data-test-card-module-definition]')
      .includesText('exported field');
    await waitFor('[data-test-card-schema="exported field"]');
    assert.dom('[data-test-card-schema="exported field"]').exists({ count: 1 });
    assert.dom(`[data-test-total-fields]`).containsText('1');
    assert
      .dom(
        `[data-test-card-schema="exported field"] [data-test-field-name="someString"] [data-test-card-display-name="String"]`,
      )
      .exists();
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));

    // clicking on an exported function
    elementName = 'exportedFunction';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} function`);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();
    assert.dom('[data-test-card-module-definition]').doesNotExist();
    assert
      .dom('[data-test-schema-editor-file-incompatibility-message]')
      .hasText(
        `No tools are available for the selected item: function "exportedFunction". Select a card or field definition in the inspector.`,
      );
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));
  });

  test('inspector persists scroll position but choosing another element overrides it', async function (assert) {
    window.localStorage.setItem(
      CodeModePanelHeights,
      JSON.stringify({ filePanel: 50, recentPanel: 50 }),
    );
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    let localClassSelector =
      '[data-test-boxel-selector-item-text="LocalClass"]';
    let localClassElement = find(localClassSelector);

    if (!localClassElement) {
      assert.ok(localClassElement, 'local class should exist');
    } else {
      assert.notOk(
        await elementIsVisible(localClassElement),
        'expected local class not to be within view',
      );

      localClassElement.scrollIntoView({ block: 'center' });

      assert.ok(
        await elementIsVisible(localClassElement),
        'expected local class to now be within view',
      );
    }

    await click('[data-test-file-browser-toggle]');
    assert.dom(localClassSelector).doesNotExist();

    await click('[data-test-inspector-toggle]');
    await waitFor(localClassSelector);

    let position = new MonacoSDK.Position(15, 0);
    monacoService.updateCursorPosition(position);

    await settled();

    let exportedClassSelector =
      '[data-test-boxel-selector-item-text="ExportedClass"]';
    let exportedClassElement = find(exportedClassSelector);

    if (!exportedClassElement) {
      assert.ok(exportedClassElement, 'exported class element should exist');
    } else {
      assert.ok(
        await elementIsVisible(exportedClassElement),
        'expected exported class to have scrolled into view',
      );
    }
  });

  test<TestContextWithSave>('can duplicate an instance in same realm', async function (assert) {
    assert.expect(7);
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}Pet/vangogh.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor(`[data-test-action-button="Duplicate"]`);
    await click('[data-test-action-button="Duplicate"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );
    await percySnapshot(assert);

    let deferred = new Deferred<void>();
    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error(`expected json save data`);
      }
      if ((json.data.meta.adoptsFrom as ResolvedCodeRef)?.name === 'Pet') {
        id = url.href;
        assert.strictEqual(
          json.data.attributes?.name,
          'Van Gogh',
          'the name field is correct',
        );
        assert.deepEqual(json.data.meta.adoptsFrom, {
          module: '../pet',
          name: 'Pet',
        });
        assert.strictEqual(json.data.meta.realmURL, testRealmURL);
        this.unregisterOnSave?.();
        deferred.fulfill();
      }
    });
    await click('[data-test-duplicate-card-instance]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;

    await settled();
    await waitFor(`[data-test-code-mode-card-renderer-header="${id}"]`);
    assert.dom('[data-test-card-resource-loaded]').containsText('Pet');
    assert
      .dom(
        `[data-test-code-mode-card-renderer-header="${id}"] [data-test-realm-icon-url]`,
      )
      .hasAttribute('aria-label', 'Test Workspace B');
    assert.dom('[data-test-field="name"] input').hasValue('Van Gogh');
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${id}.json`);
  });

  test<TestContextWithSave>('can duplicate an instance in different realm', async function (assert) {
    assert.expect(8);
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}Pet/vangogh.json`,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    await waitFor(`[data-test-action-button="Duplicate"]`);
    await click('[data-test-action-button="Duplicate"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );

    // realm selection
    await click(`[data-test-realm-dropdown-trigger]`);
    await waitFor('[data-test-boxel-menu-item-text="Test Workspace A"]');
    await click('[data-test-boxel-menu-item-text="Test Workspace A"]');
    await waitFor(`[data-test-realm-name="Test Workspace A"]`);
    assert.dom('[data-test-realm-name]').hasText('Test Workspace A');

    let deferred = new Deferred<void>();
    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error(`expected json save data`);
      }
      id = url.href;
      assert.strictEqual(
        json.data.attributes?.name,
        'Van Gogh',
        'the name field is correct',
      );
      assert.deepEqual(json.data.meta.adoptsFrom, {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      });
      assert.strictEqual(json.data.meta.realmURL, testRealmURL2);
      deferred.fulfill();
    });
    await click('[data-test-duplicate-card-instance]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;

    await settled();
    await waitFor(`[data-test-code-mode-card-renderer-header="${id}"]`);
    assert.dom('[data-test-card-resource-loaded]').containsText('Pet');
    assert
      .dom(
        `[data-test-code-mode-card-renderer-header="${id}"] [data-test-realm-icon-url]`,
      )
      .hasAttribute('aria-label', 'Test Workspace A');
    assert.dom('[data-test-field="name"] input').hasValue('Van Gogh');
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${id}.json`);
  });

  test('can delete a card instance from code submode with no recent files to fall back on', async function (assert) {
    let recentCardsService = getService('recent-cards-service');
    let recentFilesService = getService('recent-files-service');

    [`${testRealmURL}Pet/vangogh`, `${testRealmURL}Person/1`].map((url) =>
      recentCardsService.add(url),
    );
    recentFilesService.addRecentFileUrl(`${testRealmURL}Pet/vangogh.json`);

    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
          {
            id: `${testRealmURL}Pet/vangogh`,
            format: 'isolated',
          },
        ],
      ],
    });
    assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"]`).exists();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');

    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${testRealmURL}Pet/vangogh.json`],
      'recent file is correct',
    );
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
    assert.dom('[data-test-empty-code-mode]').doesNotExist();

    await click('[data-test-action-button="Delete"]');
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/vangogh"]`)
      .exists();
    assert
      .dom('[data-test-delete-msg]')
      .includesText('Delete the card Van Gogh?');
    await percySnapshot(assert);

    await click('[data-test-confirm-delete-button]');
    assert.dom('[data-test-empty-code-mode]').exists();

    await percySnapshot(
      'Acceptance | operator mode tests | can delete a card instance from code submode with no recent files - empty code submode',
    );
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"`).exists();
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`)
      .doesNotExist('stack item removed');

    assert.deepEqual(
      recentCardsService.recentCardIds,
      [`${testRealmURL}Person/1`],
      'the deleted card has been removed from recent cards',
    );
    assert.deepEqual(
      recentFilesService.recentFiles.length,
      0,
      'the deleted card has been removed from recent files',
    );

    let notFound = await adapter.openFile('Pet/vangogh.json');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
  });

  test('Can delete a card instance from code submode and fall back to recent file', async function (assert) {
    let recentFilesService = getService('recent-files-service');

    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
          {
            id: `${testRealmURL}Pet/vangogh`,
            format: 'isolated',
          },
        ],
      ],
    });
    assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"]`).exists();

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');

    assert.strictEqual(recentFilesService.recentFiles.length, 1);

    recentFilesService.addRecentFileUrl(`${testRealmURL}Pet/mango.json`);
    assertRecentFileURLs(assert, recentFilesService.recentFiles, [
      `${testRealmURL}Pet/mango.json`,
      `${testRealmURL}Pet/vangogh.json`,
    ]);

    await click('[data-test-action-button="Delete"]');
    assert
      .dom(`[data-test-delete-modal="${testRealmURL}Pet/vangogh"]`)
      .exists();

    await click('[data-test-confirm-delete-button]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assert.deepEqual(JSON.parse(getMonacoContent()), {
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
    });

    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"`).exists();
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Pet/vangogh"`)
      .doesNotExist('stack item removed');
    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${testRealmURL}Pet/mango.json`],
      'the deleted card has been removed from recent files',
    );
  });

  test('can delete a card definition and fallback to recent file', async function (assert) {
    let recentFilesService = getService('recent-files-service');

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });

    recentFilesService.addRecentFileUrl(`${testRealmURL}Pet/mango.json`);
    assertRecentFileURLs(assert, recentFilesService.recentFiles, [
      `${testRealmURL}Pet/mango.json`,
      `${testRealmURL}pet.gts`,
    ]);
    assert.dom('[data-test-delete-modal-container]').doesNotExist();

    await click('[data-test-delete-module-button]');
    assert.dom(`[data-test-delete-modal="${testRealmURL}pet.gts"]`).exists();

    await click('[data-test-confirm-delete-button]');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${testRealmURL}Pet/mango.json`],
      'the deleted card def has been removed from recent files',
    );

    let notFound = await adapter.openFile('pet.gts');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
  });

  test('can delete a card definition with no recent files to fall back on', async function (assert) {
    let recentFilesService = getService('recent-files-service');

    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}pet.gts`,
    });

    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${testRealmURL}pet.gts`],
      'recent file is correct',
    );
    assert.dom('[data-test-empty-code-mode]').doesNotExist();

    await click('[data-test-delete-module-button]');
    assert.dom(`[data-test-delete-modal="${testRealmURL}pet.gts"]`).exists();

    await click('[data-test-confirm-delete-button]');
    assert.dom('[data-test-empty-code-mode]').exists();
    assert.strictEqual(
      recentFilesService.recentFiles.length,
      0,
      'the deleted card has been removed from recent files',
    );
    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [],
      'recent file is correct',
    );

    let notFound = await adapter.openFile('pet.gts');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  test('shows command panel for command declarations', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: Submodes.Code,
      codePath: `${testRealmURL}command-module.gts`,
    });

    await waitFor('[data-test-command-panel-header]');
    assert
      .dom('[data-test-command-panel-header]')
      .hasText('Command', 'renders command panel');
    assert
      .dom('[data-test-card-module-definition]')
      .hasTextContaining('SampleCommand', 'shows command definition details');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText('SampleCommand command', 'selector shows command type');
  });

  test('can delete a misc file', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}léame.md`,
    });
    assert.dom('[data-test-delete-modal-container]').doesNotExist();

    await waitFor(`[data-test-action-button="Delete"]`);
    await click('[data-test-action-button="Delete"]');
    await waitFor(`[data-test-delete-modal="${testRealmURL}l%C3%A9ame.md"]`);
    assert
      .dom('[data-test-delete-msg]')
      .includesText('Delete the file léame.md?');
    await click('[data-test-confirm-delete-button]');
    await waitFor('[data-test-empty-code-mode]');

    let notFound = await adapter.openFile('léame.md');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
    assert.dom('[data-test-delete-modal-container]').doesNotExist();
  });

  test('After opening inherited definition inside inheritance panel, "in-this-file" highlights selected definition', async function (assert) {
    let operatorModeState = {
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}imports.gts`,
    } as SerializedState;

    await visitOperatorMode(operatorModeState);

    // clicking on normal card
    let elementName = 'ChildCard1';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    let selected = 'AncestorCard2 card';
    await waitFor(`[data-test-clickable-definition-container]`);
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);

    //clicking on default card
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildCard2';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    selected = 'default (DefaultAncestorCard) card';
    await waitFor(`[data-test-clickable-definition-container]`);
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);

    //clicking on card which is renamed during export
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildCard3';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    selected = 'RenamedAncestorCard (AncestorCard) card';
    await waitFor(`[data-test-clickable-definition-container]`);
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);

    //clicking on card which is renamed during import
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildCard4';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    selected = 'AncestorCard3 card';
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);

    //clicking on card which is defined locally
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildCard5';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    selected = 'ChildCard2 card';
    await waitFor(`[data-test-clickable-definition-container]`);
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');

    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);
    //clicking on field
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildField1';
    await waitFor(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    selected = 'AncestorField1 field';
    await click(`[data-test-clickable-definition-container]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(selected);
  });

  test('After opening definition from card type and fields in module inspector, "in-this-file" highlights selected definition', async function (assert) {
    let operatorModeState = {
      submode: Submodes.Code,
      codePath: `${testRealmURL}imports.gts`,
    };

    await visitOperatorMode(operatorModeState);

    //click card type
    await visitOperatorMode(operatorModeState);
    await click(`[data-test-boxel-selector-item-text="ChildCard1"]`);
    let elementName = 'AncestorCard2';
    await waitFor(
      `[data-test-card-schema="${elementName}"] [data-test-card-schema-navigational-button]`,
    );
    await click(
      `[data-test-card-schema="${elementName}"] [data-test-card-schema-navigational-button]`,
    );
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });

    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);

    //click normal field
    await visitOperatorMode(operatorModeState);
    elementName = 'AncestorField1';
    await waitFor(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field1"] [data-test-card-display-name="${elementName}"]`,
    );
    await click(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field1"] [data-test-card-display-name="${elementName}"]`,
    );
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} field`);

    //click linksTo card
    await visitOperatorMode(operatorModeState);

    elementName = 'AncestorCard2';
    await waitFor(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field2"] [data-test-card-display-name="${elementName}"]`,
    );
    await click(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field2"] [data-test-card-display-name="${elementName}"]`,
    );

    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);
    //click linksTo card in the same file
    await visitOperatorMode(operatorModeState);

    elementName = 'ChildCard2';
    await waitFor(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field3"] [data-test-card-display-name="${elementName}"]`,
    );
    await click(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field3"] [data-test-card-display-name="${elementName}"]`,
    );
    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);

    //click linksTo many card
    await click('[data-boxel-selector-item-text="ChildCard1"]');
    elementName = 'AncestorCard2';
    await waitFor(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field4"] [data-test-card-display-name="${elementName}"]`,
    );
    await click(
      `[data-test-card-schema="ChildCard1"] [data-test-field-name="field4"] [data-test-card-display-name="${elementName}"]`,
    );

    assert.operatorModeParametersMatch(currentURL(), {
      codeSelection: elementName,
    });
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);
  });

  test('in-this-file panel displays re-exports', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}re-export.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the 1st index
    let elementName = 'StrCard (StringField) field';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(1)')
      .hasText(elementName);
    //TODO: intentionally not care about default line position for exports
    //currently, only focus cursor if selecting declaration; not the reverse
    //assert.true(monacoService.getLineCursorOn()?.includes('Str'));

    // elements must be ordered by the way they appear in the source code
    const expectedElementNames = [
      'StrCard (StringField) field',
      'FDef (FieldDef) field',
      'CardDef card',
      'BDef base',
      'default (NumberField) field',
      'Human (Person) card',
      'Date (default) field',
    ];
    expectedElementNames.forEach(async (elementName, index) => {
      await waitFor(
        `[data-test-boxel-selector-item]:nth-of-type(${index + 1})`,
      );
      assert
        .dom(`[data-test-boxel-selector-item]:nth-of-type(${index + 1})`)
        .hasText(elementName);
    });
    assert.dom('[data-test-boxel-selector-item]').exists({ count: 7 });

    //clicking on a base card
    elementName = 'BDef';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} base`);
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert.dom('[data-test-card-module-definition]').exists();
    assert
      .dom('[data-test-definition-header]')
      .includesText('Re-exported Base Definition');
    assert.dom('[data-test-card-module-definition]').includesText('Base');
    assert.true(monacoService.getLineCursorOn()?.includes('BDef'));
    assert.dom('[data-test-file-incompatibility-message]').doesNotExist();

    //clicking on re-export (which doesn't enter module scope)
    elementName = 'Person';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`Human (${elementName}) card`);
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert.dom('[data-test-card-module-definition]').exists();
    assert
      .dom('[data-test-definition-header]')
      .includesText('Re-exported Card Definition');
    assert.dom('[data-test-card-module-definition]').includesText('Card');
    assert.true(monacoService.getLineCursorOn()?.includes('Human'));
    assert.dom('[data-test-file-incompatibility-message]').doesNotExist();
  });

  test('"in-this-file" panel displays local grandfather card. selection will move cursor and display card or field schema', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}local-inherit.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the last index
    await click(`[data-test-boxel-selector-item-text="GrandParent"]`);
    let elementName = 'GrandParent card';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(1)')
      .hasText(elementName);
    assert.true(monacoService.getLineCursorOn()?.includes('GrandParent'));
    assert.true(monacoService.getLineCursorOn()?.includes('CardDef'));
    // elements must be ordered by the way they appear in the source code
    const expectedElementNames = [
      'GrandParent card',
      'Parent card',
      'Activity field',
      'Hobby field',
      'Sport field',
      'Child card',
    ];
    expectedElementNames.forEach(async (elementName, index) => {
      await waitFor(
        `[data-test-boxel-selector-item]:nth-of-type(${index + 1})`,
      );
      assert
        .dom(`[data-test-boxel-selector-item]:nth-of-type(${index + 1})`)
        .hasText(elementName);
    });

    //select card defined locally
    elementName = 'Parent';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} card`);
    await waitFor('[data-test-card-module-definition]');
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert.dom('[data-test-card-module-definition]').exists();
    assert.dom('[data-test-definition-header]').includesText('Card Definition');
    assert
      .dom('[data-test-card-module-definition]')
      .includesText('local parent');
    await waitFor('[data-test-card-schema="local parent"]');
    assert
      .dom('[data-test-card-schema="local grandparent"]')
      .exists({ count: 1 });
    assert.dom(`[data-test-card-schema="local parent"]`).exists();
    assert.dom(`[data-test-card-schema="local grandparent"]`).exists();
    assert.dom(`[data-test-total-fields]`).containsText('4');
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));
    assert.true(monacoService.getLineCursorOn()?.includes('GrandParent'));

    //select field defined locally
    elementName = 'Sport';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} field`);
    await waitFor('[data-test-card-module-definition]');
    assert.dom('[data-test-inheritance-panel-header]').exists();
    assert.dom('[data-test-card-module-definition]').exists();
    assert
      .dom('[data-test-definition-header]')
      .includesText('Field Definition');
    assert.dom('[data-test-card-module-definition]').includesText('my sport');
    await waitFor('[data-test-card-schema="my sport"]');
    assert.dom('[data-test-card-schema="my sport"]').exists({ count: 1 });
    assert.dom(`[data-test-card-schema="my hobby"]`).exists({ count: 1 });
    assert.dom(`[data-test-card-schema="my activity"]`).exists({ count: 1 });
    assert.dom(`[data-test-total-fields]`).containsText('0');
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));

    //clicking on inherited field defined locally
    await waitFor(`[data-test-clickable-definition-container]`);
    await click(`[data-test-clickable-definition-container]`); //clicking on Hobby
    await waitFor('[data-test-boxel-selector-item-selected]');
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText('Hobby field');
    await waitFor('[data-test-card-schema="my hobby"]');
    assert.dom(`[data-test-card-schema="my hobby"]`).exists({ count: 1 });
    assert.dom(`[data-test-card-schema="my activity"]`).exists({ count: 1 });
    assert.dom(`[data-test-total-fields]`).containsText('0');
    assert.true(monacoService.getLineCursorOn()?.includes('Hobby'));
    assert.true(monacoService.getLineCursorOn()?.includes('Activity'));
  });

  test('"in-this-file" panel maintains selection after editing name of declaration', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name]');
    await waitFor('[data-test-in-this-file-selector]');
    //default is the last index
    let elementName = 'default (DefaultClass) class';
    assert
      .dom('[data-test-boxel-selector-item]:nth-of-type(11)')
      .hasText(elementName);
    assert.true(monacoService.getLineCursorOn()?.includes('DefaultClass'));
    // elements must be ordered by the way they appear in the source code
    const expectedElementNames = [
      'AClassWithExportName (LocalClass) class',
      'ExportedClass class',
      'ExportedClassInheritLocalClass class',
      'exportedFunction function',
      'LocalCard card',
      'ExportedCard card',
      'ExportedCardInheritLocalCard card',
      'LocalField field',
      'ExportedField field',
      'ExportedFieldInheritLocalField field',
      'default (DefaultClass) class',
    ];
    expectedElementNames.forEach(async (elementName, index) => {
      await waitFor(
        `[data-test-boxel-selector-item]:nth-of-type(${index + 1})`,
      );
      assert
        .dom(`[data-test-boxel-selector-item]:nth-of-type(${index + 1})`)
        .hasText(elementName);
    });
    assert.dom('[data-test-boxel-selector-item]').exists({ count: 11 });
    assert.dom('[data-test-boxel-selector-item-selected]').hasText(elementName);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();

    // select exported function and edit its name
    elementName = 'exportedFunction';
    await click(`[data-test-boxel-selector-item-text="${elementName}"]`);
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${elementName} function`);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();
    assert.dom('[data-test-card-module-definition]').doesNotExist();
    assert
      .dom('[data-test-schema-editor-file-incompatibility-message]')
      .hasText(
        'No tools are available for the selected item: function "exportedFunction". Select a card or field definition in the inspector.',
      );
    assert.true(monacoService.getLineCursorOn()?.includes(elementName));

    let renamedElementName = 'exportedFunc';
    let editedInThisFileSource = inThisFileSource.replace(
      'exportedFunction',
      renamedElementName,
    );

    setMonacoContent(editedInThisFileSource);
    await waitFor(`[data-test-boxel-selector-item]:nth-of-type(4)`);
    await waitFor('[data-test-code-mode][data-test-save-idle]');
    await waitFor(`[data-test-boxel-selector-item]:nth-of-type(4)`);
    await waitUntil(() => {
      return !document
        .querySelector('[data-test-boxel-selector-item]:nth-of-type(4)')
        ?.textContent?.includes('exportedFunction');
    });

    assert
      .dom(`[data-test-boxel-selector-item]:nth-of-type(4)`)
      .hasText(`${renamedElementName} function`);
    assert.dom('[data-test-boxel-selector-item]').exists({ count: 11 });
    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${renamedElementName} function`);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();

    assert
      .dom('[data-test-boxel-selector-item-selected]')
      .hasText(`${renamedElementName} function`);
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();
    assert.dom('[data-test-card-module-definition]').doesNotExist();
    assert
      .dom('[data-test-schema-editor-file-incompatibility-message]')
      .hasText(
        `No tools are available for the selected item: function "${renamedElementName}". Select a card or field definition in the inspector.`,
      );
  });

  test<TestContextWithSave>('can inherit from an exported card def declaration', async function (assert) {
    assert.expect(11);
    let expectedSrc = `
import { ExportedCard } from './in-this-file';
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends ExportedCard {
  static displayName = "Test Card";
}`.trim();
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );

    assert
      .dom('[data-test-inherits-from-field] .pill')
      .includesText('exported card', 'the inherits from is correct');
    assert.dom('[data-test-create-definition]').isDisabled();

    await fillIn('[data-test-display-name-field]', 'Test Card');
    assert.dom('[data-test-create-definition]').isEnabled();
    await fillIn('[data-test-file-name-field]', '/test-card');
    assert.dom('[data-test-create-definition]').isEnabled();

    let deferred = new Deferred<void>();
    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error(`expected string save data`);
      }
      assert.strictEqual(content, expectedSrc, 'the source is correct');
      deferred.fulfill();
    });
    await percySnapshot(assert);
    await click('[data-test-create-definition]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;

    await settled();
    assert.strictEqual(
      getMonacoContent(),
      expectedSrc,
      'monaco displays the new definition',
    );

    await waitFor('[data-test-card-schema="Test Card"]');
    assert
      .dom('[data-test-card-schema]')
      .exists({ count: 4 }, 'the card hierarchy is displayed in schema editor');
    assert.dom('[data-test-total-fields]').containsText('5');

    // assert modal state is cleared
    await settled();
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );
    assert
      .dom('[data-test-inherits-from-field] .pill')
      .includesText('Test Card', 'the inherits from is correct');
    assert
      .dom('[data-test-display-name-field]')
      .hasNoValue('display name field is empty');
    assert
      .dom('[data-test-file-name-field]')
      .hasNoValue('filename field is empty');
  });

  test<TestContextWithSave>('can inherit from an exported field def declaration', async function (assert) {
    assert.expect(2);
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedField"]');

    await click('[data-boxel-selector-item-text="ExportedField"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );

    assert
      .dom('[data-test-inherits-from-field] .pill')
      .includesText('exported field', 'the inherits from is correct');

    await fillIn('[data-test-display-name-field]', 'Test Field');
    await fillIn('[data-test-file-name-field]', '/test-field');

    let deferred = new Deferred<void>();
    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error(`expected string save data`);
      }
      assert.strictEqual(
        content,
        `
import { ExportedField } from './in-this-file';
import { Component } from 'https://cardstack.com/base/card-api';
export class TestField extends ExportedField {
  static displayName = "Test Field";
}`.trim(),
        'the source is correct',
      );
      deferred.fulfill();
    });
    await click('[data-test-create-definition]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;
  });

  test<TestContextWithSave>('inherit modal state is cleared when modal is cancelled', async function (assert) {
    assert.expect(3);
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );
    await fillIn('[data-test-display-name-field]', 'Test Card');
    await fillIn('[data-test-file-name-field]', '/test-card');
    this.onSave(() => assert.ok(false, 'should not save a file'));
    await click('[data-test-cancel-create-file]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });

    // assert modal state is cleared
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );
    assert
      .dom('[data-test-inherits-from-field] .pill')
      .includesText('exported card', 'the inherits from is correct');
    assert
      .dom('[data-test-display-name-field]')
      .hasNoValue('display name field is empty');
    assert
      .dom('[data-test-file-name-field]')
      .hasNoValue('filename field is empty');
  });

  test<TestContextWithSave>(`can handle the situation where there is a class name collision with the inherited cards class name`, async function (assert) {
    assert.expect(4);
    let expectedSrc = `
import { ExportedCard as ExportedCardParent } from './in-this-file';
import { Component } from 'https://cardstack.com/base/card-api';
export class ExportedCard extends ExportedCardParent {
  static displayName = "Exported Card";
}`.trim();
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );

    await fillIn('[data-test-display-name-field]', 'Exported Card'); // this name collides with the parent card
    await fillIn('[data-test-file-name-field]', '/test-card');

    let deferred = new Deferred<void>();
    this.onSave((_, content) => {
      if (typeof content !== 'string') {
        throw new Error(`expected string save data`);
      }
      assert.strictEqual(content, expectedSrc, 'the source is correct');
      deferred.fulfill();
    });
    await click('[data-test-create-definition]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;

    await settled();
    assert.strictEqual(
      getMonacoContent(),
      expectedSrc,
      'monaco displays the new definition',
    );

    await waitFor('[data-test-card-schema="Exported Card"]');
    assert
      .dom('[data-test-card-schema]')
      .exists({ count: 4 }, 'the card hierarchy is displayed in schema editor');
    assert.dom('[data-test-total-fields]').containsText('5');
  });

  test('field error message displays if you try to inherit using a filename that already exists', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Inherit"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );
    await fillIn('[data-test-display-name-field]', 'Test Card');
    await fillIn('[data-test-file-name-field]', 'in-this-file');
    await click('[data-test-create-definition]');

    assert
      .dom(
        '[data-test-file-name-field][data-test-boxel-input-validation-state="invalid"]',
      )
      .exists('error state for filename field is displayed');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .includesText('This file already exists');

    await fillIn('[data-test-file-name-field]', 'test-file');
    assert
      .dom(
        '[data-test-file-name-field][data-test-boxel-input-validation-state="invalid"]',
      )
      .doesNotExist('error state for filename field is not displayed');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .doesNotExist('no error message displayed');
  });

  test('Inherit action item is not displayed when definition is not exported', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="LocalCard"]');

    await click('[data-boxel-selector-item-text="LocalCard"]');
    await waitFor('[data-test-card-module-definition]');
    assert
      .dom('[data-test-action-button="Inherit"]')
      .doesNotExist('non-exported cards do not display an inherit button');
  });

  test<TestContextWithSave>('can create an instance from an exported card definition', async function (assert) {
    assert.expect(8);
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Create Instance"]');
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="Test Workspace B"]`,
    );

    assert
      .dom('[data-test-inherits-from-field] .pill')
      .includesText('exported card', 'the inherits from is correct');
    assert.dom('[data-test-create-card-instance]').isEnabled();

    let deferred = new Deferred<void>();
    let id: string | undefined;
    this.onSave((url, json) => {
      if (typeof json === 'string') {
        throw new Error(`expected JSON save data`);
      }
      id = url.href;
      assert.strictEqual(
        json.data.attributes?.someString,
        null,
        'someString field is empty',
      );
      assert.strictEqual(
        json.data.meta.realmURL,
        testRealmURL,
        'realm url is correct',
      );
      assert.deepEqual(
        json.data.meta.adoptsFrom,
        {
          module: '../in-this-file',
          name: 'ExportedCard',
        },
        'adoptsFrom is correct',
      );
      deferred.fulfill();
    });

    await percySnapshot(assert);
    await click('[data-test-create-card-instance]');
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await deferred.promise;

    if (!id) {
      assert.ok(false, 'card instance ID does not exist');
    }
    await waitFor('[data-test-create-file-modal]', { count: 0 });
    await waitFor(`[data-test-code-mode-card-renderer-header="${id}"]`);
    assert
      .dom('[data-test-card-resource-loaded]')
      .containsText('exported card');
    assert.dom('[data-test-field="someString"] input').hasValue('');
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${id}.json`);
  });

  test('Create instance action is not displayed for non-exported Card definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="LocalCard"]');

    await click('[data-boxel-selector-item-text="LocalCard"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Create Instance"]')
      .doesNotExist(
        'non-exported card defs do not display a create instance button',
      );
  });

  test('Create instance action is not displayed for field definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedField"]');

    await click('[data-boxel-selector-item-text="ExportedField"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Create Instance"]')
      .doesNotExist('field defs do not display a create instance button');
  });

  test('Create listing action is displayed for exported card definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

    await click('[data-boxel-selector-item-text="ExportedCard"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Create Listing"]')
      .exists('exported card defs display a Create Listing button');
  });

  test('Create listing action is displayed for exported field definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedField"]');

    await click('[data-boxel-selector-item-text="ExportedField"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Create Listing"]')
      .exists('exported field defs display a Create Listing button');
  });

  test('Create listing action is not displayed for non-exported Card definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="LocalCard"]');

    await click('[data-boxel-selector-item-text="LocalCard"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Create Listing"]')
      .doesNotExist(
        'non-exported card defs do not display a Create Listing button',
      );
  });

  test('can find instances of an exported card definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}pet`,
    });

    await waitFor('[data-boxel-selector-item-text="Pet"]');

    await click('[data-boxel-selector-item-text="Pet"]');
    await waitFor('[data-test-card-module-definition]');

    await click('[data-test-action-button="Find instances"]');
    await waitFor('[data-test-search-sheet-search-result]');
    assert
      .dom('[data-test-search-field]')
      .hasValue(`carddef:${testRealmURL}pet/Pet`);
    assert
      .dom('[data-test-search-label]')
      .hasText(`2 Results for “carddef:${testRealmURL}pet/Pet”`);
    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(`[data-test-search-result="${testRealmURL}Pet/vangogh"]`)
      .exists();
  });

  test('find instances action is not displayed for non-exported Card definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="LocalCard"]');

    await click('[data-boxel-selector-item-text="LocalCard"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Find instances"]')
      .doesNotExist(
        'non-exported card defs do not display a Find instances button',
      );
  });

  test('find instances action is not displayed for field definition', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}in-this-file.gts`,
    });

    await waitFor('[data-boxel-selector-item-text="ExportedField"]');

    await click('[data-boxel-selector-item-text="ExportedField"]');
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-action-button="Find instances"]')
      .doesNotExist('field defs do not display a Find instances button');
  });

  test('inspector shows empty file panel with delete button when file is empty', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}empty-file.gts`,
    });

    await waitFor('[data-test-card-inspector-panel]');
    await waitFor('[data-test-current-module-name="empty-file.gts"]');

    assert.dom('[data-test-current-module-name="empty-file.gts"]').exists();
    assert.dom('[data-test-in-this-file-selector]').doesNotExist();
    assert.dom('[data-test-inheritance-panel-header]').doesNotExist();
    assert.dom('[data-test-delete-module-button]').exists();
  });

  test('can delete an erroring module file', async function (assert) {
    await visitOperatorMode({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}erroring-module.gts`,
    });

    await waitFor('[data-test-syntax-error]');
    await waitFor('[data-test-action-button="Delete"]');

    await click('[data-test-action-button="Delete"]');
    await waitFor(
      `[data-test-delete-modal="${testRealmURL}erroring-module.gts"]`,
    );
    await click('[data-test-confirm-delete-button]');
    await waitFor('[data-test-empty-code-mode]');

    let notFound = await adapter.openFile('erroring-module.gts');
    assert.strictEqual(notFound, undefined, 'file ref does not exist');
  });

  module('when the user lacks write permissions', function (hooks) {
    hooks.beforeEach(async function () {
      setRealmPermissions({ [testRealmURL]: ['read'] });
    });

    test('delete button is not displayed for module when user does not have permission to write to realm', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}pet.gts`,
      });
      await waitFor('[data-test-current-module-name="pet.gts"]');
      assert.dom('[data-test-delete-module-button]').doesNotExist();
    });

    test('delete button is not displayed for card instance when user does not have permission to write to realm', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Pet/mango.json`,
      });
      assert.dom('[data-test-action-button="Delete"]').doesNotExist();
    });

    test('delete button is not displayed for misc file when user does not have permission to write to realm', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
        submode: 'code',
        codePath: `${testRealmURL}readme.md`,
      });
      assert.dom('[data-test-action-button="Delete"]').doesNotExist();
    });

    test('delete button is not displayed for empty file when user does not have permission to write to realm', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
        submode: 'code',
        codePath: `${testRealmURL}empty-file.gts`,
      });
      await waitFor('[data-test-current-module-name="empty-file.gts"]');
      assert.dom('[data-test-delete-module-button]').doesNotExist();
    });

    test('Create listing action is not displayed when user does not have permission to write to realm', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
        submode: 'code',
        codePath: `${testRealmURL}in-this-file.gts`,
      });

      await waitFor('[data-boxel-selector-item-text="ExportedCard"]');

      await click('[data-boxel-selector-item-text="ExportedCard"]');
      await waitFor('[data-test-card-module-definition]');

      assert
        .dom('[data-test-action-button="Create Listing"]')
        .doesNotExist(
          'Create Listing button is not displayed when user lacks write permissions',
        );
    });
  });
});
