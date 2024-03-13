import { module, test, assert } from 'qunit';
import { constructHistory } from '../helpers';
import { type IRoomEvent } from 'matrix-js-sdk';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';

module('constructHistory', () => {
  test('should return an empty array when the input array is empty', () => {
    const history: DiscreteMatrixEvent[] = [];

    const result = constructHistory(history);

    assert.deepEqual(result, []);
  });

  test('should return an empty array when the input array contains only non-message events', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.create',
        event_id: '1',
        room_id: 'room1',
        origin_server_ts: 1234567890,
        state_key: 'a',
        content: {
          creator: 'user1',
          room_version: 'abc',
        },
        sender: 'user1',
        unsigned: {
          age: 1000,
        },
      },
      {
        type: 'm.room.join_rules',
        event_id: '2',
        room_id: 'room1',
        state_key: 'b',
        origin_server_ts: 1234567891,
        content: {},
        sender: 'user2',
        unsigned: {
          age: 1001,
        },
      },
      {
        type: 'm.room.member',
        event_id: '3',
        room_id: 'room1',
        state_key: 'c',
        origin_server_ts: 1234567892,
        content: {
          membership: 'invite',
          displayname: 'mary',
        },
        sender: 'user3',
        unsigned: {
          age: 1002,
        },
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, []);
  });

  test('should return an array with a single message event when the input array contains only one message event', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
        sender: 'John',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array with all message events when the input array contains multiple message events', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        sender: 'sender1',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567891,
        sender: 'sender2',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'yo',
          formatted_body: 'yo',
        },
        room_id: 'room1',
        unsigned: {
          age: 1001,
          transaction_id: '2',
        },
      },
      {
        type: 'm.room.message',
        event_id: '3',
        origin_server_ts: 1234567892,
        sender: 'sender3',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hola',
          formatted_body: 'hola',
        },
        room_id: 'room1',
        unsigned: {
          age: 1002,
          transaction_id: '3',
        },
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array with all message events when the input array contains multiple events with the same origin_server_ts', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        sender: '',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
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
        sender: '',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hola',
          formatted_body: 'hola',
        },
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
        sender: '',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'yo',
          formatted_body: 'yo',
        },
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '3',
        },
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, history);
  });

  test('should return an array of DiscreteMatrixEvent objects with no duplicates based on event_id even when m.relates_to is present and include senders and origin_server_ts', () => {
    const history: DiscreteMatrixEvent[] = [
      // this event will _not_ replace event_id 2 since it's timestamp is before event_id 2
      {
        event_id: '1',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '2',
          },
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'yo',
          formatted_body: 'yo',
        },
        sender: 'user1',
        origin_server_ts: 1629876543210,
        room_id: 'room1',
        unsigned: {
          age: 1001,
          transaction_id: '1',
        },
      },
      {
        event_id: '2',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
        sender: 'user2',
        origin_server_ts: 1629876543220,
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
      {
        event_id: '3',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
        sender: 'user3',
        origin_server_ts: 1629876543230,
        room_id: 'room1',
        unsigned: {
          age: 1002,
          transaction_id: '3',
        },
      },
      // this event _will_ replace event_id 3 since it's timestamp is after event_id 3
      {
        event_id: '4',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '3',
          },
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hola',
          formatted_body: 'hola',
        },
        sender: 'user3',
        origin_server_ts: 1629876543240,
        room_id: 'room1',
        unsigned: {
          age: 1003,
          transaction_id: '4',
        },
      },
      {
        event_id: '5',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'aloha',
          formatted_body: 'aloha',
        },
        sender: 'user5',
        origin_server_ts: 1629876543250,
        room_id: 'room1',
        unsigned: {
          age: 1004,
          transaction_id: '5',
        },
      },
    ];

    const result = constructHistory(history);

    assert.deepEqual(result, [
      {
        event_id: '2',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
          formatted_body: 'hi',
        },
        sender: 'user2',
        origin_server_ts: 1629876543220,
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
      {
        event_id: '3',
        type: 'm.room.message',
        content: {
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '3',
          },
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hola',
          formatted_body: 'hola',
        },
        sender: 'user3',
        origin_server_ts: 1629876543240,
        room_id: 'room1',
        unsigned: {
          age: 1003,
          transaction_id: '4',
        },
      },
      {
        event_id: '5',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'aloha',
          formatted_body: 'aloha',
        },
        sender: 'user5',
        origin_server_ts: 1629876543250,
        room_id: 'room1',
        unsigned: {
          age: 1004,
          transaction_id: '5',
        },
      },
    ]);
  });

  test('should reassemble card fragments', () => {
    // we can't use the DiscreteMatrixEvent type here because we need to start
    // from the wire-format which serializes the data.content to a string for
    // safe transport over the wire
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          formatted_body: '',
          body: '',
          data: JSON.stringify({
            cardFragment: `{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Ter`,
            index: 0,
            totalParts: 2,
          }),
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
        origin_server_ts: 1234567900,
        content: {
          'm.relates_to': {
            rel_type: 'append',
            event_id: '1',
          },
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          formatted_body: '',
          body: '',
          data: JSON.stringify({
            firstFragment: '1',
            cardFragment: `ry","lastName":"Pratchett"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`,
            index: 1,
            totalParts: 2,
          }),
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
        origin_server_ts: 1234567910,
        content: {
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          formatted_body: '',
          body: '',
          data: JSON.stringify({
            cardFragment: `{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Mango","lastName":"Abdel-Rahman"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`,
            index: 1,
            totalParts: 1,
          }),
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '3',
        },
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567920,
        content: {
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: JSON.stringify({
            context: {
              functions: [],
            },
            attachedCardsTxnIds: ['1'],
          }),
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '4',
        },
      },
    ];

    const result = constructHistory(history);
    assert.deepEqual(result, [
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567920,
        content: {
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            context: {
              functions: [],
              openCards: [
                {
                  data: {
                    type: 'card',
                    id: 'http://localhost:4201/drafts/Author/1',
                    attributes: {
                      firstName: 'Mango',
                      lastName: 'Abdel-Rahman',
                    },
                    meta: {
                      adoptsFrom: {
                        module: '../author',
                        name: 'Author',
                      },
                    },
                  },
                },
              ],
            },
            attachedCardsTxnIds: ['1'],
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/drafts/Author/1',
                  attributes: {
                    firstName: 'Terry',
                    lastName: 'Pratchett',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../author',
                      name: 'Author',
                    },
                  },
                },
              },
            ],
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '4',
        },
      },
    ]);
  });
});
