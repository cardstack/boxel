import { fn } from '@ember/helper';
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

import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import { baseRealm, Command } from '@cardstack/runtime-common';

import {
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import GetBoxelUIStateCommand from '@cardstack/host/commands/get-boxel-ui-state';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import PatchCardCommand from '@cardstack/host/commands/patch-card';
import SaveCardCommand from '@cardstack/host/commands/save-card';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import ShowCardCommand from '@cardstack/host/commands/show-card';
import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type LoaderService from '@cardstack/host/services/loader-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  setupUserSubscription,
  delay,
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

let matrixRoomId = '';
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

        // Mutate and save again
        let patchCardCommand = new PatchCardCommand(this.commandContext, {
          cardType: Meeting,
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
        await sendAiAssistantMessageCommand.execute({
          roomId,
          prompt: `Change the topic of the meeting to "${input.topic}"`,
          attachedCards: [meeting],
          commands: [{ command: patchCardCommand, autoExecute: true }],
        });

        await patchCardCommand.waitForNextCompletion();

        let showCardCommand = new ShowCardCommand(this.commandContext);
        await showCardCommand.execute({
          cardToShow: meeting,
        });

        return undefined;
      }
    }

    class SleepCommand extends Command<typeof ScheduleMeetingInput> {
      static displayName = 'SleepCommand';
      async getInputType() {
        return ScheduleMeetingInput;
      }
      protected async run() {
        await delay(1000);
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
        runSwitchToCodeModeCommandViaAiAssistant = async (
          autoExecute: boolean,
        ) => {
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
          });
          let switchSubmodeCommand = new SwitchSubmodeCommand(commandContext);
          let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
            commandContext,
          );
          await sendAiAssistantMessageCommand.execute({
            roomId,
            prompt: 'Switch to code mode',
            commands: [{ command: switchSubmodeCommand, autoExecute }],
          });
        };
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
        runDelayCommandViaAiAssistant = async () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }
          let sleepCommand = new SleepCommand(commandContext);
          let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
            commandContext,
          );
          await sendAiAssistantMessageCommand.execute({
            prompt: 'Please delay',
            roomId: 'mock_room_1',
            commands: [{ command: sleepCommand, autoExecute: true }],
          });
          await sleepCommand.execute(new ScheduleMeetingInput());
        };

        runWhatSubmodeAmIIn = async () => {
          let commandContext = this.args.context?.commandContext;
          if (!commandContext) {
            console.error('No command context found');
            return;
          }
          let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
            commandContext,
          );
          let { roomId } = await createAIAssistantRoomCommand.execute({
            name: 'Submode Check',
          });
          let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
            commandContext,
          );
          let getBoxelUIStateCommand = new GetBoxelUIStateCommand(
            commandContext,
          );
          await sendAiAssistantMessageCommand.execute({
            roomId,
            prompt: 'What submode am I in?',
            commands: [{ command: getBoxelUIStateCommand, autoExecute: true }],
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
            roomId: 'mock_room_1',
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
            {{on
              'click'
              (fn this.runSwitchToCodeModeCommandViaAiAssistant true)
            }}
            data-test-switch-to-code-mode-with-autoexecute-button
          >Switch to code-mode with autoExecute</button>
          <button
            {{on
              'click'
              (fn this.runSwitchToCodeModeCommandViaAiAssistant false)
            }}
            data-test-switch-to-code-mode-without-autoexecute-button
          >Switch to code-mode (no autoExecute)</button>
          <button
            {{on 'click' this.runScheduleMeetingCommand}}
            data-test-schedule-meeting-button
          >Schedule meeting</button>
          <button
            {{on 'click' this.runDelayCommandViaAiAssistant}}
            data-test-delay-button
          >Delay with autoExecute</button>
          <button
            {{on 'click' this.runWhatSubmodeAmIIn}}
            data-test-what-submode-am-i-in
          >What submode and I in?</button>
          <button
            {{on 'click' this.runOpenAiAssistantRoomCommand}}
            data-test-open-ai-assistant-room-button
          >Open AI Assistant Room</button>
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
        'Skill/switcher.json': {
          data: {
            type: 'card',
            attributes: {
              instructions:
                'Use the tool SwitchSubmodeCommand with "code" to go to codemode and "interact" to go to interact mode.',
              commands: [
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/commands/switch-submode',
                  },
                  executors: [],
                },
              ],
              title: 'Switcher',
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/skill-card',
                name: 'SkillCard',
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

  test('a command sent via SendAiAssistantMessageCommand with autoExecute flag is automatically executed by the bot, panel closed', async function (assert) {
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
    await click('[data-test-switch-to-code-mode-with-autoexecute-button]');
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.ok(
      /^SwitchSubmodeCommand_/.test(toolName),
      'The function name start with SwitchSubmodeCommand_',
    );
    assert.strictEqual(
      boxelMessageData.context.tools[0].function.description,
      'Navigate the UI to another submode. Possible values for submode are "interact" and "code".',
    );
    // TODO: do we need to include `required: ['attributes'],` in the parameters object? If so, how?
    assert.deepEqual(boxelMessageData.context.tools[0].function.parameters, {
      type: 'object',
      properties: {
        description: {
          type: 'string',
        },
        attributes: {
          type: 'object',
          properties: {
            submode: {
              type: 'string',
            },
            codePath: {
              type: 'string',
            },
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            thumbnailURL: {
              type: 'string',
            },
          },
        },
        relationships: {
          properties: {},
          type: 'object',
        },
      },
      required: ['attributes', 'description'],
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Switching to code submode',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Switching to code submode',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {
              submode: 'code',
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await waitFor('[data-test-submode-switcher=code]');
    assert.dom('[data-test-submode-switcher=code]').exists();
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${testCard}.json`);
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await click('[data-test-open-ai-assistant]');
    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('Switch to code mode');
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Switching to code submode');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
  });

  test('a command sent via SendAiAssistantMessageCommand with autoExecute flag is automatically executed by the bot, panel open', async function (assert) {
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

    await click('[data-test-open-ai-assistant]');
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click(
      `[data-test-stack-card="${testRealmURL}index"] [data-test-cards-grid-item="${testCard}"]`,
    );
    await click('[data-test-delay-button]');
    await waitUntil(() => getRoomIds().includes('mock_room_1'));
    let roomId = 'mock_room_1';
    let message = getRoomEvents(roomId).pop()!;
    let boxelMessageData = JSON.parse(message.content.data);
    let toolName = boxelMessageData.context.tools[0].function.name;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Delaying 1 second',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Delaying 1 second',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {},
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await waitFor(
      '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
    );
    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('Please delay');
    await waitFor(
      '[data-test-message-idx="1"] [data-test-apply-state="applying"]',
    );
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applying"]')
      .exists();
    await settled();
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Delaying 1 second');
    await waitFor(
      '[data-test-message-idx="1"] [data-test-apply-state="applied"]',
      { timeout: 2000 },
    );
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
  });

  test('a command sent via SendAiAssistantMessageCommand without autoExecute flag is not automatically executed by the bot', async function (assert) {
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
    await click('[data-test-switch-to-code-mode-without-autoexecute-button]');
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.ok(
      /^SwitchSubmodeCommand_/.test(toolName),
      'The function name start with SwitchSubmodeCommand_',
    );
    assert.strictEqual(
      boxelMessageData.context.tools[0].function.description,
      'Navigate the UI to another submode. Possible values for submode are "interact" and "code".',
    );
    // TODO: do we need to include `required: ['attributes'],` in the parameters object? If so, how?
    assert.deepEqual(boxelMessageData.context.tools[0].function.parameters, {
      type: 'object',
      properties: {
        description: {
          type: 'string',
        },
        attributes: {
          type: 'object',
          properties: {
            submode: {
              type: 'string',
            },
            codePath: {
              type: 'string',
            },
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            thumbnailURL: {
              type: 'string',
            },
          },
        },
        relationships: {
          properties: {},
          type: 'object',
        },
      },
      required: ['attributes', 'description'],
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Switching to code submode',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Switching to code submode',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {
              submode: 'code',
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    assert.dom('[data-test-submode-switcher=interact]').exists();
    await click('[data-test-open-ai-assistant]');
    await waitFor(`[data-room-settled]`);
    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('Switch to code mode');
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Switching to code submode');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="ready"]')
      .exists();
    await click('[data-test-message-idx="1"] [data-test-command-apply]');
    await waitFor('[data-test-submode-switcher=code]');
    assert.dom('[data-test-submode-switcher=code]').exists();
    assert.dom('[data-test-card-url-bar-input]').hasValue(`${testCard}.json`);
    await click('[data-test-submode-switcher] button');
    await click('[data-test-boxel-menu-item-text="Interact"]');

    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('Switch to code mode');
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Switching to code submode');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
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
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    let meetingCardEventId = boxelMessageData.attachedCardsEventIds[0];
    let cardFragment = JSON.parse(
      getRoomEvents(roomId).find(
        (event) => event.event_id === meetingCardEventId,
      )!.content.data,
    ).cardFragment;
    let parsedCard = JSON.parse(cardFragment);
    let meetingCardId = parsedCard.data.id;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Update card',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Update card',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {
              cardId: meetingCardId,
              patch: {
                attributes: {
                  topic: 'Meeting with Hassan',
                },
              },
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

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

  test('a command added from a skill can be executed when clicked on', async function (assert) {
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
    // open skill menu
    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    // add switcher skill
    await click(
      '[data-test-card-catalog-item="http://test-realm/test/Skill/switcher"]',
    );
    await click('[data-test-card-catalog-go-button]');

    // simulate message
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Switching to code submode',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Switching to code submode',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: 'switch-submode_dd88',
          arguments: {
            attributes: {
              submode: 'code',
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
    });
    // Click on the apply button
    await waitFor('[data-test-message-idx="0"]');
    await click('[data-test-message-idx="0"] [data-test-command-apply]');

    // check we're in code mode
    await waitFor('[data-test-submode-switcher=code]');
    assert.dom('[data-test-submode-switcher=code]').exists();
  });

  test('a command executed via the AI Assistant shows the result as an embedded card', async function (assert) {
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
    await click('[data-test-what-submode-am-i-in]');
    await click('[data-test-open-ai-assistant]');
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.ok(
      /^GetBoxelUIState/.test(toolName),
      'The function name starts with GetBoxelUIStateCommand_',
    );
    assert.strictEqual(
      boxelMessageData.context.tools[0].function.description,
      'Get information about the current state of the Boxel UI, including the current submode, what cards are open, and what room, if any, the AI assistant is showing.',
    );
    // TODO: do we need to include `required: ['attributes'],` in the parameters object? If so, how?
    assert.deepEqual(boxelMessageData.context.tools[0].function.parameters, {
      type: 'object',
      properties: {
        description: {
          type: 'string',
        },
        attributes: {
          type: 'object',
          properties: {},
        },
        relationships: {
          properties: {},
          type: 'object',
        },
      },
      required: ['attributes', 'description'],
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Inspecting the current UI state',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Inspecting the current UI state',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {},
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });
    await settled();
    assert
      .dom(
        '[data-test-message-idx="0"][data-test-boxel-message-from="testuser"]',
      )
      .containsText('What submode am I in?');
    assert
      .dom('[data-test-message-idx="1"][data-test-boxel-message-from="aibot"]')
      .containsText('Inspecting the current UI state');
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists();
    assert
      .dom('[data-test-message-idx="1"] [data-test-boxel-command-result]')
      .containsText('Submode: interact');
  });

  test('command returns serialized result in room message', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}AiCommandExample/london`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click('[data-test-get-weather]');
    await waitUntil(() => getRoomIds().length > 0);

    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Getting weather information for London',
      msgtype: APP_BOXEL_COMMAND_MSGTYPE,
      formatted_body: 'Getting weather information for London',
      format: 'org.matrix.custom.html',
      data: JSON.stringify({
        toolCall: {
          name: toolName,
          arguments: {
            attributes: {
              location: 'London',
            },
          },
        },
        eventId: '__EVENT_ID__',
      }),
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '__EVENT_ID__',
      },
    });

    await settled();
    let commandResultEvents = await getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type === 'm.annotation' &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
  });
});
