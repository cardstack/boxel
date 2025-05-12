import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { click, waitFor, findAll, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { GridContainer } from '@cardstack/boxel-ui/components';

import { baseRealm, Command, skillCardRef } from '@cardstack/runtime-common';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
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

let matrixRoomId = '';
let maybeBoomShouldBoom = true;

module('Acceptance | Code patches tests', function (hooks) {
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
        'hello.txt': 'Hello, world!',
        'hi.txt': 'Hi, world!\nHow are you?',
      },
    });
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
    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
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

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
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

    await waitFor('[data-test-apply-all-code-patches-button]', {
      timeout: 4000,
    });
    click('[data-test-apply-all-code-patches-button]');
    await waitFor('.code-patch-actions [data-test-apply-state="applying"]');
    await waitFor('.code-patch-actions [data-test-apply-state="applied"]', {
      timeout: 3000,
      timeoutMessage:
        'timed out waiting for Accept All button to be in applied state',
    });
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

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      codePatchResultEvents.length,
      3,
      'code patch result events are dispatched',
    );
  });

  test('previously applied code patches show the correct applied state', async function (assert) {
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

    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: 'org.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      {
        msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
        'm.relates_to': {
          event_id: eventId,
          rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          key: 'applied',
        },
        codeBlockIndex: 1,
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
      },
    );

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    await waitUntil(() => findAll('[data-test-apply-state]').length === 4);
    assert
      .dom('[data-test-apply-state="applied"]')
      .exists({ count: 1 }, 'one patch is applied');
  });
});
