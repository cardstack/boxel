import { click, fillIn, waitFor, waitUntil, visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import { GridContainer } from '@cardstack/boxel-ui/components';

import { baseRealm } from '@cardstack/runtime-common';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_MESSAGE_MSGTYPE,
  DEFAULT_LLM,
  DEFAULT_LLM_LIST,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import {
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  assertMessages,
  type TestContextWithSave,
} from '../helpers';

import {
  CardDef,
  Component,
  CardsGrid,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { getRoomIdForRealmAndUser } from '../helpers/mock-matrix/_utils';
import { setupApplicationTest } from '../helpers/setup';

async function selectCardFromCatalog(cardId: string) {
  await click('[data-test-attach-button]');
  await click('[data-test-attach-card-btn]');
  await click(`[data-test-select="${cardId}"]`);
  await click('[data-test-card-catalog-go-button]');
}

let countryDefinition = `import { field, contains, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  export class Country extends CardDef {
    static displayName = 'Country';
    @field name = contains(StringField);
  }`;

let matrixRoomId: string;
module('Acceptance | AI Assistant tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    directRooms: [
      getRoomIdForRealmAndUser(testRealmURL, '@testuser:localhost'),
      getRoomIdForRealmAndUser(baseRealm.url, '@testuser:localhost'),
    ],
  });

  let { createAndJoinRoom, getRoomState, simulateRemoteMessage } =
    mockMatrixUtils;

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field favoriteTreat = contains(StringField);

      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <GridContainer class='container'>
            <h2><@fields.title /></h2>
            <div>
              <div>Favorite Treat: <@fields.favoriteTreat /></div>
              <div data-test-editable-meta>
                {{#if @canEdit}}
                  <@fields.title />
                  is editable.
                {{else}}
                  <@fields.title />
                  is NOT editable.
                {{/if}}
              </div>
            </div>
          </GridContainer>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          if (!this.firstName) {
            return;
          }
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          Pet:
          <@fields.pet />
          Friends:
          <@fields.friends />
        </template>
      };
    }

    let mangoPet = new Pet({ name: 'Mango' });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'pet.gts': { Pet },
        'country.gts': countryDefinition,
        'Country/indonesia.json': {
          data: {
            attributes: {
              name: 'Indonesia',
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}country`,
                name: 'Country',
              },
            },
          },
        },
        'Pet/ringo.json': new Pet({ name: 'Ringo' }),
        'Person/hassan.json': new Person({
          firstName: 'Hassan',
          lastName: 'Abdel-Rahman',
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'Pet/mango.json': mangoPet,
        'Pet/vangogh.json': new Pet({ name: 'Van Gogh' }),
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'plant.gts': `
          import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
          export class Plant extends CardDef {
            static displayName = "Plant";
            @field commonName = contains(StringField);
          }
        `,
        'Plant/highbush-blueberry.json': {
          data: {
            attributes: {
              commonName: 'Highbush Blueberry',
            },
            meta: {
              adoptsFrom: {
                module: `../plant`,
                name: 'Plant',
              },
            },
          },
        },
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
  });

  test('attaches a card in a conversation multiple times', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    const testCard = `${testRealmURL}Person/hassan`;

    for (let i = 1; i <= 3; i++) {
      await fillIn('[data-test-message-field]', `Message - ${i}`);
      await selectCardFromCatalog(testCard);
      await click('[data-test-send-message-btn]');
    }

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    //Test the scenario where there is an update to the card
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"]`,
    );

    await click(`[data-test-stack-card="${testCard}"] [data-test-edit-button]`);
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Updated Name',
    );
    await click(`[data-test-stack-card="${testCard}"] [data-test-edit-button]`);

    await fillIn('[data-test-message-field]', `Message with updated card`);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message with updated card',
        cards: [{ id: testCard, title: 'Updated Name Abdel-Rahman' }],
      },
    ]);
  });

  test('attached cards include computed fields', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    const testCard = `${testRealmURL}Person/hassan`;

    await fillIn('[data-test-message-field]', `Message - 1`);
    await selectCardFromCatalog(testCard);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message - 1',
        cards: [{ id: testCard, title: 'Hassan' }],
      },
    ]);

    let roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    let lastMessageEvent = roomEvents[roomEvents.length - 1];

    // This series of checks just covers common places this may
    // fail as there are a lot of layers here.
    assert.ok(lastMessageEvent, 'A message event was found');
    let messageDataString = lastMessageEvent.content?.data;
    assert.ok(messageDataString, 'Message has data string');
    let messageData = JSON.parse(messageDataString); // Assuming data is a JSON string
    assert.ok(messageData, 'Message data is parsable');
    let attachedCards = messageData.attachedCards;
    assert.ok(attachedCards, 'Message has attachedCards');
    assert.strictEqual(attachedCards.length, 1, 'One card is attached');
    let attachedCard = attachedCards[0];
    assert.ok(attachedCard, 'Attached card is present');
    const mxcUrl = attachedCard.url;

    assert.ok(mxcUrl, 'Attached card has a URL (mxc)');
    // The mock matrix server uses http://mock-server/ for its mxc content
    assert.ok(
      mxcUrl.startsWith('http://mock-server/'),
      `Card URL "${mxcUrl}" should start with http://mock-server/`,
    );

    // Download the card file def
    const matrixService = getService('matrix-service');

    let cardContent = await matrixService.downloadCardFileDef(attachedCard);

    // Check that the computed title is present in the downloaded content
    assert.strictEqual(
      cardContent.data.attributes!.title,
      'Hassan Abdel-Rahman',
      'Computed card title is present in downloaded content',
    );
  });

  test('displays active LLM in chat input', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom('[data-test-llm-select-selected]')
      .hasText(DEFAULT_LLM.split('/')[1]);
    await click('[data-test-llm-select-selected]');

    assert.dom('[data-test-llm-select-item]').exists({
      count: DEFAULT_LLM_LIST.length,
    });
    assert
      .dom('[data-test-llm-select-item="anthropic/claude-3.7-sonnet"]')
      .hasText('anthropic/claude-3.7-sonnet');
    await click(
      '[data-test-llm-select-item="anthropic/claude-3.7-sonnet"] button',
    );
    await click('[data-test-pill-menu-button]');
    assert.dom('[data-test-llm-select-selected]').hasText('claude-3.7-sonnet');

    let roomState = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.strictEqual(roomState.model, 'anthropic/claude-3.7-sonnet');
  });

  test('defaults to anthropic/claude-sonnet-4 in code mode', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    assert.dom('[data-test-llm-select-selected]').hasText('claude-sonnet-4');

    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test-2',
    });

    await click('[data-test-past-sessions-button]');
    await waitFor("[data-test-enter-room='mock_room_1']");
    await click('[data-test-enter-room="mock_room_1"]');
    assert.dom('[data-test-llm-select-selected]').hasText('claude-sonnet-4');
  });

  test('auto-attached file is not displayed in interact mode', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click(
      '[data-test-cards-grid-item="http://test-realm/test/Person/fadhlan"]',
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert.dom('[data-test-autoattached-file]').doesNotExist();
    assert.dom('[data-test-autoattached-card]').exists();
    // Move to code mode and a file will be attached
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    assert.dom('[data-test-autoattached-file]').exists();
    assert.dom('[data-test-autoattached-card]').exists();
    // Move back to interact mode and check the file is not attached
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    assert.dom('[data-test-autoattached-file]').doesNotExist();
    assert.dom('[data-test-autoattached-card]').exists();
  });

  test('cards are auto-attached in code mode', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click(
      '[data-test-cards-grid-item="http://test-realm/test/Person/fadhlan"]',
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert.dom('[data-test-autoattached-file]').doesNotExist();
    assert.dom('[data-test-autoattached-card]').exists();
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    assert.dom('[data-test-autoattached-file]').exists();
    assert.dom('[data-test-autoattached-card]').exists();
    await click(`[data-test-autoattached-card] [data-test-remove-card-btn]`);
    assert.dom('[data-test-autoattached-card]').doesNotExist();
  });

  test<TestContextWithSave>('can send a newly created auto-attached card', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    let id: string | undefined;
    this.onSave((url) => {
      id = url.href;
    });

    await click('[data-test-open-ai-assistant]');
    assert.dom('[data-test-attached-card]').doesNotExist();
    await click('[data-test-create-new-card-button]');
    await click(`[data-test-select="https://cardstack.com/base/types/card"]`);

    await click(`[data-test-card-catalog-go-button]`);

    await waitUntil(() => id);
    id = id!;

    await fillIn('[data-test-field="title"] input', 'new card');
    assert.dom(`[data-test-attached-card]`).containsText('new card');

    await fillIn('[data-test-message-field]', `Message with updated card`);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message with updated card',
        cards: [{ id, title: 'new card' }],
      },
    ]);
  });

  test('can open attach file modal', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    assert.dom('[data-test-choose-file-modal]').exists();
    assert.dom('[data-test-file="pet.gts"]').exists();

    // Change realm
    await click('[data-test-choose-file-modal-realm-chooser]');
    await click('[data-test-choose-file-modal-realm-option="Base Workspace"]');
    assert.dom('[data-test-file="boolean.gts"]').exists();

    await click('[data-test-choose-file-modal-realm-chooser]');
    await click(
      '[data-test-choose-file-modal-realm-option="Test Workspace B"]',
    );

    // Add attachment item
    await click('[data-test-file="person.gts"]');
    await click('[data-test-choose-file-modal-add-button]');
    assert.dom('[data-test-attached-file]').exists({ count: 1 });
    assert.dom('[data-test-attached-file]').hasText('person.gts');
    // Add attachment item
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click('[data-test-file="pet.gts"]');
    await click('[data-test-choose-file-modal-add-button]');
    assert.dom('[data-test-attached-file]').exists({ count: 2 });
    assert
      .dom(`[data-test-attached-file="${testRealmURL}person.gts"]`)
      .hasText('person.gts');
    assert
      .dom(`[data-test-attached-file="${testRealmURL}pet.gts"]`)
      .hasText('pet.gts');

    // Add remove attachment item
    await click(
      `[data-test-attached-file="${testRealmURL}person.gts"] [data-test-remove-file-btn]`,
    );
    assert.dom('[data-test-attached-file]').hasText('pet.gts');

    await fillIn('[data-test-message-field]', `Message With File`);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message With File',
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
    ]);
  });

  test('can display and remove auto attached file', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await click('[data-test-file="person.gts"]');
    assert.dom('[data-test-autoattached-file]').exists();
    assert.dom(`[data-test-autoattached-file]`).hasText('person.gts');

    await click('[data-test-file-browser-toggle]');
    await click(`[data-test-autoattached-file] [data-test-remove-file-btn]`);
    assert.dom('[data-test-autoattached-file]').doesNotExist();

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="pet.gts"]');
    assert.dom('[data-test-autoattached-file]').exists();
    assert.dom(`[data-test-autoattached-file]`).hasText('pet.gts');

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="person.gts"]');
    assert.dom('[data-test-autoattached-file]').exists();
    assert.dom(`[data-test-autoattached-file]`).hasText('person.gts');
  });

  test('loads more AI rooms when scrolling', async function (assert) {
    for (let i = 1; i <= 15; i++) {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: `AI Room ${i}`,
      });
    }

    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await click('[data-test-past-sessions-button]');

    assert.dom('[data-test-past-sessions]').exists();
    assert.dom('[data-test-joined-room]').exists({ count: 10 });

    let pastSessionsElement = document.querySelector(
      '[data-test-past-sessions] .body ul',
    );
    if (pastSessionsElement) {
      pastSessionsElement.scrollTop = pastSessionsElement.scrollHeight;
    }
    await waitUntil(
      () => document.querySelectorAll('[data-test-joined-room]').length === 16,
    );
    assert.dom('[data-test-joined-room]').exists({ count: 16 });
  });

  test('preserves ai assistant panel open/closed status', async function (assert) {
    // Test with AI assistant closed
    let operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      aiAssistantOpen: false,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    // Open AI assistant and verify state is updated
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert.dom('[data-test-ai-assistant-panel]').exists();

    // Verify URL contains updated state with aiAssistantOpen: true
    let operatorModeStateService = getService('operator-mode-state-service');
    assert.true(
      operatorModeStateService.aiAssistantOpen,
      'URL state should have aiAssistantOpen: true',
    );

    // Close AI assistant and verify state is updated
    await click('[data-test-close-ai-assistant]');
    assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

    // Verify URL contains updated state with aiAssistantOpen: false
    assert.false(
      operatorModeStateService.aiAssistantOpen,
      'URL state should have aiAssistantOpen: false',
    );

    // Test with AI assistant opened
    operatorModeStateParam = stringify({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      aiAssistantOpen: true,
    })!;
    await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
    assert.dom('[data-test-ai-assistant-panel]').exists();
  });

  test('auto-attached cards behaviour', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // In interact mode, auto-attached cards must be the top most cards in the stack
    // unless the card is manually chosen
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert.dom('[data-test-autoattached-file]').doesNotExist();
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .exists();

    await click('[data-test-add-card-right-stack]');
    await fillIn('[data-test-search-field]', 'Mango');
    await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);
    assert.dom('[data-test-autoattached-card]').exists({ count: 2 });
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Pet/mango"][data-test-autoattached-card]`,
      )
      .exists();

    await click('[data-test-attach-button]');
    await click('[data-test-attach-card-btn]');
    await fillIn('[data-test-search-field]', 'Mango');
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Pet/mango"][data-test-autoattached-card]`,
      )
      .doesNotExist();
    assert.dom(`[data-test-attached-card="${testRealmURL}Pet/mango"]`).exists();

    // In code mode, auto-attached card must be the playground panel card and the card of the opened file with json extension
    // unless the card is manually chosen
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .doesNotExist();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Pet/mango"][data-test-autoattached-card]`,
      )
      .doesNotExist();
    assert.dom(`[data-test-attached-card="${testRealmURL}Pet/mango"]`).exists();

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-directory="Person/"]');
    await click('[data-test-file="Person/fadhlan.json"]');
    assert.dom('[data-test-attached-card]').exists({ count: 2 });
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });
    assert.dom('[data-test-autoattached-file]').exists({ count: 1 });
    assert.dom(`[data-test-attached-card="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .exists();

    await click('[data-test-file="country.gts"]');
    await click('[data-test-module-inspector-view="preview"]');
    assert.dom('[data-test-attached-card]').exists({ count: 2 });
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });
    assert.dom('[data-test-autoattached-file]').exists({ count: 1 });
    assert.dom(`[data-test-attached-card="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Country/indonesia"][data-test-autoattached-card]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}country.gts"][data-test-autoattached-file]`,
      )
      .exists();

    // auto-attached cards should be removable
    await click(
      `[data-test-attached-card="${testRealmURL}Country/indonesia"] [data-test-remove-card-btn]`,
    );
    assert
      .dom(`[data-test-attached-card="${testRealmURL}Country/indonesia"]`)
      .doesNotExist();
  });

  test('displays "Generating results..." when streaming', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // In interact mode, auto-attached cards must be the top most cards in the stack
    // unless the card is manually chosen
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    let eventId = simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      body: 'Streaming...',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });

    await waitFor('[data-test-ai-assistant-action-bar]');
    assert
      .dom('[data-test-ai-assistant-action-bar]')
      .containsText('Generating results...');
    assert.dom('[data-test-stop-generating]').exists();

    simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      body: 'Streaming finished',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      'm.relates_to': {
        event_id: eventId,
        rel_type: 'm.replace',
      },
    });
    await waitUntil(
      () => !document.querySelector('[data-test-ai-assistant-action-bar]'),
    );
  });

  test('displays "Generation Cancelled" in the bottom of the message', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // In interact mode, auto-attached cards must be the top most cards in the stack
    // unless the card is manually chosen
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    let eventId = simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
      isCanceled: false,
    });

    await waitFor('[data-test-ai-assistant-message]');
    assert.dom('[data-test-ai-assistant-action-bar]').exists();
    assert
      .dom('[data-test-ai-assistant-action-bar]')
      .containsText('Generating results...');
    assert.dom('[data-test-stop-generating]').exists();
    assert
      .dom('[data-test-ai-message-content]')
      .hasText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.');

    simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      isCanceled: true,
      'm.relates_to': {
        event_id: eventId,
        rel_type: 'm.replace',
      },
    });

    await waitUntil(
      () => !document.querySelector('[data-test-ai-assistant-action-bar]'),
    );
    assert
      .dom('[data-test-ai-message-content]')
      .hasText(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. {Generation Cancelled}',
      );
  });

  test(`displays "Generation Cancelled" in the bottom of the message when it's stopped during reasoning`, async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      codePath: `${testRealmURL}index.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // In interact mode, auto-attached cards must be the top most cards in the stack
    // unless the card is manually chosen
    await click(`[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    let eventId = simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'This message will be cancelled before the reasoning is finished',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
      isCanceled: false,
    });

    await waitFor('[data-test-ai-assistant-message]');
    assert.dom('[data-test-ai-assistant-action-bar]').exists();
    assert
      .dom('[data-test-ai-assistant-action-bar]')
      .containsText('Generating results...');
    assert.dom('[data-test-stop-generating]').exists();
    assert.dom('[data-test-ai-message-content]').containsText('Thinking...');
    assert
      .dom('[data-test-ai-message-content]')
      .doesNotContainText('{Generation Cancelled}');
    assert
      .dom('[data-test-reasoning]')
      .containsText(
        'This message will be cancelled before the reasoning is finished',
      );

    simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'This message will be cancelled before the reasoning is finished',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      isCanceled: true,
      'm.relates_to': {
        event_id: eventId,
        rel_type: 'm.replace',
      },
    });

    await waitUntil(
      () => !document.querySelector('[data-test-ai-assistant-action-bar]'),
    );
    assert.dom('[data-test-ai-message-content]').containsText('Thinking...');
    assert
      .dom('[data-test-ai-message-content]')
      .containsText('{Generation Cancelled}');
    await click('[data-test-reasoning]');
    assert
      .dom('[data-test-reasoning]')
      .containsText(
        'This message will be cancelled before the reasoning is finished',
      );
  });

  test('code mode context sent with message', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}Plant/highbush-blueberry.json`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
          {
            id: `${testRealmURL}Plant/highbush-blueberry`,
            format: 'isolated',
          },
        ],
      ],
    });
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await fillIn('[data-test-message-field]', `Message - 1`);
    await click('[data-test-send-message-btn]');

    let roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    let lastMessageEvent = roomEvents[roomEvents.length - 1];
    let contextSent = JSON.parse(lastMessageEvent.content.data).context;
    assert.strictEqual(
      contextSent.realmUrl,
      testRealmURL,
      'Context sent with message contains correct realmUrl',
    );
    assert.strictEqual(
      contextSent.submode,
      'code',
      'Context sent with message contains correct submode',
    );
    assert.deepEqual(
      contextSent.openCardIds,
      [`${testRealmURL}Plant/highbush-blueberry`],
      'Context sent with message contains correct openCardIds',
    );
    assert.strictEqual(
      contextSent.codeMode.currentFile,
      `${testRealmURL}Plant/highbush-blueberry.json`,
      'Context sent with message contains correct currentFile',
    );
    // TODO: contextSent.codeMode.moduleInspectorPanel is 'schema' but the schema panel is not visible right now
    // assert.strictEqual(
    //   contextSent.codeMode.moduleInspectorPanel,
    //   'card-renderer',
    //   'Context sent with message contains correct moduleInspectorPanel',
    // );
    // TODO: should we report what format the user is looking at the card in?
    // assert.strictEqual(
    //   contextSent.codeMode.cardRendererFormat,
    //   'isolated',
    //   'Context sent with message contains correct cardRendererFormat',
    // );

    assert.strictEqual(
      contextSent.codeMode.previewPanelSelection,
      undefined,
      'Context sent with message contains correct previewPanelSelection',
    );

    await click('[data-test-clickable-definition-container]');

    await fillIn('[data-test-message-field]', `Message - 2`);
    await click('[data-test-send-message-btn]');

    roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    lastMessageEvent = roomEvents[roomEvents.length - 1];
    contextSent = JSON.parse(lastMessageEvent.content.data).context;

    assert.strictEqual(
      contextSent.realmUrl,
      testRealmURL,
      'Context sent with message contains correct realmUrl',
    );
    assert.strictEqual(
      contextSent.submode,
      'code',
      'Context sent with message contains correct submode',
    );
    assert.deepEqual(
      contextSent.openCardIds,
      [],
      'Context sent with message contains correct openCardIds',
    );
    assert.strictEqual(
      contextSent.codeMode.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.strictEqual(
      contextSent.codeMode.moduleInspectorPanel,
      'schema',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.strictEqual(
      contextSent.codeMode.previewPanelSelection,
      undefined,
      'Context sent with message contains correct previewPanelSelection',
    );

    await click(
      '[data-test-boxel-button][data-test-module-inspector-view="preview"]',
    );

    await fillIn('[data-test-message-field]', `Message - 3`);
    await click('[data-test-send-message-btn]');

    roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    lastMessageEvent = roomEvents[roomEvents.length - 1];
    contextSent = JSON.parse(lastMessageEvent.content.data).context;

    assert.strictEqual(
      contextSent.realmUrl,
      testRealmURL,
      'Context sent with message contains correct realmUrl',
    );
    assert.strictEqual(
      contextSent.submode,
      'code',
      'Context sent with message contains correct submode',
    );
    assert.deepEqual(
      contextSent.openCardIds,
      [`${testRealmURL}Plant/highbush-blueberry`],
      'Context sent with message contains correct openCardIds',
    );
    assert.strictEqual(
      contextSent.codeMode.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.strictEqual(
      contextSent.codeMode.moduleInspectorPanel,
      'preview',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.deepEqual(
      contextSent.codeMode.previewPanelSelection,
      {
        cardId: `${testRealmURL}Plant/highbush-blueberry`,
        format: 'isolated',
      },
      'Context sent with message contains correct previewPanelSelection',
    );

    await click(
      '[data-test-boxel-button][data-test-module-inspector-view="spec"]',
    );
    await fillIn('[data-test-message-field]', `Message - 4`);
    await click('[data-test-send-message-btn]');

    roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    lastMessageEvent = roomEvents[roomEvents.length - 1];
    contextSent = JSON.parse(lastMessageEvent.content.data).context;

    assert.strictEqual(
      contextSent.realmUrl,
      testRealmURL,
      'Context sent with message contains correct realmUrl',
    );
    assert.strictEqual(
      contextSent.submode,
      'code',
      'Context sent with message contains correct submode',
    );
    assert.deepEqual(
      contextSent.openCardIds,
      [],
      'Context sent with message contains correct openCardIds',
    );
    assert.strictEqual(
      contextSent.codeMode.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.strictEqual(
      contextSent.codeMode.moduleInspectorPanel,
      'spec',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.strictEqual(
      contextSent.codeMode.previewPanelSelection,
      undefined,
      'Context sent with message contains correct previewPanelSelection',
    );
  });
});
