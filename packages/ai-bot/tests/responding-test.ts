import { module, test, assert } from 'qunit';
import { Responder } from '../lib/responder';
import { IContent } from 'matrix-js-sdk';
import { MatrixClient } from '../lib/matrix';
import FakeTimers from '@sinonjs/fake-timers';
import { thinkingMessage } from '../constants';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import { CommandRequest } from '@cardstack/runtime-common/commands';
import {
  APP_BOXEL_REASONING_CONTENT_KEY,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';

class FakeMatrixClient implements MatrixClient {
  private eventId = 0;
  private sentEvents: {
    eventId: string;
    roomId: string;
    eventType: string;
    content: IContent;
  }[] = [];

  async sendEvent(
    roomId: string,
    eventType: string,
    content: IContent,
  ): Promise<{ event_id: string }> {
    const messageEventId = this.eventId.toString();
    this.sentEvents.push({
      eventId: messageEventId,
      roomId,
      eventType,
      content,
    });
    this.eventId++;
    return { event_id: messageEventId.toString() };
  }

  async setRoomName(
    _roomId: string,
    _title: string,
  ): Promise<{ event_id: string }> {
    this.eventId++;
    return { event_id: this.eventId.toString() };
  }

  getSentEvents() {
    return this.sentEvents;
  }

  sendStateEvent(
    _roomId: string,
    _eventType: string,
    _content: IContent,
    _stateKey: string,
  ): Promise<{ event_id: string }> {
    throw new Error('Method not implemented.');
  }

  resetSentEvents() {
    this.sentEvents = [];
    this.eventId = 0;
  }
}

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
    responder = new Responder(fakeMatrixClient, 'room-id');
  });

  hooks.afterEach(() => {
    clock.runToLast();
    clock.uninstall();
    responder.finalize();
    fakeMatrixClient.resetSentEvents();
  });

  test('Sends thinking message', async () => {
    await responder.ensureThinkingMessageSent();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'One event should be sent');
    assert.equal(
      sentEvents[0].eventType,
      'm.room.message',
      'Event type should be m.room.message',
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

    // Advance the clock 250ms
    clock.tick(250);

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
        name: 'patchCard',
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
          name: 'patchCard',
          arguments: {
            description: 'A new thing',
            attributes: {
              cardId: 'card/1',
              patch: {
                attributes: {
                  some: 'thing',
                },
              },
            },
          },
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
        name: 'patchCard',
        arguments: { description: 'A new' },
      }),
    );

    await responder.flush();

    await responder.onChunk(
      {} as any,
      snapshotWithToolCall({
        id: 'some-tool-call-id',
        name: 'patchCard',
        arguments: patchArgs,
      }),
    );

    await responder.finalize();

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      5,
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
          name: 'patchCard',
          arguments: {
            description: 'A new',
          },
        },
      ],
      'Partial tool call event should be sent with correct content',
    );
    assert.deepEqual(
      sentEvents[3].content[APP_BOXEL_COMMAND_REQUESTS_KEY],
      [
        {
          id: 'some-tool-call-id',
          name: 'patchCard',
          arguments: {
            description: 'A new thing',
            attributes: {
              cardId: 'card/1',
              patch: {
                attributes: {
                  some: 'thing',
                },
              },
            },
          },
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
      false,
      'The tool call event should not be sent with isStreamingFinished set to true',
    );
    assert.deepEqual(
      sentEvents[4].content.isStreamingFinished,
      true,
      'The final event should be sent with isStreamingFinished set to true',
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
          arguments: {
            description: 'Check the weather in NYC',
            attributes: {
              zipCode: '10011',
            },
          },
        },
        {
          id: 'tool-call-2-id',
          name: 'checkWeather',
          arguments: {
            description: 'Check the weather in Beverly Hills',
            attributes: {
              zipCode: '90210',
            },
          },
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
    await responder.onChunk(chunkWithReasoning(' and 2'), {} as any);
    clock.tick(250); // Advance clock to trigger throttled update
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 3, 'Second reasoning update sent');
    assert.equal(
      sentEvents[2].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2',
      'Second reasoning content',
    );
    assert.equal(sentEvents[2].content.body, '', 'Body still empty');

    // First content update
    await responder.onChunk({} as any, snapshotWithContent('content step 1'));
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 4, 'First content update sent');
    assert.equal(
      sentEvents[3].content.body,
      'content step 1',
      'First content body',
    );
    assert.equal(
      sentEvents[3].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2',
      'Reasoning preserved with content update',
    );

    // Second content update
    await responder.onChunk({} as any, snapshotWithContent('content step 2'));
    clock.tick(250); // Advance clock to trigger throttled update
    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 5, 'Second content update sent');
    assert.equal(
      sentEvents[4].content.body,
      'content step 2',
      'Second content body',
    );
    assert.equal(
      sentEvents[4].content[APP_BOXEL_REASONING_CONTENT_KEY],
      'reasoning step 1 and 2',
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
});
