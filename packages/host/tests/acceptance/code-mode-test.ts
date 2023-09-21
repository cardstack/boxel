import { module, test } from 'qunit';
import {
  visit,
  click,
  waitFor,
  waitUntil,
  find,
  fillIn,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupMockMessageService,
  testRealmURL,
} from '../helpers';
import stringify from 'safe-stable-stringify';
import { Realm } from '@cardstack/runtime-common/realm';
import type LoaderService from '@cardstack/host/services/loader-service';
import { setupWindowMock } from 'ember-window-mock/test-support';
import window from 'ember-window-mock';

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

    await waitUntil(() => find('[data-test-card-inheritance-panel]'));

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

    await click('[data-test-directory="Person/"]');
    await click('[data-test-file="Person/1.json"]');

    assert.dom('[data-test-person]').exists();
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
      openDirs: ['Person/'],
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
      openDirs: ['Person/'],
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
      openDirs: ['Person/'],
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
      openDirs: ['Person/'],
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
      JSON.stringify([[testRealmURL, 'index.json'], 'a-non-url-to-ignore']),
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
      openDirs: [],
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    assert
      .dom('[data-test-recent-file]')
      .exists({ count: 1 })
      .containsText('index.json');

    await click('[data-test-file="index.json"]');
    assert
      .dom('[data-test-recent-file]')
      .exists({ count: 1 })
      .containsText('Person/1.json');

    await click('[data-test-directory]');
    await waitFor('[data-test-file="Person/1.json"]');

    await click('[data-test-file="Person/1.json"]');

    assert
      .dom('[data-test-recent-file]')
      .exists({ count: 1 })
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
      openDirs: [],
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await waitFor('[data-test-file]');
    await waitFor('[data-test-directory]');

    assert.dom('[data-test-recent-file]').exists({ count: 99 });

    await click('[data-test-file="index.json"]');
    assert.dom('[data-test-recent-file]').exists({ count: 99 });

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

    await waitUntil(() => find('[data-test-card-inheritance-panel]'));
    await waitUntil(() => find('[data-test-card-module-definition]'));
    await waitUntil(() => find('[data-test-card-instance-definition]'));

    assert.dom('[data-test-card-module-definition]').includesText('Card');
    //TODO: CS-5957 deriving extension
    // assert
    //   .dom(
    //     '[data-test-card-module-definition] [data-test-definition-file-extension]',
    //   )
    //   .includesText('.gts');
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
    assert
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-realm-name]',
      )
      .includesText('Test Workspace B');
    assert
      .dom(
        '[data-test-card-instance-definition] [data-test-definition-info-text]',
      )
      .includesText('Last saved was a few seconds ago');

    assert.dom('[data-test-card-instance-definition]').hasClass('active');
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

    await waitUntil(() => find('[data-test-card-inheritance-panel]'));
    await waitUntil(() => find('[data-test-card-module-definition]'));

    assert.dom('[data-test-card-module-definition]').includesText('Card');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);

    assert.dom('[data-test-card-module-definition]').hasClass('active');
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-file-extension]',
      )
      .includesText('.gts');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
    assert.dom('[data-test-card-module-definition]').includesText('Card');
    assert
      .dom(
        '[data-test-card-module-definition] [data-test-definition-realm-name]',
      )
      .includesText('Test Workspace B');
    assert.dom('[data-test-card-instance-definition]').doesNotExist();
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
      .containsText('File is not found');
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
