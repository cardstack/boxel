import { module, test, assert } from 'qunit';
import { constructHistory, HistoryConstructionError } from '../helpers';
import {
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import { EventStatus, type IRoomEvent } from 'matrix-js-sdk';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { FakeMatrixClient } from './helpers/fake-matrix-client';

module('constructHistory', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let originalFetch: any;
  let mockResponses: Map<string, { ok: boolean; text: string }>;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
    mockResponses = new Map();
    // Mock fetch
    originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string) => {
      const response = mockResponses.get(url);
      if (response) {
        return {
          ok: response.ok,
          status: response.ok ? 200 : 404,
          statusText: response.ok ? 'OK' : 'Not Found',
          text: async () => response.text,
        };
      }
      throw new Error(`No mock response for ${url}`);
    };
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
    // Restore the original fetch
    (globalThis as any).fetch = originalFetch;
    mockResponses.clear();
  });

  test('should return an empty array when the input array is empty', async () => {
    const history: DiscreteMatrixEvent[] = [];

    const result = await constructHistory(history, fakeMatrixClient);

    assert.deepEqual(result, []);
  });

  test('should return an empty array when the input array contains only non-message events', async () => {
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
        status: EventStatus.SENT,
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
        status: EventStatus.SENT,
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
        status: EventStatus.SENT,
      },
    ];

    const result = await constructHistory(history, fakeMatrixClient);

    assert.deepEqual(result, []);
  });

  test('should return an array with a single message event when the input array contains only one message event', async () => {
    const eventlist: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
        },
        sender: 'John',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
      },
    ];

    const result = await constructHistory(eventlist, fakeMatrixClient);

    // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
    assert.deepEqual(result, eventlist);
  });

  test('should return an array with all message events when the input array contains multiple message events', async () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        sender: 'sender1',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
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
        },
        room_id: 'room1',
        unsigned: {
          age: 1002,
          transaction_id: '3',
        },
      },
    ];

    const result = await constructHistory(history, fakeMatrixClient);

    // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
    assert.deepEqual(result, history);
  });

  test('should return an array with all message events when the input array contains multiple events with the same origin_server_ts', async () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        sender: '',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
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
        },
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '3',
        },
      },
    ];

    const result = await constructHistory(history, fakeMatrixClient);

    // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
    assert.deepEqual(result, history);
  });

  test('should return an array of DiscreteMatrixEvent objects with no duplicates based on event_id even when m.relates_to is present and include senders and origin_server_ts', async () => {
    const history: IRoomEvent[] = [
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

    const result = await constructHistory(history, fakeMatrixClient);

    assert.deepEqual(result, [
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
      {
        event_id: '2',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'hi',
        },
        sender: 'user2',
        origin_server_ts: 1629876543220,
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '2',
        },
      },
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
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
        },
        sender: 'user3',
        origin_server_ts: 1629876543240,
        room_id: 'room1',
        unsigned: {
          age: 1003,
          transaction_id: '4',
        },
      },
      // @ts-ignore Fix type related issues in ai bot after introducing linting (CS-8468)
      {
        event_id: '5',
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'aloha',
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

  test('should download the card content from url', async () => {
    // Set up the mock response for this test
    mockResponses.set('http://mock-server/Author/1', {
      ok: true,
      text: `{"data":{"type":"card","id":"http://localhost:4201/experiments/Author/1","attributes":{"firstName":"Terry","lastName":"Pratchett"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`,
    });

    const eventlist: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567920,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          data: JSON.stringify({
            context: {
              functions: [],
              openCardIds: ['http://localhost:4201/experiments/Author/1'],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://mock-server/Author/1',
                name: 'Author',
                contentType: 'text/plain',
              },
            ],
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

    const result = await constructHistory(eventlist, fakeMatrixClient);
    assert.deepEqual(result, [
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 1234567920,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          data: {
            context: {
              functions: [],
              openCardIds: ['http://localhost:4201/experiments/Author/1'],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://mock-server/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: `{"data":{"type":"card","id":"http://localhost:4201/experiments/Author/1","attributes":{"firstName":"Terry","lastName":"Pratchett"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`,
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
    ] as unknown as DiscreteMatrixEvent[]);
  });

  test('should download the COMMAND_RESULT card content from url', async () => {
    // Set up the mock response for this test
    let contentText = `{"data":{"type":"card","id":"http://localhost:4201/experiments/Author/1","attributes":{"firstName":"Terry","lastName":"Pratchett"},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}`;
    mockResponses.set('http://mock-server/Author/1', {
      ok: true,
      text: contentText,
    });

    const eventlist: IRoomEvent[] = [
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        room_id: 'room-id-1',
        sender: '@tintinthong:localhost',
        content: {
          'm.relates_to': {
            event_id: 'command-event-id-1',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
            key: 'applied',
          },
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: 'tool-call-id-1',
          data: JSON.stringify({
            card: {
              sourceUrl: 'http://localhost:4201/drafts/Author/1',
              url: 'http://mock-server/Author/1',
              contentType: 'text/plain',
              name: 'Author',
            },
          }),
        },
        origin_server_ts: 1722242853988,
        unsigned: {
          age: 44,
          transaction_id: 'm1722242836705.4',
        },
        event_id: 'command-result-id-1',
      },
    ];

    const result = await constructHistory(eventlist, fakeMatrixClient);
    assert.deepEqual(result, [
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        room_id: 'room-id-1',
        sender: '@tintinthong:localhost',
        content: {
          'm.relates_to': {
            event_id: 'command-event-id-1',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
            key: 'applied',
          },
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: 'tool-call-id-1',
          data: {
            card: {
              sourceUrl: 'http://localhost:4201/drafts/Author/1',
              url: 'http://mock-server/Author/1',
              contentType: 'text/plain',
              name: 'Author',
              content: contentText,
            },
          },
        },
        origin_server_ts: 1722242853988,
        unsigned: {
          age: 44,
          transaction_id: 'm1722242836705.4',
        },
        event_id: 'command-result-id-1',
      },
    ] as unknown as DiscreteMatrixEvent[]);
  });

  test('should handle fetch card content errors', async () => {
    // Set up a mock response that will fail
    mockResponses.set('http://mock-server/Author/2', {
      ok: false,
      text: 'Not Found',
    });

    const eventlist: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567930,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hello',
          data: JSON.stringify({
            context: {
              functions: [],
              openCardIds: ['http://localhost:4201/experiments/Author/2'],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/2',
                url: 'http://mock-server/Author/2',
                name: 'Author',
                contentType: 'text/plain',
              },
            ],
          }),
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '5',
        },
      },
    ];

    let response = await constructHistory(eventlist, fakeMatrixClient);
    assert.deepEqual(response, [
      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567930,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hello',
          data: {
            context: {
              functions: [],
              openCardIds: ['http://localhost:4201/experiments/Author/2'],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/2',
                url: 'http://mock-server/Author/2',
                name: 'Author',
                contentType: 'text/plain',
                error:
                  'Error loading attached card: Error: HTTP error. Status: 404',
              },
            ],
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '5',
        },
      },
    ] as unknown as DiscreteMatrixEvent[]);
  });

  test('handles invalid content data', async () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '5',
        origin_server_ts: 1234567930,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hello',
          data: 'not a JSON string',
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '5',
        },
      },
    ];

    try {
      await constructHistory(history, fakeMatrixClient);
      assert.ok(false, 'Expected an error');
    } catch (e) {
      assert.ok(e instanceof HistoryConstructionError);
    }
  });
});
