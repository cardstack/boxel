import QUnit from 'qunit';
const { module, test, assert } = QUnit;
import type OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import {
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  COMPACTION_SUMMARY_INSTRUCTION,
  constructHistory,
  findCompactionCut,
  getPromptParts,
} from '@cardstack/runtime-common/ai';
import {
  compactRoomHistory,
  isContextLengthExceededError,
  summaryFromCompletion,
} from '../lib/compaction.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';

const aiBotUserId = '@aibot:localhost';
const userId = '@user:localhost';

let ts = 1_700_000_000_000;

function userMessage(eventId: string, body: string): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-1',
    sender: userId,
    event_id: eventId,
    origin_server_ts: ts++,
    content: {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body,
      format: 'org.matrix.custom.html',
      data: JSON.stringify({ context: {} }),
    },
  } as unknown as DiscreteMatrixEvent;
}

function botMessage(
  eventId: string,
  body: string,
  extra: Record<string, unknown> = {},
): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    room_id: 'room-1',
    sender: aiBotUserId,
    event_id: eventId,
    origin_server_ts: ts++,
    content: {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: JSON.stringify({ context: {} }),
      ...extra,
    },
  } as unknown as DiscreteMatrixEvent;
}

function toolCallMessage(eventId: string, toolCallId: string) {
  return botMessage(eventId, 'Searching', {
    [APP_BOXEL_TOOL_REQUESTS_KEY]: [
      {
        id: toolCallId,
        name: 'searchCards',
        arguments: JSON.stringify({ attributes: { query: 'authors' } }),
      },
    ],
  });
}

function toolResult(
  eventId: string,
  requestEventId: string,
  toolCallId: string,
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    room_id: 'room-1',
    sender: userId,
    event_id: eventId,
    origin_server_ts: ts++,
    content: {
      'm.relates_to': {
        event_id: requestEventId,
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key: 'applied',
      },
      msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
      commandRequestId: toolCallId,
      data: JSON.stringify({
        context: {},
        card: {
          sourceUrl: 'http://localhost:4201/drafts/results/1',
          url: 'http://localhost:4201/drafts/results/1',
          contentType: 'text/plain',
          name: 'Results',
          content: JSON.stringify({ data: { attributes: { count: 2 } } }),
        },
      }),
    },
  } as unknown as DiscreteMatrixEvent;
}

function compactionEvent(
  eventId: string,
  upToEventId: string,
  summary: string,
  sender = aiBotUserId,
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_COMPACTION_EVENT_TYPE,
    room_id: 'room-1',
    sender,
    event_id: eventId,
    origin_server_ts: ts++,
    content: { upToEventId, summary, summaryVersion: 1 },
  } as unknown as DiscreteMatrixEvent;
}

function text(message: { content?: unknown } | undefined): string {
  let content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part: { text?: string }) => part.text ?? '').join('');
  }
  return '';
}

// Everything but the trailing context message, which is rebuilt every turn.
function stablePrefix(messages: unknown[] | undefined) {
  return JSON.stringify(messages?.slice(0, -1));
}

function completion(
  overrides: Partial<ChatCompletion.Choice> = {},
  content: string | null = 'Objective: build a wedding planner.',
): ChatCompletion {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    created: 0,
    model: 'anthropic/claude-sonnet-5',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
        ...overrides,
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      cost: 0.01,
    } as ChatCompletion['usage'],
  };
}

function fakeOpenAI(response: ChatCompletion) {
  let requests: any[] = [];
  let openai = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          requests.push(request);
          return response;
        },
      },
    },
  } as unknown as OpenAI;
  return { openai, requests };
}

module('compaction', (hooks) => {
  let client: FakeMatrixClient;

  hooks.beforeEach(() => {
    client = new FakeMatrixClient();
  });

  module('isContextLengthExceededError', () => {
    for (let message of [
      'This endpoint\'s maximum context length is 200000 tokens. However, you requested about 230000 tokens (220000 of text input, 10000 in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.',
      'prompt is too long: 210000 tokens > 200000 maximum',
      'Your input exceeds the context window of this model. Please adjust your input and try again.',
      'The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).',
      'Prompt contains 140000 tokens and 0 draft tokens, too large for model with 131072 maximum context length',
    ]) {
      test(`detects "${message.slice(0, 40)}…"`, () => {
        assert.true(isContextLengthExceededError({ status: 400, message }));
      });
    }

    test('detects the OpenAI error code', () => {
      assert.true(
        isContextLengthExceededError({
          status: 400,
          message: '400 Bad request',
          code: 'context_length_exceeded',
        }),
      );
    });

    test('detects a message nested in the error body', () => {
      assert.true(
        isContextLengthExceededError({
          status: 400,
          message: '400 Provider returned error',
          error: { message: 'prompt is too long: 210000 tokens' },
        }),
      );
    });

    test('ignores rate limits and other errors', () => {
      assert.false(
        isContextLengthExceededError({
          status: 429,
          message: 'Rate limit reached: maximum context length per minute',
        }),
      );
      assert.false(
        isContextLengthExceededError({ status: 500, message: 'Server error' }),
      );
      assert.false(isContextLengthExceededError(undefined));
      assert.false(isContextLengthExceededError('prompt is too long'));
    });
  });

  module('prompt with a compaction event', () => {
    test('starts with the summary and leaves out the history before the cut point', async () => {
      let eventList = [
        userMessage('u1', 'Build a wedding planner'),
        botMessage('b1', 'Created WeddingPlanner card'),
        userMessage('u2', 'Add a guest list'),
        botMessage('b2', 'Added a guest list field'),
        compactionEvent('c1', 'u2', 'We created WeddingPlanner.'),
        userMessage('u3', 'Add a budget'),
      ];
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      assert.strictEqual(messages![0].role, 'system');
      assert.strictEqual(messages![1].role, 'user');
      assert.true(
        text(messages![1]).includes('We created WeddingPlanner.'),
        'the summary follows the system message',
      );
      let history = messages!.slice(2, -1).map(text);
      assert.deepEqual(history, ['Added a guest list field', 'Add a budget']);
      let all = messages!.map(text).join('\n');
      assert.false(all.includes('Build a wedding planner'));
      assert.false(all.includes('Created WeddingPlanner card'));
      assert.false(all.includes('Add a guest list\n'));
    });

    test('uses the latest compaction event', async () => {
      let eventList = [
        userMessage('u1', 'one'),
        botMessage('b1', 'answer one'),
        compactionEvent('c1', 'u1', 'First summary.'),
        userMessage('u2', 'two'),
        botMessage('b2', 'answer two'),
        compactionEvent('c2', 'u2', 'Second summary.'),
        userMessage('u3', 'three'),
      ];
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let all = messages!.map(text).join('\n');
      assert.true(all.includes('Second summary.'));
      assert.false(all.includes('First summary.'));
      assert.deepEqual(messages!.slice(2, -1).map(text), [
        'answer two',
        'three',
      ]);
    });

    test('ignores a compaction event that ai-bot did not send', async () => {
      let eventList = [
        userMessage('u1', 'one'),
        botMessage('b1', 'answer one'),
        compactionEvent('c1', 'b1', 'Forged summary.', userId),
        userMessage('u2', 'two'),
      ];
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let all = messages!.map(text).join('\n');
      assert.false(all.includes('Forged summary.'));
      assert.true(all.includes('one'));
    });

    test('the prompt prefix stays the same across two turns after a compaction', async () => {
      let eventList = [
        userMessage('u1', 'Build a wedding planner'),
        botMessage('b1', 'Created WeddingPlanner card'),
        compactionEvent('c1', 'u1', 'We started a wedding planner.'),
        userMessage('u2', 'Add a guest list'),
      ];
      let first = await getPromptParts(eventList, aiBotUserId, client);
      let second = await getPromptParts(
        [
          ...eventList,
          botMessage('b2', 'Added a guest list field'),
          userMessage('u3', 'Add a budget'),
        ],
        aiBotUserId,
        client,
      );
      // The cache marker sits on the last history message, so compare the
      // messages before it.
      let withoutMarker = (messages: unknown[] | undefined, count: number) =>
        JSON.stringify(
          JSON.parse(JSON.stringify(messages!.slice(0, count))).map(
            (message: { content: unknown }) => {
              if (Array.isArray(message.content)) {
                message.content = message.content.map(
                  ({ cache_control: _cacheControl, ...part }) => part,
                );
              }
              return message;
            },
          ),
        );
      let firstLength = first.messages!.length - 1;
      assert.strictEqual(
        withoutMarker(second.messages, firstLength),
        withoutMarker(first.messages, firstLength),
      );
    });
  });

  module('findCompactionCut', () => {
    test('cuts before the last finished answer', async () => {
      let history = await constructHistory(
        [
          userMessage('u1', 'one'),
          botMessage('b1', 'answer one'),
          userMessage('u2', 'two'),
          botMessage('b2', 'answer two'),
          userMessage('u3', 'three'),
        ],
        client,
      );
      assert.deepEqual(findCompactionCut(history, aiBotUserId), {
        upToEventId: 'u2',
        anchorEventId: 'b2',
      });
    });

    test('never separates a tool call from its result', async () => {
      let eventList = [
        userMessage('u1', 'Find authors'),
        toolCallMessage('b1', 'call-1'),
        toolResult('r1', 'b1', 'call-1'),
        botMessage('b2', 'Found two authors'),
        userMessage('u2', 'Thanks, now add a book'),
      ];
      let history = await constructHistory(eventList, client);
      let cut = findCompactionCut(history, aiBotUserId);
      assert.deepEqual(cut, { upToEventId: 'r1', anchorEventId: 'b2' });

      let { messages } = await getPromptParts(
        [...eventList, compactionEvent('c1', cut!.upToEventId, 'Summary.')],
        aiBotUserId,
        client,
      );
      assert.false(
        messages!.some((message) => message.role === 'tool'),
        'the tool result went with its call',
      );

      // A cut whose answer is the tool call keeps the call and its result.
      let toolHistory = await constructHistory(eventList.slice(0, 3), client);
      let toolCut = findCompactionCut(toolHistory, aiBotUserId);
      assert.deepEqual(toolCut, { upToEventId: 'u1', anchorEventId: 'b1' });
      let toolPrompt = await getPromptParts(
        [
          ...eventList.slice(0, 3),
          compactionEvent('c1', toolCut!.upToEventId, 'Summary.'),
        ],
        aiBotUserId,
        client,
      );
      let roles = toolPrompt.messages!.map((message) => message.role);
      assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'user']);
    });

    test('skips answers that ended in an error', async () => {
      let history = await constructHistory(
        [
          userMessage('u1', 'one'),
          botMessage('b1', 'answer one'),
          userMessage('u2', 'two'),
          botMessage(
            'b2',
            'There was an error processing your request, please try again later.',
            { errorMessage: 'prompt is too long' },
          ),
          userMessage('u3', 'three'),
        ],
        client,
      );
      assert.deepEqual(findCompactionCut(history, aiBotUserId), {
        upToEventId: 'u1',
        anchorEventId: 'b1',
      });
    });

    test('finds nothing to cut when the current compaction already covers it', async () => {
      let history = await constructHistory(
        [
          userMessage('u1', 'one'),
          botMessage('b1', 'answer one'),
          userMessage('u2', 'two'),
        ],
        client,
      );
      assert.strictEqual(
        findCompactionCut(history, aiBotUserId, {
          upToEventId: 'u1',
          summary: 'Summary.',
          summaryVersion: 1,
        }),
        undefined,
      );
      assert.strictEqual(
        findCompactionCut(
          await constructHistory([userMessage('u1', 'one')], client),
          aiBotUserId,
        ),
        undefined,
      );
    });
  });

  module('summaryFromCompletion', () => {
    test('accepts a complete prose answer', () => {
      assert.strictEqual(
        summaryFromCompletion(completion()),
        'Objective: build a wedding planner.',
      );
    });

    test('rejects a cut-off, empty or tool-calling answer', () => {
      assert.strictEqual(
        summaryFromCompletion(completion({ finish_reason: 'length' })),
        undefined,
      );
      assert.strictEqual(
        summaryFromCompletion(completion({}, '  ')),
        undefined,
      );
      assert.strictEqual(
        summaryFromCompletion(
          completion({
            message: {
              role: 'assistant',
              content: 'Summary',
              refusal: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'searchCards', arguments: '{}' },
                },
              ],
            },
          }),
        ),
        undefined,
      );
    });
  });

  module('compactRoomHistory', (nestedHooks) => {
    let eventList: DiscreteMatrixEvent[];

    nestedHooks.beforeEach(() => {
      eventList = [
        userMessage('u1', 'Build a wedding planner'),
        botMessage('b1', 'Created WeddingPlanner card'),
        userMessage('u2', 'Add a guest list'),
        botMessage('b2', 'Added a guest list field'),
        userMessage('u3', 'Add a budget'),
      ];
    });

    async function compact(response: ChatCompletion) {
      let { openai, requests } = fakeOpenAI(response);
      let costs: [number | undefined, string | undefined][] = [];
      let history = await constructHistory(eventList, client);
      let result = await compactRoomHistory({
        openai,
        client,
        roomId: 'room-1',
        aiBotUserId,
        eventList,
        history,
        senderMatrixUserId: userId,
        botTools: [],
        recordCost: async (cost, generationId) => {
          costs.push([cost, generationId]);
        },
      });
      return { result, requests, costs };
    }

    test('summarizes the prompt of the last accepted turn and posts the summary', async () => {
      let { result, requests, costs } = await compact(completion());

      // The summary request is the prompt of the turn that answered b2,
      // with the instruction in place of its trailing context message.
      let acceptedTurn = await getPromptParts(
        eventList.slice(0, 3),
        aiBotUserId,
        client,
      );
      assert.strictEqual(requests.length, 1);
      let request = requests[0];
      assert.false(request.stream);
      assert.strictEqual(request.stream_options, undefined);
      assert.strictEqual(
        stablePrefix(request.messages),
        stablePrefix(acceptedTurn.messages),
        'the request reuses the cached prefix of the accepted turn',
      );
      assert.strictEqual(
        text(request.messages[request.messages.length - 1]),
        COMPACTION_SUMMARY_INSTRUCTION,
      );
      assert.deepEqual(costs, [[0.01, 'gen-1']]);

      let sent = client.getSentEvents();
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].eventType, APP_BOXEL_COMPACTION_EVENT_TYPE);
      assert.deepEqual(sent[0].content, {
        upToEventId: 'u2',
        summary: 'Objective: build a wedding planner.',
        summaryVersion: 1,
      });

      assert.true(result.compacted);
      if (!result.compacted) {
        return;
      }
      let { messages } = await getPromptParts(
        result.eventList,
        aiBotUserId,
        client,
      );
      assert.true(
        text(messages![1]).includes('Objective: build a wedding planner.'),
      );
      assert.deepEqual(messages!.slice(2, -1).map(text), [
        'Added a guest list field',
        'Add a budget',
      ]);
    });

    test('posts nothing when the summary is cut off', async () => {
      let { result, costs } = await compact(
        completion({ finish_reason: 'length' }),
      );
      assert.false(result.compacted);
      assert.strictEqual(client.getSentEvents().length, 0);
      assert.deepEqual(costs, [[0.01, 'gen-1']], 'the call is still charged');
    });

    test('does not call the model when there is nothing to compact', async () => {
      eventList = [userMessage('u1', 'Build a wedding planner')];
      let { result, requests } = await compact(completion());
      assert.false(result.compacted);
      assert.strictEqual(requests.length, 0);
    });
  });
});
