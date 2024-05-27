import { module, test, assert } from 'qunit';
import { Responder } from '../lib/send-response';
import { IContent } from 'matrix-js-sdk';
import { MatrixClient } from '../lib/matrix';

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

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
    responder = new Responder(fakeMatrixClient, 'room-id');
  });

  hooks.afterEach(() => {
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

  test('Sends message content events after 40 unsent, and replace the thinking message', async () => {
    await responder.initialize();

    for (let i = 0; i < 40; i++) {
      await responder.onContent('content ' + i);
    }

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 1, 'Only initial message should be sent');
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Just the thinking message sent',
    );

    await responder.onContent('content final');

    sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(sentEvents.length, 2, 'Only initial message should be sent');
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Just the thinking message sent',
    );
    assert.equal(
      sentEvents[1].content.body,
      'content final',
      'The final content should be sent',
    );
    assert.deepEqual(
      sentEvents[1].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The final content should replace the original thinking message',
    );
  });

  test('Sends tool call event and replaces thinking message when tool call happens with no content', async () => {
    const patchArgs = {
      card_id: 'card/1',
      description: 'A new thing',
      attributes: { some: 'thing' },
    };

    await responder.initialize();

    await responder.onMessage({
      role: 'assistant',
      tool_calls: [
        {
          function: {
            name: 'patchCard',
            arguments: JSON.stringify(patchArgs),
          },
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
        command: {
          type: 'patchCard',
          id: patchArgs.card_id,
          patch: { attributes: patchArgs.attributes },
          eventId: '0',
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

  test('Sends tool call event separately when content is sent before tool call, under the chunk threshold', async () => {
    const patchArgs = {
      card_id: 'card/1',
      description: 'A new thing',
      attributes: { some: 'thing' },
    };
    await responder.initialize();

    await responder.onContent('some content');

    await responder.onMessage({
      role: 'assistant',
      tool_calls: [
        {
          function: {
            name: 'patchCard',
            arguments: JSON.stringify(patchArgs),
          },
        },
      ],
    });

    let sentEvents = fakeMatrixClient.getSentEvents();
    assert.equal(
      sentEvents.length,
      2,
      'Thinking message, and tool call event should be sent',
    );
    assert.equal(
      sentEvents[0].content.body,
      'Thinking...',
      'Thinking message should be sent first',
    );
    assert.deepEqual(
      JSON.parse(sentEvents[1].content.data),
      {
        command: {
          type: 'patchCard',
          id: patchArgs.card_id,
          patch: { attributes: patchArgs.attributes },
        },
      },
      'Tool call event should be sent with correct content',
    );
    assert.notOk(
      sentEvents[1].content['m.relates_to'],
      'The tool call event should not replace any message',
    );

    // Send enough chunks to
    for (let i = 0; i < 40; i++) {
      await responder.onContent('content ' + i);
    }

    assert.equal(
      sentEvents[2].content.body,
      'content 39',
      'Content event should be sent next',
    );
    assert.deepEqual(
      sentEvents[2].content['m.relates_to'],
      {
        rel_type: 'm.replace',
        event_id: '0',
      },
      'The content event should replace the thinking message',
    );
  });
});
