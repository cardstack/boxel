import { module, test, assert } from 'qunit';
import { Responder } from '../lib/responder';
import { DEFAULT_EVENT_SIZE_MAX } from '../lib/matrix/response-publisher';
import FakeTimers from '@sinonjs/fake-timers';
import { thinkingMessage } from '../constants';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import type { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY,
  APP_BOXEL_CONTINUATION_OF_CONTENT_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import type OpenAI from 'openai';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import { OpenAIError } from 'openai';

function snapshotWithContent(content: string): ChatCompletionSnapshot {
  return {
    choices: [
      {
        message: {
          content: content,
        },
        finish_reason: null,
        logprobs: null,
        index: 0,
      },
    ],
    id: '',
    created: 0,
    model: 'llm',
  };
}

function chunkWithReasoning(
  reasoning: string,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    choices: [
      {
        delta: {
          // @ts-expect-error  Type '{ reasoning: string; }' is not assignable to type 'Delta'.
          reasoning: reasoning,
        },
        finish_reason: null,
        logprobs: null,
        index: 0,
      },
    ],
    id: '',
    created: 0,
    model: 'llm',
  };
}

function snapshotWithToolCall(
  commandRequest: Partial<CommandRequest>,
): ChatCompletionSnapshot {
  let toolCall = {
    type: 'function',
  } as any;
  if (commandRequest.arguments) {
    toolCall.function = (toolCall.function ?? {}) as any;
    toolCall.function.arguments = JSON.stringify(commandRequest.arguments);
  }
  if (commandRequest.name) {
    toolCall.function = (toolCall.function ?? {}) as any;
    toolCall.function.name = commandRequest.name;
  }
  if (commandRequest.id) {
    toolCall.id = commandRequest.id;
  }
  return {
    choices: [
      {
        message: {
          tool_calls: [toolCall],
        },
        finish_reason: null,
        logprobs: null,
        index: 0,
      },
    ],
    id: '',
    created: 0,
    model: 'llm',
  };
}

module('Responding', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let responder: Responder;
  let clock: FakeTimers.InstalledClock;

  hooks.beforeEach(() => {
    clock = FakeTimers.install();
    fakeMatrixClient = new FakeMatrixClient();
    responder = new Responder(fakeMatrixClient, 'room-id', 'abc123agentId');
  });

  hooks.afterEach(() => {
    clock.runToLast();
    clock.uninstall();
    responder.finalize();
    fakeMatrixClient.resetSentEvents();
    responder.matrixResponsePublisher.eventSizeMax = DEFAULT_EVENT_SIZE_MAX;
  });

  test('Sends thinking message', async () => {
    await responder.ensureThinkingMessageSent();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'One event should be sent');
    assert.equal(
      sentEvents[0].eventType,
      'm.room.message',
      `Event type should be m.room.message`,
    );
    assert.equal(
      sentEvents[0].content.msgtype,
      'app.boxel.message',
      'Message type should be app.boxel.message',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Reasoning content should be thinking message',
    );
    assert.equal(sentEvents[0].content.body, '', 'Body should be empty');
    assert.equal(
      JSON.parse(sentEvents[0].content.data).context.agentId,
      'abc123agentId',
      'agentId should be sent',
    );

    await responder.ensureThinkingMessageSent();
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'Still only one event');
  });

  test('Sends first content message immediately, replace the thinking message', async () => {
    await responder.ensureThinkingMessageSent();

    // Send several messages
    for (let i = 0; i < 10; i++) {
      await responder.onChunk({} as any, snapshotWithContent('content ' + i));
    }

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Only the initial message and one content message should be sent',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Just the thinking message sent in reasoning',
    );
    assert.equal(
      sentEvents[0].content.body,
      '',
      'Initial body should be empty',
    );

    assert.equal(
      sentEvents[1].content.body,
      'content 0',
      'The first new content message should be sent',
    );
    assert.equal(
      sentEvents[1].content[APP_BOXEL_REASONING_CONTENT_KEY],
      '',
      'No reasoning in content message',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The first content should replace the original thinking message',
    );
    assert.equal(
      JSON.parse(sentEvents[1].content.data).context.agentId,
      'abc123agentId',
      'agentId should be sent',
    );
  });

  test('Sends first content message immediately, only sends new content updates after 250ms, replacing the thinking message', async () => {
    await responder.ensureThinkingMessageSent();

    // Send several messages
    for (let i = 0; i < 10; i++) {
      await responder.onChunk({} as any, snapshotWithContent('content ' + i));
    }

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Only the initial message and one content message should be sent',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Just the thinking message sent in reasoning',
    );
    assert.equal(
      sentEvents[0].content.body,
      '',
      'Initial body should be empty',
    );

    assert.equal(
      sentEvents[1].content.body,
      'content 0',
      'The first new content message should be sent',
    );
    assert.equal(
      sentEvents[1].content[APP_BOXEL_REASONING_CONTENT_KEY],
      '',
      'No reasoning in content message',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The first content should replace the original thinking message',
    );

    await responder.flush();
    sentEvents = fakeMatrixClient.getSentEvents();

    assert.equal(
      sentEvents.length,
      3,
      'Only the initial message and two content messages should be sent',
    );

    assert.equal(
      sentEvents[2].content.body,
      'content 9',
      'The last new content message should be sent',
    );
    assert.equal(
      sentEvents[2].content[APP_BOXEL_REASONING_CONTENT_KEY],
      '',
      'No reasoning in content message',
    );
    assert.deepEqual(
      sentEvents[2].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The updated content should replace the original thinking message',
    );
  });

  test('Sends tool call event and replaces thinking message when tool call happens with no content', async () => {
    const patchArgs = {
      description: 'A new thing',
      attributes: {
        cardId: 'card/1',
        patch: {
          attributes: {
            some: 'thing',
          },
        },
      },
    };

    await responder.ensureThinkingMessageSent();

    await responder.onChunk(
      {} as any,
      snapshotWithToolCall({
        id: 'some-tool-call-id',
        name: 'patchCardInstance',
        arguments: patchArgs,
      }),
    );

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Thinking message and tool call event should be sent',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Thinking message should be sent first in reasoning',
    );
    assert.equal(
      sentEvents[0].content.body,
      '',
      'Initial body should be empty',
    );
    assert.deepEqual(
      sentEvents[1].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          id: 'some-tool-call-id',
          name: 'patchCardInstance',
          arguments:
            '{"description":"A new thing","attributes":{"cardId":"card/1","patch":{"attributes":{"some":"thing"}}}}',
        },
      ],
      'Tool call event should be sent with correct content',
    );
    assert.deepEqual(sentEvents[1].content.body, '', 'Body text is empty');
    assert.equal(
      sentEvents[1].content[APP_BOXEL_REASONING_CONTENT_KEY],
      '',
      'No reasoning in tool call message',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The tool call event should replace the thinking message',
    );
    assert.equal(
      JSON.parse(sentEvents[1].content.data).context.agentId,
      'abc123agentId',
      'agentId should be sent',
    );
  });

  test('Sends tool call event with content when content is sent before tool call', async () => {
    const patchArgs = {
      description: 'A new thing',
      attributes: {
        cardId: 'card/1',
        patch: {
          attributes: {
            some: 'thing',
          },
        },
      },
    };
    await responder.ensureThinkingMessageSent();

    await responder.onChunk({} as any, snapshotWithContent('some content'));

    await responder.onChunk(
      {} as any,
      snapshotWithToolCall({
        name: 'patchCardInstance',
        arguments: { description: 'A new' },
      }),
    );

    await responder.flush();

    await responder.onChunk(
      {} as any,
      snapshotWithToolCall({
        id: 'some-tool-call-id',
        name: 'patchCardInstance',
        arguments: patchArgs,
      }),
    );

    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      4,
      'Thinking message, and event with content, event with partial tool call, and event with full tool call should be sent',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Thinking message should be sent first in reasoning',
    );
    assert.equal(
      sentEvents[0].content.body,
      '',
      'Initial body should be empty',
    );
    assert.deepEqual(
      sentEvents[2].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          name: 'patchCardInstance',
          arguments: '{"description":"A new"}',
        },
      ],
      'Partial tool call event should be sent with correct content',
    );
    assert.deepEqual(
      sentEvents[3].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          id: 'some-tool-call-id',
          name: 'patchCardInstance',
          arguments:
            '{"description":"A new thing","attributes":{"cardId":"card/1","patch":{"attributes":{"some":"thing"}}}}',
        },
      ],
      'Tool call event should be sent with correct content',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Thinking message should be sent first in reasoning',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The replacement event with content should replace the original message',
    );
    assert.deepEqual(
      sentEvents[2].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The replacement event with the partial tool call event should replace the original message',
    );
    assert.deepEqual(
      sentEvents[3].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The replacement event with the tool call event should replace the original message',
    );
    assert.deepEqual(
      sentEvents[3].content.isStreamingFinished,
      true,
      'The tool call event should be sent together with isStreamingFinished set to true',
    );
    assert.equal(
      JSON.parse(sentEvents[3].content.data).context.agentId,
      'abc123agentId',
      'agentId should be sent',
    );
  });

  test('Handles multiple tool calls', async () => {
    const weatherCheck1Args = {
      description: 'Check the weather in NYC',
      attributes: {
        zipCode: '10011',
      },
    };
    const weatherCheck2Args = {
      description: 'Check the weather in Beverly Hills',
      attributes: {
        zipCode: '90210',
      },
    };
    await responder.ensureThinkingMessageSent();

    await responder.onChunk({} as any, snapshotWithContent('some content'));

    let snapshot = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'tool-call-1-id',
                type: 'function' as 'function',
                function: {
                  name: 'checkWeather',
                  arguments: JSON.stringify(weatherCheck1Args),
                },
              },
              {
                id: 'tool-call-2-id',
                type: 'function' as 'function',
                function: {
                  name: 'checkWeather',
                  arguments: JSON.stringify(weatherCheck2Args),
                },
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
          index: 0,
        },
      ],
      id: '',
      created: 0,
      model: 'llm',
    };
    await responder.onChunk({} as any, snapshot);

    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      3,
      'Thinking message, and event with content, and event with two tool calls should be sent',
    );
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Thinking message should be sent first in reasoning',
    );
    assert.equal(
      sentEvents[0].content.body,
      '',
      'Initial body should be empty',
    );
    assert.deepEqual(
      sentEvents[2].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          id: 'tool-call-1-id',
          name: 'checkWeather',
          arguments:
            '{"description":"Check the weather in NYC","attributes":{"zipCode":"10011"}}',
        },
        {
          id: 'tool-call-2-id',
          name: 'checkWeather',
          arguments:
            '{"description":"Check the weather in Beverly Hills","attributes":{"zipCode":"90210"}}',
        },
      ],
      'Command requests should be sent with correct content',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The replacement event with content should replace the original message',
    );
    assert.deepEqual(
      sentEvents[2].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The replacement event with the tool calls should replace the original message',
    );
    assert.equal(
      JSON.parse(sentEvents[2].content.data).context.agentId,
      'abc123agentId',
      'agentId should be sent',
    );
  });

  test('Handles an empty tool call by eliding it (gpt-5 produces this at the time of this writing)', async () => {
    const weatherCheckArgs = {
      description: 'Check the weather in NYC',
      attributes: {
        zipCode: '10011',
      },
    };
    await responder.ensureThinkingMessageSent();

    await responder.onChunk({} as any, snapshotWithContent('some content'));

    let snapshot = {
      choices: [
        {
          message: {
            tool_calls: [
              undefined,
              {
                id: 'tool-call-1-id',
                type: 'function' as 'function',
                function: {
                  name: 'checkWeather',
                  arguments: JSON.stringify(weatherCheckArgs),
                },
              },
            ],
          },
          finish_reason: null,
          logprobs: null,
          index: 0,
        },
      ],
      id: '',
      created: 0,
      model: 'llm',
    };
    await responder.onChunk({} as any, snapshot as ChatCompletionSnapshot);

    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      3,
      'Thinking message, and event with content, and event with one tool call should be sent',
    );
    assert.deepEqual(
      sentEvents[2].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          id: 'tool-call-1-id',
          name: 'checkWeather',
          arguments:
            '{"description":"Check the weather in NYC","attributes":{"zipCode":"10011"}}',
        },
      ],
      'Command requests should be sent with correct content',
    );
  });

  test('Handles sequence of thinking -> reasoning -> content correctly', async () => {
    await responder.ensureThinkingMessageSent();

    // Initial state - thinking message
    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'Initial thinking message sent');
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'Initial thinking message in reasoning',
    );
    assert.equal(sentEvents[0].content.body, '', 'Initial body empty');

    // First reasoning update
    await responder.onChunk(chunkWithReasoning('reasoning step 1'), {} as any);
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 2, 'First reasoning update sent');
    assert.equal(
      sentEvents[1].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1',
      'First reasoning content',
    );
    assert.equal(sentEvents[1].content.body, '', 'Body still empty');

    // Second reasoning update
    await responder.onChunk(
      chunkWithReasoning(' and 2**New header**\n\nstep 3 might go here'),
      {} as any,
    );
    await responder.flush();
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 3, 'Second reasoning update sent');
    assert.equal(
      sentEvents[2].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2\n\n**New header**\n\nstep 3 might go here',
      'Second reasoning content',
    );
    assert.equal(sentEvents[2].content.body, '', 'Body still empty');

    // First content update
    await responder.onChunk({} as any, snapshotWithContent('content step 1'));
    await responder.flush();
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 4, 'First content update sent');
    assert.equal(
      sentEvents[3].content.body,
      'content step 1',
      'First content body',
    );
    assert.equal(
      sentEvents[3].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2\n\n**New header**\n\nstep 3 might go here',
      'Reasoning preserved with content update',
    );

    // Second content update
    await responder.onChunk({} as any, snapshotWithContent('content step 2'));
    await responder.finalize();
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 5, 'Second content update sent');
    assert.equal(
      sentEvents[4].content.body,
      'content step 2',
      'Second content body',
    );
    assert.equal(
      sentEvents[4].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2\n\n**New header**\n\nstep 3 might go here',
      'Reasoning still preserved',
    );

    // Verify all updates replaced the original message
    for (let i = 1; i < sentEvents.length; i++) {
      assert.deepEqual(
        sentEvents[i].content['m.relates_to'],
        {
          rel_type: 'm.replace',
          event_id: '0',
        },
        `Update ${i} replaced original message`,
      );
    }
  });

  test('Chunk processing will result in an error if matrix sending fails', async () => {
    await responder.ensureThinkingMessageSent();
    fakeMatrixClient.sendEvent = async () => {
      throw new Error('MatrixError: [413] event too large');
    };
    let result = await responder.onChunk(
      {} as any,
      snapshotWithContent('super long content that is too large'),
    );

    assert.equal(
      (result[0] as { errorMessage: string }).errorMessage,
      'MatrixError: [413] event too large',
    );
  });

  test('When content exceeds max event size threshold, it will be split into a new event', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024 * 2.5; // 2.5KB max event size

    let longContentPart1 = 'a'.repeat(1024); // 1KB of content
    let longContentPart2 = 'b'.repeat(2048); // 2KB of content
    let longContentPart3 = 'ccccc'; // a smidge more

    await responder.ensureThinkingMessageSent();

    await responder.onChunk({} as any, snapshotWithContent(longContentPart1));

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 2, 'Two events should be sent');
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'First event is the initial thinking message',
    );
    assert.equal(
      sentEvents[1].content.body,
      longContentPart1,
      'Initial message content',
    );
    assert.equal(
      sentEvents[1].content.isStreamingFinished,
      false,
      'isStreamingFinished should be false',
    );

    await responder.onChunk(
      {} as any,
      snapshotWithContent(longContentPart1 + longContentPart2),
    );
    clock.tick(250); // Advance clock to trigger throttled update
    await responder.onChunk(
      {} as any,
      snapshotWithContent(
        longContentPart1 + longContentPart2 + longContentPart3,
      ),
    );
    await responder.finalize();

    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 6, 'Five events should be sent');

    // verify 3rd event is an update to the first event that sets hasContinuation to true
    // console.log(JSON.stringify(sentEvents, null, 2));
    assert.deepEqual(sentEvents[2].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[0].eventId,
    });
    assert.ok(
      sentEvents[2].content.body.startsWith('a'),
      'Continuation message content starts with a',
    );
    assert.ok(
      sentEvents[2].content.body.endsWith('b'),
      'Continuation message content ends with b',
    );
    assert.equal(
      sentEvents[2].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      true,
    );
    assert.equal(sentEvents[2].content.isStreamingFinished, true);

    // verify 4th event has continuationOf pointing to 1st event and isStreamingFinished to false
    assert.equal(
      sentEvents[3].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.equal(sentEvents[3].content.isStreamingFinished, false);
    assert.ok(
      sentEvents[3].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[3].content.body.endsWith('b'),
      'Continuation message content ends with b',
    );

    // verify 5th event has continuationOf pointing to 1st event, replaces 4th event and has isStreamingFinished == false
    assert.equal(
      sentEvents[4].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.ok(
      sentEvents[4].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[4].content.body.endsWith('bccccc'),
      'Continuation message content ends with bccccc',
    );
    assert.equal(
      sentEvents[4].content.isStreamingFinished,
      false,
      'expected the fifth event to have isStreamingFinished set to false',
    );
    assert.deepEqual(sentEvents[4].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[3].eventId,
    });

    // verify 5th event has continuationOf pointing to 1st event, replaces 4th event and has isStreamingFinished == true
    assert.equal(
      sentEvents[5].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.ok(
      sentEvents[5].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[5].content.body.endsWith('bccccc'),
      'Continuation message content ends with bccccc',
    );
    assert.equal(
      sentEvents[5].content.isStreamingFinished,
      true,
      'expected the sixth event to have isStreamingFinished set to true',
    );
    assert.deepEqual(sentEvents[5].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[3].eventId,
    });
  });

  test('When new content is too large to fit in eventMaxSize, it will be split into multiple events', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024; // 1KB max event size

    let longContentPart1 = 'a'.repeat(512); // 0.5KB of content
    let longContentPart2 = 'b'.repeat(1024) + 'c'.repeat(1024); // 2KB of content

    await responder.ensureThinkingMessageSent();
    await responder.onChunk({} as any, snapshotWithContent(longContentPart1));
    await responder.onChunk(
      {} as any,
      snapshotWithContent(longContentPart1 + longContentPart2),
    );
    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    // console.log(JSON.stringify(sentEvents, null, 2));
    assert.equal(sentEvents.length, 5, 'Five events should be sent');

    assert.true(sentEvents[2].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]);
    assert.true(
      sentEvents[2].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.true(sentEvents[2].content.body.startsWith('a'));
    assert.true(sentEvents[2].content.body.endsWith('b'));

    assert.true(sentEvents[3].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]);
    assert.true(
      sentEvents[3].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.equal(
      sentEvents[3].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.true(sentEvents[3].content.body.startsWith('b'));
    assert.true(sentEvents[3].content.body.endsWith('c'));

    assert.strictEqual(
      sentEvents[4].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      undefined,
    );
    assert.true(
      sentEvents[4].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.equal(
      sentEvents[4].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[3].eventId,
    );
    assert.true(sentEvents[4].content.body.startsWith('c'));
    assert.true(sentEvents[4].content.body.endsWith('c'));
  });

  test('When reasoning is too large to fit in eventMaxSize, it will be split into multiple events', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024; // 1KB max event size
    let longReasoningPart1 = 'a'.repeat(512); // 0.5KB of reasoning
    let longReasoningPart2 = 'b'.repeat(1024) + 'c'.repeat(1024); // 2KB of reasoning

    await responder.ensureThinkingMessageSent();
    clock.tick(250); // Advance clock to trigger throttled update
    await responder.onChunk(chunkWithReasoning(longReasoningPart1), {} as any);
    clock.tick(250); // Advance clock to trigger throttled update
    await responder.onChunk(chunkWithReasoning(longReasoningPart2), {} as any);
    clock.tick(250); // Advance clock to trigger throttled update
    await responder.onChunk({} as any, snapshotWithContent('my content'));
    clock.tick(250); // Advance clock to trigger throttled update
    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    // console.log(JSON.stringify(sentEvents, null, 2));
    assert.equal(sentEvents.length, 7, 'Seven events should be sent');

    assert.true(sentEvents[2].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]);
    assert.true(
      sentEvents[2].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.true(
      sentEvents[2].content[APP_BOXEL_REASONING_CONTENT_KEY].startsWith('a'),
    );
    assert.true(
      sentEvents[2].content[APP_BOXEL_REASONING_CONTENT_KEY].endsWith('b'),
    );

    assert.true(sentEvents[3].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]);
    assert.true(
      sentEvents[3].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.equal(
      sentEvents[3].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.true(
      sentEvents[3].content[APP_BOXEL_REASONING_CONTENT_KEY].startsWith('b'),
    );
    assert.true(
      sentEvents[3].content[APP_BOXEL_REASONING_CONTENT_KEY].endsWith('c'),
    );

    assert.strictEqual(
      sentEvents[4].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      undefined,
    );
    assert.false(
      sentEvents[4].content.isStreamingFinished,
      'isStreamingFinished should be false',
    );
    assert.equal(
      sentEvents[4].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[3].eventId,
    );
    assert.true(
      sentEvents[4].content[APP_BOXEL_REASONING_CONTENT_KEY].startsWith('c'),
    );
    assert.true(
      sentEvents[4].content[APP_BOXEL_REASONING_CONTENT_KEY].endsWith('c'),
    );
    assert.strictEqual(sentEvents[4].content.body, '');

    assert.strictEqual(
      sentEvents[5].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      undefined,
    );
    assert.false(
      sentEvents[5].content.isStreamingFinished,
      'isStreamingFinished should be false',
    );
    assert.equal(
      sentEvents[5].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[3].eventId,
    );
    assert.true(
      sentEvents[5].content[APP_BOXEL_REASONING_CONTENT_KEY].startsWith('c'),
    );
    assert.true(
      sentEvents[5].content[APP_BOXEL_REASONING_CONTENT_KEY].endsWith('c'),
    );

    assert.strictEqual(
      sentEvents[6].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      undefined,
    );
    assert.true(
      sentEvents[6].content.isStreamingFinished,
      'isStreamingFinished should be true',
    );
    assert.equal(
      sentEvents[6].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[3].eventId,
    );
    assert.true(
      sentEvents[6].content.body.startsWith('my content'),
      'Content message body starts with my content',
    );
    assert.true(
      sentEvents[6].content[APP_BOXEL_REASONING_CONTENT_KEY].startsWith('c'),
    );
    assert.true(
      sentEvents[6].content[APP_BOXEL_REASONING_CONTENT_KEY].endsWith('c'),
    );
    assert.deepEqual(sentEvents[6].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[4].eventId,
    });
  });

  test('when reasoning plus content is too large to fit in eventMaxSize, it will be split into a new event', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024 * 1.5; // 1.5KB max event size

    let longReasoning = 'a'.repeat(1024); // 1KB of content
    let longContent = 'b'.repeat(2048); // 2KB of content

    await responder.ensureThinkingMessageSent();
    clock.tick(250);
    await responder.onChunk(chunkWithReasoning(longReasoning), {} as any);
    clock.tick(250);
    await responder.onChunk({} as any, snapshotWithContent(longContent));
    clock.tick(250);
    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 5, 'Five events should be sent');
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'First event is the initial thinking message',
    );
    assert.equal(
      sentEvents[1].content[APP_BOXEL_REASONING_CONTENT_KEY],
      longReasoning,
      'Initial reasoning content',
    );
    assert.equal(
      sentEvents[1].content.isStreamingFinished,
      false,
      'isStreamingFinished should be false',
    );

    // console.log(JSON.stringify(sentEvents, null, 2));
    assert.deepEqual(sentEvents[2].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[0].eventId,
    });
    assert.ok(
      sentEvents[2].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[2].content.body.endsWith('b'),
      'Continuation message content ends with b',
    );
    assert.equal(
      sentEvents[2].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      true,
    );
    assert.equal(sentEvents[2].content.isStreamingFinished, true);

    assert.equal(
      sentEvents[3].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.equal(sentEvents[3].content.isStreamingFinished, false);
    assert.ok(
      sentEvents[3].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[3].content.body.endsWith('b'),
      'Continuation message content ends with b',
    );

    assert.strictEqual(
      sentEvents[4].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY],
      undefined,
    );
    assert.equal(
      sentEvents[4].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.equal(sentEvents[4].content.isStreamingFinished, true);
    assert.ok(
      sentEvents[4].content.body.startsWith('b'),
      'Continuation message content starts with b',
    );
    assert.ok(
      sentEvents[4].content.body.endsWith('b'),
      'Continuation message content ends with b',
    );
  });

  test('onChunk returns error if matrix sending fails during continuation', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024 * 2.5; // 2.5KB max event size

    let longContentPart1 = 'a'.repeat(1024); // 1KB of content
    let longContentPart2 = 'b'.repeat(2048); // 2KB of content
    let longContentPart3 = 'c'.repeat(2048); // 2KB of content

    await responder.ensureThinkingMessageSent();
    clock.tick(250);
    await responder.onChunk({} as any, snapshotWithContent(longContentPart1));
    clock.tick(250);
    await responder.onChunk(
      {} as any,
      snapshotWithContent(longContentPart1 + longContentPart2),
    );
    clock.tick(250);

    fakeMatrixClient.sendEvent = async () => {
      throw new Error('MatrixError: something went wrong');
    };
    let result = await responder.onChunk(
      {} as any,
      snapshotWithContent(
        longContentPart1 + longContentPart2 + longContentPart3,
      ),
    );
    assert.equal(
      (result[result.length - 1] as { errorMessage: string }).errorMessage,
      'MatrixError: something went wrong',
    );
  });

  test('onChunk returns error if matrix sending fails during continuation', async () => {
    responder.matrixResponsePublisher.eventSizeMax = 1024 * 1.5; // 2.5KB max event size

    let longContentPart1 = 'a'.repeat(1024); // 1KB of content
    let longContentPart2 = 'b'.repeat(2048); // 2KB of content

    await responder.ensureThinkingMessageSent();
    clock.tick(250);
    await responder.onChunk(
      {} as any,
      snapshotWithContent(longContentPart1 + longContentPart2),
    );
    clock.tick(250);
    await responder.onError(new OpenAIError('All your base are belong to us'));
    clock.tick(250);

    let sentEvents = fakeMatrixClient.getSentEvents();
    // console.log(JSON.stringify(sentEvents, null, 2));
    assert.equal(sentEvents.length, 4, 'Four events should be sent');
    assert.equal(
      sentEvents[0].content[APP_BOXEL_REASONING_CONTENT_KEY],
      thinkingMessage,
      'First event is the initial thinking message',
    );
    assert.true(sentEvents[1].content.body.startsWith('a'));
    assert.true(sentEvents[1].content.body.endsWith('b'));
    assert.true(sentEvents[1].content[APP_BOXEL_HAS_CONTINUATION_CONTENT_KEY]);
    assert.deepEqual(sentEvents[1].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[0].eventId,
    });
    assert.true(sentEvents[2].content.body.startsWith('b'));
    assert.true(sentEvents[2].content.body.endsWith('b'));
    assert.strictEqual(
      sentEvents[2].content[APP_BOXEL_CONTINUATION_OF_CONTENT_KEY],
      sentEvents[0].eventId,
    );
    assert.deepEqual(sentEvents[3].content['m.relates_to'], {
      rel_type: 'm.replace',
      event_id: sentEvents[0].eventId,
    });
    assert.strictEqual(
      sentEvents[3].content.errorMessage,
      'Error - All your base are belong to us',
      'Error message should be sent, replacing the original message',
    );
  });
});
