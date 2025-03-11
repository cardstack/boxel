import {
  click,
  waitFor,
  fillIn,
  triggerKeyEvent,
  findAll,
} from '@ember/test-helpers';

import { waitUntil } from '@ember/test-helpers';

import window from 'ember-window-mock';
import * as MonacoSDK from 'monaco-editor';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import MonacoService from '@cardstack/host/services/monaco-service';

import {
  percySnapshot,
  setupLocalIndexing,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  waitForCodeEditor,
  setupUserSubscription,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

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
    @field friends = linksToMany(Friend);
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

let matrixRoomId: string;
let monacoService: MonacoService;
module('Acceptance | code submode | recent files tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

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
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.gts': indexCardSource,
        'pet-person.gts': personCardSource,
        'person.gts': personCardSource,
        'français.json': '{}',
        'friend.gts': friendCardSource,
        'employee.gts': employeeCardSource,
        'in-this-file.gts': inThisFileSource,
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
  });

  test('recent file links are shown', async function (assert) {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        [testRealmURL, 'index.json'],
        ['http://localhost:4202/test/', 'français.json'],
        'a-non-url-to-ignore',
      ]),
    );

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
      fileView: 'browser',
      openDirs: {},
    });

    await waitForCodeEditor();
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    await waitUntil(() => findAll('[data-test-recent-file]').length === 2);
    assert.dom('[data-test-recent-file]').exists({ count: 2 });

    await waitFor(
      '[data-test-recent-file]:nth-child(1) [data-test-realm-icon-url]',
    );
    assert
      .dom('[data-test-recent-file]:nth-child(1) [data-test-realm-icon-url]')
      .hasStyle({
        backgroundImage: 'url("https://i.postimg.cc/L8yXRvws/icon.png")',
      })
      .hasAttribute('role', 'img')
      .hasAttribute('aria-label', 'Test Workspace B');

    await waitFor(
      '[data-test-recent-file]:nth-child(2) [data-test-realm-icon-url]',
    );
    assert
      .dom('[data-test-recent-file]:nth-child(2) [data-test-realm-icon-url]')
      .hasStyle({
        backgroundImage:
          'url("https://boxel-images.boxel.ai/icons/cardstack.png")',
      })
      .hasAttribute('role', 'img')
      .hasAttribute('aria-label', 'Test Workspace A');

    await click('[data-test-file="index.json"]');
    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('Person/1.json');

    await waitFor('[data-test-file="Person/1.json"]');
    await click('[data-test-file="Person/1.json"]');

    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('index.json');

    await waitFor('[data-test-file="français.json"]');
    await click('[data-test-file="français.json"]');

    assert
      .dom('[data-test-recent-file]:first-child')
      .containsText('Person/1.json')
      .doesNotContainText(testRealmURL, 'expected realm root to be hidden');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('index.json');

    await click('[data-test-recent-file]:nth-child(2)');
    assert.dom('[data-test-index-card]').exists('index card is rendered');

    assert
      .dom('[data-test-recent-file]:first-child')
      .containsText('français.json');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('Person/1.json');

    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('recent-files') || '[]'),
      [
        [testRealmURL, 'index.json', null],
        [testRealmURL, 'français.json', null],
        [testRealmURL, 'Person/1.json', null],
        ['http://localhost:4202/test/', 'français.json', null],
      ],
    );
  });

  test('recent files are truncated at 100', async function (assert) {
    let recentFilesEntries = [];

    for (let i = 0; i < 100; i++) {
      recentFilesEntries.push([testRealmURL, `file-${i}.txt`]);
    }

    window.localStorage.setItem(
      'recent-files',
      JSON.stringify(recentFilesEntries),
    );

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
      fileView: 'browser',
      openDirs: {},
    });

    await waitForCodeEditor();
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    await percySnapshot(assert);

    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('file-0.txt');

    assert
      .dom('[data-test-recent-file]:nth-child(99)')
      .containsText('file-98.txt');

    await click('[data-test-file="index.json"]');

    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('Person/1.json');

    assert
      .dom('[data-test-recent-file]:nth-child(99)')
      .containsText('file-97.txt');
  });

  test('recent files section does not list files not-found', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-card-module-definition]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
    assert.dom('[data-test-recent-files]').exists();
    assert.dom('[data-test-recent-file]').doesNotExist();

    await fillIn('[data-test-card-url-bar-input]', `${testRealmURL}pers`);
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await waitFor('[data-test-card-module-definition]', { count: 0 });

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}pers`);
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('This resource does not exist');
    assert.dom('[data-test-recent-file]').exists({ count: 1 });
    assert.dom(`[data-test-recent-file="${testRealmURL}person.gts"]`).exists();
    assert
      .dom(`[data-test-recent-file]:first-child`)
      .containsText('person.gts');

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Person/1.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Person/1.json`);
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
    assert.dom('[data-test-recent-file]').exists({ count: 1 });
    assert.dom(`[data-test-recent-file="${testRealmURL}pers"]`).doesNotExist();
    assert
      .dom(`[data-test-recent-file]:first-child`)
      .containsText('person.gts');
  });

  test('displays recent files in base realm', async function (assert) {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        ['https://cardstack.com/base/', 'code-ref.gts'],
        ['https://cardstack.com/base/', 'spec.gts'],
        'a-non-url-to-ignore',
      ]),
    );

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
      codePath: `https://cardstack.com/base/date.gts`,
      fileView: 'browser',
      openDirs: {},
    });

    await waitForCodeEditor();
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    assert.dom('[data-test-recent-file]').exists({ count: 2 });

    await waitFor(
      '[data-test-recent-file]:nth-child(1) [data-test-realm-icon-url]',
    );
    assert
      .dom('[data-test-recent-file]:nth-child(1) [data-test-realm-icon-url]')
      .hasStyle({
        backgroundImage:
          'url("https://boxel-images.boxel.ai/icons/cardstack.png")',
      })
      .hasAttribute('role', 'img')
      .hasAttribute('aria-label', 'Base Workspace');

    await waitFor(
      '[data-test-recent-file]:nth-child(2) [data-test-realm-icon-url]',
    );
    assert
      .dom('[data-test-recent-file]:nth-child(2) [data-test-realm-icon-url]')
      .hasStyle({
        backgroundImage:
          'url("https://boxel-images.boxel.ai/icons/cardstack.png")',
      });

    await waitFor('[data-test-file="field-component.gts"]');
    await click('[data-test-file="field-component.gts"]');
    await waitFor('[data-test-file="field-component.gts"].selected');

    assert.dom('[data-test-recent-file]:nth-child(1)').containsText('date.gts');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('code-ref.gts');
    assert.dom('[data-test-recent-file]:nth-child(3)').containsText('spec.gts');

    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('recent-files') || '[]'),
      [
        [
          'https://cardstack.com/base/',
          'field-component.gts',
          {
            column: 81,
            line: 62,
          },
        ],
        [
          'https://cardstack.com/base/',
          'date.gts',
          {
            column: 48,
            line: 39,
          },
        ],
        ['https://cardstack.com/base/', 'code-ref.gts', null],
        ['https://cardstack.com/base/', 'spec.gts', null],
      ],
    );
  });

  test('set cursor based on the position in recent file', async function (assert) {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        [testRealmURL, 'index.json', null],
        [testRealmURL, 'friend.gts', { line: 14, column: 1 }],
      ]),
    );

    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}friend.gts`,
      fileView: 'browser',
      openDirs: {},
    });

    let cursorPosition = monacoService.getCursorPosition();
    assert.strictEqual(cursorPosition?.lineNumber, 14);
    assert.strictEqual(cursorPosition?.column, 1);

    monacoService.updateCursorPosition(new MonacoSDK.Position(22, 3));
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('recent-files') || '[]'),
      [
        [testRealmURL, 'friend.gts', { column: 3, line: 22 }],
        [testRealmURL, 'index.json', null],
      ],
    );
  });
});
