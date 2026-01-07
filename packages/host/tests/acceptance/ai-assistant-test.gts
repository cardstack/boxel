import {
  click,
  fillIn,
  waitFor,
  waitUntil,
  visit,
  triggerEvent,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import { module, test } from 'qunit';
import stringify from 'safe-stable-stringify';

import { GridContainer } from '@cardstack/boxel-ui/components';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { Deferred, baseRealm, skillCardRef } from '@cardstack/runtime-common';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_REASONING_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import { AiAssistantMessageDrafts } from '@cardstack/host/utils/local-storage-keys';

import type { BoxelContext } from 'https://cardstack.com/base/matrix-event';

import {
  setupLocalIndexing,
  setupOnSave,
  setupAuthEndpoints,
  setupUserSubscription,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  assertMessages,
  setupRealmServerEndpoints,
  type TestContextWithSave,
  delay,
  getMonacoContent,
  envSkillId,
  catalogRealm,
  skillsRealm,
} from '../helpers';

import {
  CardDef,
  CardInfoField,
  Component,
  CardsGrid,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
  SystemCard,
  ModelConfiguration,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { getRoomIdForRealmAndUser } from '../helpers/mock-matrix/_utils';
import { setupApplicationTest } from '../helpers/setup';

async function selectCardFromCatalog(cardId: string) {
  await click('[data-test-attach-button]');
  await click('[data-test-attach-card-btn]');
  await fillIn('[data-test-search-field]', cardId);
  await click(`[data-test-select="${cardId}"]`);
  await click('[data-test-card-catalog-go-button]');
}

async function waitForSessionPreparationToFinish(
  timeout = 30_000,
): Promise<void> {
  const aiAssistantPanelService = getService(
    'ai-assistant-panel-service',
  ) as AiAssistantPanelService;

  // Background tasks post messages asynchronously; wait until they are done.
  await waitUntil(() => !aiAssistantPanelService.isPreparingSession, {
    timeout,
  });
}

let countryDefinition = `import { field, contains, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  export class Country extends CardDef {
    static displayName = 'Country';
    @field name = contains(StringField);
  }`;

let matrixRoomId: string;
let mockedFileContent = 'Hello, world!';
const TEST_MODEL_NAMES: Record<string, string> = {
  'openai/gpt-5': 'OpenAI: GPT-5',
  'openai/gpt-4o-mini': 'OpenAI: GPT-4o-mini',
  'anthropic/claude-sonnet-4.5': 'Anthropic: Claude Sonnet 4.5',
  'anthropic/claude-3.7-sonnet': 'Anthropic: Claude 3.7 Sonnet',
  'deepseek/deepseek-chat-v3-0324': 'DeepSeek: DeepSeek V3 0324',
  'google/gemini-2.5-flash': 'Google: Gemini 2.5 Flash',
};

function modelNameFor(llmId: string): string {
  return TEST_MODEL_NAMES[llmId] ?? llmId;
}

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
      'test-auth-realm-server-session-room',
    ],
  });

  let { createAndJoinRoom, getRoomIds, getRoomState, simulateRemoteMessage } =
    mockMatrixUtils;

  // Setup realm server endpoints for summarization tests
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        // Handle summarization requests
        if (body.url.includes('openrouter.ai/api/v1/chat/completions')) {
          const requestBody = JSON.parse(body.requestBody);

          // Check if this is a summarization request
          if (
            requestBody.messages &&
            requestBody.messages.some(
              (msg: any) =>
                msg.content &&
                msg.content.includes('Please provide a concise summary'),
            )
          ) {
            // Return a mock summary based on the conversation content
            const conversationText = requestBody.messages
              .filter(
                (msg: any) =>
                  msg.role === 'user' &&
                  !msg.content.includes('Please provide a concise summary'),
              )
              .map((msg: any) => msg.content)
              .join(' ');

            let summary = 'This conversation focused on general discussion.';

            if (conversationText.includes('project')) {
              summary =
                'This conversation focused on project help, specifically creating a new card for a person with name and age fields. The user requested assistance with card creation and field definition.';
            } else if (
              conversationText.includes('card') &&
              conversationText.includes('file')
            ) {
              summary =
                'This conversation involved discussing a person card (Hassan) and a pet definition file. The user shared both a Person card and a pet.gts file, then asked for help understanding the structure.';
            } else if (conversationText.includes('error')) {
              throw new Error('OpenRouter API error');
            }

            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: summary,
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
        }

        // Default response for other requests
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 123, name: 'test' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field favoriteTreat = contains(StringField);

      @field cardTitle = contains(StringField, {
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
            <h2><@fields.cardTitle /></h2>
            <div>
              <div>Favorite Treat: <@fields.favoriteTreat /></div>
              <div data-test-editable-meta>
                {{#if @canEdit}}
                  <@fields.cardTitle />
                  is editable.
                {{else}}
                  <@fields.cardTitle />
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
      @field cardTitle = contains(StringField, {
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

    // Create model configurations for testing
    let openAiGpt5Model = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('openai/gpt-5'),
      }),
      modelId: 'openai/gpt-5',
      toolsSupported: true,
      reasoningEffort: 'minimal',
    });

    let openAiGpt4oMiniModel = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('openai/gpt-4o-mini'),
      }),
      modelId: 'openai/gpt-4o-mini',
      toolsSupported: true,
    });

    let anthropicClaudeSonnet45Model = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('anthropic/claude-sonnet-4.5'),
      }),
      modelId: 'anthropic/claude-sonnet-4.5',
      toolsSupported: true,
    });

    let anthropicClaudeSonnet37Model = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('anthropic/claude-3.7-sonnet'),
      }),
      modelId: 'anthropic/claude-3.7-sonnet',
      toolsSupported: true,
    });

    // Create system card with model configurations
    let defaultSystemCard = new SystemCard({
      defaultModelConfiguration: anthropicClaudeSonnet45Model,
      modelConfigurations: [
        openAiGpt5Model,
        openAiGpt4oMiniModel,
        anthropicClaudeSonnet45Model,
        anthropicClaudeSonnet37Model,
      ],
    });

    let deepseekModel = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('deepseek/deepseek-chat-v3-0324'),
      }),
      modelId: 'deepseek/deepseek-chat-v3-0324',
      toolsSupported: true,
    });

    let geminiFlashModel = new ModelConfiguration({
      cardInfo: new CardInfoField({
        name: modelNameFor('google/gemini-2.5-flash'),
      }),
      modelId: 'google/gemini-2.5-flash',
      toolsSupported: true,
    });

    let alternateSystemCard = new SystemCard({
      defaultModelConfiguration: deepseekModel,
      modelConfigurations: [deepseekModel, geminiFlashModel, openAiGpt5Model],
    });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
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
        'Spec/plant-spec.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'Plant',
                module: `${testRealmURL}plant`,
              },
              specType: 'card',
              title: 'Plant spec',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Skill/example.json': {
          data: {
            attributes: {
              title: 'Exanple Skill',
              cardDescription: 'This skill card is for testing purposes',
              instructions: 'This is an example skill card',
              commands: [],
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
        'Skill/example2.json': {
          data: {
            attributes: {
              title: 'Example 2 Skill',
              cardDescription: 'This skill card is also for testing purposes',
              instructions: 'This is a second example skill card',
              commands: [],
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
        'ModelConfiguration/gpt-4o-mini.json': openAiGpt4oMiniModel,
        'ModelConfiguration/gpt-5.json': openAiGpt5Model,
        'ModelConfiguration/claude-sonnet-4.5.json':
          anthropicClaudeSonnet45Model,
        'ModelConfiguration/claude-sonnet-3.7.json':
          anthropicClaudeSonnet37Model,
        'SystemCard/default.json': defaultSystemCard,
        'ModelConfiguration/deepseek-chat-v3-0324.json': deepseekModel,
        'ModelConfiguration/gemini-2.5-flash.json': geminiFlashModel,
        'SystemCard/productivity.json': alternateSystemCard,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });

    getService('matrix-service').fetchMatrixHostedFile = async (_url) => {
      return new Response(mockedFileContent);
    };
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
        cards: [{ id: testCard, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, cardTitle: 'Hassan' }],
      },
    ]);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    //Test the scenario where there is an update to the card
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card="${testCard}"]`);

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
        cards: [{ id: testCard, cardTitle: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 2',
        cards: [{ id: testCard, cardTitle: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message - 3',
        cards: [{ id: testCard, cardTitle: 'Updated Name Abdel-Rahman' }],
      },
      {
        from: 'testuser',
        message: 'Message with updated card',
        cards: [{ id: testCard, cardTitle: 'Updated Name Abdel-Rahman' }],
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
        cards: [{ id: testCard, cardTitle: 'Hassan' }],
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

    // Check that the computed cardTitle is present in the downloaded content
    assert.strictEqual(
      cardContent.data.attributes!.cardTitle,
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

    // Default model should come from the system card's default configuration
    let defaultModelId = 'anthropic/claude-sonnet-4.5';
    let defaultModelName = modelNameFor(defaultModelId);

    assert.dom('[data-test-llm-select-selected]').hasText(defaultModelName);
    await click('[data-test-llm-select-selected]');

    // Should have 4 models from our system card
    assert.dom('[data-test-llm-select-item]').exists({
      count: 4,
    });

    let llmIdToChangeTo = 'anthropic/claude-3.7-sonnet';
    let llmNameToChangeTo = modelNameFor('anthropic/claude-3.7-sonnet');

    assert
      .dom(`[data-test-llm-select-item="${llmIdToChangeTo}"]`)
      .hasText(llmNameToChangeTo);
    await click(`[data-test-llm-select-item="${llmIdToChangeTo}"] button`);
    await click('[data-test-llm-select-selected]');
    assert.dom('[data-test-llm-select-selected]').hasText(llmNameToChangeTo);

    let roomState = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.strictEqual(roomState.model, llmIdToChangeTo);
  });

  test('active LLM event includes metadata when switching models', async function (assert) {
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
    await waitFor('[data-room-settled]');

    await click('[data-test-llm-select-selected]');
    await click(`[data-test-llm-select-item="openai/gpt-4o-mini"] button`);
    await click('[data-test-llm-select-selected]');

    await waitUntil(() => {
      let state = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
      return state.model === 'openai/gpt-4o-mini';
    });

    let firstState = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.strictEqual(
      firstState.model,
      'openai/gpt-4o-mini',
      'Switching to GPT-4o mini updates active LLM',
    );
    assert.true(
      firstState.toolsSupported,
      'Active LLM event records tool support for GPT-4o mini',
    );
    assert.strictEqual(
      firstState.reasoningEffort,
      null,
      'Reasoning effort is omitted when not configured',
    );

    await click('[data-test-llm-select-selected]');
    await click(`[data-test-llm-select-item="openai/gpt-5"] button`);
    await click('[data-test-llm-select-selected]');

    await waitUntil(() => {
      let state = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
      return state.model === 'openai/gpt-5';
    });

    let secondState = getRoomState(matrixRoomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.strictEqual(
      secondState.model,
      'openai/gpt-5',
      'Switching back to GPT-5 updates active LLM',
    );
    assert.true(
      secondState.toolsSupported,
      'Active LLM event records tool support for GPT-5',
    );
    assert.strictEqual(
      secondState.reasoningEffort,
      'minimal',
      'Active LLM event records configured reasoning effort for GPT-5',
    );
  });

  test('defaults to the system card default regardless of submode', async function (assert) {
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
    let matrixService = getService('matrix-service');
    let defaultSystemModelId =
      matrixService.systemCard?.defaultModelConfiguration?.modelId ??
      matrixService.systemCard?.modelConfigurations?.[0]?.modelId;

    assert.ok(defaultSystemModelId, 'system card provides a default model');
    let expectedName = modelNameFor(defaultSystemModelId!);

    assert.dom('[data-test-llm-select-selected]').hasText(expectedName);

    // Switching submodes should not change the active LLM
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Code"]');
    assert.dom('[data-test-llm-select-selected]').hasText(expectedName);

    await click('[data-test-close-ai-assistant]');
  });

  test('selecting a new system card via menu updates available models', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}SystemCard/productivity`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await click('[data-test-llm-select-selected]');
    assert
      .dom('[data-test-llm-select-item="deepseek/deepseek-chat-v3-0324"]')
      .doesNotExist();
    await click('[data-test-llm-select-selected]');
    await click('[data-test-close-ai-assistant]');

    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Set as my system card"]');

    let matrixService = getService('matrix-service');
    await waitUntil(
      () =>
        matrixService.systemCard?.modelConfigurations?.[0]?.modelId ===
        'deepseek/deepseek-chat-v3-0324',
    );

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom('[data-test-llm-select-selected]')
      .hasText(modelNameFor('deepseek/deepseek-chat-v3-0324'));
    await click('[data-test-llm-select-selected]');
    assert
      .dom('[data-test-llm-select-item="deepseek/deepseek-chat-v3-0324"]')
      .exists();
    assert
      .dom('[data-test-llm-select-item="deepseek/deepseek-chat-v3-0324"]')
      .hasText(modelNameFor('deepseek/deepseek-chat-v3-0324'));
    assert
      .dom('[data-test-llm-select-item="google/gemini-2.5-flash"]')
      .exists();
    await click('[data-test-pill-menu-button]');
    await click('[data-test-close-ai-assistant]');
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

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      '[data-test-cards-grid-item="http://test-realm/test/Person/fadhlan"] .field-component-card',
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

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      '[data-test-cards-grid-item="http://test-realm/test/Person/fadhlan"] .field-component-card',
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await waitUntil(
      () =>
        document.querySelector('[data-test-autoattached-card]') ||
        document.querySelector('[data-test-autoattached-file]'),
    );
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click('[data-test-create-new-card-button]');
    await click(`[data-test-select="https://cardstack.com/base/types/card"]`);

    await click(`[data-test-card-catalog-go-button]`);

    await waitUntil(() => id);
    id = id!;

    await fillIn('[data-test-field="cardInfo-name"] input', 'new card');
    assert.dom(`[data-test-attached-card]`).containsText('new card');

    await fillIn('[data-test-message-field]', `Message with updated card`);
    await click('[data-test-send-message-btn]');

    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message with updated card',
        cards: [{ id, cardTitle: 'new card' }],
      },
    ]);
  });

  test('can open attached card dropdown menu', async function (assert) {
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

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      '[data-test-cards-grid-item="http://test-realm/test/Person/fadhlan"] .field-component-card',
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    await waitUntil(
      () =>
        document.querySelector('[data-test-autoattached-card]') ||
        document.querySelector('[data-test-autoattached-file]'),
    );

    await fillIn('[data-test-message-field]', `Message with updated card`);
    await click('[data-test-send-message-btn]');

    mockedFileContent = 'test card content';

    // This is to make sure opening code mode works even if the workspace chooser is open
    await click('[data-test-workspace-chooser-toggle]');

    await click('[data-test-attached-file-dropdown-button="Fadhlan"]');

    assert.dom('[data-test-boxel-menu-item-text="Open in Code Mode"]').exists();
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Submitted Content"]')
      .exists();
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Submitted Content"]')
      .exists();

    await waitFor('[data-test-copy-file-content="test card content"]');
    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');

    await waitUntil(
      () =>
        getMonacoContent().startsWith(
          '{"data":{"type":"card","id":"http://test-realm/test/Person/fadhlan"',
        ),
      {
        timeout: 5000,
      },
    );
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
    await (getService('monaco-service') as MonacoService).getMonacoContext();

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
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      aiAssistantOpen: true,
    });
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
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

  test(`should not display action bar when there is no code patch block`, async function (assert) {
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
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    let codeBlock = `\`\`\`
  { "name": "test" }
\`\`\``;

    simulateRemoteMessage(matrixRoomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-ai-assistant-message]');
    assert.dom('[data-test-ai-assistant-action-bar]').doesNotExist();
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
    assert.dom('[data-test-focus-pill-main]').containsText('Card');
    assert
      .dom('[data-test-focus-pill-meta]')
      .exists({ count: 1 }, 'FocusPill shows one meta pill');
    let metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
    assert
      .dom(metaEls[0] as Element)
      .hasText('Isolated', 'FocusPill shows item type "Format"');

    await click('[data-test-format-chooser="embedded"]');
    assert
      .dom('[data-test-focus-pill-meta]')
      .exists({ count: 1 }, 'FocusPill shows one meta pill');
    metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
    assert
      .dom(metaEls[0] as Element)
      .hasText('Embedded', 'FocusPill shows item type "Format"');

    await fillIn('[data-test-message-field]', `Message - 1`);
    await click('[data-test-send-message-btn]');

    let roomEvents = mockMatrixUtils.getRoomEvents(matrixRoomId);
    let lastMessageEvent = roomEvents[roomEvents.length - 1];
    let contextSent: BoxelContext = JSON.parse(
      lastMessageEvent.content.data,
    ).context;
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
      contextSent.codeMode!.currentFile,
      `${testRealmURL}Plant/highbush-blueberry.json`,
      'Context sent with message contains correct currentFile',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectionRange,
      {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      },
      'Context sent with message contains correct selectionRange',
    );
    assert.strictEqual(
      contextSent.codeMode!.moduleInspectorPanel,
      'preview',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.deepEqual(
      contextSent.codeMode!.previewPanelSelection,
      {
        cardId: `${testRealmURL}Plant/highbush-blueberry`,
        format: 'embedded',
      },
      'Context sent with message contains correct previewPanelSelection',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectedCodeRef,
      undefined,
      'Context sent with message contains correct selectedCodeRef',
    );
    assert.deepEqual(
      contextSent.codeMode!.inheritanceChain,
      undefined,
      'Context sent with message contains undefined inheritanceChain when no selectedCodeRef',
    );
    assert.strictEqual(
      contextSent.codeMode!.activeSpecId,
      undefined,
      'Context sent with message contains undefined activeSpecId when spec panel is not active',
    );
    assert.deepEqual(
      contextSent.realmPermissions,
      {
        canRead: true,
        canWrite: true,
      },
      'Context sent with message contains correct realmPermissions',
    );
    await click('[data-test-clickable-definition-container]');

    // After selecting a definition, FocusPill should appear with label and meta
    await waitFor('[data-test-focus-pill-main]');
    assert
      .dom('[data-test-focus-pill-main]')
      .containsText('Plant', 'FocusPill shows selected code label');
    assert
      .dom('[data-test-focus-pill-meta]')
      .exists({ count: 1 }, 'FocusPill shows one meta pill');
    metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
    assert
      .dom(metaEls[0] as Element)
      .hasText('Schema', 'FocusPill shows item type "Schema"');

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
      contextSent.codeMode!.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectionRange,
      {
        startLine: 3,
        startColumn: 45,
        endLine: 3,
        endColumn: 45,
      },
      'Context sent with message contains correct selectionRange',
    );
    assert.strictEqual(
      contextSent.codeMode!.moduleInspectorPanel,
      'schema',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.strictEqual(
      contextSent.codeMode!.previewPanelSelection,
      undefined,
      'Context sent with message contains correct previewPanelSelection',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectedCodeRef,
      {
        module: 'http://test-realm/test/plant',
        name: 'Plant',
      },
      'Context sent with message contains correct selectedCodeRef',
    );
    assert.ok(
      contextSent.codeMode!.inheritanceChain,
      'Context sent with message contains inheritanceChain',
    );
    // The first item should be the Plant card itself
    assert.deepEqual(
      contextSent.codeMode!.inheritanceChain![0].codeRef,
      {
        module: 'http://test-realm/test/plant',
        name: 'Plant',
      },
      'First item in inheritanceChain is the Plant card',
    );
    // Verify that the Plant card has its own fields
    assert.ok(
      Array.isArray(contextSent.codeMode!.inheritanceChain![0].fields),
      'Plant card has fields array',
    );
    assert.ok(
      contextSent.codeMode!.inheritanceChain![0].fields.includes('commonName'),
      'Plant card includes commonName field',
    );
    // The last item should be CardDef from the base realm
    let lastInheritanceItem =
      contextSent.codeMode!.inheritanceChain![
        contextSent.codeMode!.inheritanceChain!.length - 1
      ];
    assert.strictEqual(
      (lastInheritanceItem.codeRef as ResolvedCodeRef).name,
      'CardDef',
      'Last item in inheritanceChain is CardDef',
    );
    // Verify that each item in the inheritance chain has fields
    contextSent.codeMode!.inheritanceChain!.forEach((item, index) => {
      assert.ok(
        Array.isArray(item.fields),
        `Inheritance chain item ${index} has fields array`,
      );
      assert.ok(
        'codeRef' in item,
        `Inheritance chain item ${index} has codeRef property`,
      );
    });
    assert.ok(
      (lastInheritanceItem.codeRef as ResolvedCodeRef).module.includes(
        'card-api',
      ),
      'Last item in inheritanceChain comes from card-api module',
    );
    assert.deepEqual(
      contextSent.realmPermissions,
      {
        canRead: true,
        canWrite: true,
      },
      'Context sent with message contains correct realmPermissions',
    );

    await click(
      '[data-test-boxel-button][data-test-module-inspector-view="preview"]',
    );
    // Select some text in the monaco editor for testing selectionRange
    let monacoService = getService('monaco-service');
    let editor = monacoService.editor;
    if (editor?.setSelection) {
      editor.setSelection({
        startLineNumber: 3,
        startColumn: 45,
        endLineNumber: 6,
        endColumn: 1,
      });
    }

    // FocusPill should reflect Preview item type, format, and multi-line selection range
    await waitFor('[data-test-focus-pill-main]');
    await delay(20); // editor selection updates are debounced
    assert
      .dom('[data-test-focus-pill-main]')
      .containsText('Plant', 'FocusPill still shows selected code label');
    assert
      .dom('[data-test-focus-pill-meta]')
      .exists({ count: 3 }, 'FocusPill shows three meta pills');
    metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
    assert
      .dom(metaEls[0] as Element)
      .hasText('Preview', 'FocusPill shows item type "Preview"');
    assert
      .dom(metaEls[1] as Element)
      .hasText('Isolated', 'FocusPill shows format "Isolated"');
    assert
      .dom(metaEls[2] as Element)
      .hasText(
        'Lines 3-6',
        'FocusPill shows multi-line selection range "Lines 3-6"',
      );

    await click('[data-test-format-chooser="fitted"]');
    metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
    assert
      .dom(metaEls[1] as Element)
      .hasText('Fitted', 'FocusPill shows format "Fitted"');

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
      contextSent.codeMode!.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectionRange,
      {
        startLine: 3,
        startColumn: 45,
        endLine: 6,
        endColumn: 1,
      },
      'Context sent with message contains correct selectionRange',
    );
    assert.strictEqual(
      contextSent.codeMode!.moduleInspectorPanel,
      'preview',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.deepEqual(
      contextSent.codeMode!.previewPanelSelection,
      {
        cardId: `${testRealmURL}Plant/highbush-blueberry`,
        format: 'fitted',
      },
      'Context sent with message contains correct previewPanelSelection',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectedCodeRef,
      {
        module: 'http://test-realm/test/plant',
        name: 'Plant',
      },
      'Context sent with message contains correct selectedCodeRef',
    );
    assert.strictEqual(
      contextSent.codeMode!.activeSpecId,
      undefined,
      'Context sent with message contains undefined activeSpecId when spec panel is not active',
    );
    assert.deepEqual(
      contextSent.realmPermissions,
      {
        canRead: true,
        canWrite: true,
      },
      'Context sent with message contains correct realmPermissions',
    );

    await click(
      '[data-test-boxel-button][data-test-module-inspector-view="spec"]',
    );

    // FocusPill should reflect Spec item type (selection range unchanged)
    await waitFor('[data-test-focus-pill-main]');
    {
      const metaEls = document.querySelectorAll('[data-test-focus-pill-meta]');
      assert
        .dom(metaEls[0] as Element)
        .hasText('Spec', 'FocusPill shows item type "Spec"');
    }
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
      ['http://test-realm/test/Spec/plant-spec'],
      'Context sent with message contains correct openCardIds',
    );
    assert.strictEqual(
      contextSent.codeMode!.currentFile,
      `${testRealmURL}plant.gts`,
      'Context sent with message contains correct currentFile',
    );
    assert.strictEqual(
      contextSent.codeMode!.moduleInspectorPanel,
      'spec',
      'Context sent with message contains correct moduleInspectorPanel',
    );
    assert.strictEqual(
      contextSent.codeMode!.previewPanelSelection,
      undefined,
      'Context sent with message contains correct previewPanelSelection',
    );
    assert.deepEqual(
      contextSent.codeMode!.selectedCodeRef,
      {
        module: 'http://test-realm/test/plant',
        name: 'Plant',
      },
      'Context sent with message contains correct selectedCodeRef',
    );
    assert.ok(
      contextSent.codeMode!.activeSpecId,
      'Context sent with message contains activeSpecId when spec panel is active',
    );
    assert.true(
      contextSent.codeMode!.activeSpecId!.startsWith(testRealmURL),
      'activeSpecId should start with test realm URL',
    );
    assert.deepEqual(
      contextSent.realmPermissions,
      {
        canRead: true,
        canWrite: true,
      },
      'Context sent with message contains correct realmPermissions',
    );
  });

  test('dashboard context sent with message', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      workspaceChooserOpened: true,
      stacks: [[]],
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
      undefined,
      'Context sent with message does not contain realmUrl',
    );
    assert.strictEqual(
      contextSent.submode,
      'workspace-chooser',
      'Context sent with message contains correct submode',
    );
    assert.deepEqual(
      contextSent.workspaces,
      [
        {
          name: 'Test Workspace B',
          type: 'user-workspace',
          url: testRealmURL,
        },
        {
          name: 'Cardstack Catalog',
          type: 'catalog-workspace',
          url: catalogRealm.url,
        },
        {
          name: 'Boxel Skills',
          type: 'catalog-workspace',
          url: skillsRealm.url,
        },
      ],
      'Context sent with message contains correct workspaces',
    );
  });

  test('clicking auto-attached card makes it a chosen card', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}Person/fadhlan`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);

    // Verify auto-attached card exists
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .exists();

    // Click on the auto-attached card (not the remove button) to make it a chosen card
    await click(
      `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
    );

    // Verify the card is now a regular attached card (not auto-attached)
    assert.dom('[data-test-autoattached-card]').doesNotExist();
    assert
      .dom(`[data-test-attached-card="${testRealmURL}Person/fadhlan"]`)
      .exists();
    assert
      .dom(
        `[data-test-attached-card="${testRealmURL}Person/fadhlan"][data-test-autoattached-card]`,
      )
      .doesNotExist();

    // Verify the remove button still works
    await click(
      `[data-test-attached-card="${testRealmURL}Person/fadhlan"] [data-test-remove-card-btn]`,
    );
    assert
      .dom(`[data-test-attached-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist();
  });

  test('clicking auto-attached file makes it a chosen file', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Verify auto-attached file exists
    assert.dom('[data-test-autoattached-file]').exists({ count: 1 });
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}plant.gts"][data-test-autoattached-file]`,
      )
      .exists();

    // Click on the auto-attached file (not the remove button) to make it a chosen file
    await click(
      `[data-test-attached-file="${testRealmURL}plant.gts"][data-test-autoattached-file]`,
    );

    // Verify the file is now a regular attached file (not auto-attached)
    assert.dom('[data-test-autoattached-file]').doesNotExist();
    assert.dom(`[data-test-attached-file="${testRealmURL}plant.gts"]`).exists();
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}plant.gts"][data-test-autoattached-file]`,
      )
      .doesNotExist();

    // Verify the remove button still works
    await click(
      `[data-test-attached-file="${testRealmURL}plant.gts"] [data-test-remove-file-btn]`,
    );
    assert
      .dom(`[data-test-attached-file="${testRealmURL}plant.gts"]`)
      .doesNotExist();
    // Navigate to spec panel - this should auto-select the plant spec
    await click('[data-test-module-inspector-view="spec"]');

    // Wait for the spec to be loaded and auto-selected
    await waitFor('[data-test-spec-selector-item-path]');

    // Verify spec card is auto-attached
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });

    // Verify the auto-attached card is a spec card
    let autoAttachedCards = document.querySelectorAll(
      '[data-test-autoattached-card]',
    );
    let hasAutoAttachedSpec = Array.from(autoAttachedCards).some((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/plant-spec');
    });
    assert.ok(
      hasAutoAttachedSpec,
      'Auto-attached card should be the plant spec card',
    );
  });

  test('auto-attaches spec card when spec panel is open and spec is selected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Navigate to spec panel - this should auto-select the plant spec
    await click('[data-test-module-inspector-view="spec"]');

    // Wait for the spec to be loaded and auto-selected
    await waitFor('[data-test-spec-selector-item-path]');

    // Verify spec card is auto-attached
    assert.dom('[data-test-autoattached-card]').exists({ count: 1 });

    // Verify the auto-attached card is a spec card
    let autoAttachedCards = document.querySelectorAll(
      '[data-test-autoattached-card]',
    );
    let hasAutoAttachedSpec = Array.from(autoAttachedCards).some((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/plant-spec');
    });
    assert.ok(
      hasAutoAttachedSpec,
      'Auto-attached card should be the plant spec card',
    );
  });

  test('does not auto-attach spec card when spec panel is closed', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Navigate to spec panel briefly to load and auto-select spec, then switch away
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    // Switch to schema panel (not spec)
    await click('[data-test-module-inspector-view="schema"]');

    // Verify no spec card is auto-attached
    let autoAttachedCards = document.querySelectorAll(
      '[data-test-autoattached-card]',
    );
    let hasAutoAttachedSpec = Array.from(autoAttachedCards).some((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });
    assert.false(
      hasAutoAttachedSpec,
      'No spec card should be auto-attached when spec panel is closed',
    );
  });

  test('does not auto-attach spec card when no spec is selected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}country.gts`,
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

    // Navigate to spec panel without creating a spec
    await click('[data-test-module-inspector-view="spec"]');

    // If no specs exist yet, there should be no auto-attached spec cards
    assert.dom('[data-test-spec-selector-item-path]').doesNotExist();
    let autoAttachedCards = document.querySelectorAll(
      '[data-test-autoattached-card]',
    );
    let hasAutoAttachedSpec = Array.from(autoAttachedCards).some((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });
    assert.false(
      hasAutoAttachedSpec,
      'No spec card should be auto-attached when no spec is selected',
    );
  });

  test('manually attached spec cards do not duplicate auto-attached ones', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Navigate to spec panel - this should auto-select the plant spec
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    // Wait for auto-attachment to occur
    await waitUntil(() => {
      let autoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      return Array.from(autoAttachedCards).some((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/plant-spec');
      });
    });

    // Count auto-attached cards before manual attachment
    let autoAttachedCardsBefore = document.querySelectorAll(
      '[data-test-autoattached-card]',
    );
    let autoAttachedSpecId = Array.from(autoAttachedCardsBefore)
      .find((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/');
      })
      ?.getAttribute('data-test-attached-card');

    if (autoAttachedSpecId) {
      // Manually attach the same spec card
      await click('[data-test-attach-button]');
      await click('[data-test-attach-card-btn]');
      await fillIn('[data-test-search-field]', 'Plant spec');
      await click(`[data-test-select="${autoAttachedSpecId}"]`);
      await click('[data-test-card-catalog-go-button]');

      // Verify the spec card appears only once (not duplicated)
      let specCards = document.querySelectorAll(
        `[data-test-attached-card="${autoAttachedSpecId}"]`,
      );
      assert.strictEqual(
        specCards.length,
        1,
        'Spec card should only appear once, not duplicated',
      );

      // Verify it's no longer marked as auto-attached
      let remainingAutoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      let hasAutoAttachedSpec = Array.from(remainingAutoAttachedCards).some(
        (card) => {
          let cardId = card.getAttribute('data-test-attached-card');
          return cardId === autoAttachedSpecId;
        },
      );
      assert.false(
        hasAutoAttachedSpec,
        'Manually attached spec should no longer be auto-attached',
      );
    } else {
      // If no spec was auto-attached, that's a test failure but we should at least assert it
      assert.ok(
        false,
        'Expected a spec card to be auto-attached, but none was found',
      );
    }
  });

  test('manually attached cards and files persist through reload without duplicating auto attachments', async function (assert) {
    window.localStorage.removeItem(AiAssistantMessageDrafts);

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      aiAssistantOpen: true,
    });

    await waitFor(`[data-room-settled]`);
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    let autoAttachedSpecId: string | undefined;
    await waitUntil(() => {
      let autoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      let specCard = Array.from(autoAttachedCards).find((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/');
      });
      if (specCard) {
        autoAttachedSpecId = specCard.getAttribute(
          'data-test-attached-card',
        ) as string;
        return true;
      }
      return false;
    });

    assert.ok(autoAttachedSpecId, 'expected a spec card to be auto-attached');

    await click('[data-test-attach-button]');
    await click('[data-test-attach-card-btn]');
    await fillIn('[data-test-search-field]', 'Plant spec');
    await click(`[data-test-select="${autoAttachedSpecId}"]`);
    await click('[data-test-card-catalog-go-button]');

    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click('[data-test-file="plant.gts"]');
    await click('[data-test-choose-file-modal-add-button]');

    await fillIn('[data-test-message-field]', 'Reload keeps my draft');

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
      aiAssistantOpen: true,
    });

    await waitFor(`[data-test-room-settled]`);
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    assert.dom('[data-test-message-field]').hasValue('Reload keeps my draft');
    assert
      .dom(`[data-test-attached-card="${autoAttachedSpecId}"]`)
      .exists({ count: 1 });
    assert
      .dom(
        `[data-test-autoattached-card][data-test-attached-card="${autoAttachedSpecId}"]`,
      )
      .doesNotExist();
    assert
      .dom(`[data-test-attached-file="${testRealmURL}plant.gts"]`)
      .exists({ count: 1 });
    assert.dom('[data-test-autoattached-file]').doesNotExist();
  });

  test('auto-attached spec card can be removed', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Navigate to spec panel - this should auto-select the plant spec
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    // Wait for auto-attachment to occur
    await waitUntil(() => {
      let autoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      return Array.from(autoAttachedCards).some((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/plant-spec');
      });
    });

    // Find the auto-attached spec card
    let autoAttachedSpecCard = Array.from(
      document.querySelectorAll('[data-test-autoattached-card]'),
    ).find((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });

    if (autoAttachedSpecCard) {
      let specCardId = autoAttachedSpecCard.getAttribute(
        'data-test-attached-card',
      );

      // Remove the auto-attached spec card
      await click(
        autoAttachedSpecCard.querySelector('[data-test-remove-card-btn]')!,
      );

      // Verify the spec card is removed
      assert.dom(`[data-test-attached-card="${specCardId}"]`).doesNotExist();
    } else {
      // If no spec was auto-attached, that's a test failure but we should at least assert it
      assert.ok(
        false,
        'Expected a spec card to be auto-attached, but none was found',
      );
    }
  });

  test('spec card re-auto-attaches when switching back to spec panel', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}plant.gts`,
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

    // Navigate to spec panel - this should auto-select the plant spec
    await click('[data-test-module-inspector-view="spec"]');
    await waitFor('[data-test-spec-selector-item-path]');

    // Wait for auto-attachment to occur
    await waitUntil(() => {
      let autoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      return Array.from(autoAttachedCards).some((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/plant-spec');
      });
    });

    // Verify spec card is auto-attached
    let autoAttachedSpecCards = Array.from(
      document.querySelectorAll('[data-test-autoattached-card]'),
    ).filter((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });
    assert.ok(
      autoAttachedSpecCards.length > 0,
      'Spec card should be auto-attached when spec panel is open',
    );

    // Switch to schema panel
    await click('[data-test-module-inspector-view="schema"]');

    // Verify spec card is no longer auto-attached
    let autoAttachedSpecCardsAfterSwitch = Array.from(
      document.querySelectorAll('[data-test-autoattached-card]'),
    ).filter((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });
    assert.strictEqual(
      autoAttachedSpecCardsAfterSwitch.length,
      0,
      'Spec card should not be auto-attached when spec panel is closed',
    );

    // Switch back to spec panel
    await click('[data-test-module-inspector-view="spec"]');

    // Wait for auto-attachment to occur again
    await waitUntil(() => {
      let autoAttachedCards = document.querySelectorAll(
        '[data-test-autoattached-card]',
      );
      return Array.from(autoAttachedCards).some((card) => {
        let cardId = card.getAttribute('data-test-attached-card');
        return cardId?.includes('Spec/plant-spec');
      });
    });

    // Verify spec card is auto-attached again
    let autoAttachedSpecCardsAfterReturn = Array.from(
      document.querySelectorAll('[data-test-autoattached-card]'),
    ).filter((card) => {
      let cardId = card.getAttribute('data-test-attached-card');
      return cardId?.includes('Spec/');
    });
    assert.ok(
      autoAttachedSpecCardsAfterReturn.length > 0,
      'Spec card should be auto-attached again when returning to spec panel',
    );
  });

  test('"Add Same Skills" copies skill configuration to new session', async function (assert) {
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

    // First, let's add some skills to the current room
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click(`[data-test-card-catalog-item="${testRealmURL}Skill/example"]`);
    await click('[data-test-card-catalog-go-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    await click(
      `[data-test-card-catalog-item="${testRealmURL}Skill/example2"]`,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(
      () =>
        document.querySelectorAll(
          '[data-test-skill-menu] [data-test-attached-card]',
        )?.length === 2,
    );
    assert
      .dom(
        `[data-test-skill-menu] [data-test-attached-card="${testRealmURL}Skill/example"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-skill-menu] [data-test-attached-card="${testRealmURL}Skill/example2"]`,
      )
      .exists();
    assert
      .dom(`[data-test-skill-toggle="${testRealmURL}Skill/example-on"`)
      .exists();
    assert
      .dom(`[data-test-skill-toggle="${testRealmURL}Skill/example2-on"`)
      .exists();
    await click(`[data-test-skill-toggle="${testRealmURL}Skill/example2-on"`);
    await waitFor(
      `[data-test-skill-toggle="${testRealmURL}Skill/example2-off"`,
    );
    assert
      .dom(`[data-test-skill-toggle="${testRealmURL}Skill/example2-off"`)
      .exists();

    // Enabling create new session by sending a message
    await fillIn(
      '[data-test-message-field]',
      'Enabling create new session button',
    );
    await click('[data-test-send-message-btn]');

    let roomsBeforeSameSkills = getRoomIds();
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click('[data-test-new-session-settings-option="Add Same Skills"]');
    await click('[data-test-new-session-settings-create-button]');
    await waitFor('[data-room-settled]');

    let roomsAfterSameSkills = getRoomIds();
    let duplicatedSkillsRoomId = roomsAfterSameSkills.find(
      (roomId) => !roomsBeforeSameSkills.includes(roomId),
    );
    assert.ok(
      duplicatedSkillsRoomId,
      'Creating a new session with copied skills creates a new room',
    );
    if (duplicatedSkillsRoomId) {
      let activeLLMState = getRoomState(
        duplicatedSkillsRoomId,
        APP_BOXEL_ACTIVE_LLM,
        '',
      );
      assert.strictEqual(
        typeof activeLLMState.toolsSupported,
        'boolean',
        'New room active LLM event includes toolsSupported metadata',
      );
      assert.true(
        Object.prototype.hasOwnProperty.call(activeLLMState, 'reasoningEffort'),
        'New room active LLM event includes reasoningEffort metadata',
      );
    }

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu]');
    await waitUntil(
      () =>
        document.querySelectorAll(
          '[data-test-skill-menu] [data-test-attached-card]',
        )?.length === 2,
    );
    assert
      .dom(
        `[data-test-skill-menu] [data-test-attached-card="${testRealmURL}Skill/example"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-skill-menu] [data-test-attached-card="${testRealmURL}Skill/example2"]`,
      )
      .exists();
    assert
      .dom(`[data-test-skill-toggle="${testRealmURL}Skill/example-on"`)
      .exists();
    assert
      .dom(`[data-test-skill-toggle="${testRealmURL}Skill/example2-off"`)
      .exists();

    // Normal click scenario
    // Enabling create new session by sending a message
    await fillIn(
      '[data-test-message-field]',
      'Enabling create new session button',
    );
    await click('[data-test-send-message-btn]');
    let roomsBeforeNewSession = getRoomIds();
    await waitFor('[data-test-create-room-btn]:not([disabled])');
    await click('[data-test-create-room-btn]');
    await waitFor('[data-room-settled]');

    let roomsAfterNewSession = getRoomIds();
    let newlyCreatedRoomId = roomsAfterNewSession.find(
      (roomId) => !roomsBeforeNewSession.includes(roomId),
    );
    assert.ok(newlyCreatedRoomId, 'Creating a new session creates a new room');
    if (newlyCreatedRoomId) {
      let activeLLMState = getRoomState(
        newlyCreatedRoomId,
        APP_BOXEL_ACTIVE_LLM,
        '',
      );
      assert.strictEqual(
        typeof activeLLMState.toolsSupported,
        'boolean',
        'Newly created room includes toolsSupported metadata',
      );
      assert.true(
        Object.prototype.hasOwnProperty.call(activeLLMState, 'reasoningEffort'),
        'Newly created room includes reasoningEffort metadata',
      );
    }

    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await waitFor('[data-test-skill-menu]');
    assert
      .dom('[data-test-skill-menu] [data-test-attached-card]')
      .exists({ count: 1 });
    assert
      .dom(`[data-test-skill-menu] [data-test-attached-card="${envSkillId}"]`)
      .exists();
  });

  test('new session inherits llm mode from current room', async function (assert) {
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
    await waitFor('[data-room-settled]');

    await click('[data-test-llm-mode-option="act"]');
    assert
      .dom('[data-test-llm-mode-option="act"]')
      .hasClass('selected', 'LLM mode is set to act');

    await fillIn(
      '[data-test-message-field]',
      'Enable create new session button',
    );
    await click('[data-test-send-message-btn]');

    let roomsBeforeNewSession = getRoomIds();
    await waitFor('[data-test-create-room-btn]:not([disabled])');
    await click('[data-test-create-room-btn]');
    await waitFor('[data-room-settled]');

    let roomsAfterNewSession = getRoomIds();
    let newlyCreatedRoomId = roomsAfterNewSession.find(
      (roomId) => !roomsBeforeNewSession.includes(roomId),
    );
    assert.ok(newlyCreatedRoomId, 'Creating a new session creates a new room');
    if (newlyCreatedRoomId) {
      let llmModeState = getRoomState(
        newlyCreatedRoomId,
        APP_BOXEL_LLM_MODE,
        '',
      );
      assert.strictEqual(
        llmModeState?.mode,
        'act',
        'New session inherits LLM mode from current room',
      );
    }
  });

  test('copies file history when creating new session with option checked', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
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

    // Send first message with a card
    await fillIn('[data-test-message-field]', 'Message with card');
    await selectCardFromCatalog(`${testRealmURL}Person/hassan`);
    await click('[data-test-send-message-btn]');

    // Send second message with a file
    await fillIn('[data-test-message-field]', 'Message with file');
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click('[data-test-file="pet.gts"]');
    await click('[data-test-choose-file-modal-add-button]');
    await click('[data-test-send-message-btn]');

    // Send third message with another card
    await fillIn('[data-test-message-field]', 'Message with another card');
    await selectCardFromCatalog(`${testRealmURL}Pet/mango`);
    await click('[data-test-send-message-btn]');

    // Verify messages were sent with attachments
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Message with card',
        cards: [{ id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Message with file',
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
      {
        from: 'testuser',
        message: 'Message with another card',
        cards: [{ id: `${testRealmURL}Pet/mango`, cardTitle: 'Mango' }],
      },
    ]);
    // Create new session with "Copy File History" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click('[data-test-new-session-settings-option="Copy File History"]');
    await click('[data-test-new-session-settings-create-button]');
    await waitFor(`[data-room-settled]`);
    await waitForSessionPreparationToFinish();
    await waitUntil(() => {
      // Wait until the informational message for the cloned session appears.
      return document.querySelectorAll('[data-test-message-idx]').length === 1;
    });

    assertMessages(assert, [
      {
        from: 'testuser',
        message:
          'This session includes files and cards from the previous conversation for context.',
        cards: [
          { id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' },
          { id: `${testRealmURL}Pet/mango`, cardTitle: 'Mango' },
        ],
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
    ]);
  });

  test('summarizes current session when creating new session with option checked', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
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

    // Send several messages to create conversation history
    await fillIn(
      '[data-test-message-field]',
      'Hello, I need help with my project',
    );
    await click('[data-test-send-message-btn]');

    await fillIn(
      '[data-test-message-field]',
      'I want to create a new card for a person',
    );
    await click('[data-test-send-message-btn]');

    await fillIn(
      '[data-test-message-field]',
      'The person should have a name and age field',
    );
    await click('[data-test-send-message-btn]');

    // Verify messages were sent
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'Hello, I need help with my project',
      },
      {
        from: 'testuser',
        message: 'I want to create a new card for a person',
      },
      {
        from: 'testuser',
        message: 'The person should have a name and age field',
      },
    ]);

    // Create new session with "Summarize Current Session" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click(
      '[data-test-new-session-settings-option="Summarize Current Session"]',
    );
    await click('[data-test-new-session-settings-create-button]');
    await waitFor(`[data-room-settled]`);
    await waitForSessionPreparationToFinish();
    await waitUntil(
      () => document.querySelectorAll('[data-test-message-idx]').length >= 1,
      {
        timeout: 5000,
        timeoutMessage:
          'timed out waiting for summary message to arrive in new session',
      },
    );

    // Verify the summary message was sent to the new room
    assertMessages(assert, [
      {
        from: 'testuser',
        message:
          'This is a summary of the previous conversation that should be included as context for our discussion: This conversation focused on project help, specifically creating a new card for a person with name and age fields. The user requested assistance with card creation and field definition.',
      },
    ]);
  });

  test('summarizes current session with cards and files when creating new session', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
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

    // Send message with a card
    await fillIn('[data-test-message-field]', 'I have a person card here');
    await selectCardFromCatalog(`${testRealmURL}Person/hassan`);
    await click('[data-test-send-message-btn]');

    // Send message with a file
    await fillIn(
      '[data-test-message-field]',
      'And here is the pet definition file',
    );
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click('[data-test-file="pet.gts"]');
    await click('[data-test-choose-file-modal-add-button]');
    await click('[data-test-send-message-btn]');

    // Send another message
    await fillIn(
      '[data-test-message-field]',
      'Can you help me understand this structure?',
    );
    await click('[data-test-send-message-btn]');
    await waitFor(`[data-room-settled]`);

    // Verify messages were sent with attachments
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'I have a person card here',
        cards: [{ id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'And here is the pet definition file',
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
      {
        from: 'testuser',
        message: 'Can you help me understand this structure?',
      },
    ]);

    // Create new session with "Summarize Current Session" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click(
      '[data-test-new-session-settings-option="Summarize Current Session"]',
    );
    await click('[data-test-new-session-settings-create-button]');
    await waitFor(`[data-room-settled]`);
    await waitForSessionPreparationToFinish();
    await waitUntil(
      () => document.querySelectorAll('[data-test-message-idx]').length >= 1,
      {
        timeoutMessage:
          'timed out waiting for summary message to arrive in new session',
      },
    );

    // Verify the summary message was sent to the new room
    assertMessages(assert, [
      {
        from: 'testuser',
        message:
          'This is a summary of the previous conversation that should be included as context for our discussion: This conversation involved discussing a person card (Hassan) and a pet definition file. The user shared both a Person card and a pet.gts file, then asked for help understanding the structure.',
      },
    ]);
  });

  test('handles summarization error gracefully when creating new session', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
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

    // Send a message to create some history
    await fillIn('[data-test-message-field]', 'Test message for summarization');
    await click('[data-test-send-message-btn]');

    // Mock the realm server to return an error for summarization
    // This would be handled by the realm server endpoint mock
    const originalRequestForward = getService('realm-server').requestForward;
    getService('realm-server').requestForward = async () => {
      throw new Error('Summarization service unavailable');
    };

    // Create new session with "Summarize Current Session" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click(
      '[data-test-new-session-settings-option="Summarize Current Session"]',
    );
    await click('[data-test-new-session-settings-create-button]');
    await waitFor(`[data-room-settled]`);
    await waitForSessionPreparationToFinish();

    // Verify that the new session was created without the summary (graceful fallback)
    assertMessages(assert, []);

    // Restore the original function
    getService('realm-server').requestForward = originalRequestForward;
  });

  test('skip button skips session preparation and shows correct wording', async function (assert) {
    // Mock the matrix service getPromptParts method to block summarization
    const matrixService = getService('matrix-service');
    const originalGetPromptParts = matrixService.getPromptParts;
    let summarizationDeferred = new Deferred<void>();
    matrixService.getPromptParts = async (roomId: string) => {
      await summarizationDeferred.promise;
      return originalGetPromptParts.call(matrixService, roomId);
    };

    await visitOperatorMode({
      submode: 'interact',
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

    // Send a message to create some history
    await fillIn('[data-test-message-field]', 'Test message for summarization');
    await click('[data-test-send-message-btn]');

    // Create new session with "Summarize Current Session" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click(
      '[data-test-new-session-settings-option="Summarize Current Session"]',
    );
    await click('[data-test-new-session-settings-create-button]');

    try {
      await waitFor('[data-test-session-preparation]');
      // Verify the session preparation message is shown with correct wording
      assert
        .dom('[data-test-session-preparation]')
        .includesText('Summarizing previous session');
      assert
        .dom('[data-test-session-preparation]')
        .includesText('Takes 10-20 seconds');
      await waitFor('[data-test-session-preparation-skip-button]');
      assert.dom('[data-test-session-preparation-skip-button]').hasText('Skip');

      // Click the skip button to skip session preparation
      await click('[data-test-session-preparation-skip-button]');

      // Verify that the session preparation UI is no longer shown
      await waitFor('[data-test-session-preparation]', { count: 0 });

      // Verify that the message input is now enabled (canSend should be true)
      await waitFor('[data-test-message-field]');
      await waitUntil(() => {
        let field = document.querySelector('[data-test-message-field]');
        return Boolean(field && !field.hasAttribute('disabled'));
      });
      assert.dom('[data-test-message-field]').isNotDisabled();

      assertMessages(assert, []);
    } finally {
      summarizationDeferred.fulfill();
      matrixService.getPromptParts = originalGetPromptParts;
    }
  });

  test('ai assistant panel width persists to localStorage', async function (assert) {
    // Clear any existing localStorage data for AI assistant panel width
    window.localStorage.removeItem('ai-assistant-panel-width');

    // First, set a specific width in localStorage
    const testWidth = 60; // 25% width
    window.localStorage.setItem('ai-assistant-panel-width', String(testWidth));

    let operatorModeStateParam = stringify({
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
    // Verify the panel follows the width from localStorage
    let aiAssistantPanel = document.querySelector(
      '[data-test-ai-assistant-panel]',
    );
    assert.ok(aiAssistantPanel, 'AI assistant panel should exist');

    let initialWidth = aiAssistantPanel!.getBoundingClientRect().width;
    assert.ok(initialWidth > 0, 'AI assistant panel should have a width');

    // Calculate the percentage width of the AI assistant panel
    let submodeLayout = document.querySelector('[data-test-submode-layout]');
    assert.ok(submodeLayout, 'submode layout should exist');
    let submodeLayoutWidth = submodeLayout!.getBoundingClientRect().width;
    let actualPercentageWidth = (initialWidth / submodeLayoutWidth) * 100;

    // Verify the width was loaded from localStorage and matches the actual panel width
    let storedWidth = window.localStorage.getItem('ai-assistant-panel-width');
    assert.ok(storedWidth, 'Width should be in localStorage');
    assert.strictEqual(
      Number(storedWidth),
      testWidth,
      'Stored width should match the test width',
    );
    // Verify the actual panel width percentage matches the stored width (with some tolerance for rounding)
    assert.ok(
      Math.abs(actualPercentageWidth - testWidth) < 5,
      `Actual panel width percentage (${actualPercentageWidth.toFixed(
        1,
      )}%) should be close to stored width (${testWidth}%)`,
    );

    // Now test resizing the panel and verify localStorage updates
    let resizeHandle = document.querySelector(
      '[data-boxel-panel-resize-handle-id]',
    );
    assert.ok(resizeHandle, 'Resize handle should exist');

    let resizeHandleRect = resizeHandle!.getBoundingClientRect();
    // Simulate a resize by triggering mouse events on the resize handle
    // This will actually trigger the ResizablePanelGroup's resize logic
    await triggerEvent(resizeHandle!, 'pointerdown', {
      clientX: resizeHandleRect.x,
      clientY: resizeHandleRect.y,
    });
    await triggerEvent(resizeHandle!, 'pointermove', {
      clientX: resizeHandleRect.x + 20,
      clientY: resizeHandleRect.y,
    }); // Move left to make AI panel smaller
    await triggerEvent(resizeHandle!, 'pointerup');

    // Wait a moment for the layout to update
    await waitFor('[data-test-ai-assistant-panel]');

    // Verify the width has been updated in localStorage
    let updatedStoredWidth = window.localStorage.getItem(
      'ai-assistant-panel-width',
    );
    assert.ok(
      updatedStoredWidth,
      'Width should still be in localStorage after resize',
    );

    let updatedParsedWidth = Number(updatedStoredWidth);
    assert.ok(
      updatedParsedWidth > 0,
      'Updated width should be a positive number',
    );
    assert.ok(
      updatedParsedWidth <= 100,
      'Updated width should be a percentage (<= 100)',
    );

    // Verify the width changed (it should be different from the initial test width)
    assert.notStrictEqual(
      updatedParsedWidth,
      testWidth,
      'Width should have changed after resize',
    );

    // Verify the panel width actually changed
    let resizedWidth = aiAssistantPanel!.getBoundingClientRect().width;
    assert.ok(
      resizedWidth > 0,
      'AI assistant panel should still have a width after resize',
    );
  });

  test('creates new session with settings even when empty new session exists', async function (assert) {
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

    // 1. Create first room and add messages with files
    await fillIn('[data-test-message-field]', 'First message with card');
    await selectCardFromCatalog(`${testRealmURL}Person/hassan`);
    await click('[data-test-send-message-btn]');

    await fillIn('[data-test-message-field]', 'Second message with file');
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click('[data-test-file="pet.gts"]');
    await click('[data-test-choose-file-modal-add-button]');
    await click('[data-test-send-message-btn]');

    await fillIn(
      '[data-test-message-field]',
      'Third message with another card',
    );
    await selectCardFromCatalog(`${testRealmURL}Pet/mango`);
    await click('[data-test-send-message-btn]');

    // Verify first room messages
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'First message with card',
        cards: [{ id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Second message with file',
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
      {
        from: 'testuser',
        message: 'Third message with another card',
        cards: [{ id: `${testRealmURL}Pet/mango`, cardTitle: 'Mango' }],
      },
    ]);

    // Get the first room ID
    const matrixService = getService('matrix-service');
    const firstRoomId = matrixService.currentRoomId;
    assert.ok(firstRoomId, 'Should have first room ID');

    // 2. Create second room (new session)
    await click('[data-test-create-room-btn]');
    await waitFor(`[data-room-settled]`);

    const secondRoomId = matrixService.currentRoomId;
    assert.ok(secondRoomId, 'Should have second room ID');
    assert.notStrictEqual(
      secondRoomId,
      firstRoomId,
      'Second room should be different from first room',
    );

    // 3. Switch back to first room with message history
    await click('[data-test-past-sessions-button]');
    await waitFor(`[data-test-enter-room="${firstRoomId}"]`);
    await click(`[data-test-enter-room="${firstRoomId}"]`);
    await waitFor(`[data-room-settled]`);

    // Verify we're back in the first room
    assert.strictEqual(
      matrixService.currentRoomId,
      firstRoomId,
      'Should be back in the first room',
    );

    // Verify first room messages are still there
    assertMessages(assert, [
      {
        from: 'testuser',
        message: 'First message with card',
        cards: [{ id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' }],
      },
      {
        from: 'testuser',
        message: 'Second message with file',
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
      {
        from: 'testuser',
        message: 'Third message with another card',
        cards: [{ id: `${testRealmURL}Pet/mango`, cardTitle: 'Mango' }],
      },
    ]);

    // 4. Create third room with "Copy File History" option
    await click('[data-test-create-room-btn]', { shiftKey: true });
    await click('[data-test-new-session-settings-option="Copy File History"]');
    await click('[data-test-new-session-settings-create-button]');
    await waitFor(`[data-room-settled]`);
    await waitForSessionPreparationToFinish();
    await waitFor('[data-test-user-message]');

    const thirdRoomId = matrixService.currentRoomId;
    assert.ok(thirdRoomId, 'Should have third room ID');
    assert.notStrictEqual(
      thirdRoomId,
      firstRoomId,
      'Third room should be different from first room',
    );
    assert.notStrictEqual(
      thirdRoomId,
      secondRoomId,
      'Third room should be different from second room',
    );

    // 5. Assert that the third room has the first message with files from the first room
    assertMessages(assert, [
      {
        from: 'testuser',
        message:
          'This session includes files and cards from the previous conversation for context.',
        cards: [
          { id: `${testRealmURL}Person/hassan`, cardTitle: 'Hassan' },
          { id: `${testRealmURL}Pet/mango`, cardTitle: 'Mango' },
        ],
        files: [{ sourceUrl: `${testRealmURL}pet.gts`, name: 'pet.gts' }],
      },
    ]);
  });

  test('restores chat input of unsent messages', async function (assert) {
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

    const matrixService = getService('matrix-service');
    await waitFor(`[data-room-settled]`);

    let firstRoomId = matrixService.currentRoomId;
    assert.ok(firstRoomId, 'Should have an initial room ID');
    if (!firstRoomId) {
      throw new Error('Missing room ID for initial session');
    }

    await waitFor(`[data-test-message-field="${firstRoomId}"]`);

    await fillIn(
      `[data-test-message-field="${firstRoomId}"]`,
      'hey, could you do something for me?',
    );
    await click('[data-test-send-message-btn]');
    await fillIn(
      `[data-test-message-field="${firstRoomId}"]`,
      'how old is the sun?',
    );

    // user does not click send, and moves on to a new room

    await click('[data-test-create-room-btn]');
    await waitFor(`[data-room-settled]`);

    let secondRoomId = matrixService.currentRoomId;
    assert.ok(secondRoomId, 'Should have a second room ID');
    if (!secondRoomId) {
      throw new Error('Missing room ID for new session');
    }
    assert.notStrictEqual(
      secondRoomId,
      firstRoomId,
      'Second room should be different from first room',
    );

    await waitFor(`[data-test-message-field="${secondRoomId}"]`);
    assert
      .dom(`[data-test-message-field="${secondRoomId}"]`)
      .hasValue('', 'New room starts with an empty chat input');

    await click('[data-test-past-sessions-button]');
    await waitFor(`[data-test-enter-room="${firstRoomId}"]`);
    await click(`[data-test-enter-room="${firstRoomId}"]`);
    await waitFor(`[data-room-settled]`);
    await waitUntil(() => matrixService.currentRoomId === firstRoomId);
    await waitFor(`[data-test-message-field="${firstRoomId}"]`);
    assert
      .dom(`[data-test-message-field="${firstRoomId}"]`)
      .hasValue(
        'how old is the sun?',
        'Draft message is restored when returning to the original room',
      );
  });

  test('shows an error and persists the prompt in case the message failed to send', async function (assert) {
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

    const matrixService = getService('matrix-service');

    let roomId = matrixService.currentRoomId;
    assert.ok(roomId, 'Should have a room ID');
    if (!roomId) {
      throw new Error('Missing room ID for message failure test');
    }

    await waitFor(`[data-test-message-field="${roomId}"]`);

    const originalSendMessage = matrixService.sendMessage;
    let sendAttempts = 0;
    matrixService.sendMessage = async function (
      ..._args: Parameters<typeof originalSendMessage>
    ) {
      sendAttempts++;
      throw new Error('Intentional failure for test');
    };

    const failingMessage = 'This message should trigger an error';
    try {
      await fillIn(`[data-test-message-field="${roomId}"]`, failingMessage);
      await waitUntil(
        () => matrixService.getMessageToSend(roomId!) === failingMessage,
      );

      await click('[data-test-send-message-btn]');

      await waitFor('[data-test-boxel-alert="error"]');
      assert.strictEqual(sendAttempts, 1, 'sendMessage was attempted once');
      assert
        .dom('[data-test-boxel-alert="error"] [data-test-alert-message="0"]')
        .hasText(
          'There was an error sending your message. This could be due to network issues, or serialization issues with the cards or files you are trying to send. It might be helpful to refresh the page and try again.',
        );

      await waitUntil(
        () => matrixService.getMessageToSend(roomId!) === failingMessage,
      );
      assert
        .dom(`[data-test-message-field="${roomId}"]`)
        .hasValue(
          failingMessage,
          'Draft message is restored after a failed send attempt',
        );
    } finally {
      matrixService.sendMessage = originalSendMessage;
    }
  });
});
