import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';
import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type CommandService from '@cardstack/host/services/command-service';

import RealmService from '@cardstack/host/services/realm';

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

let loader: Loader;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | send-ai-assistant-message', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom, getRoomEvents } = mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = lookupLoaderService().loader;
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {},
    });
  });

  test('send an ai assistant message', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = lookupService<CommandService>('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 0);
  });

  test('send an ai assistant message with command call, not required to be called', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = lookupService<CommandService>('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    let command = new SwitchSubmodeCommand(commandService.commandContext);
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
      commands: [{ command, autoExecute: false }],
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.true(toolName.startsWith('SwitchSubmode'));
    assert.strictEqual(boxelMessageData.context.requireToolCall, false);
  });

  test('send an ai assistant message with command call, explicitly not required to be called', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = lookupService<CommandService>('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    let command = new SwitchSubmodeCommand(commandService.commandContext);
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
      commands: [{ command, autoExecute: false }],
      requireCommandCall: false,
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.true(toolName.startsWith('SwitchSubmode'));
    assert.strictEqual(boxelMessageData.context.requireToolCall, false);
  });

  test('send an ai assistant message with command call, explicitly required to be called', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = lookupService<CommandService>('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    let command = new SwitchSubmodeCommand(commandService.commandContext);
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
      commands: [{ command, autoExecute: false }],
      requireCommandCall: true,
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 1);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.true(toolName.startsWith('SwitchSubmode'));
    assert.strictEqual(boxelMessageData.context.requireToolCall, true);
  });

  test('multiple commands are allowed if not required to be called', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = lookupService<CommandService>('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    let command1 = new SwitchSubmodeCommand(commandService.commandContext);
    let command2 = new SwitchSubmodeCommand(commandService.commandContext);
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
      commands: [
        { command: command1, autoExecute: false },
        { command: command2, autoExecute: false },
      ],
      requireCommandCall: false,
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 2);
    assert.strictEqual(boxelMessageData.context.tools[0].type, 'function');
    let toolName = boxelMessageData.context.tools[0].function.name;
    assert.true(toolName.startsWith('SwitchSubmode'));
    assert.strictEqual(boxelMessageData.context.requireToolCall, false);
  });
});
