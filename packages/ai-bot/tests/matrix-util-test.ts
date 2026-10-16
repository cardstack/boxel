import QUnit from 'qunit';
const { test } = QUnit;
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';
import type { Method } from 'matrix-js-sdk';
import type {
  CardMessageEvent,
  MatrixEvent as DiscreteMatrixEvent,
} from '@cardstack/base/matrix-event';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common';
import {
  getRoomEvents,
  ROOM_EVENTS_MAX_PAGES,
  ROOM_EVENTS_PAGE_SIZE,
  sendErrorEvent,
} from '@cardstack/runtime-common/ai';
import { OpenAIError } from 'openai/error';

const AI_BOT_USER_ID = '@aibot:localhost';

/**
 * Creates a mock Matrix message event. Events are numbered in the order
 * the room received them, which also sets their timestamp.
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

function createRoomTimeline(length: number): DiscreteMatrixEvent[] {
  return Array.from({ length }, (_, i) => ({
    ...createMockEvent(`event${i}`, `message ${i}`),
    origin_server_ts: i,
  }));
}

function stateEvent(
  id: string,
  type: string,
  content: Record<string, unknown> = {},
) {
  return {
    event_id: id,
    type,
    sender: '@test-user:matrix.org',
    content,
    state_key: '',
    room_id: 'test-room-id',
  } as unknown as DiscreteMatrixEvent;
}

function compactionEvent(id: string, upToEventId: string) {
  return {
    event_id: id,
    type: APP_BOXEL_COMPACTION_EVENT_TYPE,
    sender: AI_BOT_USER_ID,
    content: { status: 'done', upToEventId, summary: 'summary' },
    room_id: 'test-room-id',
  } as unknown as DiscreteMatrixEvent;
}

// Puts `event` at `index` in the timeline, in place of the message there.
function placeAt(
  timeline: DiscreteMatrixEvent[],
  index: number,
  event: DiscreteMatrixEvent,
) {
  timeline[index] = { ...event, origin_server_ts: index };
}

interface MessagesRequest {
  dir: string;
  limit: string;
  from?: string;
  filter: { types?: string[] };
}

/**
 * A Matrix client whose /messages pages a fixed timeline (oldest first) the
 * way Synapse does: `dir: 'b'` from the live end or from an `end` token,
 * `types` filtered before `limit` applies, and `end` left out only when a
 * page is empty.
 */
function createMockedClient(timeline: DiscreteMatrixEvent[] = []) {
  const client = new FakeMatrixClient();
  client.getUserId = () => AI_BOT_USER_ID;
  const requests: MessagesRequest[] = [];
  client.http = {
    authedRequest: async (
      _method: Method,
      _path: string,
      queryParams: Record<string, string>,
    ) => {
      let request: MessagesRequest = {
        dir: queryParams.dir,
        limit: queryParams.limit,
        from: queryParams.from,
        filter: JSON.parse(queryParams.filter),
      };
      requests.push(request);
      let position =
        request.from === undefined ? timeline.length : Number(request.from);
      let types = request.filter.types;
      let chunk: DiscreteMatrixEvent[] = [];
      let next = position;
      while (next > 0 && chunk.length < Number(request.limit)) {
        next--;
        if (!types || types.includes(timeline[next].type)) {
          chunk.push(timeline[next]);
        }
      }
      return chunk.length === 0 ? { chunk } : { chunk, end: String(next) };
    },
  } as any;
  return { client, requests };
}

async function getErrorMessageFromSend(error: any) {
  const client = new FakeMatrixClient();
  await sendErrorEvent(client, 'room123', error, undefined);
  return client.getSentEvents()[0].content.errorMessage;
}

const unfilteredRequests = (requests: MessagesRequest[]) =>
  requests.filter((request) => !request.filter.types);

test('getRoomEvents - returns all events when no lastEventId provided', async function (assert) {
  const timeline = createRoomTimeline(2);
  const { client } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client);

  assert.deepEqual(
    result,
    timeline,
    'Returns all events when no lastEventId provided',
  );
});

test('getRoomEvents - returns events up to and including lastEventId', async function (assert) {
  const timeline = createRoomTimeline(3);
  const { client } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, 'event1');

  assert.deepEqual(
    result,
    timeline.slice(0, 2),
    'Returns events up to and including lastEventId',
  );
});

test('getRoomEvents - returns all events when lastEventId is not found', async function (assert) {
  const timeline = createRoomTimeline(2);
  const { client } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, 'non-existent-id');

  assert.deepEqual(
    result,
    timeline,
    'Returns all events when lastEventId is not found',
  );
});

test('getRoomEvents - handles empty response', async function (assert) {
  const { client } = createMockedClient([]);

  const result = await getRoomEvents('room123', client);

  assert.deepEqual(result, [], 'Returns empty array when no events are found');
});

test('getRoomEvents - pages a room longer than one page back to its start, ending at the trigger', async function (assert) {
  const timeline = createRoomTimeline(2500);
  const { client, requests } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, 'event2400');

  assert.strictEqual(result.length, 2401);
  assert.strictEqual(result[0].event_id, 'event0', 'starts at the room start');
  assert.deepEqual(
    result.slice(-3).map((event) => event.event_id),
    ['event2398', 'event2399', 'event2400'],
    'ends with the trigger and the events just before it',
  );
  assert.deepEqual(
    result.map((event) => event.origin_server_ts),
    [...result.map((event) => event.origin_server_ts)].sort((a, b) => a - b),
    'events are in chronological order',
  );
  assert.true(
    requests.every((request) => request.dir === 'b'),
    'pages backwards',
  );
  assert.deepEqual(
    requests.map((request) => request.from),
    [undefined, '1500', '500', '0'],
    "each page starts from the previous page's end",
  );
});

test('getRoomEvents - stops paging at the latest compaction cut and keeps the room config', async function (assert) {
  const timeline = createRoomTimeline(3000);
  placeAt(
    timeline,
    0,
    stateEvent('create-name', 'm.room.name', { name: 'New session' }),
  );
  placeAt(timeline, 1, stateEvent('skills', APP_BOXEL_ROOM_SKILLS_EVENT_TYPE));
  placeAt(timeline, 2, stateEvent('llm', APP_BOXEL_ACTIVE_LLM));
  placeAt(
    timeline,
    10,
    stateEvent('title', 'm.room.name', { name: 'Room title' }),
  );
  placeAt(timeline, 1700, compactionEvent('compaction', 'event1500'));
  const { client, requests } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, 'event2999');

  assert.strictEqual(
    unfilteredRequests(requests).length,
    2,
    'stops after the page holding the cut',
  );
  assert.deepEqual(
    result.slice(0, 5).map((event) => event.event_id),
    ['create-name', 'skills', 'llm', 'title', 'event1500'],
    'room config events come first, then the history from the cut event',
  );
  assert.strictEqual(result.at(-1)?.event_id, 'event2999');
  assert.strictEqual(result.length, 4 + 1500);
});

test('getRoomEvents - uses the latest compaction before the trigger, not one after it', async function (assert) {
  const timeline = createRoomTimeline(2000);
  placeAt(timeline, 1200, compactionEvent('compaction1', 'event1100'));
  placeAt(timeline, 1900, compactionEvent('compaction2', 'event1800'));

  const { client } = createMockedClient(timeline);
  const result = await getRoomEvents('room123', client, 'event1850');

  assert.strictEqual(result[0].event_id, 'event1100');
  assert.strictEqual(result.at(-1)?.event_id, 'event1850');
});

test('getRoomEvents - leaves out config events from after the trigger', async function (assert) {
  const timeline = createRoomTimeline(2000);
  placeAt(timeline, 1, stateEvent('skills', APP_BOXEL_ROOM_SKILLS_EVENT_TYPE));
  placeAt(timeline, 1200, compactionEvent('compaction', 'event1100'));
  placeAt(
    timeline,
    1950,
    stateEvent('later-skills', APP_BOXEL_ROOM_SKILLS_EVENT_TYPE),
  );
  const { client } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, 'event1900');
  const ids = result.map((event) => event.event_id);

  assert.true(ids.includes('skills'));
  assert.false(ids.includes('later-skills'));
});

test('getRoomEvents - stops after ROOM_EVENTS_MAX_PAGES pages in a room with no compaction', async function (assert) {
  const timeline = createRoomTimeline(
    (ROOM_EVENTS_MAX_PAGES + 2) * ROOM_EVENTS_PAGE_SIZE,
  );
  placeAt(timeline, 1, stateEvent('skills', APP_BOXEL_ROOM_SKILLS_EVENT_TYPE));
  const { client, requests } = createMockedClient(timeline);
  const trigger = timeline.at(-1)!.event_id;

  const result = await getRoomEvents('room123', client, trigger);

  assert.strictEqual(
    unfilteredRequests(requests).length,
    ROOM_EVENTS_MAX_PAGES,
  );
  assert.strictEqual(result[0].event_id, 'skills');
  assert.strictEqual(
    result.length,
    1 + ROOM_EVENTS_MAX_PAGES * ROOM_EVENTS_PAGE_SIZE,
  );
  assert.strictEqual(result.at(-1)?.event_id, trigger);
});

test('getRoomEvents - keeps paging past an empty page that has an end token', async function (assert) {
  const { client, requests } = createMockedClient();
  const pages = [
    { chunk: [createMockEvent('event2', 'message 2')], end: 't1' },
    { chunk: [], end: 't2' },
    { chunk: [createMockEvent('event1', 'message 1')], end: 't3' },
    { chunk: [] },
  ];
  client.http = {
    authedRequest: async (_method: Method, _path: string, queryParams: any) => {
      requests.push(queryParams);
      return pages.shift();
    },
  } as any;

  const result = await getRoomEvents('room123', client, 'event2');

  assert.deepEqual(
    result.map((event) => event.event_id),
    ['event1', 'event2'],
  );
  assert.strictEqual(requests.length, 4);
});

test('getRoomEvents - wholeRoom pages to the start past a compaction', async function (assert) {
  const timeline = createRoomTimeline(2500);
  placeAt(timeline, 2200, compactionEvent('compaction', 'event2100'));
  const { client } = createMockedClient(timeline);

  const result = await getRoomEvents('room123', client, undefined, {
    wholeRoom: true,
  });

  assert.deepEqual(result, timeline);
});

test('sendErrorEvent - uses provider metadata when available', async function (assert) {
  const error = {
    error: {
      metadata: {
        provider_name: 'anthropic',
        raw: JSON.stringify({ error: { message: 'Provider level failure' } }),
      },
    },
  };

  const errorMessage = await getErrorMessageFromSend(error);

  assert.strictEqual(
    errorMessage,
    'anthropic error: Provider level failure',
    'Provider error message is preferred',
  );
});

test('sendErrorEvent - formats OpenRouter errors coming from OpenAI SDK', async function (assert) {
  const error = new OpenAIError('OpenRouter exploded') as any;
  error.error = {
    metadata: {
      provider_name: 'OpenRouter',
      raw: JSON.stringify({ error: { message: 'OpenRouter exploded' } }),
    },
  };

  const errorMessage = await getErrorMessageFromSend(error);

  assert.strictEqual(
    errorMessage,
    'OpenRouter error: OpenRouter exploded',
    'OpenAI SDK errors are treated as provider errors when metadata is present',
  );
});

test('sendErrorEvent - passes through string errors', async function (assert) {
  const errorMessage = await getErrorMessageFromSend('plain string error');

  assert.strictEqual(
    errorMessage,
    'plain string error',
    'String errors are forwarded directly',
  );
});

test('sendErrorEvent - falls back to error.message', async function (assert) {
  const errorMessage = await getErrorMessageFromSend(
    new Error('generic failure'),
  );

  assert.strictEqual(
    errorMessage,
    'generic failure',
    'Uses message property when no special handling applies',
  );
});

test('sendErrorEvent - returns unknown error when no details provided', async function (assert) {
  const errorMessage = await getErrorMessageFromSend({});

  assert.strictEqual(
    errorMessage,
    'Unknown error',
    'Falls back to generic message when no details exist',
  );
});
