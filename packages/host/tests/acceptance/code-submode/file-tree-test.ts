import {
  click,
  waitFor,
  find,
  fillIn,
  settled,
  triggerKeyEvent,
  triggerEvent,
} from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  elementIsVisible,
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

const realmInfo = {
  name: 'Test Workspace B',
  backgroundURL:
    'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
  iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
};

let matrixRoomId: string;
module('Acceptance | code submode | file-tree tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    setRealmPermissions({ [testRealmURL]: ['read', 'write'] });

    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    const numStubFiles = 100;
    let stubFiles: Record<string, string> = {};
    for (let i = 0; i < numStubFiles; i++) {
      stubFiles[`z${String(i).padStart(2, '0')}.json`] = '{}';
    }

    // this seeds the loader used during index which obtains url mappings
    // from the global loader
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.gts': indexCardSource,
        'pet-person.gts': personCardSource,
        'person.gts': personCardSource,
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
        ...stubFiles,
        'zzz/zzz/file.json': '{}',
        '.realm.json': realmInfo,
      },
    });
  });

  test('can navigate file tree, file view mode is persisted in query parameter', async function (assert) {
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
      fileView: 'browser',
      codePath: `${testRealmURL}person.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await waitFor('[data-test-file]');
    assert
      .dom('[data-test-directory="Person/"]')
      .exists('Person/ directory entry is rendered')
      .hasAttribute('title', 'Person/');
    assert.dom('[data-test-directory="Person/"] .icon').hasClass('closed');

    assert
      .dom('[data-test-file="person.gts"]')
      .exists('person.gts file entry is rendered')
      .hasAttribute('title', 'person.gts');

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
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert
      .dom('[data-test-realm-name]')
      .hasText(`In ${realmInfo.name}`)
      .hasAttribute('title', `In ${realmInfo.name}`);
    assert.dom('[data-test-realm-writable]').exists();

    await waitFor('[data-test-file="pet-person.gts"]');

    await click('[data-test-file="pet-person.gts"]');

    await waitFor('[data-test-file="pet-person.gts"]');
    assert.dom('[data-test-file="pet-person.gts"]').hasClass('selected');
    assert.dom('[data-test-file="person.gts"]').doesNotHaveClass('selected');

    await click('[data-test-file="Person/1.json"]');

    assert.dom('[data-test-person]').exists();
  });

  module('when the user lacks write permissions', function (hooks) {
    hooks.beforeEach(function () {
      setRealmPermissions({ [testRealmURL]: ['read'] });
    });

    test('it is reflected in the realm header', async function (assert) {
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
        fileView: 'browser',
        codePath: `${testRealmURL}Person/1.json`,
      });

      await waitForCodeEditor();
      await waitFor('[data-test-realm-name]');
      assert.dom('[data-test-realm-not-writable]').exists();
    });
  });

  test('navigating to a file in a different realm causes it to become active in the file tree', async function (assert) {
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
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `http://localhost:4202/test/mango.png`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await waitFor('[data-test-realm-name="Test Workspace A"]');
    assert
      .dom(
        '[data-test-realm-icon-url="https://boxel-images.boxel.ai/icons/cardstack.png"]',
      )
      .exists();
    assert.dom('[data-test-realm-name]').hasText('In Test Workspace A');

    await waitFor('[data-test-file="mango.png"]');
    assert.dom('[data-test-file="mango.png"]').hasClass('selected');
  });

  test('open directories are persisted', async function (assert) {
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
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await waitFor('[data-test-file]');

    assert.dom('[data-test-directory="Person/"] .icon').hasClass('open');
  });

  test('open file is within view when the file browser renders', async function (assert) {
    let openFilename = 'z19.json';

    await visitOperatorMode({
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
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await waitFor('[data-test-file]');
    await waitFor('[data-test-file-tree-mask]', { count: 0 });
    let fileElement = find(`[data-test-file="${openFilename}"]`)!;
    assert.ok(
      await elementIsVisible(fileElement),
      'expected open file to be scrolled into view',
    );
  });

  test('open file is within view even when its parent directory is not stored as open', async function (assert) {
    let openFilename = 'zzz/zzz/file.json';

    await visitOperatorMode({
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
    });

    await waitForCodeEditor();

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
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await waitFor(`[data-test-file="${openFilename}"]`);
    await waitFor('[data-test-file-tree-mask]', { count: 0 });
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

    await visitOperatorMode({
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
    });

    await waitForCodeEditor();
    await waitFor('[data-test-realm-name]');
    assert.dom(`[data-test-realm-icon-url="${realmInfo.iconURL}"]`).exists();
    assert.dom('[data-test-realm-name]').hasText(`In ${realmInfo.name}`);

    await waitFor('[data-test-file]');
    await waitFor('[data-test-file-tree-mask]', { count: 0 });
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
    await waitFor('[data-test-file-tree-mask]', { count: 0 });

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

  test('scroll position is restored when returning to file view but only for one file per realm', async function (assert) {
    window.localStorage.setItem(
      'code-mode-panel-widths',
      JSON.stringify({ leftPanel: 200 }),
    ); // make it wide enough for the directory contents to show without wrapping which causes makes height of the folder list to be unpredictable
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
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    });

    let endDirectorySelector = `[data-test-directory="zzz/"]`;

    await waitFor(endDirectorySelector);
    await waitFor('[data-test-file-tree-mask]', { count: 0 });
    let endDirectoryElement = find(endDirectorySelector);

    if (!endDirectoryElement) {
      assert.ok(endDirectoryElement, 'end directory should exist');
    } else {
      assert.notOk(
        await elementIsVisible(endDirectoryElement),
        'expected end directory not to be within view',
      );

      endDirectoryElement.scrollIntoView({ block: 'center' });

      assert.ok(
        await elementIsVisible(endDirectoryElement),
        'expected end directory to now be within view',
      );
    }

    await click('[data-test-inspector-toggle]');
    assert.dom(endDirectorySelector).doesNotExist();

    await click('[data-test-file-browser-toggle]');
    await waitFor(endDirectorySelector);
    await waitFor('[data-test-file-tree-mask]', { count: 0 });

    endDirectoryElement = find(endDirectorySelector);

    // in this test we are trying to assert the scroll position of a nested
    // element, however the scroll position of the testing window itself can
    // interfere with this test. In order to properly test we need to scroll the
    // testing window itself such that the file tree is visible.
    let testingContainer = document.getElementById('ember-testing-container')!;
    let fileTreeHeight = document
      .querySelector('.inner-container.file-browser')!
      .getBoundingClientRect().height;
    try {
      testingContainer.scrollTop = fileTreeHeight;
      if (!endDirectoryElement) {
        assert.ok(endDirectoryElement, 'end directory should exist');
      } else {
        assert.ok(
          await elementIsVisible(endDirectoryElement),
          'expected end directory to be within view after returning to the file tree',
        );
      }
    } finally {
      testingContainer.scrollTop = 0;
    }

    // Change to another file and back, persisted scroll position should be forgotten

    await click('[data-test-file="pet-person.gts"]');
    await click('[data-test-file="Person/1.json"]');

    await click('[data-test-inspector-toggle]');
    assert.dom(endDirectorySelector).doesNotExist();

    await click('[data-test-file-browser-toggle]');
    await waitFor(endDirectorySelector);
    await waitFor('[data-test-file-tree-mask]', { count: 0 });

    endDirectoryElement = find(endDirectorySelector);

    if (!endDirectoryElement) {
      assert.ok(endDirectoryElement, 'end directory should exist');
    } else {
      assert.notOk(
        await elementIsVisible(endDirectoryElement),
        'expected previously-stored scroll position to have been forgotten',
      );

      endDirectoryElement.scrollIntoView({ block: 'center' });

      assert.ok(
        await elementIsVisible(endDirectoryElement),
        'expected end directory to again be within view',
      );
    }

    await fillIn(
      '[data-test-card-url-bar-input]',
      `http://localhost:4202/test/mango.png`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );

    await waitFor('[data-test-realm-name="Test Workspace A"]', {
      timeout: 2000,
    });

    await fillIn(
      '[data-test-card-url-bar-input]',
      `http://test-realm/test/Person/1.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await waitFor('[data-test-realm-name="Test Workspace B"]');
    await waitFor('[data-test-file-tree-mask]', { count: 0 });

    endDirectoryElement = find(endDirectorySelector);

    if (!endDirectoryElement) {
      assert.ok(endDirectoryElement, 'end directory should exist');
    } else {
      assert.notOk(
        await elementIsVisible(endDirectoryElement),
        'expected previously-stored scroll position to have been forgotten',
      );
    }
  });

  test('scroll position does not change when switching to another file within view', async function (assert) {
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
      fileView: 'browser',

      // this was picked because it's way out in the middle of a long list of
      // files. So it will get scrolled to the middle of the visible window,
      // such that it's following entry (z80) is always on-screen.
      //
      // If instead we picked a file whose neighbor may hang off the bottom of
      // the screen, choosing that neighbor would intentionally cause scroll and
      // fail our test.
      codePath: `${testRealmURL}z79.json`,
    });

    await waitFor('[data-test-file="z80.json"]');

    let scrollablePanel = find('[data-test-togglable-left-panel]');
    let currentScrollTop = scrollablePanel?.scrollTop;

    await click('[data-test-file="z80.json"]');

    let newScrollTop = scrollablePanel?.scrollTop;

    assert.strictEqual(
      currentScrollTop,
      newScrollTop,
      'expected scroll position not to have changed when choosing a neighbouring file',
    );
  });

  test('persisted scroll position is restored on refresh', async function (assert) {
    window.localStorage.setItem(
      'scroll-positions',
      JSON.stringify({
        'file-tree': ['http://test-realm/test/Person/1.json', 300],
      }),
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
      fileView: 'browser',
      codePath: `${testRealmURL}Person/1.json`,
      openDirs: { [testRealmURL]: ['Person/'] },
    });

    await waitFor('[data-test-togglable-left-panel]');
    await settled();

    let scrollablePanel = find('[data-test-togglable-left-panel]');

    assert.strictEqual(scrollablePanel?.scrollTop, 300);
  });

  test('can open files in base realm', async function (assert) {
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
      fileView: 'browser',
      codePath: `https://cardstack.com/base/cards-grid.gts`,
    });

    await waitForCodeEditor();
    await waitFor('[data-test-file="cards-grid.gts"]');

    await click('[data-test-file="cards-grid.gts"]');
    await waitFor('[data-test-file="cards-grid.gts"].selected');
    assert.dom('[data-test-file="cards-grid.gts"]').hasClass('selected');
  });

  test('can scroll to bottom of the file tree', async function (assert) {
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
      fileView: 'browser',
      codePath: `https://cardstack.com/base/cards-grid.gts`,
    });

    await waitFor('[data-test-togglable-left-panel]');
    await settled();
    let scrollablePanel = find('[data-test-togglable-left-panel]');
    let expectedScrollTop;
    if (scrollablePanel) {
      scrollablePanel.scrollTop = scrollablePanel.scrollHeight;
      expectedScrollTop = scrollablePanel.scrollTop;
      // We have to trigger `scrollend` event to make sure
      // event listeners not updating the scroll position
      await triggerEvent('[data-test-togglable-left-panel]', 'scrollend');
    }

    assert.strictEqual(scrollablePanel?.scrollTop, expectedScrollTop);
  });
});
