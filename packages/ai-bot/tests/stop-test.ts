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
  readStopState,
} from '@cardstack/runtime-common/ai/stop';
import { RoomTurns } from '../lib/room-turns.ts';
import {
  abandonedBotToolCalls,
  cancelBotToolCalls,
  fulfillBotToolCalls,
  type BotToolCall,
  type BotToolTarget,
  type BotToolTurn,
} from '../lib/bot-tools/index.ts';
import {
  INTERRUPTED_TOOL_CALL_REASON,
  publishCanceledResult,
} from '../lib/bot-tools/results.ts';
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
  toolName = 'searchCardsByTypeAndTitle',
  args: Record<string, unknown> = { attributes: { title: 'Author' } },
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
        name: toolName,
        arguments: JSON.stringify(args),
      })),
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 900, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

// An answer that patched a card: its edits are what the correctness check
// looks at.
function botPatchMessage(eventId: string, toolCallId: string) {
  return botMessageWithToolCalls(eventId, [toolCallId], 'patchCardInstance', {
    attributes: {
      cardId: 'http://localhost:4201/user/Author/1',
      patch: { attributes: { firstName: 'Jane' } },
    },
  });
}

// An edit of a bot message: the same answer, under another event id.
function botEdit(eventId: string, editedEventId: string): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-id-1',
    sender: BOT,
    content: {
      body: 'Working on it, still',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      'm.relates_to': { rel_type: 'm.replace', event_id: editedEventId },
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
  {
    status = 'applied',
    failureReason,
    resumesAssistant,
  }: {
    status?: 'applied' | 'canceled' | 'invalid';
    failureReason?: string;
    // The result answers a call the user asked to go ahead (see
    // readStopState).
    resumesAssistant?: true;
  } = {},
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
      ...(resumesAssistant ? { resumesAssistant } : {}),
      data: { context: { tools: [], functions: [] } },
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 800, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

// An answer the user stopped while it was streaming: it keeps the calls it
// had streamed, the last one possibly cut off mid-arguments.
function canceledAnswer(
  eventId: string,
  toolRequests: { id: string; name: string; arguments: string }[],
): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-id-1',
    sender: BOT,
    content: {
      body: '',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      isCanceled: true,
      data: { context: { functions: [] } },
      [APP_BOXEL_TOOL_REQUESTS_KEY]: toolRequests,
    },
    origin_server_ts: nextTs(),
    unsigned: { age: 900, transaction_id: eventId },
    event_id: eventId,
    status: EventStatus.SENT,
  } as unknown as DiscreteMatrixEvent;
}

const READ_SKILL_FILES = {
  name: 'readRealmFile',
  arguments: JSON.stringify({
    urls: ['https://realm.example/skills/boxel-environment/SKILL.md'],
  }),
};
// The same call, cut off by the stop before its arguments finished.
const CUT_OFF_READ = {
  name: 'readRealmFile',
  arguments: '{"urls":["https://realm.example/skills/boxel-env',
};

// The ids of the calls the prompt's assistant messages make, and of the tool
// messages that answer them.
function promptToolCallIds(messages: { role: string }[]) {
  let calls = messages.flatMap(
    (m) =>
      (m as { tool_calls?: { id: string }[] }).tool_calls?.map((c) => c.id) ??
      [],
  );
  let answered = messages
    .filter((m) => m.role === 'tool')
    .map((m) => (m as { tool_call_id: string }).tool_call_id);
  return { calls, answered };
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

  test('a call the user asks to go ahead after a stop starts a turn with its result', async (assert) => {
    let eventList = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1', 'call-2']),
      stopEvent('stop-1'),
      toolResult('result-1', 'bot-1', 'call-1', {
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
      }),
      toolResult('result-2', 'bot-1', 'call-2', { resumesAssistant: true }),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.true(shouldRespond, 'the user clicked Run, so the loop goes on');
  });

  test('declining a held call after a stop leaves the stop in force', async (assert) => {
    let eventList = [
      userMessage('user-1', 'read the page'),
      botMessageWithToolCalls('bot-1', ['call-1'], 'readUrl'),
      stopEvent('stop-1'),
      toolResult('result-1', 'bot-1', 'call-1', {
        status: 'invalid',
        failureReason: 'The user declined this call.',
      }),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.false(
      shouldRespond,
      'the call settles, and the assistant stays quiet',
    );
  });

  test("a stopped answer's edits are never checked for correctness", async (assert) => {
    let stopped = [
      userMessage('user-1', 'fix the author'),
      botPatchMessage('bot-1', 'patch-1'),
      toolResult('result-1', 'bot-1', 'patch-1'),
      stopEvent('stop-1'),
    ];
    let held = await getPromptParts(stopped, BOT, fakeMatrixClient as any);
    assert.false(held.shouldRespond);
    assert.strictEqual(
      held.pendingCodePatchCorrectnessChecks,
      undefined,
      'the check is held while the stop is in force',
    );

    let written = [...stopped, userMessage('user-2', 'never mind, list them')];
    let next = await getPromptParts(written, BOT, fakeMatrixClient as any);
    assert.true(next.shouldRespond, 'the new message is answered');
    assert.strictEqual(
      next.pendingCodePatchCorrectnessChecks,
      undefined,
      'the stopped edits are not checked before it, nor ever',
    );
  });

  test('the edits of an answer the user resumed are checked', async (assert) => {
    let eventList = [
      userMessage('user-1', 'fix the author'),
      botPatchMessage('bot-1', 'patch-1'),
      stopEvent('stop-1'),
      toolResult('result-1', 'bot-1', 'patch-1', { resumesAssistant: true }),
    ];
    let { shouldRespond, pendingCodePatchCorrectnessChecks } =
      await getPromptParts(eventList, BOT, fakeMatrixClient as any);
    assert.true(shouldRespond);
    assert.strictEqual(
      pendingCodePatchCorrectnessChecks?.targetEventId,
      'bot-1',
      'the user applied the patch by hand, so it is checked',
    );
  });

  test('a canceled correctness check does not hold the room after the user writes again', async (assert) => {
    let eventList = [
      userMessage('user-1', 'fix the card'),
      botMessageWithToolCalls('bot-1', ['check-1'], 'checkCorrectness'),
      stopEvent('stop-1'),
      toolResult('result-1', 'bot-1', 'check-1', {
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
      }),
      userMessage('user-2', 'try again'),
    ];
    let { shouldRespond } = await getPromptParts(
      eventList,
      BOT,
      fakeMatrixClient as any,
    );
    assert.true(
      shouldRespond,
      'a canceled check is answered, so it does not wait for another result',
    );
  });

  test('a canceled call reads as canceled to the model, with its reason', async (assert) => {
    let history = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      toolResult('result-1', 'bot-1', 'call-1', {
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
      }),
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

  test('an answer stopped mid-call leaves no call without a result in the next prompt', async (assert) => {
    let history = [
      userMessage('user-1', 'create five notes'),
      stopEvent('stop-1'),
      canceledAnswer('bot-1', [
        { id: 'call-1', ...READ_SKILL_FILES },
        { id: 'call-2', ...CUT_OFF_READ },
      ]),
      userMessage('user-2', 'never mind, just say hello'),
    ];
    let messages = await buildPromptForModel(
      history,
      BOT,
      [],
      [],
      fakeMatrixClient as any,
    );
    let { calls, answered } = promptToolCallIds(messages);
    assert.deepEqual(calls, ['call-1'], 'the cut-off call is left out');
    assert.deepEqual(answered, ['call-1'], 'the finished call is answered');
    let toolMessage = messages.find((m) => m.role === 'tool');
    assert.strictEqual(
      textOf(toolMessage!.content).trim(),
      'Tool call canceled: the answer that made this call was stopped before the call ran.',
    );
  });

  test("a cut-off call's canceled result stays out of the prompt with its call", async (assert) => {
    let history = [
      userMessage('user-1', 'create five notes'),
      stopEvent('stop-1'),
      canceledAnswer('bot-1', [
        { id: 'call-1', ...READ_SKILL_FILES },
        { id: 'call-2', ...CUT_OFF_READ },
      ]),
      toolResult('result-1', 'bot-1', 'call-1', {
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
      }),
      toolResult('result-2', 'bot-1', 'call-2', {
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
      }),
      userMessage('user-2', 'never mind, just say hello'),
    ];
    let messages = await buildPromptForModel(
      history,
      BOT,
      [],
      [],
      fakeMatrixClient as any,
    );
    let { calls, answered } = promptToolCallIds(messages);
    assert.deepEqual(calls, ['call-1']);
    assert.deepEqual(answered, ['call-1']);
  });

  test('a call the user moved on from without running it is answered as not run', async (assert) => {
    let history = [
      userMessage('user-1', 'find the authors'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      userMessage('user-2', 'actually, never mind'),
    ];
    let messages = await buildPromptForModel(
      history,
      BOT,
      [],
      [],
      fakeMatrixClient as any,
    );
    let { calls, answered } = promptToolCallIds(messages);
    assert.deepEqual(calls, ['call-1']);
    assert.deepEqual(answered, ['call-1']);
    let toolMessage = messages.find((m) => m.role === 'tool');
    assert.strictEqual(
      textOf(toolMessage!.content).trim(),
      'Tool call not run: no result was recorded for this call.',
    );
  });
});

module('readStopState', () => {
  function ids(set: ReadonlySet<string>) {
    return [...set].sort();
  }

  test('nothing is stopped in a room with no stop', (assert) => {
    let state = readStopState(
      [userMessage('user-1', 'hi'), botMessageWithToolCalls('bot-1', [])],
      BOT,
    );
    assert.strictEqual(state.inForce, undefined);
    assert.deepEqual(ids(state.stoppedMessageIds), []);
    assert.deepEqual(ids(state.everStoppedMessageIds), []);
  });

  test('a stop holds, and stops the answers of its turn, until a person writes', (assert) => {
    let stop = stopEvent('stop-1');
    let turn = [
      userMessage('user-1', 'hi'),
      botMessageWithToolCalls('bot-1', ['call-1']),
      stop,
      toolResult('result-1', 'bot-1', 'call-1'),
      botMessageWithToolCalls('bot-2', []),
    ];
    let state = readStopState(turn, BOT);
    assert.strictEqual(state.inForce, stop);
    assert.deepEqual(
      ids(state.stoppedMessageIds),
      ['bot-1', 'bot-2'],
      'an answer the stopped run posts after the stop is stopped too',
    );
    assert.deepEqual(ids(state.everStoppedMessageIds), ['bot-1', 'bot-2']);

    let written = readStopState([...turn, userMessage('user-2', 'again')], BOT);
    assert.strictEqual(written.inForce, undefined, 'the stop is lifted');
    assert.deepEqual(
      ids(written.stoppedMessageIds),
      ['bot-1', 'bot-2'],
      'the stopped turn stays stopped',
    );
  });

  test('a result of a call the user asked to go ahead lifts the stop and resumes its answer', (assert) => {
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        stopEvent('stop-1'),
        toolResult('result-1', 'bot-1', 'call-1', { resumesAssistant: true }),
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, undefined);
    assert.deepEqual(
      ids(state.stoppedMessageIds),
      [],
      'the answer is no longer stopped',
    );
    assert.deepEqual(
      ids(state.everStoppedMessageIds),
      ['bot-1'],
      'but the stop that hit it is remembered',
    );
  });

  test('a resuming result on an answer from an earlier turn resumes that answer', (assert) => {
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        stopEvent('stop-1'),
        userMessage('user-2', 'something else'),
        botMessageWithToolCalls('bot-2', []),
        toolResult('result-1', 'bot-1', 'call-1', { resumesAssistant: true }),
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, undefined);
    assert.deepEqual(ids(state.stoppedMessageIds), []);
    assert.deepEqual(ids(state.everStoppedMessageIds), ['bot-1']);
  });

  test('a second stop after a resume stops the answer again', (assert) => {
    let second = stopEvent('stop-2');
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1', 'call-2']),
        stopEvent('stop-1'),
        toolResult('result-1', 'bot-1', 'call-1', { resumesAssistant: true }),
        second,
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, second);
    assert.deepEqual(ids(state.stoppedMessageIds), ['bot-1']);
  });

  test('a declined call does not lift the stop', (assert) => {
    let stop = stopEvent('stop-1');
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        stop,
        toolResult('result-1', 'bot-1', 'call-1', {
          status: 'invalid',
          failureReason: 'The user declined this call.',
        }),
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, stop);
    assert.deepEqual(ids(state.stoppedMessageIds), ['bot-1']);
  });

  test('a result without the marker does not lift the stop', (assert) => {
    // The result of a tool that was already running when the user stopped,
    // or any result from a client on a host version before the marker.
    let stop = stopEvent('stop-1');
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        stop,
        toolResult('result-1', 'bot-1', 'call-1'),
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, stop);
  });

  test('a stop event the bot itself sent is ignored', (assert) => {
    let state = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', []),
        stopEvent('stop-1', BOT),
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, undefined);
    assert.deepEqual(ids(state.stoppedMessageIds), []);
  });

  test("an answer's edits are stopped with it, and a result on an edit resumes the answer", (assert) => {
    let stopped = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        botEdit('bot-1-edit', 'bot-1'),
        stopEvent('stop-1'),
      ],
      BOT,
    );
    assert.deepEqual(ids(stopped.stoppedMessageIds), ['bot-1', 'bot-1-edit']);
    assert.deepEqual(ids(stopped.everStoppedMessageIds), [
      'bot-1',
      'bot-1-edit',
    ]);

    let resumed = readStopState(
      [
        userMessage('user-1', 'hi'),
        botMessageWithToolCalls('bot-1', ['call-1']),
        botEdit('bot-1-edit', 'bot-1'),
        stopEvent('stop-1'),
        toolResult('result-1', 'bot-1-edit', 'call-1', {
          resumesAssistant: true,
        }),
      ],
      BOT,
    );
    assert.deepEqual(ids(resumed.stoppedMessageIds), []);
  });

  test('each stopped turn keeps its own answers stopped', (assert) => {
    let second = stopEvent('stop-2');
    let state = readStopState(
      [
        userMessage('user-1', 'one'),
        botMessageWithToolCalls('bot-1', []),
        stopEvent('stop-1'),
        userMessage('user-2', 'two'),
        botMessageWithToolCalls('bot-2', []),
        second,
      ],
      BOT,
    );
    assert.strictEqual(state.inForce, second);
    assert.deepEqual(ids(state.stoppedMessageIds), ['bot-1', 'bot-2']);
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

  test('whenStopped runs its callback once, when the stop lands or at once if it already has', (assert) => {
    let turns = new RoomTurns();
    let turn = turns.begin('room-1');
    let ran = 0;
    turn.whenStopped(() => ran++);
    assert.strictEqual(ran, 0, 'nothing has stopped yet');
    turns.stop('room-1');
    assert.strictEqual(ran, 1, 'the stop runs it');
    turns.stop('room-1');
    assert.strictEqual(ran, 1, 'a second stop does not run it again');
    turn.whenStopped(() => ran++);
    assert.strictEqual(ran, 2, 'registered after the stop, it runs at once');
  });

  test('a callback is dropped when the turn ends', (assert) => {
    let turns = new RoomTurns();
    let turn = turns.begin('room-1');
    let ran = 0;
    turn.whenStopped(() => ran++);
    turns.end('room-1', turn);
    turns.stop('room-1');
    turn.whenStopped(() => ran++);
    assert.strictEqual(ran, 0, 'nothing runs for a turn that has ended');
  });
});

module('fulfillBotToolCalls', (hooks) => {
  let client: FakeMatrixClient;
  let target: BotToolTarget;

  hooks.beforeEach(() => {
    client = new FakeMatrixClient();
    target = {
      client: client as any,
      roomId: 'room-1',
      requestEventId: 'bot-1',
      agentId: 'agent-1',
    };
  });

  function call(id: string, name = 'readUrl'): BotToolCall {
    return {
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify({ url: `https://${id}` }) },
    };
  }

  // A turn that records the calls it runs, and runs `onFulfill` while each
  // runs.
  function turn(
    ran: string[],
    {
      onFulfill,
      published = true,
    }: { onFulfill?: () => void; published?: boolean } = {},
  ): BotToolTurn {
    return {
      needsApproval: () => false,
      async fulfill(fulfilled) {
        ran.push(fulfilled.id);
        onFulfill?.();
        return { commandRequestId: fulfilled.id, published };
      },
    };
  }

  test('a stop during a call cancels the calls after it, not the one running', async (assert) => {
    let stopped = false;
    let ran: string[] = [];
    // The user presses Stop while the first call is running.
    let running = turn(ran, { onFulfill: () => (stopped = true) });

    let outcomes = await fulfillBotToolCalls(
      [
        { call: call('call-1'), turn: running, target },
        { call: call('call-2'), turn: running, target },
      ],
      () => stopped,
    );

    assert.deepEqual(ran, ['call-1'], 'the running call finishes');
    assert.deepEqual(
      [...outcomes.entries()],
      [
        ['call-1', { commandRequestId: 'call-1', published: true }],
        ['call-2', { commandRequestId: 'call-2', published: true }],
      ],
    );
    let [canceled] = client.getSentEvents();
    assert.strictEqual(canceled.content.commandRequestId, 'call-2');
    assert.strictEqual(canceled.content['m.relates_to']?.key, 'canceled');
    assert.strictEqual(
      canceled.content.failureReason,
      STOPPED_TOOL_CALL_REASON,
    );
  });

  test('calls run one at a time, in order, each through its own turn', async (assert) => {
    let ran: string[] = [];
    let reads = turn(ran);
    let fileReads = turn(ran);

    await fulfillBotToolCalls(
      [
        { call: call('approved-1'), turn: fileReads, target },
        { call: call('call-1'), turn: reads, target },
        { call: call('call-2'), turn: fileReads, target },
      ],
      () => false,
    );

    assert.deepEqual(ran, ['approved-1', 'call-1', 'call-2']);
    assert.deepEqual(client.getSentEvents(), [], 'nothing was canceled');
  });

  test('an outcome whose result never reached the room says so', async (assert) => {
    let outcomes = await fulfillBotToolCalls(
      [{ call: call('call-1'), turn: turn([], { published: false }), target }],
      () => false,
    );
    assert.deepEqual(outcomes.get('call-1'), {
      commandRequestId: 'call-1',
      published: false,
    });
  });
});

module('abandonedBotToolCalls', () => {
  test("picks a canceled answer's bot-tool calls, including one cut off mid-arguments", (assert) => {
    let calls = abandonedBotToolCalls([
      { id: 'call-1', function: READ_SKILL_FILES },
      {
        id: 'call-2',
        function: { name: 'patchCardInstance', arguments: '{}' },
      },
      { id: 'call-3', function: CUT_OFF_READ },
      // The first chunk of a call names nothing yet.
      { function: { name: 'readUrl' } },
      { id: 'call-4', function: {} },
    ]);
    assert.deepEqual(
      calls.map((call) => [
        call.id,
        call.function.name,
        call.function.arguments,
      ]),
      [
        ['call-1', 'readRealmFile', READ_SKILL_FILES.arguments],
        ['call-3', 'readRealmFile', CUT_OFF_READ.arguments],
      ],
      'host-tool calls and calls with no id or name are left out',
    );
  });
});

module('cancelBotToolCalls', () => {
  test('answers every call as canceled, in order, with the reason given', async (assert) => {
    let client = new FakeMatrixClient();
    let outcomes = await cancelBotToolCalls(
      abandonedBotToolCalls([
        { id: 'call-1', function: READ_SKILL_FILES },
        { id: 'call-2', function: CUT_OFF_READ },
      ]),
      {
        client: client as any,
        roomId: 'room-1',
        requestEventId: 'bot-1',
        agentId: 'agent-1',
      },
      INTERRUPTED_TOOL_CALL_REASON,
    );
    assert.deepEqual(
      [...outcomes.keys()],
      ['call-1', 'call-2'],
      'each call has an outcome',
    );
    let sent = client.getSentEvents();
    assert.deepEqual(
      sent.map((event) => [
        event.content.commandRequestId,
        event.content['m.relates_to']?.key,
        event.content['m.relates_to']?.event_id,
        event.content.failureReason,
      ]),
      [
        ['call-1', 'canceled', 'bot-1', INTERRUPTED_TOOL_CALL_REASON],
        ['call-2', 'canceled', 'bot-1', INTERRUPTED_TOOL_CALL_REASON],
      ],
    );
  });
});

module('publishCanceledResult', () => {
  test('answers the call with a canceled result naming the stop', async (assert) => {
    let client = new FakeMatrixClient();
    let outcome = await publishCanceledResult(
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'readRealmFile', arguments: '{}' },
      },
      {
        client: client as any,
        roomId: 'room-1',
        requestEventId: 'bot-1',
        agentId: 'agent-1',
      },
    );
    assert.deepEqual(outcome, { commandRequestId: 'call-1', published: true });
    let sent = client.getSentEvents()[0]!;
    assert.strictEqual(sent.eventType, APP_BOXEL_TOOL_RESULT_EVENT_TYPE);
    assert.strictEqual(sent.content['m.relates_to']?.key, 'canceled');
    assert.strictEqual(sent.content['m.relates_to']?.event_id, 'bot-1');
    assert.strictEqual(sent.content.commandRequestId, 'call-1');
    assert.strictEqual(sent.content.failureReason, STOPPED_TOOL_CALL_REASON);
  });
});
