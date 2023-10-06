import {
  visit,
  click,
  waitFor,
  find,
  fillIn,
  triggerKeyEvent,
} from '@ember/test-helpers';

import percySnapshot from '@percy/ember';
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
  setupMockMessageService,
  testRealmURL,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
} from '../helpers';

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
  import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
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

module('Acceptance | code mode tests', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupMockMessageService(hooks);
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

  test('defaults to inheritance view and can toggle to file view', async function (assert) {
    let operatorModeStateParam = stringify({
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
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'Inheritance');
    assert.dom('[data-test-inheritance-toggle]').hasClass('active');
    assert.dom('[data-test-file-browser-toggle]').doesNotHaveClass('active');

    await waitFor('[data-test-card-inheritance-panel]');

    assert.dom('[data-test-card-inheritance-panel]').exists();
    assert.dom('[data-test-file]').doesNotExist();

    await click('[data-test-file-browser-toggle]');

    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inheritance-toggle]').doesNotHaveClass('active');
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');

    await waitFor('[data-test-file]');

    assert.dom('[data-test-inheritance-placeholder]').doesNotExist();
    assert.dom('[data-test-file]').exists();
  });

  test('can navigate file tree, file view mode is persisted in query parameter', async function (assert) {
    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file]');

    assert
      .dom('[data-test-directory="Person/"]')
      .exists('Person/ directory entry is rendered');
    assert.dom('[data-test-directory="Person/"] .icon').hasClass('closed');

    assert
      .dom('[data-test-file="person.gts"]')
      .exists('person.gts file entry is rendered');

    await click('[data-test-directory="Person/"]');
    assert.dom('[data-test-directory="Person/"] .icon').hasClass('open');

    await waitFor('[data-test-file="Person/1.json"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .exists('Person/1.json file entry is rendered');
    await click('[data-test-directory="Person/"]');
    assert
      .dom('[data-test-file="Person/1.json"]')
      .doesNotExist('Person/1.json file entry is not rendered');
  });

  test('can open files', async function (assert) {
    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file="pet-person.gts"]');

    await click('[data-test-file="pet-person.gts"]');

    await waitFor('[data-test-file="pet-person.gts"]');
    assert.dom('[data-test-file="pet-person.gts"]').hasClass('selected');
    assert.dom('[data-test-file="person.gts"]').doesNotHaveClass('selected');

    await click('[data-test-file="Person/1.json"]');

    assert.dom('[data-test-person]').exists();
  });

  test('navigating to a file in a different realm causes it to become active in the file tree', async function (assert) {
    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );

    await fillIn(
      '[data-test-card-url-bar-input]',
      `http://localhost:4202/test/mango.png`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );

    await waitFor('[data-test-file="mango.png"]');
    assert.dom('[data-test-file="mango.png"]').hasClass('selected');
  });

  test('open directories are persisted', async function (assert) {
    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');

    assert.dom('[data-test-directory="Person/"] .icon').hasClass('open');
  });

  test('open file is within view when the file browser renders', async function (assert) {
    let openFilename = 'z19.json';

    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: 'http://test-realm/test/index',
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `http://test-realm/test/${openFilename}`,
      fileView: 'browser',
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');

    let fileElement = find(`[data-test-file="${openFilename}"]`)!;
    assert.ok(
      await elementIsVisible(fileElement),
      'expected open file to be scrolled into view',
    );
  });

  test('open file is within view even when its parent directory is not stored as open', async function (assert) {
    let openFilename = 'zzz/zzz/file.json';

    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: 'http://test-realm/test/index',
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `http://test-realm/test/index`,
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}${openFilename}`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );

    await click('[data-test-file-browser-toggle]');
    await waitFor(`[data-test-file="${openFilename}"]`);

    let fileElement = find(`[data-test-file="${openFilename}"]`)!;

    if (!fileElement) {
      assert.ok(fileElement, 'file element should exist');
    } else {
      assert.ok(
        await elementIsVisible(fileElement),
        'expected open file to be scrolled into view',
      );
    }

    await click('[data-test-directory="zzz/"]');
    assert.dom(`[data-test-file="${openFilename}"]`).doesNotExist();
  });

  test('opening another file preserves the scroll position', async function (assert) {
    let openFilename = 'person.gts';
    let filenameToOpen = 'z19.json';

    let codeModeStateParam = stringify({
      stacks: [
        [
          {
            id: 'http://test-realm/test/index',
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `http://test-realm/test/${openFilename}`,
      fileView: 'browser',
      openDirs: { [testRealmURL]: ['Person/'] },
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');

    let openFileSelector = `[data-test-file="${openFilename}"]`;
    let openFileElement = find(openFileSelector)!;
    assert.ok(
      await elementIsVisible(openFileElement),
      'expected near-top file to be visible',
    );

    let fileToOpenSelector = `[data-test-file="${filenameToOpen}"]`;
    let fileToOpenElement = find(fileToOpenSelector)!;
    assert.notOk(
      await elementIsVisible(fileToOpenElement),
      'expected near-bottom file to not be visible',
    );

    fileToOpenElement.scrollIntoView({ block: 'center' });

    assert.notOk(
      await elementIsVisible(openFileElement),
      'expected near-top file to not be visible after scrolling to near bottom',
    );
    assert.ok(
      await elementIsVisible(fileToOpenElement),
      'expected near-bottom file to be visible after scrolling to near bottom',
    );

    await click(fileToOpenElement);
    await waitFor(openFileSelector);

    openFileElement = find(openFileSelector)!;
    fileToOpenElement = find(fileToOpenSelector)!;

    assert.notOk(
      await elementIsVisible(openFileElement),
      'expected near-top file to not be visible after opening near-bottom file',
    );
    assert.ok(
      await elementIsVisible(fileToOpenElement),
      'expected near-bottom file to be visible after opening it',
    );
  });

  test('recent file links are shown', async function (assert) {
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        [testRealmURL, 'index.json'],
        ['http://localhost:4202/test/', 'person.gts'],
        'a-non-url-to-ignore',
      ]),
    );

    let codeModeStateParam = stringify({
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
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    assert.dom('[data-test-recent-file]').exists({ count: 2 });

    assert
      .dom('[data-test-recent-file]:nth-child(1) [data-test-realm-icon-url]')
      .hasAttribute('src', 'https://i.postimg.cc/L8yXRvws/icon.png')
      .hasAttribute('alt', '');

    assert
      .dom('[data-test-recent-file]:nth-child(2) [data-test-realm-icon-url]')
      .hasAttribute('src', 'https://i.postimg.cc/d0B9qMvy/icon.png');

    await click('[data-test-file="index.json"]');
    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('Person/1.json');

    await waitFor('[data-test-file="Person/1.json"]');
    await click('[data-test-file="Person/1.json"]');

    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('index.json');

    await waitFor('[data-test-file="person.gts"]');
    await click('[data-test-file="person.gts"]');

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
      .containsText('person.gts');
    assert
      .dom('[data-test-recent-file]:nth-child(2)')
      .containsText('Person/1.json');

    assert.deepEqual(
      JSON.parse(window.localStorage.getItem('recent-files') || '[]'),
      [
        [testRealmURL, 'index.json'],
        [testRealmURL, 'person.gts'],
        [testRealmURL, 'Person/1.json'],
        ['http://localhost:4202/test/', 'person.gts'],
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

    let codeModeStateParam = stringify({
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
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    await percySnapshot(assert);

    assert.dom('[data-test-recent-file]').exists({ count: 99 });

    await click('[data-test-file="index.json"]');
    assert.dom('[data-test-recent-file]').exists({ count: 100 });

    assert
      .dom('[data-test-recent-file]:nth-child(1)')
      .containsText('Person/1.json');

    assert
      .dom('[data-test-recent-file]:nth-child(99)')
      .containsText('file-97.txt');
  });

  test('card inheritance panel will show json instance definition and module definition', async function (assert) {
    let operatorModeStateParam = stringify({
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
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-card-inheritance-panel]');
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
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-info-text]',
      )
      .includesText('Last saved just now');
    assert
      .dom('[data-test-card-instance-definition] [data-test-definition-header]')
      .hasClass('active');
  });

  test('card inheritance panel will show module definition', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [[]],
      submode: 'code',
      codePath: `${testRealmURL}person.gts`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-card-inheritance-panel]');
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

  test('non-card JSON is shown as just a file with empty schema editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}z01.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file-definition]');

    assert.dom('[data-test-definition-file-extension]').hasText('.json');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace B');

    assert.dom('[data-test-schema-editor-incompatible]').exists();
  });

  test('invalid JSON is shown as just a file with empty schema editor', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}Person/1`,
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      codePath: `${testRealmURL}not-json.json`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file-definition]');

    assert.dom('[data-test-definition-file-extension]').hasText('.json');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace B');

    assert.dom('[data-test-schema-editor-incompatible]').exists();
  });

  test('empty state displays default realm info', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: null,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file]');

    assert.dom('[data-test-file]').exists();
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');
    assert.dom('[data-test-card-inheritance-panel]').doesNotExist();
    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inheritance-toggle]').isDisabled();

    assert.dom('[data-test-empty-code-mode]').exists();
    assert
      .dom('[data-test-empty-code-mode]')
      .containsText('Choose a file on the left to open it');

    assert.dom('[data-test-card-url-bar-input]').hasValue('');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .containsText('in Test Workspace B');
  });

  test('not-found state displays default realm info', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}perso`, // purposely misspelled
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file]');

    assert.dom('[data-test-file]').exists();
    assert.dom('[data-test-file-browser-toggle]').hasClass('active');
    assert.dom('[data-test-card-inheritance-panel]').doesNotExist();
    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'File Browser');
    assert.dom('[data-test-inheritance-toggle]').isDisabled();

    assert.dom('[data-test-empty-code-mode]').doesNotExist();
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}perso`);
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .containsText('in Test Workspace B');
  });

  test('recent files section does not list files not-found', async function (assert) {
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
    assert.dom('[data-test-total-fields]').containsText('5 Fields');

    assert
      .dom('[data-test-card-schema="Person"] [data-test-total-fields]')
      .containsText('+ 2 Fields');
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
      .dom('[data-test-card-schema="Card"] [data-test-total-fields]')
      .containsText('+ 3 Fields');
    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="title"] [data-test-card-display-name="String"]`,
      )
      .exists();
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
      '[data-test-card-schema="Person"] .pill .realm-icon [data-test-realm-icon-url]',
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
      '[data-test-card-schema="Card"] .pill .realm-icon [data-test-realm-icon-url]',
    );
    assert
      .dom(`[data-test-card-schema="Card"] [data-test-realm-icon-url]`)
      .hasAttribute('data-test-realm-icon-url', realm2IconUrl);

    await waitFor(
      '[data-test-card-schema="Card"] [data-test-field-name="title"] [data-test-realm-icon-url]',
    );
    assert
      .dom(
        `[data-test-card-schema="Card"] [data-test-field-name="title"] [data-test-realm-icon-url]`,
      )
      .hasAttribute('data-test-realm-icon-url', realm2IconUrl);
  });

  test('shows displayName of CardResource when field contains itself', async function (assert) {
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
      '[data-test-card-schema="Employee"] [data-test-card-schema-navigational-button]',
    );

    await waitFor('[data-test-current-module-name]');

    assert.dom('[data-test-current-module-name]').hasText('employee.gts');

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

    await waitFor('[data-test-current-module-name]');
    assert.dom('[data-test-current-module-name]').hasText('string.ts');
  });

  test('code mode handles binary files', async function (assert) {
    let operatorModeStateParam = stringify({
      stacks: [],
      submode: 'code',
      codePath: `http://localhost:4202/test/mango.png`,
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );

    await waitFor('[data-test-file-definition]');

    assert.dom('[data-test-definition-file-extension]').hasText('.png');
    await waitFor('[data-test-definition-realm-name]');
    assert
      .dom('[data-test-definition-realm-name]')
      .hasText('in Test Workspace A');
    assert.dom('[data-test-definition-info-text]').containsText('Last saved');
    assert
      .dom('[data-test-binary-info] [data-test-file-name]')
      .hasText('mango.png');
    assert.dom('[data-test-binary-info] [data-test-size]').hasText('114.71 kB');
    assert
      .dom('[data-test-binary-info] [data-test-last-modified]')
      .containsText('Last modified');
    assert.dom('[data-test-schema-editor-incompatible]').exists();

    await percySnapshot(assert);
  });
});

async function elementIsVisible(element: Element) {
  return new Promise((resolve) => {
    let intersectionObserver = new IntersectionObserver(function (entries) {
      intersectionObserver.unobserve(element);

      resolve(entries[0].isIntersecting);
    });

    intersectionObserver.observe(element);
  });
}
