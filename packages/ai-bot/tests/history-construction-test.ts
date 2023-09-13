import { module, test, assert } from 'qunit';
import { constructHistory } from '../helpers';
import { IRoomEvent } from 'matrix-js-sdk';

module('constructHistory', () => {
  test('should return an empty array when the input array is empty', () => {
    const history: IRoomEvent[] = [];

    const result = constructHistory(history);

    assert.deepEqual(result, []);
  });

  test('should return an empty array when the input array contains only non-message events', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.create',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {},
        sender: 'user1',
      },
      {
        type: 'm.room.join_rules',
        event_id: '2',
        origin_server_ts: 1234567891,
        content: {},
        sender: 'user2',
      },
      {
        type: 'm.room.member',
        event_id: '3',
        origin_server_ts: 1234567892,
        content: {},
        sender: 'user3',
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, []);
  });

  test('should return an array with a single message event when the input array contains only one message event', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {},
        sender: 'John',
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array with all message events when the input array contains multiple message events', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {},
        sender: 'sender1',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567891,
        content: {},
        sender: 'sender2',
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567892,
        content: {},
        sender: 'sender3',
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array with all message events when the input array contains multiple events with the same origin_server_ts', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {},
        sender: '',
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {},
        sender: '',
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567890,
        content: {},
        sender: '',
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array of IRoomEvent objects with no duplicates based on event_id even when m.relates_to is present and include senders and origin_server_ts', () => {
    const history: IRoomEvent[] = [
      {
        event_id: '1',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '2',
          },
        },
        sender: 'user1',
        origin_server_ts: 1629876543210,
      },
      {
        event_id: '2',
        type: 'm.room.message',
        content: {},
        sender: 'user2',
        origin_server_ts: 1629876543220,
      },
      {
        event_id: '3',
        type: 'm.room.message',
        content: {},
        sender: 'user3',
        origin_server_ts: 1629876543230,
      },
      {
        event_id: '4',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '3',
          },
        },
        sender: 'user3',
        origin_server_ts: 1629876543240,
      },
      {
        event_id: '5',
        type: 'm.room.message',
        content: {},
        sender: 'user5',
        origin_server_ts: 1629876543250,
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, [
      {
        event_id: '2',
        type: 'm.room.message',
        content: {},
        sender: 'user2',
        origin_server_ts: 1629876543220,
      },
      {
        event_id: '3',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '3',
          },
        },
        sender: 'user3',
        origin_server_ts: 1629876543240,
      },
      {
        event_id: '5',
        type: 'm.room.message',
        content: {},
        sender: 'user5',
        origin_server_ts: 1629876543250,
      },
    ]);
  });
});
