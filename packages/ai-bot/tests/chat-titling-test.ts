import { module, test, assert } from 'qunit';
import { shouldSetRoomTitle } from '../helpers';
import { IRoomEvent } from 'matrix-js-sdk';

module('shouldSetRoomTitle', () => {
  test('Do not set a title when there is no content', () => {
    const eventLog: IRoomEvent[] = [];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there is little content', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
    ];
    assert.false(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Do not set a title when there are more than 5 messages but they are state/invites/etc', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          body: 'conversation',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.create',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {},
        sender: '@user:localhost',
      },
      {
        type: 'm.room.power_levels',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {},
        sender: '@user:localhost',
      },
      {
        type: 'm.room.invite',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {},
        sender: '@user:localhost',
      },
      {
        type: 'm.room.member',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {},
        sender: '@user:localhost',
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
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          body: 'conversation',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {
          body: 'Response',
        },
        sender: '@aibot:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {
          body: 'Response',
        },
        sender: '@aibot:localhost',
      },

      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {
          body: 'Response',
        },
        sender: '@aibot:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
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
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          body: 'conversation',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {
          body: 'Response',
        },
        sender: '@aibot:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },

      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '6',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
    ];
    assert.true(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });

  test('Set a title if the bot has sent a command', () => {
    const eventLog: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey please perform an action',
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          body: 'patch',
          msgtype: 'org.boxel.command',
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
        sender: '@aibot:localhost',
      },
    ];
    assert.true(shouldSetRoomTitle(eventLog, '@aibot:localhost'));
  });
});
