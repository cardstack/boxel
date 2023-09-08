import { module, test } from 'qunit';
import { visit, click, find, waitFor } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import {
  TestRealm,
  TestRealmAdapter,
  setupLocalIndexing,
  setupMockMessageService,
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
    });

    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;

    realm = await TestRealm.createWithAdapter(adapter, loader, this.owner, {
      isAcceptanceTest: true,
    });
    await realm.ready;
  });

  test('defaults to inheritance view and can toggle to file view', async function (assert) {
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
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );

    assert
      .dom('[data-test-file-view-header]')
      .hasAttribute('aria-label', 'Inheritance');
    assert.dom('[data-test-inheritance-toggle]').hasClass('active');
    assert.dom('[data-test-file-browser-toggle]').doesNotHaveClass('active');

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
            id: 'http://test-realm/test/index',
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
      fileView: 'browser',
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
            id: 'http://test-realm/test/index',
            format: 'isolated',
          },
        ],
      ],
      submode: 'code',
    })!;

    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`,
    );
    await click('[data-test-file-browser-toggle]');
    await waitFor('[data-test-file]');

    await click('[data-test-file="person.gts"]');

    assert.dom('[data-test-file="person.gts"]').hasClass('selected');

    await click('[data-test-directory="Person/"]');
    await click('[data-test-file="Person/1.json"]');

    assert.dom('[data-test-person]').exists();
  });

  test('open directories are persisted', async function (assert) {
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
      fileView: 'browser',
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
    let done = assert.async();
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
    let intersectionObserver = new IntersectionObserver(
      function (entries) {
        assert.ok(
          entries[0].isIntersecting,
          'expected element to be intersecting',
        );

        intersectionObserver.unobserve(fileElement);
        done();
      },
      { threshold: [0] },
    );

    intersectionObserver.observe(fileElement);
  });
});
