import {
  click,
  fillIn,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import QUnit, { module, test } from 'qunit';

import {
  baseRealm,
  baseRealmRRI,
  rri,
  baseRRI,
  Deferred,
} from '@cardstack/runtime-common';

import type FileUploadService from '@cardstack/host/services/file-upload';

import {
  percySnapshot,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  testRRI,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  getMonacoContent,
  visitOperatorMode as _visitOperatorMode,
  withCachedRealmSetup,
  type TestContextWithSave,
  setupAuthEndpoints,
  setupUserSubscription,
  cardDefFieldCount,
  realmConfigCardJSON,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

const testRealmURL2 = 'http://test-realm/test2/';
const testRealmAIconURL = 'https://i.postimg.cc/L8yXRvws/icon.png';

const testPrefixRealmURL2 = `@test-realm/test2/`;

const files: Record<string, any> = {
  'realm.json': realmConfigCardJSON({
    name: 'Test Workspace A',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
    iconURL: testRealmAIconURL,
  }),
  'index.json': {
    data: {
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  },
  'error.gts': `
    import { CardDef } from '@cardstack/base/card-api';

    export default class ErrorCard extends CardDef {
      static displayName = 'error';

      constructor(owner: unknown, args: any) {
        super(owner, args);
        throw new Error('A deliberate constructor error');
      }
    }
  `,
  'pet.gts': `
    import { contains, linksTo, field, CardDef, Component } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export default class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);

      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-pet><@fields.name /></span>
        </template>
      }
    }
  `,
  'person.gts': `
    import { contains, linksTo, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import Pet from "./pet";

    export class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field pet = linksTo(Pet);
    }
  `,
  'spec/error.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Error',
        cardDescription: 'Spec for Error',
        specType: 'card',
        ref: {
          module: '../error',
          name: 'default',
        },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/spec',
          name: 'Spec',
        },
      },
    },
  },
  'spec/pet.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Pet',
        cardDescription: 'Spec for Pet',
        specType: 'card',
        ref: { module: `../pet`, name: 'default' },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/spec',
          name: 'Spec',
        },
      },
    },
  },
  'spec/person.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Person',
        cardDescription: 'Spec for Person',
        specType: 'card',
        ref: { module: `../person`, name: 'Person' },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/spec',
          name: 'Spec',
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
          module: `../pet`,
          name: 'default',
        },
      },
    },
  },
  'fields/biginteger-field.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Bigint Field',
        cardDescription: 'A field that captures big int values',
        specType: 'field',
        ref: {
          module: `${baseRealmRRI}big-integer`,
          name: 'default',
        },
      },
      meta: {
        adoptsFrom: {
          module: `${baseRealmRRI}spec`,
          name: 'Spec',
        },
      },
    },
  },
  'fields/field.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'General Field',
        cardDescription: 'A FieldDef spec',
        specType: 'field',
        ref: {
          module: `${baseRealmRRI}card-api`,
          name: 'FieldDef',
        },
      },
      meta: {
        adoptsFrom: {
          module: `${baseRealmRRI}spec`,
          name: 'Spec',
        },
      },
    },
  },
};

const filesB: Record<string, any> = {
  'realm.json': realmConfigCardJSON({
    name: 'Test Workspace B',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
    iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
  }),
  'index.json': {
    data: {
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/cards-grid',
          name: 'CardsGrid',
        },
      },
    },
  },
  'animal.gts': `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Animal extends CardDef {
      static displayName = 'Animal';
      @field name = contains(StringField);
    }
  `,
  'spec/animal.json': {
    data: {
      type: 'card',
      attributes: {
        cardTitle: 'Animal',
        cardDescription: 'Spec for Animal',
        specType: 'card',
        ref: { module: '@test-realm/test2/animal', name: 'Animal' },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/spec',
          name: 'Spec',
        },
      },
    },
  },
};

module('Acceptance | code submode | create-file tests', function (hooks) {
  async function openNewFileModal(
    menuSelection: string,
    expectedRealmName = 'Test Workspace A',
  ) {
    await waitFor('[data-test-new-file-button]');
    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="${menuSelection}"]`);
    await waitFor(
      `[data-test-create-file-modal][data-test-ready] [data-test-realm-name="${expectedRealmName}"]`,
    );
  }

  async function visitOperatorMode(codePath = `${testRealmURL}index.json`) {
    await _visitOperatorMode({
      submode: 'code',
      codePath,
    });
  }

  let adapter: TestRealmAdapter;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL, testRealmURL2],
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    // The `prefix-form ref` nested module needs `@test-realm/test2/` to
    // resolve to testRealmURL2 before the realm setup below indexes
    // `spec/animal.json` (whose `adoptsFrom` is `@test-realm/test2/animal`).
    // QUnit fires the outer `beforeEach` before any nested `beforeEach`,
    // so the inner module can't add this mapping in time. Register it
    // only when the active module is that nested one — other sibling
    // modules generate IDs whose canonical form depends on which mappings
    // are present in the VN, so unconditional registration would shift
    // them into prefix form and trip downstream realm-lookup paths.
    let activeModuleName = QUnit.config.current?.module?.name ?? '';
    if (activeModuleName.includes('uses a prefix-form ref')) {
      getService('network').virtualNetwork.addRealmMapping(
        testPrefixRealmURL2,
        testRealmURL2,
      );
    }
    ({ adapter } = await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        contents: { ...SYSTEM_CARD_FIXTURE_CONTENTS, ...filesB },
        realmURL: testRealmURL2,
        mockMatrixUtils,
      });
      return await setupAcceptanceTestRealm({
        contents: { ...SYSTEM_CARD_FIXTURE_CONTENTS, ...files },
        mockMatrixUtils,
      });
    }));

    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    getService('network').mount(
      async (req: Request) => {
        // Some tests need a simulated creation failure
        if (req.url.includes('fetch-failure')) {
          throw new Error('A deliberate fetch error');
        }
        return null;
      },
      { prepend: true },
    );
  });

  module('when user has permissions to both test realms', function (hooks) {
    hooks.beforeEach(async function () {
      setRealmPermissions({
        [baseRealm.url]: ['read'],
        [testRealmURL]: ['read', 'write'],
        [testRealmURL2]: ['read', 'write'],
      });
    });

    test('new file button has options to create card def, field def, card instance, text files, and upload file', async function (assert) {
      await visitOperatorMode();
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');

      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text]',
        )
        .exists({ count: 5 });
      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text="Card Definition"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text="Field Definition"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text="Card Instance"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text="Text File"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text="Upload File\u2026"]',
        )
        .exists();
    });

    test<TestContextWithSave>('can create text files with txt and md extensions', async function (assert) {
      assert.expect(4);
      await visitOperatorMode();
      let deferred = new Deferred<void>();
      let savedUrls: string[] = [];

      this.onSave(async (url, content) => {
        savedUrls.push(url.href);
        assert.strictEqual(content, '', 'text file is created empty');
        if (savedUrls.length === 2) {
          deferred.fulfill();
        }
      });

      await openNewFileModal('Text File');
      await fillIn('[data-test-text-file-name-field]', 'notes');
      await click('[data-test-create-text-file]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });

      await openNewFileModal('Text File');
      await fillIn('[data-test-text-file-name-field]', 'readme');
      await click('[data-test-text-file-extension-select]');
      await click('[data-test-text-file-extension-option=".md"]');
      await click('[data-test-create-text-file]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });

      await deferred.promise;
      assert.ok(savedUrls.some((url) => url.endsWith('notes.txt')));
      assert.ok(savedUrls.some((url) => url.endsWith('readme.md')));
    });

    test('can upload a file via the New menu', async function (assert) {
      await visitOperatorMode();
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');

      let fileUpload = getService('file-upload') as FileUploadService;
      fileUpload.__queueLocalFileBatchForTesting([
        new File(['hello upload'], 'uploaded-via-menu.txt', {
          type: 'text/plain',
        }),
      ]);

      await click('[data-test-boxel-menu-item-text="Upload File\u2026"]');

      await waitUntil(
        () =>
          (
            document.querySelector(
              '[data-test-card-url-bar-input]',
            ) as HTMLInputElement | null
          )?.value?.includes('uploaded-via-menu.txt'),
        {
          timeout: 10000,
          timeoutMessage: 'code editor did not navigate to the uploaded file',
        },
      );

      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(
          `${testRealmURL}uploaded-via-menu.txt`,
          'code editor navigated to the uploaded file',
        );
    });

    test('can upload multiple files via the New menu', async function (assert) {
      await visitOperatorMode();
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      // Open the file tree so FileTree is mounted before the upload;
      // otherwise the {{#if}} in left-panel-toggle keeps Directory out
      // of the DOM and the assertion below has nothing to match.
      await click('[data-test-file-browser-toggle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');

      let fileUpload = getService('file-upload') as FileUploadService;
      fileUpload.__queueLocalFileBatchForTesting([
        new File(['file one'], 'multi-upload-first.txt', {
          type: 'text/plain',
        }),
        new File(['file two'], 'multi-upload-second.txt', {
          type: 'text/plain',
        }),
      ]);

      await click('[data-test-boxel-menu-item-text="Upload File…"]');

      await waitUntil(() => fileUpload.activeUploads.length === 0, {
        timeout: 20000,
        timeoutMessage: 'uploads did not all complete',
      });

      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(
          `${testRealmURL}multi-upload-first.txt`,
          'code editor navigated to the first uploaded file',
        );

      await waitUntil(
        () =>
          document.querySelector(
            '[data-test-file="multi-upload-second.txt"]',
          ) != null,
        {
          timeout: 10000,
          timeoutMessage:
            'second uploaded file did not appear in the file tree',
        },
      );

      assert
        .dom('[data-test-file="multi-upload-first.txt"]')
        .exists('first uploaded file is shown in the file tree');
      assert
        .dom('[data-test-file="multi-upload-second.txt"]')
        .exists('second uploaded file is shown in the file tree');
    });

    test('cancelling upload file picker does not cause errors', async function (assert) {
      await visitOperatorMode();
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');

      let fileUpload = getService('file-upload') as FileUploadService;
      // Simulate cancelling the native file picker - empty batch
      fileUpload.__queueLocalFileBatchForTesting([]);

      await click('[data-test-boxel-menu-item-text="Upload File\u2026"]');

      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(
          `${testRealmURL}index.json`,
          'URL bar still shows the original file',
        );
    });

    test('filename is auto-populated from display name', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Card Definition');
      await fillIn('[data-test-display-name-field]', `Très test's card 😀`);
      assert.dom('[data-test-file-name-field]').hasValue('tres-tests-card');
    });

    test('filename stops auto-populating after user edits it', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Card Definition');
      await fillIn('[data-test-file-name-field]', 'test_card');
      await fillIn('[data-test-display-name-field]', 'Très test card 😀');
      assert.dom('[data-test-file-name-field]').hasValue('test_card');
    });

    test<TestContextWithSave>('can create new card-instance file in local realm with card type from same realm', async function (assert) {
      const baseRealmIconURL =
        'https://boxel-images.boxel.ai/icons/cardstack.png';
      assert.expect(13);
      await visitOperatorMode();
      await openNewFileModal('Card Instance');
      assert.dom('[data-test-realm-name]').hasText('Test Workspace A');
      await waitFor(`[data-test-selected-type="General Card"]`);
      assert
        .dom(`[data-test-inherits-from-field] [data-test-boxel-field-label]`)
        .hasText('Adopted From');
      assert.dom(`[data-test-selected-type]`).hasText('General Card');
      assert
        .dom(`[data-test-selected-type] [data-test-realm-icon-url]`)
        .hasStyle({ backgroundImage: `url("${baseRealmIconURL}")` });

      // card type selection
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);
      assert.dom(`[data-test-selected-type]`).hasText('Person');
      assert
        .dom(`[data-test-selected-type] [data-test-realm-icon-url]`)
        .hasStyle({ backgroundImage: `url("${testRealmAIconURL}")` });

      let deferred = new Deferred<void>();
      let fileID = '';

      this.onSave(async (url, json) => {
        fileID = url.href;
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(
          json.data.attributes?.firstName,
          null,
          'firstName field is empty',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: rri('../person'),
            name: 'Person',
          },
          'adoptsFrom is correct',
        );
        assert.deepEqual(
          json.data.relationships,
          undefined,
          'relationships data is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-renderer-header="${fileID}"]`);
      assert.dom('[data-test-card-resource-loaded]').containsText('Person');
      assert.dom('[data-test-field="firstName"] input').hasValue('');
      assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileID}.json`);

      await deferred.promise;
    });

    test<TestContextWithSave>('an error when creating a new card instance is shown', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Card Instance');
      await waitFor(`[data-test-selected-type="General Card"]`);

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/error"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/error"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Error"]`);

      await click('[data-test-create-card-instance]');
      assert.dom('[data-test-error-container]').exists();
      assert
        .dom('[data-test-error-type]')
        .containsText('Error creating card instance');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .hasText('A deliberate constructor error');
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .containsText('A deliberate constructor error');

      await click('[data-test-cancel-create-file]');
      await openNewFileModal('Card Instance');

      assert
        .dom('[data-test-error-container]')
        .doesNotExist('error is cleared');
    });

    test<TestContextWithSave>('can create new card-instance file in local realm with card type from a remote realm', async function (assert) {
      assert.expect(8);
      await visitOperatorMode();
      await openNewFileModal('Card Instance');
      assert.dom('[data-test-realm-name]').hasText('Test Workspace A');
      await waitFor(`[data-test-selected-type="General Card"]`);

      let deferred = new Deferred<void>();
      let fileURL = '';

      this.onSave(async (url, json) => {
        fileURL = url.href;
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(
          json.data.attributes?.cardTitle,
          'Untitled Card',
          'title field defaults to fallback',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: baseRRI('card-api'),
            name: 'CardDef',
          },
          'adoptsFrom is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor(
        '[data-test-code-mode-card-renderer-header][data-test-card-resource-loaded]',
      );
      assert
        .dom(
          '[data-test-code-mode-card-renderer-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace A');
      assert.dom('[data-test-card-resource-loaded]').containsText('Card');
      assert.dom('[data-test-field="cardInfo-name"] input').hasValue('');
      assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileURL}.json`);

      await deferred.promise;
    });

    test<TestContextWithSave>('can create new card-instance file in a remote realm with card type from another realm', async function (assert) {
      assert.expect(8);
      await visitOperatorMode();
      await openNewFileModal('Card Instance');
      await waitFor(`[data-test-selected-type="General Card"]`);

      // realm selection
      await click(`[data-test-realm-dropdown-trigger]`);
      await waitFor(
        '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace B"]',
      );
      await click('[data-test-boxel-menu-item-text="Test Workspace B"]');
      await waitFor(`[data-test-realm-name="Test Workspace B"]`);
      assert.dom('[data-test-realm-name]').hasText('Test Workspace B');

      let deferred = new Deferred<void>();
      let fileID = '';

      this.onSave(async (url, json) => {
        fileID = url.href;
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(
          json.data.attributes?.cardTitle,
          'Untitled Card',
          'title field defaults to fallback',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL2,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: baseRRI('card-api'),
            name: 'CardDef',
          },
          'adoptsFrom is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-renderer-header="${fileID}"]`);
      assert
        .dom(
          '[data-test-code-mode-card-renderer-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace B');
      assert.dom('[data-test-card-resource-loaded]').containsText('Card');
      assert.dom('[data-test-field="cardInfo-name"] input').hasValue('');
      assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileID}.json`);

      await deferred.promise;
    });

    test<TestContextWithSave>('can create new card-instance file in a remote realm with card type from a local realm', async function (assert) {
      assert.expect(8);
      await visitOperatorMode();
      await openNewFileModal('Card Instance');

      // realm selection
      await click(`[data-test-realm-dropdown-trigger]`);
      await waitFor(
        '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace B"]',
      );
      await click('[data-test-boxel-menu-item-text="Test Workspace B"]');
      await waitFor(`[data-test-realm-name="Test Workspace B"]`);
      assert.dom('[data-test-realm-name]').hasText('Test Workspace B');

      // card type selection
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);

      let deferred = new Deferred<void>();
      let fileID = '';

      this.onSave(async (url, json) => {
        fileID = url.href;
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(
          json.data.attributes?.firstName,
          null,
          'firstName field is empty',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL2,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: testRRI('person'),
            name: 'Person',
          },
          'adoptsFrom is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-renderer-header="${fileID}"]`);
      assert
        .dom(
          '[data-test-code-mode-card-renderer-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace B');
      assert.dom('[data-test-card-resource-loaded]').containsText('Person');
      assert.dom('[data-test-field="firstName"] input').hasValue('');
      assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileID}.json`);

      await deferred.promise;
    });

    test<TestContextWithSave>('can create a new card definition in different realm than inherited definition', async function (assert) {
      assert.expect(12);
      let expectedSrc = `
import { CardDef } from '@cardstack/base/card-api';
import { Component } from '@cardstack/base/card-api';
export class TrèsTestCard extends CardDef {
  static displayName = "Très test card 😀";
}`.trim();
      await visitOperatorMode();
      await openNewFileModal('Card Definition');
      assert.dom('[data-test-selected-type]').hasText('General Card');
      assert
        .dom('[data-test-create-definition]')
        .isDisabled('create button is disabled');
      await fillIn('[data-test-display-name-field]', 'Très test card 😀');
      assert
        .dom(`[data-test-inherits-from-field] [data-test-boxel-field-label]`)
        .hasText('Inherits From');
      assert
        .dom('[data-test-create-definition]')
        .isEnabled('create button is enabled');
      await fillIn('[data-test-file-name-field]', 'très-test-card');
      assert
        .dom('[data-test-create-definition]')
        .isEnabled('create button is enabled');

      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(content, expectedSrc, 'the source is correct');
      });
      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      assert.strictEqual(
        getMonacoContent(),
        expectedSrc,
        'monaco displays the new definition',
      );

      await waitFor('[data-test-card-schema="Très test card 😀"]');
      assert
        .dom('[data-test-current-module-name]')
        .hasText('très-test-card.gts');
      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(`${testRealmURL}très-test-card.gts`);
      assert
        .dom('[data-test-card-schema]')
        .exists(
          { count: 3 },
          'the card hierarchy is displayed in schema editor',
        );
      assert
        .dom('[data-test-total-fields]')
        .containsText(`${cardDefFieldCount}`)
        .hasAttribute('title', `${cardDefFieldCount} fields`);
    });

    test<TestContextWithSave>('can create a new card definition in same realm as inherited definition', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-card');

      let deferred = new Deferred<void>();
      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import { Person } from './person';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends Person {
  static displayName = "Test Card";
}`.trim(),
          'the source is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });

    test<TestContextWithSave>('can create new card definition in different realm than realm of current file opened in code mode', async function (assert) {
      let done = assert.async();
      await visitOperatorMode(`${baseRealm.url}card-api.gts`);
      await openNewFileModal('Card Definition');

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-card');

      this.onSave((url, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(url.href, `${testRealmURL}test-card.gts`);
        done();
      });

      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
    });

    test('an error when creating a new card definition is shown', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/person"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-fetch-failure-card');

      await click('[data-test-create-definition]');
      assert.dom('[data-test-error-container]').exists();
      assert
        .dom('[data-test-error-type]')
        .containsText('Error creating card definition');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .hasText('A deliberate fetch error');
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .containsText('A deliberate fetch error');

      await fillIn('[data-test-display-name-field]', 'Test Card');
      assert
        .dom('[data-test-error-container]')
        .doesNotExist('changing a field should clear the error');
    });

    test<TestContextWithSave>('modal cannot be dismissed while creation is in progress (CS-10557)', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Card Definition');
      await fillIn('[data-test-display-name-field]', 'Dismiss Test Card');
      await fillIn('[data-test-file-name-field]', 'dismiss-test-card');

      // Mount a network handler that blocks the save POST request
      // so we can attempt to dismiss the modal while creation is in-flight
      let saveDeferred = new Deferred<void>();
      let postIntercepted = false;
      getService('network').mount(
        async (req: Request) => {
          if (
            req.method === 'POST' &&
            req.url.includes('dismiss-test-card.gts')
          ) {
            postIntercepted = true;
            await saveDeferred.promise;
          }
          return null;
        },
        { prepend: true },
      );

      // Click Create without awaiting - the task will be blocked by our handler
      let createClickPromise = click('[data-test-create-definition]');

      // Wait for the POST to be intercepted (task is now mid-creation)
      await waitUntil(() => postIntercepted, {
        timeout: 10000,
        timeoutMessage: 'Timed out waiting for save POST to be intercepted',
      });

      // Attempt to dismiss the modal while creation is in-flight using raw
      // DOM click (we can't use ember's click helper here because it awaits
      // settled, which won't resolve while the creation task is blocked)
      let cancelBtn = document.querySelector('[data-test-cancel-create-file]');
      if (!cancelBtn) {
        throw new Error(
          'Could not find [data-test-cancel-create-file] button while creation is in progress',
        );
      }
      (cancelBtn as HTMLElement).click();

      // Modal should still be open because creation is in progress
      assert
        .dom('[data-test-create-file-modal]')
        .exists('modal stays open during creation');

      // Let the save complete
      this.onSave(() => {});
      saveDeferred.fulfill();
      await createClickPromise;

      // After creation completes, the modal closes normally
      assert
        .dom('[data-test-create-file-modal]')
        .doesNotExist('modal closes after creation completes');
    });

    test<TestContextWithSave>('can create a new field definition that extends field definition that uses default export', async function (assert) {
      assert.expect(3);
      await visitOperatorMode();
      await openNewFileModal('Field Definition');
      assert.dom('[data-test-selected-type]').hasText('General Field');
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');

      await waitFor(
        `[data-test-item-button="${testRealmURL}fields/biginteger-field"]`,
      );
      await click(
        `[data-test-item-button="${testRealmURL}fields/biginteger-field"]`,
      );
      await click('[data-test-card-chooser-go-button]');

      assert.dom('[data-test-create-definition]').isDisabled();
      await fillIn(
        '[data-test-display-name-field]',
        'Field that extends from big int',
      );
      await fillIn('[data-test-file-name-field]', 'big-int-v2');
      let deferred = new Deferred<void>();
      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import BigInteger from '@cardstack/base/big-integer';
import { Component } from '@cardstack/base/card-api';
export class FieldThatExtendsFromBigInt extends BigInteger {
  static displayName = "Field that extends from big int";
}`.trim(),
          'the source is correct',
        );
        deferred.fulfill();
      });
      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });

    test('an error when creating a new field definition is shown', async function (assert) {
      await visitOperatorMode();
      await openNewFileModal('Field Definition');
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');

      await waitFor(
        `[data-test-item-button="${testRealmURL}fields/biginteger-field"]`,
      );
      await click(
        `[data-test-item-button="${testRealmURL}fields/biginteger-field"]`,
      );
      await click('[data-test-card-chooser-go-button]');
      await fillIn(
        '[data-test-display-name-field]',
        'Field that will not save',
      );
      await fillIn('[data-test-file-name-field]', 'test-fetch-failure-card');
      await click('[data-test-create-definition]');
      assert
        .dom('[data-test-error-type]')
        .containsText('Error creating field definition');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .hasText('A deliberate fetch error');
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-details]')
        .containsText('A deliberate fetch error');
    });

    test<TestContextWithSave>('can create a new definition that extends card definition which uses default export', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      // select card type
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Pet"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-card');
      let deferred = new Deferred<void>();
      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import Pet from './pet';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends Pet {
  static displayName = "Test Card";
}`.trim(),
          'the source is correct',
        );
        deferred.fulfill();
      });

      await percySnapshot(assert);
      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });

    test<TestContextWithSave>('can reconcile a classname collision with the selected name of extending a card definition which uses a default export', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      // select card type
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Pet"]`);

      await fillIn('[data-test-display-name-field]', 'Pet');
      await fillIn('[data-test-file-name-field]', 'test-card');
      let deferred = new Deferred<void>();
      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import PetParent from './pet';
import { Component } from '@cardstack/base/card-api';
export class Pet extends PetParent {
  static displayName = "Pet";
}`.trim(),
          'the source is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });

    test<TestContextWithSave>('can reconcile a classname collision with a javascript builtin object', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      // select card type
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click(`[data-test-item-button="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Pet"]`);

      await fillIn('[data-test-display-name-field]', 'Map');
      await fillIn('[data-test-file-name-field]', 'test-card');
      let deferred = new Deferred<void>();
      this.onSave((_, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import Pet from './pet';
import { Component } from '@cardstack/base/card-api';
export class Map0 extends Pet {
  static displayName = "Map";
}`.trim(),
          'the source is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });

    test<TestContextWithSave>('can specify new directory as part of filename when creating a new definition', async function (assert) {
      assert.expect(2);
      let expectedSrc = `
import { CardDef } from '@cardstack/base/card-api';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";
}`.trim();

      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-dir/test-card');
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

      let file = await adapter.openFile('test-dir/test-card.gts');
      assert.strictEqual(
        file?.content,
        expectedSrc,
        'the source exists at the correct location',
      );
    });

    test<TestContextWithSave>('can handle filename with .gts extension in filename when creating a new definition', async function (assert) {
      assert.expect(2);
      let expectedSrc = `
import { CardDef } from '@cardstack/base/card-api';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";
}`.trim();

      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-card.gts');
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

      let file = await adapter.openFile('test-card.gts');
      assert.strictEqual(
        file?.content,
        expectedSrc,
        'the source exists at the correct location',
      );
    });

    test<TestContextWithSave>('can handle leading "/" in filename when creating a new definition', async function (assert) {
      assert.expect(2);
      let expectedSrc = `
import { CardDef } from '@cardstack/base/card-api';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";
}`.trim();

      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await fillIn('[data-test-display-name-field]', 'Test Card');
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

      let file = await adapter.openFile('test-card.gts');
      assert.strictEqual(
        file?.content,
        expectedSrc,
        'the source exists at the correct location',
      );
    });
  });

  module('when a selected spec uses a prefix-form ref', function () {
    // The `@test-realm/test2/` → testRealmURL2 mapping this module relies
    // on is registered up in the outer `beforeEach` so it lands before
    // `setupAcceptanceTestRealm` indexes `spec/animal.json`.
    test<TestContextWithSave>('can create new card definition in workspace A that extends a card from workspace B via prefix-form ref', async function (assert) {
      assert.expect(2);
      await visitOperatorMode(`${baseRealm.url}card-api.gts`);
      await openNewFileModal('Card Definition');
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL2}spec/animal"]`);
      await click(`[data-test-item-button="${testRealmURL2}spec/animal"]`);
      await click('[data-test-card-chooser-go-button]');
      await waitFor(`[data-test-selected-type="Animal"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-card');

      let deferred = new Deferred<void>();
      this.onSave((url, content) => {
        if (typeof content !== 'string') {
          throw new Error(`expected string save data`);
        }
        assert.strictEqual(
          content,
          `
import { Animal } from '${testRealmURL2}animal';
import { Component } from '@cardstack/base/card-api';
export class TestCard extends Animal {
  static displayName = "Test Card";
}`.trim(),
          'The source uses the resolved absolute module URL',
        );
        assert.strictEqual(
          url.href,
          `${testRealmURL}test-card.gts`,
          [
            'Saved file URL should point to Test Workspace A',
            `Expected: ${testRealmURL}test-card.gts`,
            `Actual: ${url.href}`,
          ].join('\n'),
        );
        deferred.fulfill();
      });

      await click('[data-test-create-definition]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await deferred.promise;
    });
  });

  module(
    'when the user lacks write permissions in remote realm',
    function (hooks) {
      async function assertRealmDropDownIsCorrect(assert: Assert) {
        await click(`[data-test-realm-dropdown-trigger]`);
        await waitFor(
          '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace A"]',
        );
        assert
          .dom('[data-test-selected-realm]')
          .containsText('Test Workspace A');
        let menuItems = document
          .querySelector('[data-test-realm-dropdown-menu]')!
          .textContent!.replace(/^\s*/gm, '')
          .trim()
          .split('\n');
        assert.deepEqual(
          menuItems,
          ['Test Workspace A'],
          'the realm dropdown list is correct',
        );
      }

      hooks.beforeEach(async function () {
        setRealmPermissions({
          [baseRealm.url]: ['read'],
          [testRealmURL2]: ['read'],
          [testRealmURL]: ['read', 'write'],
        });
      });

      test('read only realm is not present in realm drop down when creating card definition', async function (assert) {
        await visitOperatorMode();
        await openNewFileModal('Card Definition');
        await waitFor(`[data-test-selected-type="General Card"]`);
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating card instance', async function (assert) {
        await visitOperatorMode();
        await openNewFileModal('Card Instance');
        await waitFor(`[data-test-selected-type="General Card"]`);
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when duplicating card instance', async function (assert) {
        await visitOperatorMode(`${testRealmURL}Pet/mango.json`);
        await waitFor(`[data-test-action-button="Duplicate"]`);
        await click('[data-test-action-button="Duplicate"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when inheriting card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitFor(`[data-test-action-button="Inherit"]`);
        await click('[data-test-action-button="Inherit"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating instance of card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitFor(`[data-test-action-button="Create Instance"]`);
        await click('[data-test-action-button="Create Instance"]');
        await assertRealmDropDownIsCorrect(assert);
      });
    },
  );

  module(
    'when the user lacks write permissions in local realm',
    function (hooks) {
      async function assertRealmDropDownIsCorrect(assert: Assert) {
        await click(`[data-test-realm-dropdown-trigger]`);
        await waitFor(
          '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace B"]',
        );
        assert
          .dom('[data-test-selected-realm]')
          .containsText('Test Workspace B');
        let menuItems = document
          .querySelector('[data-test-realm-dropdown-menu]')!
          .textContent!.replace(/^\s*/gm, '')
          .trim()
          .split('\n');
        assert.deepEqual(
          menuItems,
          ['Test Workspace B'],
          'the realm dropdown list is correct',
        );
      }

      hooks.beforeEach(async function () {
        setRealmPermissions({
          [baseRealm.url]: ['read'],
          [testRealmURL2]: ['read', 'write'],
          [testRealmURL]: ['read'],
        });
      });

      test('read only realm is not present in realm drop down when creating card definition', async function (assert) {
        await visitOperatorMode();
        await openNewFileModal('Card Definition', 'Test Workspace B');
        await waitFor(`[data-test-selected-type="General Card"]`);
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating card instance', async function (assert) {
        await visitOperatorMode();
        await openNewFileModal('Card Instance', 'Test Workspace B');
        await waitFor(`[data-test-selected-type="General Card"]`);
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when duplicating card instance', async function (assert) {
        await visitOperatorMode(`${testRealmURL}Pet/mango.json`);
        await waitFor(`[data-test-action-button="Duplicate"]`);
        await click('[data-test-action-button="Duplicate"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when inheriting card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitFor(`[data-test-action-button="Inherit"]`);
        await click('[data-test-action-button="Inherit"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating instance of card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitFor(`[data-test-action-button="Create Instance"]`);
        await click('[data-test-action-button="Create Instance"]');
        await assertRealmDropDownIsCorrect(assert);
      });
    },
  );

  // When the AI assistant (or any external writer) creates a new .gts and
  // then updates the code-submode codePath to the just-written URL, the
  // host's FileResource (packages/host/app/resources/file.ts) can lose the
  // race against the realm's index pipeline. The first authedFetch returns
  // 404 and `read` transitions into `state: 'not-found'`. The realm later
  // broadcasts `index/incremental` for the new URL, and the FileResource
  // must react to that event and recover — otherwise the URL bar stays
  // stuck on "This resource does not exist" until the user re-navigates.
  //
  // This test simulates the external write by navigating to a non-existent
  // URL, confirming the URL bar shows the not-found error, then performing
  // the write via the realm directly (mirroring what the realm-server does
  // when a card+source PUT lands). After the realm broadcasts the matching
  // `index/incremental` event, the URL bar must recover.
  module('when an external write creates a new file', function (hooks) {
    hooks.beforeEach(function () {
      setRealmPermissions({
        [baseRealm.url]: ['read'],
        [testRealmURL]: ['read', 'write'],
      });
    });

    test('code submode recovers when a newly-created file arrives via a realm index/incremental event', async function (assert) {
      let newFilePath = 'ai-created-card.gts';
      let newFileUrl = `${testRealmURL}${newFilePath}`;
      let newFileSource = `
        import { CardDef } from '@cardstack/base/card-api';
        export default class AiCreatedCard extends CardDef {
          static displayName = 'Ai Created Card';
        }
      `;

      // Simulate the AI assistant updating the codePath to a file that does
      // not yet exist in the realm. The host has not seen this URL before,
      // so FileResource.read will hit 404.
      await visitOperatorMode(newFileUrl);

      await waitFor('[data-test-card-url-bar-error]');
      assert
        .dom('[data-test-card-url-bar-error]')
        .containsText(
          'This resource does not exist',
          'URL bar surfaces the not-found error on initial 404',
        );

      // The realm broadcasts the incremental invalidation event over matrix
      // once indexing of the newly-written file completes. Subscribe so we
      // can await its arrival deterministically before asserting recovery.
      let incrementalEvent = new Deferred<void>();
      let unsubscribe = getService('message-service').subscribe(
        testRealmURL,
        (ev: RealmEventContent) => {
          if (
            ev.eventName === 'index' &&
            ev.indexType === 'incremental' &&
            Array.isArray(ev.invalidations) &&
            (ev.invalidations as string[]).includes(newFileUrl)
          ) {
            unsubscribe();
            incrementalEvent.fulfill();
          }
        },
      );

      // Mirror WriteTextFileTool exactly. `cardService.saveSource` with
      // saveType 'create-file' POSTs the new source to the realm and tags
      // the request with `X-Boxel-Client-Request-Id: create-file:<uuid>`,
      // which the realm echoes back in the `index/incremental` event.
      // This shape — saveType 'create-file' and that clientRequestId
      // prefix — is what the AI assistant produces and what the
      // invalidation handler must treat as reload-worthy even though the
      // id is in `cardService.clientRequestIds`.
      let cardService = getService('card-service');
      await cardService.saveSource(
        new URL(newFileUrl),
        newFileSource,
        'create-file',
      );
      await incrementalEvent.promise;
      await settled();
      await waitFor('[data-test-code-mode][data-test-save-idle]');

      assert
        .dom('[data-test-card-url-bar-error]')
        .doesNotExist(
          'URL bar error clears after the realm broadcasts the index/incremental event for the new file',
        );
      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(
          newFileUrl,
          'code submode stays on the new file URL after recovery',
        );
      assert.ok(
        getMonacoContent().includes('AiCreatedCard'),
        'monaco loads the recovered file body, not a stale buffer',
      );
    });

    // Buck's actual reproduction is navigation: he was viewing a prior
    // file in code mode, then clicked New Card Definition, and the URL
    // bar stayed stuck on "This resource does not exist" for the new
    // file. The existing test above covers cold-start visit to an
    // un-indexed URL; this one covers the navigate-from-ready path,
    // because `FileResource.modify` runs with `innerState` already in
    // `ready` and the realm subscription already established when the
    // codePath changes.
    test('navigating from a ready file to a newly-created file recovers via index/incremental', async function (assert) {
      let newFilePath = 'navigated-to-card.gts';
      let newFileUrl = `${testRealmURL}${newFilePath}`;
      let newFileSource = `
        import { CardDef } from '@cardstack/base/card-api';
        export default class NavigatedToCard extends CardDef {
          static displayName = 'Navigated To Card';
        }
      `;

      // Load an existing file first so FileResource is in state 'ready'
      // and subscribed to the realm before the navigation that triggers
      // the bug.
      await visitOperatorMode(`${testRealmURL}index.json`);
      await waitFor('[data-test-code-mode][data-test-save-idle]');

      // Re-visit the new (not-yet-existent) URL through code mode. This
      // drives a second `FileResource.modify` from the already-ready
      // state — the exact transition Buck reported.
      await visitOperatorMode(newFileUrl);
      await waitFor('[data-test-card-url-bar-error]');
      assert
        .dom('[data-test-card-url-bar-error]')
        .containsText(
          'This resource does not exist',
          'URL bar surfaces the not-found error on initial 404 after navigation',
        );

      let incrementalEvent = new Deferred<void>();
      let unsubscribe = getService('message-service').subscribe(
        testRealmURL,
        (ev: RealmEventContent) => {
          if (
            ev.eventName === 'index' &&
            ev.indexType === 'incremental' &&
            Array.isArray(ev.invalidations) &&
            (ev.invalidations as string[]).includes(newFileUrl)
          ) {
            unsubscribe();
            incrementalEvent.fulfill();
          }
        },
      );

      let cardService = getService('card-service');
      await cardService.saveSource(
        new URL(newFileUrl),
        newFileSource,
        'create-file',
      );
      await incrementalEvent.promise;
      await settled();
      await waitFor('[data-test-code-mode][data-test-save-idle]');

      assert
        .dom('[data-test-card-url-bar-error]')
        .doesNotExist(
          'URL bar error clears after the realm broadcasts the index/incremental event for the new file',
        );
      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(
          newFileUrl,
          'code submode stays on the new file URL after recovery',
        );
      assert.ok(
        getMonacoContent().includes('NavigatedToCard'),
        'monaco loads the recovered file body after the navigate-then-create sequence',
      );
    });
  });
});
