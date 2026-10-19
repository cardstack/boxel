import QUnit from 'qunit';
const { module, test, assert } = QUnit;
import type OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import {
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
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
  isSkillFileUrl,
  MAX_CARRIED_SKILL_FILE_BYTES,
  type PromptParts,
} from '@cardstack/runtime-common/ai';
import {
  buildCompactionRequest,
  compactRoomHistory,
  fitCompactionContent,
  isContextLengthExceededError,
  MAX_COMPACTION_CONTENT_BYTES,
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
  carried: Record<string, unknown> = {},
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_COMPACTION_EVENT_TYPE,
    room_id: 'room-1',
    sender,
    event_id: eventId,
    origin_server_ts: ts++,
    content: {
      status: 'done',
      upToEventId,
      summary,
      summaryVersion: 1,
      ...carried,
    },
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
  let requestOptions: any[] = [];
  let openai = {
    chat: {
      completions: {
        create: async (request: unknown, options?: unknown) => {
          requests.push(request);
          requestOptions.push(options);
          return response;
        },
      },
    },
  } as unknown as OpenAI;
  return { openai, requests, requestOptions };
}

module('compaction', (hooks) => {
  let client: FakeMatrixClient;

  hooks.beforeEach(() => {
    client = new FakeMatrixClient();
  });

  module('carrying the skill files read before the cut', (nestedHooks) => {
    const skillsRealm = 'http://localhost:4201/skills/';
    const catalogReuse = `${skillsRealm}catalog-reuse/SKILL.md`;
    const catalogReuseRef = `${skillsRealm}catalog-reuse/references/search.md`;
    const sourceEditing = `${skillsRealm}source-code-editing/SKILL.md`;
    const sourceFile = 'http://localhost:4201/user/desk/ticket.gts';

    // Matrix media is cached by URL across tests, so every file a test
    // attaches gets a URL of its own.
    let mediaCount = 0;
    let mediaTexts: Map<string, string>;
    let originalFetch: typeof globalThis.fetch;

    nestedHooks.beforeEach(() => {
      mediaTexts = new Map();
      originalFetch = globalThis.fetch;
      (globalThis as any).fetch = async (url: string) => {
        let body = mediaTexts.get(url);
        if (body === undefined) {
          return { ok: false, status: 404, text: async () => '' };
        }
        return { ok: true, status: 200, text: async () => body };
      };
    });

    nestedHooks.afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function readCall(
      eventId: string,
      toolCallId: string,
      name = 'readRealmFile',
    ) {
      return botMessage(eventId, '', {
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          { id: toolCallId, name, arguments: JSON.stringify({ urls: [] }) },
        ],
      });
    }

    function readResult(
      eventId: string,
      requestEventId: string,
      toolCallId: string,
      files: Record<string, string | undefined>,
      opts: { sender?: string; key?: string } = {},
    ): DiscreteMatrixEvent {
      let attachedFiles = Object.entries(files).map(([sourceUrl, body]) => {
        let url = `http://localhost:8008/_matrix/media/v3/download/localhost/file-${mediaCount++}`;
        if (body !== undefined) {
          mediaTexts.set(url, body);
        }
        return {
          sourceUrl,
          url,
          name: sourceUrl.split('/').pop(),
          contentType: 'text/plain',
          contentSize: body?.length ?? 0,
        };
      });
      return {
        type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
        room_id: 'room-1',
        sender: opts.sender ?? aiBotUserId,
        event_id: eventId,
        origin_server_ts: ts++,
        content: {
          'm.relates_to': {
            event_id: requestEventId,
            rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
            key: opts.key ?? 'applied',
          },
          msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: toolCallId,
          data: JSON.stringify({ context: {}, attachedFiles }),
        },
      } as unknown as DiscreteMatrixEvent;
    }

    // A room where the model read two skills and a source file, then the
    // history through u2 was compacted.
    function room(
      read: DiscreteMatrixEvent[],
      carried: Record<string, unknown> = {},
    ) {
      return [
        userMessage('u1', 'Build a service desk from the catalog'),
        readCall('b1', 'call-1'),
        ...read,
        botMessage('b2', 'I read the skills.'),
        userMessage('u2', 'Add a ticket card'),
        botMessage('b3', 'Added a ticket card.'),
        compactionEvent(
          'c1',
          'u2',
          'We are reusing catalog cards.',
          aiBotUserId,
          carried,
        ),
        userMessage('u3', 'Add a priority field'),
      ];
    }

    test('follows the summary with the skill files read before the cut', async () => {
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
          [sourceFile]: 'export class Ticket {}',
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);

      assert.true(text(messages![1]).includes('We are reusing catalog cards.'));
      assert.strictEqual(messages![2].role, 'user');
      let carried = text(messages![2]);
      assert.true(
        carried.includes(
          `[SKILL.md](${catalogReuse}):\n  1: Search the catalog before writing a card.`,
        ),
        'the skill file is carried as the model first read it',
      );
      assert.false(
        messages!.map(text).join('\n').includes('export class Ticket'),
        'a file that is not part of a skill is not carried',
      );
      assert.deepEqual(messages!.slice(3, -1).map(text), [
        'Added a ticket card.',
        'Add a priority field',
      ]);
    });

    test('carries only the reads a compaction lists, when it lists them', async () => {
      let read = () =>
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
        });
      let listed = await getPromptParts(
        room([read()], { skillFileEventIds: ['r1'] }),
        aiBotUserId,
        client,
      );
      assert.true(
        text(listed.messages![2]).includes('Search the catalog'),
        'a listed read is carried',
      );
      let unlisted = await getPromptParts(
        room([read()], { skillFileEventIds: [] }),
        aiBotUserId,
        client,
      );
      assert.false(
        unlisted.messages!.map(text).join('\n').includes('Search the catalog'),
      );
    });

    test('carries a listed read without the request that made it', async () => {
      // `getRoomEvents` fetches a listed read back on its own: the answer
      // that called readRealmFile is before the cut and is not loaded.
      let eventList = [
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
        }),
        userMessage('u2', 'Add a ticket card'),
        botMessage('b3', 'Added a ticket card.'),
        compactionEvent('c1', 'u2', 'Summary.', aiBotUserId, {
          skillFileEventIds: ['r1'],
          toolSourceEventIds: [],
          usedToolCallIds: [],
        }),
        userMessage('u3', 'Add a priority field'),
      ];
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      assert.true(text(messages![2]).includes('Search the catalog'));
    });

    test('carries the newest read of a file once, in the order the files were read', async () => {
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Old catalog guidance.',
          [catalogReuseRef]: 'Search answers are entries.',
        }),
        readCall('b1b', 'call-2'),
        readResult('r2', 'b1b', 'call-2', {
          [sourceEditing]: 'Edit with realm.fs.replace.',
          [catalogReuse]: 'New catalog guidance.',
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let carried = text(messages![2]);
      assert.false(carried.includes('Old catalog guidance.'));
      let order = [
        'Search answers are entries.',
        'Edit with realm.fs.replace.',
        'New catalog guidance.',
      ].map((line) => carried.indexOf(line));
      assert.true(order.every((index) => index >= 0));
      assert.deepEqual(
        order,
        [...order].sort((a, b) => a - b),
      );
    });

    test('keeps the carried files byte-stable while the conversation goes on', async () => {
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
        }),
      ]);
      let first = await getPromptParts(eventList, aiBotUserId, client);
      let later = await getPromptParts(
        [
          ...eventList,
          readCall('b4', 'call-3'),
          readResult('r3', 'b4', 'call-3', {
            [catalogReuse]: 'Edited catalog guidance.',
          }),
          botMessage('b5', 'Added a priority field.'),
          userMessage('u4', 'Add an assignee'),
        ],
        aiBotUserId,
        client,
      );
      assert.strictEqual(
        JSON.stringify(later.messages!.slice(0, 3)),
        JSON.stringify(first.messages!.slice(0, 3)),
        'a read after the cut does not change what is carried',
      );
    });

    test('names the files past the size limit for the model to read again', async () => {
      let big = (letter: string) =>
        letter.repeat(Math.floor(MAX_CARRIED_SKILL_FILE_BYTES * 0.4));
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: big('a'),
          [catalogReuseRef]: big('b'),
          [sourceEditing]: big('c'),
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let carried = text(messages![2]);
      assert.false(
        carried.includes(big('a')),
        'the oldest read is not carried',
      );
      assert.true(carried.includes(big('b')));
      assert.true(carried.includes(big('c')));
      assert.true(
        carried.includes(
          `Read them again with readRealmFile before relying on them:\n${catalogReuse}`,
        ),
      );
    });

    test('carries an older file that still fits after a newer one that does not', async () => {
      let sized = (letter: string, share: number) =>
        letter.repeat(Math.floor(MAX_CARRIED_SKILL_FILE_BYTES * share));
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: sized('a', 0.3),
          [catalogReuseRef]: sized('b', 0.5),
          [sourceEditing]: sized('c', 0.6),
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let carried = text(messages![2]);
      assert.true(carried.includes(sized('c', 0.6)), 'the newest is carried');
      assert.false(carried.includes(sized('b', 0.5)), 'the next does not fit');
      assert.true(carried.includes(sized('a', 0.3)), 'the oldest still fits');
      assert.true(
        carried.includes(`before relying on them:\n${catalogReuseRef}`),
      );
    });

    test('names a file that cannot be downloaded for the model to read again', async () => {
      let eventList = room([
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: undefined,
          [sourceEditing]: 'Edit with realm.fs.replace.',
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let carried = text(messages![2]);
      assert.true(carried.includes('Edit with realm.fs.replace.'));
      assert.true(carried.includes(`before relying on them:\n${catalogReuse}`));
      assert.false(carried.includes('Error loading attached file'));
    });

    test('leaves out the files of a skill the user disabled', async () => {
      let disabledSkillUrl = `http://localhost:8008/_matrix/media/v3/download/localhost/file-${mediaCount++}`;
      mediaTexts.set(
        disabledSkillUrl,
        '---\nboxel:\n  kind: skill\n---\nSearch the catalog.',
      );
      let eventList = room([
        {
          type: APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
          room_id: 'room-1',
          sender: userId,
          event_id: 'skills',
          state_key: '',
          origin_server_ts: ts++,
          content: {
            enabledSkillCards: [],
            disabledSkillCards: [
              {
                sourceUrl: catalogReuse,
                url: disabledSkillUrl,
                name: 'SKILL.md',
                contentType: 'text/markdown',
              },
            ],
          },
        } as unknown as DiscreteMatrixEvent,
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
          [catalogReuseRef]: 'Search answers are entries.',
          [sourceEditing]: 'Edit with realm.fs.replace.',
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      let all = messages!.map(text).join('\n');
      assert.true(all.includes('Edit with realm.fs.replace.'));
      assert.false(all.includes('Search the catalog'));
      assert.false(all.includes('Search answers are entries.'));
      assert.false(
        text(messages![2]).includes(catalogReuse),
        'nor is it named to read again',
      );
    });

    test('ignores skill-named files that did not come from an applied readRealmFile', async () => {
      let eventList = room([
        readResult(
          'r1',
          'b1',
          'call-1',
          { [catalogReuse]: 'A failed read.' },
          { key: 'failed' },
        ),
        readResult(
          'r1b',
          'b1',
          'call-1',
          { [sourceEditing]: 'Posted by the user.' },
          { sender: userId },
        ),
        readCall('b1b', 'call-2', 'readUrl'),
        readResult('r2', 'b1b', 'call-2', {
          'https://example.com/skills/evil/SKILL.md': 'A web page.',
        }),
      ]);
      let { messages } = await getPromptParts(eventList, aiBotUserId, client);
      assert.strictEqual(
        messages!.length,
        5,
        'only the system message, the summary, two history messages and the context',
      );
    });

    test('a compaction lists the reads before its cut and carries them forward', async () => {
      let eventList = [
        userMessage('u1', 'Build a service desk'),
        readCall('b1', 'call-1'),
        readResult('r1', 'b1', 'call-1', {
          [catalogReuse]: 'Search the catalog before writing a card.',
        }),
        botMessage('b2', 'I read the skill.'),
        userMessage('u2', 'Add a ticket card'),
        readCall('b3', 'call-2'),
        readResult('r2', 'b3', 'call-2', {
          [sourceEditing]: 'Edit with realm.fs.replace.',
        }),
        botMessage('b4', 'Added a ticket card.'),
        userMessage('u3', 'Add a priority field'),
      ];
      let compact = async (events: DiscreteMatrixEvent[]) => {
        let { openai } = fakeOpenAI(completion());
        return await compactRoomHistory({
          openai,
          client,
          roomId: 'room-1',
          aiBotUserId,
          eventList: events,
          history: await constructHistory(events, client),
          senderMatrixUserId: userId,
          botTools: [],
          recordCost: async () => {},
        });
      };

      let result = await compact(eventList);
      assert.true(result.compacted);
      let sent = client.getSentEvents();
      assert.deepEqual(sent[sent.length - 1].content.skillFileEventIds, [
        'r1',
        'r2',
      ]);
      if (!result.compacted) {
        return;
      }
      let carried = text(
        (await getPromptParts(result.eventList, aiBotUserId, client))
          .messages![2],
      );
      assert.true(carried.includes('Search the catalog'));
      assert.true(carried.includes('Edit with realm.fs.replace.'));

      // The next compaction keeps listing r1 although the request that
      // made it is no longer loaded, as `getRoomEvents` returns it.
      let compaction = result.eventList[result.eventList.length - 1];
      let next = await compact([
        eventList[2],
        ...eventList.slice(6),
        compaction,
        botMessage('b5', 'Added a priority field.'),
        userMessage('u4', 'Add an assignee'),
      ]);
      assert.true(next.compacted);
      sent = client.getSentEvents();
      assert.deepEqual(sent[sent.length - 1].content.skillFileEventIds, [
        'r1',
        'r2',
      ]);
    });
  });

  module('isSkillFileUrl', () => {
    test("recognizes a skill's SKILL.md and its references", () => {
      assert.true(isSkillFileUrl('http://localhost:4201/skills/a/SKILL.md'));
      assert.true(
        isSkillFileUrl('http://localhost:4201/skills/a/references/b.md'),
      );
      assert.true(isSkillFileUrl('http://localhost:4201/skills/a/SKILL.md?x'));
      assert.false(isSkillFileUrl('http://localhost:4201/skills/a/notes.md'));
      assert.false(
        isSkillFileUrl('http://localhost:4201/skills/a/references/b.gts'),
      );
      assert.false(
        isSkillFileUrl('http://localhost:4201/skills/a/references/c/b.md'),
        'only a file directly in references/',
      );
      assert.false(
        isSkillFileUrl('http://localhost:4201/user/references/notes/b.md'),
      );
      assert.false(isSkillFileUrl('SKILL.md'));
      assert.false(isSkillFileUrl(undefined));
    });
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

    test('detects a provider message that OpenRouter wraps in metadata', () => {
      assert.true(
        isContextLengthExceededError({
          status: 400,
          message: '400 Provider returned error',
          error: {
            message: 'Provider returned error',
            code: 400,
            metadata: {
              provider_name: 'Inceptron',
              raw: JSON.stringify({
                error: {
                  message:
                    "This model's maximum context length is 262144 tokens. However, you requested 94372 output tokens and your prompt contains at least 167773 input tokens, for a total of at least 262145 tokens.",
                },
              }),
            },
          },
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

    test('ignores a compaction that is running or failed', async () => {
      for (let status of ['running', 'failed']) {
        let event = compactionEvent('c1', 'b1', 'Not a summary.');
        (event.content as unknown as { status: string }).status = status;
        let { messages } = await getPromptParts(
          [
            userMessage('u1', 'one'),
            botMessage('b1', 'answer one'),
            event,
            userMessage('u2', 'two'),
          ],
          aiBotUserId,
          client,
        );
        let all = messages!.map(text).join('\n');
        assert.false(all.includes('Not a summary.'), status);
        assert.true(all.includes('answer one'), status);
      }
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

  module('buildCompactionRequest', () => {
    function parts(toolChoice: PromptParts['toolChoice']): PromptParts {
      return {
        shouldRespond: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'searchCards',
              description: 'Searches cards',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        messages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'find authors' },
          { role: 'user', content: 'context' },
        ],
        model: 'anthropic/claude-sonnet-5',
        history: [],
        toolChoice,
        toolsSupported: true,
        reasoningEffort: undefined,
      };
    }

    test('keeps the tool choice of the accepted turn', () => {
      assert.strictEqual(
        buildCompactionRequest(parts('auto')).tool_choice,
        'auto',
      );
    });

    test('never forces a tool call on the summary', () => {
      assert.strictEqual(
        buildCompactionRequest(
          parts({ type: 'function', function: { name: 'searchCards' } }),
        ).tool_choice,
        'none',
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

    async function compact(
      response: ChatCompletion,
      opts: { signal?: AbortSignal } = {},
    ) {
      let { openai, requests, requestOptions } = fakeOpenAI(response);
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
        responseEventId: 'response-1',
        signal: opts.signal,
        recordCost: async (cost, generationId) => {
          costs.push([cost, generationId]);
        },
      });
      return { result, requests, requestOptions, costs };
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
      assert.deepEqual(
        sent.map((event) => event.eventType),
        [APP_BOXEL_COMPACTION_EVENT_TYPE, APP_BOXEL_COMPACTION_EVENT_TYPE],
      );
      assert.deepEqual(sent[0].content, {
        status: 'running',
        responseEventId: 'response-1',
      });
      assert.deepEqual(sent[1].content, {
        status: 'done',
        responseEventId: 'response-1',
        upToEventId: 'u2',
        summary: 'Objective: build a wedding planner.',
        summaryVersion: 1,
        usedToolCallIds: [],
        toolSourceEventIds: [],
        skillFileEventIds: [],
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

    test('carries forward the tool-call ids the room has used', async () => {
      eventList = [
        {
          type: APP_BOXEL_COMPACTION_EVENT_TYPE,
          sender: aiBotUserId,
          event_id: 'earlier-compaction',
          origin_server_ts: 0,
          room_id: 'room-1',
          content: {
            status: 'done',
            upToEventId: 'before-this-history',
            summary: 'Objective: plan a wedding.',
            summaryVersion: 1,
            usedToolCallIds: ['x:0', 'x:0_1', 'x:0_2'],
          },
        } as unknown as DiscreteMatrixEvent,
        ...eventList,
        {
          type: 'app.boxel.toolResult',
          sender: userId,
          event_id: 'result-1',
          origin_server_ts: 6,
          room_id: 'room-1',
          content: { commandRequestId: 'y:0' },
        } as unknown as DiscreteMatrixEvent,
      ];
      let { result } = await compact(completion());

      assert.true(result.compacted);
      assert.deepEqual(client.getSentEvents()[1].content.usedToolCallIds, [
        'x:0',
        'x:0_2',
        'y:0',
      ]);
    });

    test('carries forward the events that contributed tools', async () => {
      eventList[0] = {
        ...eventList[0],
        content: {
          ...eventList[0].content,
          data: {
            context: {
              tools: [
                {
                  type: 'function',
                  function: { name: 'planWedding', parameters: {} },
                },
              ],
            },
          },
        },
      } as unknown as DiscreteMatrixEvent;
      let { result } = await compact(completion());

      assert.true(result.compacted);
      assert.deepEqual(client.getSentEvents()[1].content.toolSourceEventIds, [
        'u1',
      ]);
    });

    test('marks the compaction failed when the summary is cut off', async () => {
      let { result, costs } = await compact(
        completion({ finish_reason: 'length' }),
      );
      assert.false(result.compacted);
      assert.false(!result.compacted && result.nothingToCompact);
      assert.deepEqual(
        client.getSentEvents().map((event) => event.content.status),
        ['running', 'failed'],
      );
      assert.deepEqual(costs, [[0.01, 'gen-1']], 'the call is still charged');
    });

    test("keeps the summary that the accepted turn's own compaction made", async () => {
      // The turn that answered b2 had been compacted: its compaction event
      // follows b2's placeholder in the room, yet its prompt used the summary.
      eventList = [
        userMessage('u1', 'Build a wedding planner'),
        botMessage('b1', 'Created WeddingPlanner card'),
        userMessage('u2', 'Add a guest list'),
        botMessage('b2', 'Added a guest list field'),
        {
          ...compactionEvent('c1', 'u1', 'We started a wedding planner.'),
          content: {
            status: 'done',
            responseEventId: 'b2',
            upToEventId: 'u1',
            summary: 'We started a wedding planner.',
            summaryVersion: 1,
          },
        } as unknown as DiscreteMatrixEvent,
        userMessage('u3', 'Add a budget'),
      ];
      let { requests } = await compact(completion());
      let sent = requests[0].messages.map(text).join('\n');
      assert.true(
        sent.includes('We started a wedding planner.'),
        'the request carries the summary the accepted turn used',
      );
      assert.false(
        sent.includes('Build a wedding planner'),
        'and not the history that summary replaced',
      );
      assert.true(sent.includes('Created WeddingPlanner card'));
      assert.true(sent.includes('Add a guest list'));
    });

    test('passes the cancel signal to the summary request', async () => {
      let controller = new AbortController();
      let { requestOptions } = await compact(completion(), {
        signal: controller.signal,
      });
      assert.strictEqual(requestOptions[0]?.signal, controller.signal);
    });

    test('does not call the model when there is nothing to compact', async () => {
      eventList = [userMessage('u1', 'Build a wedding planner')];
      let { result, requests } = await compact(completion());
      assert.false(result.compacted);
      assert.true(!result.compacted && result.nothingToCompact);
      assert.strictEqual(requests.length, 0);
      assert.strictEqual(client.getSentEvents().length, 0);
    });
  });
});

module('fitCompactionContent', () => {
  test('trims what a compaction carries to fit the event size limit', () => {
    let content = {
      status: 'done' as const,
      upToEventId: '$cut',
      summary: 'x'.repeat(40_000),
      summaryVersion: 1,
      usedToolCallIds: Array.from(
        { length: 600 },
        (_, i) => `toolu_${String(i).padStart(30, '0')}`,
      ),
      toolSourceEventIds: Array.from(
        { length: 200 },
        (_, i) => `$${String(i).padStart(43, '0')}`,
      ),
      skillFileEventIds: Array.from(
        { length: 250 },
        (_, i) => `$skill${String(i).padStart(38, '0')}`,
      ),
    };
    let fitted = fitCompactionContent(content);

    assert.true(
      Buffer.byteLength(JSON.stringify(fitted)) <= MAX_COMPACTION_CONTENT_BYTES,
    );
    assert.strictEqual(fitted.summary, content.summary);
    assert.true(fitted.usedToolCallIds!.length < 600);
    assert.deepEqual(
      fitted.usedToolCallIds,
      content.usedToolCallIds.slice(-fitted.usedToolCallIds!.length),
      'the most recent used ids are kept',
    );
    assert.deepEqual(
      fitted.toolSourceEventIds,
      content.toolSourceEventIds.slice(0, fitted.toolSourceEventIds!.length),
      'the earliest tool sources are kept',
    );
    assert.true(fitted.skillFileEventIds!.length < 250);
    assert.deepEqual(
      fitted.skillFileEventIds,
      content.skillFileEventIds.slice(-fitted.skillFileEventIds!.length),
      'the latest skill file reads are kept',
    );
  });

  test('leaves content that fits as it is', () => {
    let content = {
      status: 'done' as const,
      upToEventId: '$cut',
      summary: 'summary',
      summaryVersion: 1,
      usedToolCallIds: ['x:0'],
      toolSourceEventIds: ['$source'],
    };
    assert.strictEqual(fitCompactionContent(content), content);
  });
});
