import { module, test, assert } from 'qunit';
import { constructHistory, HistoryConstructionError } from '../helpers';
import { type IRoomEvent } from 'matrix-js-sdk';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

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
        origin_server_ts: 1234567900,
        content: {
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          formatted_body: '',
          body: '',
          data: JSON.stringify({
            cardFragment: `ry","lastName":"Pratchett"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`,
            index: 1,
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
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          formatted_body: '',
          body: '',
          data: JSON.stringify({
            cardFragment: `{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Ter`,
            index: 0,
            nextFragment: '1',
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
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
            },
            attachedCardsEventIds: ['2', '3'],
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
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
            },
            attachedCardsEventIds: ['2', '3'],
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

  test('handles invalid fragments', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        room_id: 'room1',
        sender: '@user:localhost',
        content: {
          msgtype: 'org.boxel.cardFragment',
          format: 'org.boxel.card',
          body: 'card fragment 1 of 1',
          formatted_body: 'card fragment 1 of 1',
          // data should be a JSON string
          data: {
            cardFragment:
              '{"data":{"type":"card","id":"https://cardstack.com/base/SkillCard/card-editing","attributes":{"instructions":"- If the user wants the data they see edited, AND the patchCard function is available, you MUST use the \\"patchCard\\" function to make the change.\\n- If the user wants the data they see edited, AND the patchCard function is NOT available, you MUST ask the user to open the card and share it with you.\\n- If you do not call patchCard, the user will not see the change.\\n- You can ONLY modify cards shared with you. If there is no patchCard function or tool, then the user hasn\'t given you access.\\n- NEVER tell the user to use patchCard; you should always do it for them.","title":"Card Editing","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../skill-card","name":"SkillCard"}}}}',
            index: 0,
            totalParts: 1,
          },
        },
        origin_server_ts: 1722374047192,
        unsigned: {
          age: 81929388,
        },
        event_id: '$Kho0bl1orsUHUMo8XGcu8KzEH5mrtDmFOVO68ofsswc',
        age: 81929388,
      },
    ];

    try {
      constructHistory(history);
      assert.ok(false, 'Expected an error');
    } catch (e) {
      assert.ok(e instanceof HistoryConstructionError);
    }
  });
});
