import { module, test, assert } from 'qunit';
import {
  getLatestResultMessage,
  setTitle,
  shouldSetRoomTitle,
} from '../lib/set-title';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { IEvent, IRoomEvent, IStateEvent } from 'matrix-js-sdk';
import { EventStatus, type MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import type OpenAI from 'openai';
import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';
import { constructHistory } from '@cardstack/runtime-common/ai';

module('shouldSetRoomTitle', () => {
  test('Do not set a title when there is no content', () => {
    const eventLog: DiscreteMatrixEvent[] = [];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there is little content', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there are more than 5 messages but they are state/invites/etc', () => {
    const eventLog: (IRoomEvent | IStateEvent)[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'conversation',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1001,
          transaction_id: '2',
        },
      },
      {
        type: 'm.room.create',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {
          creator: '@user:localhost',
          room_version: '1',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        state_key: '',
        unsigned: {
          age: 1000,
        },
      },
      {
        type: 'm.room.power_levels',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {},
        sender: '@user:localhost',
        room_id: 'room1',
        state_key: '',
        unsigned: {
          age: 1000,
        },
      },
      {
        type: 'm.room.member',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {
          membership: 'invite',
          displayname: 'user@localhost',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        state_key: '',
        unsigned: {
          age: 1000,
        },
      },
      {
        type: 'm.room.member',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {
          membership: 'join',
          displayname: 'user@localhost',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        state_key: '',
        unsigned: {
          age: 1000,
        },
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there are under 5 user messages but more than 5 total messages', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'conversation',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Response',
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '3',
        },
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Response',
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '4',
        },
      },

      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Response',
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '5',
        },
      },
      {
        type: 'm.room.message',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '6',
        },
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Set a title when there are 5 or more user messages', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'conversation',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Response',
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '3',
        },
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '4',
        },
      },

      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '5',
        },
      },
      {
        type: 'm.room.message',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '6',
        },
      },
    ];
    assert.true(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Title is not set if the bot has sent ONLY a command', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey please perform an action',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'patching card',
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              name: 'patchCardInstance',
              id: 'patchCardInstance-1',
              arguments:
                '{"attributes":{"cardId":"http://localhost:4201/experiments/Friend/1","patch":{"attributes":{"firstName":"Dave"}}}}',
            },
          ],
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Set a title if the user applied a command', () => {
    let patchCommandResultEvent: Partial<IEvent> = {
      type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      content: {
        'm.relates_to': {
          event_id: '1',
          key: 'applied',
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
      },
    };
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey please perform an action',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'patching card',
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              name: 'patchCardInstance',
              id: 'patchCardInstance-1',
              arguments:
                '{"attributes":{"cardId":"http://localhost:4201/drafts/Friend/1","patch":{"attributes":{"firstName":"Dave"}}}}',
            },
          ],
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
    ];
    assert.true(
      shouldSetRoomTitle(
        eventLog,
        '@aibot:localhost',
        new MatrixEvent(patchCommandResultEvent),
      ),
    );
  });

  test('Set a title if the user applied a code patch', () => {
    let codePatchResultEvent: Partial<IEvent> = {
      type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
      content: {
        'm.relates_to': {
          event_id: '2',
          key: 'applied',
          rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
        },
        msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
        codeBlockIndex: 0,
      },
    };
    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}\n\`\`\``;
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey please improve the code',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: `I will apply TypeScript best practices:\n${codeBlock}`,
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
    ];
    assert.true(
      shouldSetRoomTitle(
        eventLog,
        '@aibot:localhost',
        new MatrixEvent(codePatchResultEvent),
      ),
    );
  });
});

module('getLatestResultMessage', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
  });

  test('getLatestResultMessage correctly finds matching command request', async () => {
    const commandRequestId = 'test-command-request-id';
    const testEventId = 'test-event-id';

    // Create a sample event history with a command request
    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: testEventId,
        origin_server_ts: 1234567890,
        status: EventStatus.SENT,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Test command',
          data: {
            context: {
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: commandRequestId,
              name: 'testCommand',
              arguments: JSON.stringify({ test: 'data' }),
            },
            {
              id: 'other-id',
              name: 'otherCommand',
              arguments: JSON.stringify({ other: 'data' }),
            },
          ],
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];
    let history: DiscreteMatrixEvent[] = await constructHistory(
      eventList,
      fakeMatrixClient as unknown as MatrixClient,
    );

    // Create a command result event that references the command request
    const commandResultEvent = {
      getContent: () => ({
        'm.relates_to': {
          event_id: testEventId,
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: commandRequestId,
      }),
    } as unknown as MatrixEvent;

    // Call the function with our test data
    const result = getLatestResultMessage(
      history,
      '@aibot:localhost',
      commandResultEvent,
    );

    // Verify the function returns the expected message
    assert.equal(result.length, 1, 'Should return one message');
    assert.equal(result[0].role, 'user', 'Should have user role');
    assert.ok(
      result[0].content!.includes('Applying tool call testCommand with args'),
      `Should include command args info, was ${result[0].content}`,
    );
  });

  test('getLatestResultMessage handles missing command request', () => {
    // Create a sample event history with no matching command request
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: 'test-event-id',
        origin_server_ts: 1234567890,
        status: EventStatus.SENT,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Test command',
          data: {
            context: {
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'non-matching-id',
              name: 'testCommand',
              arguments: JSON.stringify({ test: 'data' }),
            },
          ],
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];

    // Create a command result event that references a non-existent command request
    const commandResultEvent = {
      getContent: () => ({
        'm.relates_to': {
          event_id: 'test-event-id',
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: 'missing-id', // ID that doesn't exist in the command requests
      }),
    } as unknown as MatrixEvent;

    // Call the function with our test data
    const result = getLatestResultMessage(
      history,
      '@aibot:localhost',
      commandResultEvent,
    );

    // Function should gracefully handle the missing command request and return an empty array
    assert.equal(
      result.length,
      0,
      'Should return empty array when command request is not found',
    );
  });

  test('getLatestResultMessage correctly finds command request when multiple requests exist', () => {
    const commandRequestId = 'second-command';
    const testEventId = 'test-event-id';

    // Create a sample event history with multiple command requests
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: testEventId,
        origin_server_ts: 1234567890,
        status: EventStatus.SENT,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Test command',
          data: {
            context: {
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'first-command',
              name: 'firstCommand',
              arguments: JSON.stringify({ first: 'data' }),
            },
            {
              id: commandRequestId,
              name: 'secondCommand',
              arguments: JSON.stringify({ second: 'data' }),
            },
            {
              id: 'third-command',
              name: 'thirdCommand',
              arguments: JSON.stringify({ third: 'data' }),
            },
          ],
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];

    // Create a command result event that references the second command request
    const commandResultEvent = {
      getContent: () => ({
        'm.relates_to': {
          event_id: testEventId,
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: commandRequestId,
      }),
    } as unknown as MatrixEvent;

    // Call the function with our test data
    const result = getLatestResultMessage(
      history,
      '@aibot:localhost',
      commandResultEvent,
    );

    // Verify the function returns the expected message based on the correct command
    assert.equal(result.length, 1, 'Should return one message');
    assert.ok(
      result[0].content!.includes('"second":"data"'),
      'Should include args from the second command request',
    );
    assert.notOk(
      result[0].content!.includes('"first":"data"'),
      'Should not include args from the first command request',
    );
  });
});

module('setTitle', () => {
  test('setTitle correctly processes command result events', async () => {
    // Mock OpenAI client
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'User Updated Card Details' } }],
          }),
        },
      },
    } as unknown as OpenAI;

    // Mock Matrix client
    const mockMatrixClient = {
      setRoomName: async (roomId: string, title: string) => {
        assert.equal(roomId, 'test-room-id', 'Room ID passed correctly');
        assert.equal(
          title,
          'User Updated Card Details',
          'Title correctly processed',
        );
        return { event_id: 'new-event-id' };
      },
    } as unknown as MatrixClient;

    const commandRequestId = 'test-command-id';
    const testEventId = 'command-source-event-id';

    // Create history with command request event
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: testEventId,
        origin_server_ts: 1234567890,
        status: EventStatus.SENT,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Update card details',
          data: {
            context: {
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: commandRequestId,
              name: 'patchCardInstance',
              arguments: JSON.stringify({
                description: 'Update card details',
                attributes: {
                  cardId: 'card-123',
                  patch: { attributes: { title: 'New Title' } },
                },
              }),
            },
          ],
        },
        sender: '@user:localhost',
        room_id: 'test-room-id',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: 'user-message-id',
        origin_server_ts: 1234567880,
        status: EventStatus.SENT,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Please update my card title',
          data: {
            context: {
              functions: [],
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'test-room-id',
        unsigned: {
          age: 1010,
          transaction_id: '0',
        },
      },
    ];

    // Create command result event
    const commandResultEvent = {
      getContent: () => ({
        'm.relates_to': {
          event_id: testEventId,
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: commandRequestId,
      }),
    } as unknown as MatrixEvent;

    // Call setTitle with our test data
    await setTitle(
      mockOpenAI,
      mockMatrixClient,
      'test-room-id',
      history,
      '@aibot:localhost',
      commandResultEvent,
    );
    // The assertions are inside the mock matrixClient.setRoomName function
  });
});
