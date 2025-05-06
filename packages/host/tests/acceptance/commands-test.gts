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

import { fillIn } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  buildCommandFunctionName,
  Command,
} from '@cardstack/runtime-common';

import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import CreateAiAssistantRoomCommand from '@cardstack/host/commands/create-ai-assistant-room';
import GetBoxelUIStateCommand from '@cardstack/host/commands/get-boxel-ui-state';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import PatchCardInstanceCommand from '@cardstack/host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/host/commands/save-card';
import { SearchCardsByTypeAndTitleCommand } from '@cardstack/host/commands/search-cards';
import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import ShowCardCommand from '@cardstack/host/commands/show-card';
import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type LoaderService from '@cardstack/host/services/loader-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { SearchCardsByTypeAndTitleInput } from 'https://cardstack.com/base/command';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  setupUserSubscription,
  delay,
  getMonacoContent,
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
        let patchCardInstanceCommand = new PatchCardInstanceCommand(
          this.commandContext,
          {
            cardType: Meeting,
          },
        );

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
          commands: [{ command: patchCardInstanceCommand, autoExecute: true }],
        });

        await patchCardInstanceCommand.waitForNextCompletion();

        let showCardCommand = new ShowCardCommand(this.commandContext);
        await showCardCommand.execute({
          cardIdToShow: meeting.id,
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

    class MaybeBoomCommand extends Command<undefined, undefined> {
      static displayName = 'MaybeBoomCommand';
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
            cardIdToShow: searchResult.cardIds[0],
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
            roomId: getRoomIds().pop()!,
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
          });
          let maybeBoomCommand = new MaybeBoomCommand(commandContext);
          let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
            commandContext,
          );
          await sendAiAssistantMessageCommand.execute({
            prompt: "Let's find out if it will boom",
            roomId,
            commands: [{ command: maybeBoomCommand, autoExecute: true }],
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
                'Here are few commands you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode. * get-boxel-ui-state: find out what mode you are in currently, and what cards are open. * search-cards-by-type-and-title: search for cards by name or description.',
              commands: [
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/commands/get-boxel-ui-state',
                  },
                  requiresApproval: true,
                },
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
                  requiresApproval: true,
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
        'hello.txt': 'Hello, world!',
        'hi.txt': 'Hi, world!\nHow are you?',
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
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1',
          name: toolName,
          arguments: JSON.stringify({
            description: 'Switching to code submode',
            attributes: {
              submode: 'code',
            },
          }),
        },
      ],
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
    await waitUntil(() => getRoomIds().length > 0);
    let roomId = getRoomIds().pop()!;
    let message = getRoomEvents(roomId).pop()!;
    let boxelMessageData = JSON.parse(message.content.data);
    let toolName = boxelMessageData.context.tools[0].function.name;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: '1',
          name: toolName,
          arguments: JSON.stringify({
            description: 'Delaying 1 second',
            attributes: {},
          }),
        },
      ],
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

  test('can patch code', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
// File url: http://test-realm/test/hello.txt
<<<<<<< SEARCH
Hello, world!
=======
Hi, world!
>>>>>>> REPLACE\n\`\`\``;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: 'org.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    let originalContent = getMonacoContent();
    assert.strictEqual(originalContent, 'Hello, world!');
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');
    await waitUntil(() => getMonacoContent() === 'Hi, world!');
  });

  test('can patch code when there are multiple patches using "Accept All" button', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world!
    // 2. hi.txt: Hi, world! -> Greetings, world!
    // 3. hi.txt: How are you? -> We are one!

    let codeBlock = `\`\`\`
// File url: http://test-realm/test/hello.txt
<<<<<<< SEARCH
Hello, world!
=======
Hi, world!
>>>>>>> REPLACE
\`\`\`

 \`\`\`
// File url: http://test-realm/test/hi.txt
<<<<<<< SEARCH
Hi, world!
=======
Greetings, world!
>>>>>>> REPLACE
\`\`\`

\`\`\`
// File url: http://test-realm/test/hi.txt
<<<<<<< SEARCH
How are you?
=======
We are one!
>>>>>>> REPLACE
\`\`\``;

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: 'org.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-apply-all-code-patches-button]');
    await click('[data-test-apply-all-code-patches-button]');

    await waitFor('.code-patch-actions [data-test-apply-state="applied"]');
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 4 }); // 3 patches + 1 for "Accept All" button

    assert.strictEqual(
      getMonacoContent(),
      'Hi, world!',
      'hello.txt should be patched',
    );
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hi.txt`,
    });

    // We can see content that is the result of 2 patches made to this file (hi.txt)
    await waitUntil(
      () => getMonacoContent() === 'Greetings, world!\nWe are one!',
    );
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
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: toolName,
          arguments: JSON.stringify({
            attributes: {
              submode: 'code',
            },
          }),
        },
      ],
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
    let meetingCardEventId = boxelMessageData.attachedCards[0];
    let meetingCardId = meetingCardEventId.sourceUrl;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: toolName,
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
    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
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
    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
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
    await click('[data-test-message-idx="0"] [data-test-command-apply]');
    assert
      .dom(
        '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
      )
      .includesText('Person Hassan');

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

  test('ShowCard command added from a skill, can be automatically executed', async function (assert) {
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
              cardIdToShow: 'http://test-realm/test/Person/hassan',
              title: 'Asclepias',
            },
          }),
        },
      ],
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
      .includesText('Person Hassan');

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

  test('multiple commands can be requested in a single aibot message', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-open-ai-assistant]');
    // open skill menu
    await click('[data-test-skill-menu] [data-test-pill-menu-header-button]');
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
          name: 'get-boxel-ui-state_dd88',
          arguments: JSON.stringify({}),
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
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          name: toolName,
          arguments: JSON.stringify({
            attributes: {},
          }),
        },
      ],
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
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'fd1606f6-4d81-414a-8901-d6017eaf1fe9',
          name: toolName,
          arguments: JSON.stringify({
            attributes: {
              location: 'London',
            },
          }),
        },
      ],
    });

    await settled();
    let commandResultEvents = await getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_COMMAND_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_COMMAND_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      commandResultEvents.length,
      1,
      'command result event is dispatched',
    );
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
      let message = getRoomEvents(roomId).pop()!;
      let boxelMessageData = JSON.parse(message.content.data);
      let toolName = boxelMessageData.context.tools[0].function.name;
      maybeBoomShouldBoom = true;
      simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: 'Will it boom?',
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
          {
            id: '8406a6eb-a3d5-494f-a7f3-ae9880115756',
            name: toolName,
            arguments: JSON.stringify({}),
          },
        ],
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
      await click('[data-test-retry-command-button]');
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
