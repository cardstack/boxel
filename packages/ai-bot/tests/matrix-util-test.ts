import { test } from 'qunit';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import { getRoomEvents } from '../lib/matrix/util';
import { Method } from 'matrix-js-sdk';
import type {
  CardMessageEvent,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/matrix-event';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

/**
 * Creates a mock Matrix event with all required properties
 * @param id - Event ID
 * @param body - Message body content
 * @param roomId - Room ID where event occurred
 * @returns A properly typed MatrixEvent object
 */
function createMockEvent(
  id: string,
  body: string,
  roomId = 'test-room-id',
): CardMessageEvent {
  return {
    event_id: id,
    content: {
      body,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      data: {},
    },
    type: 'm.room.message',
    sender: '@test-user:matrix.org',
    origin_server_ts: 102030,
    room_id: roomId,
    unsigned: { age: 1000, transaction_id: '123' },
    status: null,
  };
}

/**
 * Creates a mocked Matrix client that returns the specified events
 * @param mockEvents - Array of events to return in response
 * @returns A configured FakeMatrixClient
 */
function createMockedClient(mockEvents: DiscreteMatrixEvent[] = []) {
  const client = new FakeMatrixClient();
  client.http = {
    authedRequest: async (
      _method: Method,
      _path: string,
      _queryParams: any,
    ) => {
      return { chunk: mockEvents };
    },
  } as any;
  return client;
}

test('getRoomEvents - returns all events when no lastEventId provided', async function (assert) {
  // Setup mock events
  const mockEvents = [
    createMockEvent('event1', 'message 1'),
    createMockEvent('event2', 'message 2'),
  ];

  // Create fake client with mocked HTTP response
  const client = createMockedClient(mockEvents);

  // Test function
  const result = await getRoomEvents('room123', client);

  // Assertions
  assert.deepEqual(
    result,
    mockEvents,
    'Returns all events when no lastEventId provided',
  );
});

test('getRoomEvents - returns events up to and including lastEventId', async function (assert) {
  // Setup mock events
  const mockEvents = [
    createMockEvent('event1', 'message 1'),
    createMockEvent('event2', 'message 2'),
    createMockEvent('event3', 'message 3'),
  ];

  // Create fake client with mocked HTTP response
  const client = createMockedClient(mockEvents);

  // Test function with lastEventId of 'event2'
  const result = await getRoomEvents('room123', client, 'event2');

  // Assertions
  assert.deepEqual(
    result,
    [
      createMockEvent('event1', 'message 1'),
      createMockEvent('event2', 'message 2'),
    ],
    'Returns events up to and including lastEventId',
  );
});

test('getRoomEvents - returns all events when lastEventId is not found', async function (assert) {
  // Setup mock events
  const mockEvents = [
    createMockEvent('event1', 'message 1'),
    createMockEvent('event2', 'message 2'),
  ];

  // Create fake client with mocked HTTP response
  const client = createMockedClient(mockEvents);

  // Test function with non-existent lastEventId
  const result = await getRoomEvents('room123', client, 'non-existent-id');

  // Assertions
  assert.deepEqual(
    result,
    mockEvents,
    'Returns all events when lastEventId is not found',
  );
});

test('getRoomEvents - handles empty response', async function (assert) {
  // Create fake client with empty response
  const client = createMockedClient([]);

  const result = await getRoomEvents('room123', client);

  assert.deepEqual(result, [], 'Returns empty array when no events are found');
});
