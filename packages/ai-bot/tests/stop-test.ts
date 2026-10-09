import QUnit from 'qunit';
const { module, test } = QUnit;
import { EventStatus } from 'matrix-js-sdk';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  buildPromptForModel,
  getPromptParts,
} from '@cardstack/runtime-common/ai';
import {
  STOPPED_TOOL_CALL_REASON,
  stopInForce,
} from '@cardstack/runtime-common/ai/stop';
import { RoomTurns } from '../lib/room-turns.ts';
import { publishCanceledResults } from '../lib/bot-tools/results.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';

const BOT = '@aibot:localhost';

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return (content as { type: string; text?: string }[])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}
const USER = '@user:localhost';

let ts = 1722242847000;
function nextTs() {
  return (ts += 1000);
}

function userMessage(eventId: string, body: string): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-id-1',
    sender: USER,
    content: {
      body,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      data: { context: { tools: [], functions: [] } },
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 1000, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

function botMessageWithToolCalls(
  eventId: string,
  toolCallIds: string[],
): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-id-1',
    sender: BOT,
    content: {
      body: 'Working on it',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: { context: { functions: [] } },
      [APP_BOXEL_TOOL_REQUESTS_KEY]: toolCallIds.map((id) => ({
        id,
        name: 'searchCardsByTypeAndTitle',
        arguments: JSON.stringify({ attributes: { title: 'Author' } }),
      })),
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 900, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

function toolResult(
  eventId: string,
  requestEventId: string,
  toolCallId: string,
  status: 'applied' | 'canceled' = 'applied',
  failureReason?: string,
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    room_id: 'room-id-1',
    sender: USER,
    content: {
      'm.relates_to': {
        event_id: requestEventId,
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key: status,
      },
      msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
      commandRequestId: toolCallId,
      ...(failureReason ? { failureReason } : {}),
      data: { context: { tools: [], functions: [] } },
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 800, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

function stopEvent(eventId: string, sender = USER): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_STOP_GENERATING_EVENT_TYPE,
    room_id: 'room-id-1',
    sender,
    content: {},
    origin_server_ts: nextTs(),
    unsigned: { age: 700, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

module('stop holds the assistant loop', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
  });

  test('a stop while tools run keeps their results from starting a turn', async (assert) => {
    let eventList = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1', 'call-2']),
      toolResult('result-1', 'bot-1', 'call-1'),
      stopEvent('stop-1'),
      toolResult('result-2', 'bot-1', 'call-2'),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.false(
      shouldRespond,
      'every call has a result, but the stop holds the loop',
    );
  });

  test('the same results start a turn when nothing was stopped', async (assert) => {
    let eventList = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1', 'call-2']),
      toolResult('result-1', 'bot-1', 'call-1'),
      toolResult('result-2', 'bot-1', 'call-2'),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.true(shouldRespond);
  });

  test('a new message from the user releases the stop', async (assert) => {
    let eventList = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      stopEvent('stop-1'),
      toolResult('result-1', 'bot-1', 'call-1'),
      userMessage('user-2', 'try another way'),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.true(shouldRespond);
  });

  test('a stop before the last user message does not hold later turns', async (assert) => {
    let eventList = [
      userMessage('user-1', 'find the authors'),
      stopEvent('stop-1'),
      userMessage('user-2', 'try another way'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      toolResult('result-1', 'bot-1', 'call-1'),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.true(shouldRespond);
  });

  test('a canceled call reads as canceled to the model, with its reason', async (assert) => {
    let history = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      toolResult(
        'result-1',
        'bot-1',
        'call-1',
        'canceled',
        'The user stopped the assistant before this tool call ran.',
      ),
    ];
    let messages = await buildPromptForModel(
      history,
      BOT,
      [],
      [],
      fakeMatrixClient as any,
    );
    let toolMessage = messages.find((m) => m.role === 'tool');
    assert.ok(toolMessage, 'the canceled call keeps its tool message');
    assert.strictEqual(
      textOf(toolMessage!.content).trim(),
      'Tool call canceled.\nThe user stopped the assistant before this tool call ran.',
    );
  });
});

module('stopInForce', () => {
  test('is undefined when the room has no stop', (assert) => {
    assert.strictEqual(
      stopInForce(
        [userMessage('user-1', 'hi'), botMessageWithToolCalls('bot-1', [])],
        BOT,
      ),
      undefined,
    );
  });

  test('returns the stop when no person has written since', (assert) => {
    let stop = stopEvent('stop-1');
    assert.strictEqual(
      stopInForce(
        [
          userMessage('user-1', 'hi'),
          botMessageWithToolCalls('bot-1', ['call-1']),
          stop,
          toolResult('result-1', 'bot-1', 'call-1'),
          botMessageWithToolCalls('bot-2', []),
        ],
        BOT,
      ),
      stop,
    );
  });

  test('ignores a stop event the bot itself sent', (assert) => {
    assert.strictEqual(
      stopInForce([userMessage('user-1', 'hi'), stopEvent('stop-1', BOT)], BOT),
      undefined,
    );
  });
});

module('RoomTurns', () => {
  test('a stop marks the turns in flight for the room', (assert) => {
    let turns = new RoomTurns();
    let first = turns.begin('room-1');
    let second = turns.begin('room-1');
    let other = turns.begin('room-2');
    turns.stop('room-1');
    assert.true(first.stopped);
    assert.true(second.stopped);
    assert.false(other.stopped, 'another room is untouched');
  });

  test('a stop does not carry over to a turn that begins after it', (assert) => {
    let turns = new RoomTurns();
    let ended = turns.begin('room-1');
    turns.end('room-1', ended);
    turns.stop('room-1');
    assert.false(ended.stopped, 'an ended turn is no longer in flight');
    let next = turns.begin('room-1');
    assert.false(
      next.stopped,
      'a later turn reads the stop from the room history instead',
    );
  });
});

module('publishCanceledResults', () => {
  test('answers each call with a canceled result naming the stop', async (assert) => {
    let client = new FakeMatrixClient();
    let outcomes = await publishCanceledResults(
      [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'readRealmFile', arguments: '{}' },
        },
      ],
      {
        client: client as any,
        roomId: 'room-1',
        requestEventId: 'bot-1',
        agentId: 'agent-1',
      },
    );
    assert.deepEqual(outcomes, [
      { commandRequestId: 'call-1', published: true },
    ]);
    let sent = client.getSentEvents()[0]!;
    assert.strictEqual(sent.eventType, APP_BOXEL_TOOL_RESULT_EVENT_TYPE);
    assert.strictEqual(sent.content['m.relates_to']?.key, 'canceled');
    assert.strictEqual(sent.content['m.relates_to']?.event_id, 'bot-1');
    assert.strictEqual(sent.content.commandRequestId, 'call-1');
    assert.strictEqual(sent.content.failureReason, STOPPED_TOOL_CALL_REASON);
  });
});
