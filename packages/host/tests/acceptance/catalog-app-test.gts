import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import ListingInstallCommand from '@cardstack/host/commands/listing-install';
import ListingRemixCommand from '@cardstack/host/commands/listing-remix';
import ListingUseCommand from '@cardstack/host/commands/listing-use';
import type CommandService from '@cardstack/host/services/command-service';
import type StoreService from '@cardstack/host/services/store';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  lookupService,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  waitForCodeEditor,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const catalogRealmURL = 'http://localhost:4201/catalog/';
const testRealm2URL = `http://test-realm/test2/`;

const listingCardSource = `
  import {
    field,
    contains,
    linksTo,
    linksToMany,
    containsMany,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import { Spec } from 'https://cardstack.com/base/spec';
  import StringField from 'https://cardstack.com/base/string';
  import TextAreaField from 'https://cardstack.com/base/text-area';
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import ColorField from 'https://cardstack.com/base/color';

  export class Listing extends CardDef {
    static displayName = 'Listing';
    static headerColor = '#6638ff';
    @field name = contains(StringField);
    @field summary = contains(MarkdownField);
    @field specs = linksToMany(() => Spec);
    @field publisher = linksTo(() => Publisher);
    @field categories = linksToMany(() => Category);
    @field tags = linksToMany(() => Tag);
    @field license = linksTo(() => License);
    @field images = containsMany(StringField);
    @field examples = linksToMany(CardDef);

    @field title = contains(StringField, {
      computeVia(this: Listing) {
        return this.name;
      },
    });
  }

  export class Publisher extends CardDef {
    static displayName = 'Publisher';
    static headerColor = '#00ebac';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia(this: Publisher) {
        return this.name;
      },
    });
  }

  export class Category extends CardDef {
    static displayName = 'Category';
    static headerColor = '#00ebac';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Category) {
        return this.name;
      },
    });
  }

  export class License extends CardDef {
    static displayName = 'License';
    static headerColor = '#00ebac';
    @field name = contains(StringField);
    @field content = contains(TextAreaField);
    @field title = contains(StringField, {
      computeVia: function (this: License) {
        return this.name;
      },
    });
  }

  export class Tag extends CardDef {
    static displayName = 'Tag';
    @field name = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Tag) {
        return this.name;
      },
    });
    @field color = contains(ColorField);
  }
`;

const authorCardSource = `
  import { field, contains, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
  } 
`;

let matrixRoomId: string;
module('Acceptance | catalog app tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  let { getRoomIds, getRoomEvents, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'listing.gts': listingCardSource,
        'author/author.gts': authorCardSource,
        'author/Author/example.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mike',
              lastName: 'Dane',
              summary: 'Author',
            },
            meta: {
              adoptsFrom: {
                module: '../author',
                name: 'Author',
              },
            },
          },
        },
        'Spec/author.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'Author',
                module: '../author/author',
              },
            },
            specType: 'card',
            containedExamples: [],
            title: 'Author',
            description: 'Spec for Author card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Listing/author.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Author',
              name: 'Author',
              summary: 'Author',
              images: null,
              description: null,
              thumbnailURL: null,
            },
            relationships: {
              'specs.0': {
                links: {
                  self: '../Spec/author',
                },
              },
              publisher: {
                links: {
                  self: null,
                },
              },
              'categories.0': {
                links: {
                  self: null,
                },
              },
              'tags.0': {
                links: {
                  self: null,
                },
              },
              license: {
                links: {
                  self: null,
                },
              },
              'examples.0': {
                links: {
                  self: '../author/Author/example',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../listing',
                name: 'Listing',
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
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
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
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
  });

  module('catalog listing', async function () {
    test('after clicking "Use" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${catalogRealmURL}CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitFor('[data-test-catalog-listing-use-button]');
      assert
        .dom('[data-test-catalog-listing-use-button]')
        .containsText('Use', '"Use" button exist in listing');
      await click('[data-test-catalog-listing-use-button]');
      await click(`[data-test-boxel-menu-item-text="Test Workspace B"]`);

      await waitFor(`[data-room-settled]`);

      await waitUntil(() => getRoomIds().length > 0);
      let roomId = getRoomIds().pop()!;
      let message = getRoomEvents(roomId).pop()!;

      assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
      assert.strictEqual(
        message.content.body,
        'I would like to use this Mortgage Calculator under the following realm: http://test-realm/test/',
      );
    });

    test('after clicking "Install" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${catalogRealmURL}CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitFor('[data-test-catalog-listing-install-button]');
      assert
        .dom('[data-test-catalog-listing-install-button]')
        .containsText('Install', '"Install" button exist in listing');
      await click('[data-test-catalog-listing-install-button]');
      await click(`[data-test-boxel-menu-item-text="Test Workspace B"]`);

      await waitFor(`[data-room-settled]`);

      await waitUntil(() => getRoomIds().length > 0);
      let roomId = getRoomIds().pop()!;
      let message = getRoomEvents(roomId).pop()!;

      assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
      assert.strictEqual(
        message.content.body,
        'I would like to install this Mortgage Calculator under the following realm: http://test-realm/test/',
      );
    });

    test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${catalogRealmURL}`,
              format: 'isolated',
            },
          ],
        ],
      });

      const mortgageCalculatorCardId = `${catalogRealmURL}CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`;

      await waitFor('.catalog-content');
      await waitFor('.showcase-center-div');

      await waitFor(
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
      );

      assert
        .dom(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
        )
        .containsText(
          'Mortgage Calculator',
          '"Mortgage Calculator" button exist in listing',
        );

      await waitFor(
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-remix-button]`,
      );
      assert
        .dom(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-remix-button]`,
        )
        .containsText('Remix', '"Remix" button exist in listing');

      await click(
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-remix-button]`,
      );
      await click(`[data-test-boxel-menu-item-text="Test Workspace B"]`);

      await waitFor(`[data-room-settled]`);

      await waitUntil(() => getRoomIds().length > 0);
      let roomId = getRoomIds().pop()!;
      let message = getRoomEvents(roomId).pop()!;

      assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
      assert.strictEqual(
        message.content.body,
        'I would like to remix this Mortgage Calculator under the following realm: http://test-realm/test/',
      );
    });

    test('use command copy the card to the workspace successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      let commandService = lookupService<CommandService>('command-service');
      let store = lookupService<StoreService>('store');

      let useCommand = new ListingUseCommand(commandService.commandContext);
      const listingUrl = testRealmURL + 'Listing/author.json';
      const listing = (await store.get(listingUrl)) as CardDef;

      await useCommand.execute({
        realm: testRealm2URL,
        listing,
      });

      // Check example is copied successfully
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealm2URL}index`,
      });

      await waitForCodeEditor();

      await waitFor('[data-test-directory^="author-"]');
      const element = document.querySelector(
        '[data-test-directory^="author-"]',
      );
      const fullPath = element?.getAttribute('data-test-directory');
      await click(`[data-test-directory="${fullPath}"]`);

      assert.dom(`[data-test-directory="${fullPath}"] .icon`).hasClass('open');

      // able to see example install successfully
      const examplePath = `${fullPath}Author/`;
      await waitFor(`[data-test-directory="${examplePath}"]`);
      await click(`[data-test-directory="${examplePath}"]`);

      assert
        .dom(`[data-test-directory="${examplePath}"] .icon`)
        .hasClass('open');

      await waitFor(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );
      await click(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );

      assert
        .dom(`[data-test-file^="${examplePath}"][data-test-file$=".json"]`)
        .exists('Author Example with uuid instance exists')
        .hasClass('selected', 'Author Example with uuid instance is selected');
    });

    test('install command installs the card and example successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      let commandService = lookupService<CommandService>('command-service');
      let store = lookupService<StoreService>('store');

      let installCommand = new ListingInstallCommand(
        commandService.commandContext,
      );
      const listingUrl = testRealmURL + 'Listing/author.json';
      const listing = (await store.get(listingUrl)) as CardDef;

      await installCommand.execute({
        realm: testRealm2URL,
        listing,
      });

      // Check gts file is installed/copied successfully
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealm2URL}index`,
      });

      await waitForCodeEditor();

      await waitFor('[data-test-directory^="author-"]');
      const element = document.querySelector(
        '[data-test-directory^="author-"]',
      );
      const fullPath = element?.getAttribute('data-test-directory');
      await click(`[data-test-directory="${fullPath}"]`);

      assert.dom(`[data-test-directory="${fullPath}"] .icon`).hasClass('open');

      const filePath = `${fullPath}author.gts`;
      await waitFor(`[data-test-file="${filePath}"]`);
      await click(`[data-test-file="${filePath}"]`);
      assert
        .dom(`[data-test-file="${filePath}"]`)
        .exists('author.gts file exists')
        .hasClass('selected', 'author.gts file is selected');

      // able to see example install successfully
      const examplePath = `${fullPath}Author/`;
      await waitFor(`[data-test-directory="${examplePath}"]`);
      await click(`[data-test-directory="${examplePath}"]`);

      assert
        .dom(`[data-test-directory="${examplePath}"] .icon`)
        .hasClass('open');

      await waitFor(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );
      await click(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );

      assert
        .dom(`[data-test-file^="${examplePath}"][data-test-file$=".json"]`)
        .exists('Author Example with uuid instance exists')
        .hasClass('selected', 'Author Example with uuid instance is selected');
    });

    test('remix command installs the card and redirects to code mode with persisted playground selection for first example successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      let commandService = lookupService<CommandService>('command-service');
      let store = lookupService<StoreService>('store');

      let remixCommand = new ListingRemixCommand(commandService.commandContext);
      const listingUrl = testRealmURL + 'Listing/author.json';
      const listing = (await store.get(listingUrl)) as CardDef;

      await remixCommand.execute({
        realm: testRealm2URL,
        listing,
      });

      await waitFor('[data-test-accordion-item="playground"]', {
        timeout: 5_000,
      });
      await click('[data-test-accordion-item="playground"] button');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
    });
  });
});
