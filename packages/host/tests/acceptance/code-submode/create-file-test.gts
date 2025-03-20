import { click, fillIn, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, Deferred } from '@cardstack/runtime-common';

import {
  percySnapshot,
  setupLocalIndexing,
  testRealmURL,
  setupOnSave,
  setupAcceptanceTestRealm,
  waitForCodeEditor,
  getMonacoContent,
  visitOperatorMode as _visitOperatorMode,
  type TestContextWithSave,
  lookupNetworkService,
  setupUserSubscription,
} from '../../helpers';
import { TestRealmAdapter } from '../../helpers/adapter';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

const testRealmURL2 = 'http://test-realm/test2/';
const testRealmAIconURL = 'https://i.postimg.cc/L8yXRvws/icon.png';

const files: Record<string, any> = {
  '.realm.json': {
    name: 'Test Workspace A',
    backgroundURL:
      'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
    iconURL: testRealmAIconURL,
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
  'error.gts': `
    import { CardDef } from 'https://cardstack.com/base/card-api';

    export default class ErrorCard extends CardDef {
      static displayName = 'error';

      constructor(owner: unknown, args: any) {
        super(owner, args);
        throw new Error('A deliberate constructor error');
      }
    }
  `,
  'pet.gts': `
    import { contains, linksTo, field, CardDef, Component } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";

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
    import { contains, linksTo, field, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";
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
        title: 'Error',
        description: 'Spec for Error',
        specType: 'card',
        ref: {
          module: '../error',
          name: 'default',
        },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
          name: 'Spec',
        },
      },
    },
  },
  'spec/pet.json': {
    data: {
      type: 'card',
      attributes: {
        title: 'Pet',
        description: 'Spec for Pet',
        specType: 'card',
        ref: { module: `../pet`, name: 'default' },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
          name: 'Spec',
        },
      },
    },
  },
  'spec/person.json': {
    data: {
      type: 'card',
      attributes: {
        title: 'Person',
        description: 'Spec for Person',
        specType: 'card',
        ref: { module: `../person`, name: 'Person' },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/spec',
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
};

const filesB: Record<string, any> = {
  '.realm.json': {
    name: 'Test Workspace B',
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

let matrixRoomId: string;
module('Acceptance | code submode | create-file tests', function (hooks) {
  async function openNewFileModal(
    menuSelection: string,
    expectedRealmName = 'Test Workspace A',
  ) {
    await waitForCodeEditor();
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

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL, testRealmURL2],
  });

  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      contents: filesB,
      realmURL: testRealmURL2,
      mockMatrixUtils,
    });
    ({ adapter } = await setupAcceptanceTestRealm({
      contents: files,
      mockMatrixUtils,
    }));

    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    lookupNetworkService().mount(
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

    test('new file button has options to create card def, field def, and card instance files', async function (assert) {
      await visitOperatorMode();
      await waitFor('[data-test-code-mode][data-test-save-idle]');
      await waitFor('[data-test-new-file-button]');
      await click('[data-test-new-file-button]');

      assert
        .dom(
          '[data-test-new-file-dropdown-menu] [data-test-boxel-menu-item-text]',
        )
        .exists({ count: 3 });
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/person"]`);
      await click(`[data-test-select="${testRealmURL}spec/person"]`);
      await click('[data-test-card-catalog-go-button]');
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
            module: '../person',
            name: 'Person',
          },
          'adoptsFrom is correct',
        );
        assert.deepEqual(
          json.data.relationships,
          {
            pet: {
              links: {
                self: null,
              },
            },
          },
          'relationships data is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-preview-header="${fileID}"]`);
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/error"]`);
      await click(`[data-test-select="${testRealmURL}spec/error"]`);
      await click('[data-test-card-catalog-go-button]');
      await waitFor(`[data-test-selected-type="Error"]`);

      await click('[data-test-create-card-instance]');

      await waitFor('[data-test-create-file-modal] [data-test-error-message]');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .containsText(
          'Error creating card instance: A deliberate constructor error',
        );

      await click('[data-test-cancel-create-file]');
      await openNewFileModal('Card Instance');

      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .doesNotExist();
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
          json.data.attributes?.title,
          null,
          'title field is empty',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: `${baseRealm.url}card-api`,
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
        '[data-test-code-mode-card-preview-header][data-test-card-resource-loaded]',
      );
      assert
        .dom(
          '[data-test-code-mode-card-preview-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace A');
      assert.dom('[data-test-card-resource-loaded]').containsText('Card');
      assert.dom('[data-test-field="title"] input').hasValue('');
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
          json.data.attributes?.title,
          null,
          'title field is empty',
        );
        assert.strictEqual(
          json.data.meta.realmURL,
          testRealmURL2,
          'realm url is correct',
        );
        assert.deepEqual(
          json.data.meta.adoptsFrom,
          {
            module: `${baseRealm.url}card-api`,
            name: 'CardDef',
          },
          'adoptsFrom is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-preview-header="${fileID}"]`);
      assert
        .dom(
          '[data-test-code-mode-card-preview-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace B');
      assert.dom('[data-test-card-resource-loaded]').containsText('Card');
      assert.dom('[data-test-field="title"] input').hasValue('');
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/person"]`);
      await click(`[data-test-select="${testRealmURL}spec/person"]`);
      await click('[data-test-card-catalog-go-button]');
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
            module: `${testRealmURL}person`,
            name: 'Person',
          },
          'adoptsFrom is correct',
        );
        deferred.fulfill();
      });

      await click('[data-test-create-card-instance]');
      await waitFor('[data-test-create-file-modal]', { count: 0 });
      await waitFor(`[data-test-code-mode-card-preview-header="${fileID}"]`);
      assert
        .dom(
          '[data-test-code-mode-card-preview-header] [data-test-realm-icon-url]',
        )
        .hasAttribute('aria-label', 'Test Workspace B');
      assert.dom('[data-test-card-resource-loaded]').containsText('Person');
      assert.dom('[data-test-field="firstName"] input').hasValue('');
      assert.dom('[data-test-card-url-bar-input]').hasValue(`${fileID}.json`);

      await deferred.promise;
    });

    test<TestContextWithSave>('can create a new card definition in different realm than inherited definition', async function (assert) {
      assert.expect(11);
      let expectedSrc = `
import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class TrèsTestCard extends CardDef {
  static displayName = "Très test card 😀";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
      await waitForCodeEditor();
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
      assert.dom('[data-test-total-fields]').containsText('3 Fields');
    });

    test<TestContextWithSave>('can create a new card definition in same realm as inherited definition', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/person"]`);
      await click(`[data-test-select="${testRealmURL}spec/person"]`);
      await click('[data-test-card-catalog-go-button]');
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
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends Person {
  static displayName = "Test Card";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/person"]`);
      await click(`[data-test-select="${testRealmURL}spec/person"]`);
      await click('[data-test-card-catalog-go-button]');
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/person"]`);
      await click(`[data-test-select="${testRealmURL}spec/person"]`);
      await click('[data-test-card-catalog-go-button]');
      await waitFor(`[data-test-selected-type="Person"]`);

      await fillIn('[data-test-display-name-field]', 'Test Card');
      await fillIn('[data-test-file-name-field]', 'test-fetch-failure-card');

      await click('[data-test-create-definition]');

      await waitFor('[data-test-create-file-modal] [data-test-error-message]');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .containsText('Error creating card definition')
        .containsText('A deliberate fetch error');

      await fillIn('[data-test-display-name-field]', 'Test Card');

      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .doesNotExist('changing a field should clear the error');
    });

    test<TestContextWithSave>('can create a new field definition that extends field definition that uses default export', async function (assert) {
      assert.expect(3);
      await visitOperatorMode();
      await openNewFileModal('Field Definition');
      assert.dom('[data-test-selected-type]').hasText('General Field');
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-catalog-modal]');

      await waitFor(
        `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
      );
      await click(
        `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
      );
      await click('[data-test-card-catalog-go-button]');

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
import BigInteger from 'https://cardstack.com/base/big-integer';
import { Component } from 'https://cardstack.com/base/card-api';
export class FieldThatExtendsFromBigInt extends BigInteger {
  static displayName = "Field that extends from big int";

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
      await waitFor('[data-test-card-catalog-modal]');

      await waitFor(
        `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
      );
      await click(
        `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
      );
      await click('[data-test-card-catalog-go-button]');
      await fillIn(
        '[data-test-display-name-field]',
        'Field that will not save',
      );
      await fillIn('[data-test-file-name-field]', 'test-fetch-failure-card');
      await click('[data-test-create-definition]');

      await waitFor('[data-test-create-file-modal] [data-test-error-message]');
      assert
        .dom('[data-test-create-file-modal] [data-test-error-message]')
        .containsText('Error creating field definition')
        .containsText('A deliberate fetch error');
    });

    test<TestContextWithSave>('can create a new definition that extends card definition which uses default export', async function (assert) {
      assert.expect(1);
      await visitOperatorMode();
      await openNewFileModal('Card Definition');

      // select card type
      await click('[data-test-select-card-type]');
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-catalog-go-button]');
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
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends Pet {
  static displayName = "Test Card";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-catalog-go-button]');
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
import { Component } from 'https://cardstack.com/base/card-api';
export class Pet extends PetParent {
  static displayName = "Pet";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click(`[data-test-select="${testRealmURL}spec/pet"]`);
      await click('[data-test-card-catalog-go-button]');
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
import { Component } from 'https://cardstack.com/base/card-api';
export class Map0 extends Pet {
  static displayName = "Map";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class TestCard extends CardDef {
  static displayName = "Test Card";

  /*
  static isolated = class Isolated extends Component<typeof this> {
    <template></template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
  */
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
        await waitForCodeEditor();
        await waitFor(`[data-test-action-button="Duplicate"]`);
        await click('[data-test-action-button="Duplicate"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when inheriting card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitForCodeEditor();
        await waitFor(`[data-test-action-button="Inherit"]`);
        await click('[data-test-action-button="Inherit"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating instance of card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitForCodeEditor();
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
        await waitForCodeEditor();
        await waitFor(`[data-test-action-button="Duplicate"]`);
        await click('[data-test-action-button="Duplicate"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when inheriting card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitForCodeEditor();
        await waitFor(`[data-test-action-button="Inherit"]`);
        await click('[data-test-action-button="Inherit"]');
        await assertRealmDropDownIsCorrect(assert);
      });

      test('read only realm is not present in realm drop down when creating instance of card definition', async function (assert) {
        await visitOperatorMode(`${testRealmURL}pet.gts`);
        await waitForCodeEditor();
        await waitFor(`[data-test-action-button="Create Instance"]`);
        await click('[data-test-action-button="Create Instance"]');
        await assertRealmDropDownIsCorrect(assert);
      });
    },
  );
});
