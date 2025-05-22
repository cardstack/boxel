import { test } from 'qunit';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import { getRoomEvents } from '../lib/matrix/util';
import { Method } from 'matrix-js-sdk';

/**
 * Creates a mocked Matrix client that returns the specified events
 * @param mockEvents - Array of events to return in response
 * @returns A configured FakeMatrixClient
 */
function createMockedClient(mockEvents: any[] = []) {
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
    { event_id: 'event1', content: { body: 'message 1' } },
    { event_id: 'event2', content: { body: 'message 2' } },
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
    { event_id: 'event1', content: { body: 'message 1' } },
    { event_id: 'event2', content: { body: 'message 2' } },
    { event_id: 'event3', content: { body: 'message 3' } },
  ];

  // Create fake client with mocked HTTP response
  const client = createMockedClient(mockEvents);

  // Test function with lastEventId of 'event2'
  const result = await getRoomEvents('room123', client, 'event2');

  // Assertions
  assert.deepEqual(
    result,
    [
      { event_id: 'event1', content: { body: 'message 1' } },
      { event_id: 'event2', content: { body: 'message 2' } },
    ],
    'Returns events up to and including lastEventId',
  );
});

test('getRoomEvents - returns all events when lastEventId is not found', async function (assert) {
  // Setup mock events
  const mockEvents = [
    { event_id: 'event1', content: { body: 'message 1' } },
    { event_id: 'event2', content: { body: 'message 2' } },
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

test('getRoomEvents - verifies correct request parameters', async function (assert) {
  // Setup to capture the request parameters
  let capturedMethod: Method | null = null;
  let capturedPath: string | null = null;
  let capturedParams: any = null;

  // Create fake client with custom authedRequest implementation
  const client = new FakeMatrixClient();
  client.http = {
    authedRequest: async (method: Method, path: string, queryParams: any) => {
      capturedMethod = method;
      capturedPath = path;
      capturedParams = queryParams;
      return { chunk: [] };
    },
  } as any;

  // Call function
  await getRoomEvents('test-room-id', client);

  // Assertions
  assert.equal(capturedMethod, Method.Get, 'Uses GET method');
  assert.equal(
    capturedPath,
    '/rooms/test-room-id/messages',
    'Constructs correct path',
  );
  assert.equal(capturedParams.dir, 'f', 'Uses forward direction');
  assert.equal(capturedParams.limit, '1000', 'Limits to 1000 events');
  assert.ok(
    capturedParams.filter.includes('m.replace'),
    'Filter includes replace relation type',
  );
});

test('getRoomEvents - handles empty response', async function (assert) {
  // Create fake client with empty response
  const client = createMockedClient([]);

  const result = await getRoomEvents('room123', client);

  assert.deepEqual(result, [], 'Returns empty array when no events are found');
});
