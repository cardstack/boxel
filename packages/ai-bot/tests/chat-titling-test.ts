import { module, test, assert } from 'qunit';
import { shouldSetRoomTitle } from '../helpers';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';

module('shouldSetRoomTitle', () => {
  test('Do not set a title when there is no content', () => {
    const eventLog: DiscreteMatrixEvent[] = [];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there is little content', () => {
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'conversation',
          formatted_body: 'conversation',
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
        state_key: 'a',
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
        state_key: 'b',
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
        state_key: 'c',
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
        state_key: 'd',
        unsigned: {
          age: 1000,
        },
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there are under 5 user messages but more than 5 total messages', () => {
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'conversation',
          formatted_body: 'conversation',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Response',
          formatted_body: 'Response',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Response',
          formatted_body: 'Response',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Response',
          formatted_body: 'Response',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'conversation',
          formatted_body: 'conversation',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Response',
          formatted_body: 'Response',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
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

  test('Set a title if the bot has sent a command', () => {
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey please perform an action',
          formatted_body: 'Hey please perform an action',
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
          msgtype: 'org.boxel.command',
          format: 'org.matrix.custom.html',
          body: 'patch',
          formatted_body: 'patch',
          data: {
            command: {
              type: 'patch',
              id: 'http://localhost:4201/drafts/Friend/1',
              patch: {
                attributes: {
                  firstName: 'Dave',
                },
              },
            },
          },
        },
        sender: '@aibot:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
    ];
    assert.true(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Set a title if the bot has sent a command in the last event, not seen in the log', () => {
    const eventLog: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey please perform an action',
          formatted_body: 'Hey please perform an action',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];
    assert.true(shouldSetRoomTitle(eventLog, '@aibot:localhost', 1));
  });
});
