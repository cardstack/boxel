import { on } from '@ember/modifier';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import {
  click,
  waitFor,
  findAll,
  waitUntil,
  settled,
} from '@ember/test-helpers';

import { fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  buildCommandFunctionName,
  Command,
  skillCardRef,
} from '@cardstack/runtime-common';

import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import SaveCardCommand from '@cardstack/host/commands/save-card';
import { SearchCardsByTypeAndTitleCommand } from '@cardstack/host/commands/search-cards';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import ShowCardCommand from '@cardstack/host/commands/show-card';
import {
  waitForCompletedCommandRequest,
  waitForRealmState,
} from '@cardstack/host/commands/utils';
import type LoaderService from '@cardstack/host/services/loader-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { SearchCardsByTypeAndTitleInput } from 'https://cardstack.com/base/command';

import { Skill } from 'https://cardstack.com/base/skill';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  setupUserSubscription,
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
import { setupApplicationTest } from '../helpers/setup';
import { suspendGlobalErrorHook } from '../helpers/uncaught-exceptions';

let matrixRoomId = '';
let maybeBoomShouldBoom = true;

module('Acceptance | Commands tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let { simulateRemoteMessage, getRoomIds, getRoomEvents, createAndJoinRoom } =
    mockMatrixUtils;

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    matrixRoomId = await createAndJoinRoom({
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

    class ScheduleMeetingInput extends CardDef {
      @field topic = contains(StringField);
      @field participants = linksToMany(() => Person);
    }

    class Meeting extends CardDef {
      static displayName = 'Meeting';
      @field participants = linksToMany(() => Person);
      @field topic = contains(StringField);
    }

    class ScheduleMeetingCommand extends Command<typeof ScheduleMeetingInput> {
      @service private declare loaderService: LoaderService;
      @service
      private declare operatorModeStateService: OperatorModeStateService;
      static displayName = 'ScheduleMeetingCommand';
      static actionVerb = 'Schedule';

      async getInputType() {
        return ScheduleMeetingInput;
      }
      protected async run(input: ScheduleMeetingInput) {
        let meeting = new Meeting({
          topic: 'unset topic',
          participants: input.participants,
        });
        let saveCardCommand = new SaveCardCommand(this.commandContext);
        await saveCardCommand.execute({
          card: meeting,
          realm: testRealmURL,
        });

        let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
          this.commandContext,
        );
        let { roomId } = await createAIAssistantRoomCommand.execute({
          name: 'AI Assistant Room',
        });
        let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
          this.commandContext,
        );
        let { eventId } = await sendAiAssistantMessageCommand.execute({
          roomId,
          prompt: `Change the topic of the meeting to "${input.topic}"`,
          attachedCards: [meeting],
        });

        await waitForCompletedCommandRequest(
          this.commandContext,
          roomId,
          (commandRequest) => commandRequest.name === 'patchCardInstance',
          { afterEventId: eventId },
        );

        await waitForRealmState(
          this.commandContext,
          testRealmURL,
          () => meeting.topic === input.topic,
        );

        let showCardCommand = new ShowCardCommand(this.commandContext);
        await showCardCommand.execute({
          cardId: meeting.id,
        });

        return undefined;
      }
    }

    class MaybeBoomCommand extends Command<undefined, undefined> {
      static displayName = 'MaybeBoomCommand';
      static actionVerb = 'Boom?';
      async getInputType() {
        return undefined;
      }
      protected async run(): Promise<undefined> {
        if (maybeBoomShouldBoom) {
          throw new Error('Boom!');
        }
        return undefined;
      }
    }

    class SearchAndOpenCardCommand extends Command<
      typeof SearchCardsByTypeAndTitleInput,
      undefined
    > {
      static displayName = 'SearchAndOpenCardCommand';
      static actionVerb = 'Search';
      async getInputType() {
        return new SearchCardsByTypeAndTitleCommand(
          this.commandContext,
        ).getInputType();
      }
      protected async run(
        input: SearchCardsByTypeAndTitleInput,
      ): Promise<undefined> {
        let searchCommand = new SearchCardsByTypeAndTitleCommand(
          this.commandContext,
        );
        let searchResult = await searchCommand.execute(input);
        if (searchResult.cardIds.length > 0) {
          let showCardCommand = new ShowCardCommand(this.commandContext);
          await showCardCommand.execute({
            cardId: searchResult.cardIds[0],
          });
        }
        return undefined;
      }
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
        runScheduleMeetingCommand = async () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }
          let scheduleMeeting = new ScheduleMeetingCommand(commandContext);
          setOwner(scheduleMeeting, getOwner(this)!);
          await scheduleMeeting.execute({
            topic: 'Meeting with Hassan',
            participants: [this.args.model as Person],
          });
        };

        runOpenAiAssistantRoomCommand = async () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }

          let openAiAssistantRoomCommand = new OpenAiAssistantRoomCommand(
            commandContext,
          );
          await openAiAssistantRoomCommand.execute({
            roomId: getRoomIds().pop()!,
          });
        };

        runMaybeBoomCommandViaAiAssistant = async () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }
          let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
            commandContext,
          );
          let { roomId } = await createAIAssistantRoomCommand.execute({
            name: 'AI Assistant Room',
            defaultSkills: [
              (await getService('store').get<Skill>(
                `${testRealmURL}Skill/useful-commands`,
              )) as Skill,
            ],
          });
          let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
            commandContext,
          );
          await sendAiAssistantMessageCommand.execute({
            prompt: "Let's find out if it will boom",
            roomId,
          });
        };

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
          <button
            {{on 'click' this.runScheduleMeetingCommand}}
            data-test-schedule-meeting-button
          >Schedule meeting</button>
          <button
            {{on 'click' this.runOpenAiAssistantRoomCommand}}
            data-test-open-ai-assistant-room-button
          >Open AI Assistant Room</button>
          <button
            {{on 'click' this.runMaybeBoomCommandViaAiAssistant}}
            data-test-maybe-boom-via-ai-assistant
          >Maybe Boom</button>
        </template>
      };
    }
    let mangoPet = new Pet({ name: 'Mango' });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person, Meeting },
        'pet.gts': { Pet },
        'Pet/ringo.json': new Pet({ name: 'Ringo' }),
        'AiCommandExample/london.json': {
          data: {
            type: 'card',
            attributes: {
              location: 'London',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/ai-command-example',
                name: 'AiCommandExample',
              },
            },
          },
        },
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
        'maybe-boom-command.ts': { default: MaybeBoomCommand },
        'search-and-open-card-command.ts': {
          default: SearchAndOpenCardCommand,
        },
        'Skill/useful-commands.json': {
          data: {
            type: 'card',
            attributes: {
              instructions:
                'Here are few commands you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode. * search-cards-by-type-and-title: search for cards by name or description.',
              commands: [
                {
                  codeRef: {
                    name: 'SearchCardsByTypeAndTitleCommand',
                    module: '@cardstack/boxel-host/commands/search-cards',
                  },
                  requiresApproval: true,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/commands/switch-submode',
                  },
                  requiresApproval: true,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: `/test/maybe-boom-command`,
                  },
                  requiresApproval: false,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: '../search-and-open-card-command',
                  },
                  requiresApproval: true,
                },
              ],
              title: 'Useful Commands',
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: skillCardRef,
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
        'hi.txt': 'hi',
      },
    });
  });

  test('OpenAiAssistantRoomCommand opens the AI assistant room', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}Person/hassan`, format: 'isolated' }]],
    });

    await click('[data-test-schedule-meeting-button]');
    await click('[data-test-open-ai-assistant-room-button]');

    await waitFor('[data-room-settled]');
    await waitFor('[data-test-room-name="AI Assistant Room"]');

    assert
      .dom('[data-test-ai-message-content]')
      .includesText('Change the topic of the meeting to "Meeting with Hassan"');
  });

  test('a scripted command can create a card, update it and show it', async function (assert) {
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
    const testCard = `${testRealmURL}Person/hassan`;

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"]`,
    );
    await click('[data-test-schedule-meeting-button]');
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    let meetingCardEventId = boxelMessageData.attachedCards[0];
    let meetingCardId = meetingCardEventId.sourceUrl;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: 'patchCardInstance',
          id: '794c52f1-b444-47bd-8b2c-5d03ba7ef042',
          arguments: JSON.stringify({
            description:
              'Change the topic of the meeting to "Meeting with Hassan"',
            attributes: {
              cardId: meetingCardId,
              patch: {
                attributes: {
                  topic: 'Meeting with Hassan',
                },
              },
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    // open assistant
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');

    await click('[data-test-message-idx="1"] [data-test-command-apply]');
    await waitUntil(
      () => findAll('[data-test-operator-mode-stack]').length === 2,
    );

    assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

    assert
      .dom(
        '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
      )
      .includesText('Meeting with Hassan');
  });

  test('a host command added from a skill can be executed when clicked on', async function (assert) {
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
    // open assistant
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');
    // open skill menu
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    // add useful-commands skill, which includes the switch-submode command
    await click(
      '[data-test-card-catalog-item="http://test-realm/test/Skill/useful-commands"]',
    );
    await click('[data-test-card-catalog-go-button]');

    // simulate message
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'abc123',
          name: 'switch-submode_dd88',
          arguments: JSON.stringify({
            description: 'Switching to code submode',
            attributes: {
              submode: 'code',
            },
          }),
        },
      ],
    });
    // Click on the apply button
    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="0"] .command-description')
      .containsText('Switching to code submode');

    await click('[data-test-message-idx="0"] [data-test-command-apply]');

    // check we're in code mode
    await waitFor('[data-test-submode-switcher=code]');
    assert.dom('[data-test-submode-switcher=code]').exists();

    // verify that command result event was created correctly
    await waitUntil(
      () =>
        getRoomIds().length > 0 &&
        getRoomEvents(roomId).find(
          (m) =>
            m.content.msgtype ===
            APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        ),
    );
    let message = getRoomEvents(roomId).find(
      (m) =>
        m.content.msgtype === APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    )!;
    assert.strictEqual(
      message.content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(
      message.content['m.relates_to']?.rel_type,
      APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    );
    assert.strictEqual(message.content['m.relates_to']?.key, 'applied');
    assert.strictEqual(message.content.commandRequestId, 'abc123');
  });

  test('a userland command added from a skill can be executed when clicked on', async function (assert) {
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
    // open assistant
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');
    // open skill menu
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');
    // add useful-commands skill, which includes the switch-submode command
    await click(
      '[data-test-card-catalog-item="http://test-realm/test/Skill/useful-commands"]',
    );
    await click('[data-test-card-catalog-go-button]');
    // simulate message
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '29e8addb-197b-4d6d-b0a9-547959bf7c96',
          name: buildCommandFunctionName({
            module: `${testRealmURL}search-and-open-card-command`,
            name: 'default',
          }),
          arguments: JSON.stringify({
            description: 'Finding and opening Hassan card',
            attributes: {
              title: 'Hassan',
            },
          }),
        },
      ],
    });
    // Click on the apply button
    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="0"] .command-description')
      .containsText('Finding and opening Hassan card');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply]')
      .containsText('Search');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom(
        '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
      )
      .includesText('Person - Hassan Abdel-Rahman');

    // verify that command result event was created correctly
    await waitUntil(() => getRoomIds().length > 0);
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(
      message.content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(
      message.content['m.relates_to']?.rel_type,
      APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    );
    assert.strictEqual(message.content['m.relates_to']?.key, 'applied');
    assert.strictEqual(
      message.content.commandRequestId,
      '29e8addb-197b-4d6d-b0a9-547959bf7c96',
    );
  });

  test('ShowCard command added from a skill, can be automatically executed when agentId matches', async function (assert) {
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
    let roomId = getRoomIds().pop()!;
    // open assistant, ShowCard command is part of default CardEditing skill
    await click('[data-test-open-ai-assistant]');

    // Need to create a new room so this new room will include skills card
    await fillIn(
      '[data-test-message-field]',
      'Test message to enable new session button',
    );
    await click('[data-test-send-message-btn]');
    await click('[data-test-create-room-btn]');

    // simulate message
    roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Show the card',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1554f297-e9f2-43fe-8b95-55b29251444d',
          name: 'show-card_566f',
          arguments: JSON.stringify({
            description:
              'Displaying the card with the Latin word for milkweed in the title.',
            attributes: {
              cardId: 'http://test-realm/test/Person/hassan',
              title: 'Asclepias',
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-message-idx="0"]');

    // Note: you don't have to click on apply button, because command on Skill
    // has requireApproval set to false
    await waitFor(
      '[data-test-message-idx="0"] [data-test-apply-state="applied"]',
    );

    assert.dom('[data-test-command-id]').doesNotHaveClass('is-failed');

    // check we're in interact mode
    await waitFor('[data-test-submode-switcher=interact]');
    assert.dom('[data-test-submode-switcher=interact]').exists();

    // verify that the card is opened
    assert
      .dom(
        '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
      )
      .includesText('Person - Hassan Abdel-Rahman');

    // verify that command result event was created correctly
    await waitUntil(() => getRoomIds().length > 0);
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(
      message.content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(
      message.content['m.relates_to']?.rel_type,
      APP_BOXEL_COMMAND_RESULT_REL_TYPE,
    );
    assert.strictEqual(message.content['m.relates_to']?.key, 'applied');
    assert.strictEqual(
      message.content.commandRequestId,
      '1554f297-e9f2-43fe-8b95-55b29251444d',
    );
  });

  test('ShowCard command added from a skill, is not automatically executed when agentId does not match', async function (assert) {
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
    let roomId = getRoomIds().pop()!;
    // open assistant, ShowCard command is part of default CardEditing skill
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-field]');

    // Need to create a new room so this new room will include skills card
    await fillIn(
      '[data-test-message-field]',
      'Test message to enable new session button',
    );
    await click('[data-test-send-message-btn]');
    await click('[data-test-create-room-btn]');

    // simulate message
    roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Show the card',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1554f297-e9f2-43fe-8b95-55b29251444d',
          name: 'show-card_566f',
          arguments: JSON.stringify({
            description:
              'Displaying the card with the Latin word for milkweed in the title.',
            attributes: {
              cardId: 'http://test-realm/test/Person/hassan',
              title: 'Asclepias',
            },
          }),
        },
      ],
      data: {
        context: {
          agentId: 'some-other-agent-id',
        },
      },
    });
    await waitFor('[data-test-message-idx="0"]');

    await waitFor(
      '[data-test-message-idx="0"] [data-test-apply-state="ready"]',
    );

    assert.dom('[data-test-command-id]').doesNotHaveClass('is-failed');
    assert.dom('[data-test-submode-switcher=interact]').exists();
  });

  test('multiple commands can be requested in a single aibot message', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-open-ai-assistant]');
    // open skill menu
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    await click(
      '[data-test-card-catalog-item="http://test-realm/test/Skill/useful-commands"]',
    );
    await click('[data-test-card-catalog-go-button]');

    // simulate message
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Checking the current UI state and searching for cards',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'a4237eca-b73e-4256-bf3a-45849fa07d02',
          name: 'switch-submode_dd88',
          arguments: JSON.stringify({ attributes: { submode: 'code' } }),
        },
        {
          id: '2b48526b-d599-4789-a47b-dff349948c37',
          name: 'search-cards-by-type-and-title_dd88',
          arguments: JSON.stringify({
            attributes: {
              query: 'test',
            },
          }),
        },
      ],
    });
    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('[data-test-message-idx="0"] [data-test-command-apply]')
      .exists({ count: 2 });
  });

  module('suspending global error hook', (hooks) => {
    suspendGlobalErrorHook(hooks);

    test('a command that errors when executing allows retry', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-maybe-boom-via-ai-assistant]');
      await waitUntil(() => getRoomIds().length > 0);

      await click('[data-test-open-ai-assistant-room-button]');
      let roomId = getRoomIds().pop()!;
      maybeBoomShouldBoom = true;
      simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: 'Will it boom?',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
          {
            id: '2dd27b90-b473-403c-a5ae-399a29af7d62',
            name: 'maybe-boom-command_4b30',
            arguments: JSON.stringify({}),
          },
        ],
        data: {
          context: {
            agentId: getService('matrix-service').agentId,
          },
        },
      });

      await settled();
      let commandResultEvents = await getRoomEvents(roomId).filter(
        (event) => event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      assert.equal(
        commandResultEvents.length,
        0,
        'No command result event dispatched',
      );
      maybeBoomShouldBoom = false;
      await click('[data-test-alert-retry-button]');
      commandResultEvents = await getRoomEvents(roomId).filter(
        (event) => event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      );
      assert.equal(
        commandResultEvents.length,
        1,
        'Command result event was dispatched',
      );
      assert.dom('[data-test-apply-state="applied"]').exists();
    });
  });
});
