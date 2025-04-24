import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import UseAiAssistantCommand from '@cardstack/host/commands/ai-assistant';
import OpenAiAssistantRoomCommand from '@cardstack/host/commands/open-ai-assistant-room';
import type CommandService from '@cardstack/host/services/command-service';
import RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader, commandService: CommandService;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | ai-assistant', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let { createAndJoinRoom, getRoomEvents, getRoomState, getRoomIds } =
    mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = lookupLoaderService().loader;
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'empty1.json': {
          data: {
            attributes: {
              title: 'Empty Card 1',
              description: 'This is an empty card.',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'empty2.json': {
          data: {
            attributes: {
              title: 'Empty Card 2',
              description: 'This is an empty card.',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'file1.gts': 'This is file 1 content',
        'file2.gts': 'This is file 2 content',
        'skill1.json': {
          data: {
            type: 'card',
            attributes: {
              instructions: 'Here is the one thing you need to know.',
              commands: [],
              title: 'Skill1',
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
        'skill2.json': {
          data: {
            type: 'card',
            attributes: {
              instructions: 'Here is the two thing you need to know.',
              commands: [],
              title: 'Skill2',
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
      },
    });
    commandService = lookupService<CommandService>('command-service');
  });

  test('creates a new room when no roomId is provided', async function (assert) {
    let initialRoomCount = Object.keys(getRoomIds()).length;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    let result = await aiAssistantCommand.execute({
      prompt: 'Hello, new room!',
      roomName: 'My Test Room',
    });

    // Check that a new room was created
    let currentRoomIds = getRoomIds();
    let currentRoomCount = currentRoomIds.length;
    assert.strictEqual(
      currentRoomCount,
      initialRoomCount + 1,
      'A new room should be created',
    );

    let nameState = getRoomState(result.roomId, 'm.room.name', '');
    assert.strictEqual(
      nameState.name,
      'My Test Room',
      'Room should have the expected name',
    );

    // Check that a message was sent to the new room
    let messages = getRoomEvents(result.roomId);
    assert.ok(messages.length > 0, 'Message should be sent to new room');
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessage = lastMessage.content.body;
    assert.strictEqual(boxelMessage, 'Hello, new room!');
  });

  test('uses existing room when roomId is provided', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'existing-room-test',
    });

    let initialMessageCount = getRoomEvents(roomId).length;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello, existing room!',
      roomId,
    });

    // Check that a message was sent to the existing room
    let messages = getRoomEvents(roomId);
    assert.strictEqual(
      messages.length,
      initialMessageCount + 1,
      'One new message should be sent',
    );

    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessage = lastMessage.content.body;
    assert.strictEqual(boxelMessage, 'Hello, existing room!');
  });

  test('handles attached cards', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-attached-cards',
    });

    let store = lookupService<StoreService>('store');

    // Attach simple cards
    const card1 = (await store.get(`${testRealmURL}empty1.json`)) as CardDef;
    const card2 = (await store.get(`${testRealmURL}empty2.json`)) as CardDef;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with attached cards!',
      roomId,
      attachedCards: [card1, card2],
    });

    // Check that message with attachments was sent
    let messages = getRoomEvents(roomId);
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessage = lastMessage.content.body;
    assert.strictEqual(boxelMessage, 'Hello with attached cards!');

    let boxelMessageData = JSON.parse(lastMessage.content.data);
    assert.strictEqual(
      boxelMessageData.attachedCards.length,
      2,
      'Two attached cards should be present',
    );
  });

  test('handles "new" as roomId to create new room', async function (assert) {
    let initialRoomCount = Object.keys(getRoomIds()).length;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    let result = await aiAssistantCommand.execute({
      prompt: 'Hello, new room with "new"!',
      roomId: 'new',
    });

    // Check that a new room was created
    let currentRoomIds = getRoomIds();
    let currentRoomCount = currentRoomIds.length;
    assert.strictEqual(
      currentRoomCount,
      initialRoomCount + 1,
      'A new room should be created',
    );

    // Check that a message was sent to the new room
    let messages = getRoomEvents(result.roomId);
    assert.ok(messages.length > 0, 'Message should be sent to new room');
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessage = lastMessage.content.body;
    assert.strictEqual(
      boxelMessage,
      'Hello, new room with "new"!',
      'Message should be sent to the new room',
    );
  });

  test('handles clientGeneratedId', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-client-id',
    });

    let initialMessageCount = getRoomEvents(roomId).length;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );

    let clientGeneratedId = 'unique-client-id-123';
    await aiAssistantCommand.execute({
      prompt: 'Hello with clientGeneratedId!',
      roomId,
      clientGeneratedId,
    });

    // Check that a message was sent to the room
    let messages = getRoomEvents(roomId);
    assert.strictEqual(
      messages.length,
      initialMessageCount + 1,
      'One new message should be sent',
    );

    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    assert.strictEqual(
      lastMessage.content.body,
      'Hello with clientGeneratedId!',
      'Message should match the prompt',
    );

    // Verify the clientGeneratedId is present in the message
    assert.strictEqual(
      lastMessage.content.clientGeneratedId,
      clientGeneratedId,
      'Message should include the clientGeneratedId',
    );
  });

  test('sets active LLM model when llmModel is provided', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-llm-model',
    });

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with custom LLM!',
      roomId,
      llmModel: 'gpt-4',
    });

    // Check that the LLM model was set in room state
    let llmState = getRoomState(roomId, APP_BOXEL_ACTIVE_LLM, '');
    assert.ok(llmState, 'LLM state should be present in room');
    assert.strictEqual(
      llmState.model,
      'gpt-4',
      'LLM model should be set to gpt-4',
    );
  });

  test('adds skill cards to room', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-skills',
    });

    let store = lookupService<StoreService>('store');

    // Load skill cards
    const skillCard1 = (await store.get(
      `${testRealmURL}skill1.json`,
    )) as SkillCard;
    const skillCard2 = (await store.get(
      `${testRealmURL}skill2.json`,
    )) as SkillCard;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with skill cards!',
      roomId,
      skillCards: [skillCard1, skillCard2],
    });

    // Check that skills were added to room
    let skillsState = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
    );
    assert.ok(skillsState, 'Skills state should be present in room');
    assert.strictEqual(
      skillsState.enabledSkillCards.length,
      2,
      'At least two skills should be added to room',
    );
  });

  test('loads skill cards by ID', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-skill-ids',
    });

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with skill card IDs!',
      roomId,
      skillCardIds: [`${testRealmURL}skill1`, `${testRealmURL}skill2`],
    });

    // Check that skills were added to room
    let skillsState = getRoomState(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
    );
    assert.ok(skillsState, 'Skills state should be present in room');
    assert.strictEqual(
      skillsState.enabledSkillCards.length,
      2,
      'At least two skills should be added to room',
    );
  });

  test('loads attached cards by ID', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-attached-card-ids',
    });

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with attached card IDs!',
      roomId,
      attachedCardIds: [
        `${testRealmURL}empty1.json`,
        `${testRealmURL}empty2.json`,
      ],
    });

    // Check that message with attachments was sent
    let messages = getRoomEvents(roomId);
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessageData = JSON.parse(lastMessage.content.data);
    assert.strictEqual(
      boxelMessageData.attachedCards.length,
      2,
      'Two attached cards should be present',
    );
  });

  test('opens the room when openRoom is true', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-to-open',
    });

    // Spy on OpenAiAssistantRoomCommand execution
    let openRoomExecuted = false;
    let originalOpenFunction = OpenAiAssistantRoomCommand.prototype.execute;

    try {
      // @ts-expect-error abusing JS to test this
      OpenAiAssistantRoomCommand.prototype.execute = async function (input) {
        openRoomExecuted = true;
        assert.strictEqual(input.roomId, roomId, 'Room ID should match');
      };

      let aiAssistantCommand = new UseAiAssistantCommand(
        commandService.commandContext,
      );
      await aiAssistantCommand.execute({
        prompt: 'Hello, open this room!',
        roomId,
        openRoom: true,
      });

      assert.true(
        openRoomExecuted,
        'OpenAiAssistantRoomCommand should be executed',
      );
    } finally {
      OpenAiAssistantRoomCommand.prototype.execute = originalOpenFunction;
    }
  });

  test('sends message with attachedFileURLs', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-attached-files',
    });

    const fileURLs = [`${testRealmURL}file1.gts`, `${testRealmURL}file2.gts`];

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with attached files!',
      roomId,
      attachedFileURLs: fileURLs,
    });

    // Check that message with file URLs was sent
    let messages = getRoomEvents(roomId);
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessageData = JSON.parse(lastMessage.content.data);
    assert.deepEqual(
      boxelMessageData.attachedFiles.map((file: any) => file.sourceUrl),
      fileURLs,
      'File URLs should be included in message',
    );
  });

  test('sends message with openCardIds', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-with-open-cards',
    });

    const openCardIds = [`${testRealmURL}empty1`, `${testRealmURL}empty2`];

    let store = lookupService<StoreService>('store');

    // Attach simple cards
    const card1 = (await store.get(`${testRealmURL}empty1.json`)) as CardDef;
    const card2 = (await store.get(`${testRealmURL}empty2.json`)) as CardDef;

    let aiAssistantCommand = new UseAiAssistantCommand(
      commandService.commandContext,
    );
    await aiAssistantCommand.execute({
      prompt: 'Hello with open cards!',
      roomId,
      attachedCards: [card1, card2],
      openCardIds,
    });

    // Check that message with open card IDs was sent
    let messages = getRoomEvents(roomId);
    let lastMessage = messages[messages.length - 1];
    assert.strictEqual(lastMessage.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);

    let boxelMessageData = JSON.parse(lastMessage.content.data);
    assert.deepEqual(
      boxelMessageData.context.openCardIds,
      openCardIds,
      'Open card IDs should be included in message',
    );
  });
});
