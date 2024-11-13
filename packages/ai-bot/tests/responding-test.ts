import { module, test, assert } from 'qunit';
import { Responder } from '../lib/send-response';
import { IContent } from 'matrix-js-sdk';
import { MatrixClient } from '../lib/matrix';
import FakeTimers from '@sinonjs/fake-timers';

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

  resetSentEvents() {
    this.sentEvents = [];
    this.eventId = 0;
  }
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
    await responder.initialize();

    const sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'One event should be sent');
    assert.equal(
      sentEvents[0].eventType,
      'm.room.message',
      'Event type should be m.room.message',
    );
    assert.equal(
      sentEvents[0].content.msgtype,
      'm.text',
      'Message type should be m.text',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Message body should match',
    );
  });

  test('Sends first content message immediately, replace the thinking message', async () => {
    await responder.initialize();

    // Send several messages
    for (let i = 0; i < 10; i++) {
      await responder.onContent('content ' + i);
    }

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Only the initial message and one content message should be sent',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Just the thinking message sent',
    );

    assert.equal(
      sentEvents[1].content.body,
      'content 0',
      'The first new content message should be sent',
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
    await responder.initialize();

    // Send several messages
    for (let i = 0; i < 10; i++) {
      await responder.onContent('content ' + i);
    }

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Only the initial message and one content message should be sent',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Just the thinking message sent',
    );

    assert.equal(
      sentEvents[1].content.body,
      'content 0',
      'The first new content message should be sent',
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
      attributes: {
        cardId: 'card/1',
        description: 'A new thing',
        patch: {
          attributes: {
            some: 'thing',
          },
        },
      },
    };

    await responder.initialize();

    await responder.onMessage({
      role: 'assistant',
      tool_calls: [
        {
          id: 'some-tool-call-id',
          function: {
            name: 'patchCard',
            arguments: JSON.stringify(patchArgs),
          },
          type: 'function',
        },
      ],
    });

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Thinking message and tool call event should be sent',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Thinking message should be sent first',
    );
    assert.deepEqual(
      JSON.parse(sentEvents[1].content.data),
      {
        eventId: '0',
        toolCall: {
          type: 'function',
          id: 'some-tool-call-id',
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: 'card/1',
              description: 'A new thing',
              patch: {
                attributes: {
                  some: 'thing',
                },
              },
            },
          },
        },
      },
      'Tool call event should be sent with correct content',
    );
    assert.deepEqual(
      sentEvents[1].content.body,
      patchArgs.description,
      'Body text should be the description',
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

  test('Sends tool call event separately when content is sent before tool call', async () => {
    const patchArgs = {
      attributes: {
        cardId: 'card/1',
        description: 'A new thing',
        patch: {
          attributes: {
            some: 'thing',
          },
        },
      },
    };
    await responder.initialize();

    await responder.onContent('some content');

    await responder.onMessage({
      role: 'assistant',
      tool_calls: [
        {
          id: 'some-tool-call-id',
          function: {
            name: 'patchCard',
            arguments: JSON.stringify(patchArgs),
          },
          type: 'function',
        },
      ],
    });

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      3,
      'Thinking message, and tool call event should be sent',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Thinking message should be sent first',
    );
    assert.deepEqual(
      JSON.parse(sentEvents[2].content.data),
      {
        toolCall: {
          type: 'function',
          id: 'some-tool-call-id',
          name: 'patchCard',
          arguments: {
            attributes: {
              cardId: 'card/1',
              description: 'A new thing',
              patch: {
                attributes: {
                  some: 'thing',
                },
              },
            },
          },
        },
      },
      'Tool call event should be sent with correct content',
    );
    assert.notOk(
      sentEvents[2].content['m.relates_to'],
      'The tool call event should not replace any message',
    );

    assert.equal(
      sentEvents[1].content.body,
      'some content',
      'Content event should be sent',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The content event should replace the thinking message',
    );
  });
});
