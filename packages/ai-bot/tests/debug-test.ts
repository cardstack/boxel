import QUnit from 'qunit';
const { module, test } = QUnit;
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { handleDebugCommands } from '../lib/debug.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';

module('handleDebugCommands - debug:eventlist', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let uploadedContents: string[];

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
    uploadedContents = [];
    fakeMatrixClient.uploadContent = async (content: any) => {
      uploadedContents.push(content);
      return { content_uri: 'mxc://example.com/debug-dump' };
    };
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
  });

  // A streamed bot message as returned by the /messages API: the original
  // event holds the empty streaming placeholder, and the server aggregates
  // the final edit under unsigned['m.relations']['m.replace'].
  function streamedBotMessage(): DiscreteMatrixEvent {
    return {
      type: 'm.room.message',
      event_id: 'streamed-event-1',
      origin_server_ts: 1000,
      room_id: 'room1',
      sender: '@aibot:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        body: '',
        isStreamingFinished: false,
      },
      unsigned: {
        age: 1000,
        'm.relations': {
          'm.replace': {
            type: 'm.room.message',
            event_id: 'streamed-event-1-final-edit',
            origin_server_ts: 2000,
            room_id: 'room1',
            sender: '@aibot:localhost',
            content: {
              msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
              format: 'org.matrix.custom.html',
              body: 'The complete streamed answer',
              isStreamingFinished: true,
              'm.relates_to': {
                rel_type: 'm.replace',
                event_id: 'streamed-event-1',
              },
            },
            unsigned: {
              age: 500,
            },
          },
        },
      },
      status: null,
    } as unknown as DiscreteMatrixEvent;
  }

  async function dumpedEventList(eventBody: string): Promise<any[]> {
    await handleDebugCommands(
      {} as any, // openai is only used by debug:title:create
      eventBody,
      fakeMatrixClient,
      'room1',
      '@aibot:localhost',
      [streamedBotMessage()],
    );
    QUnit.assert.strictEqual(
      uploadedContents.length,
      1,
      'one event list dump was uploaded',
    );
    return JSON.parse(uploadedContents[0]);
  }

  test('debug:eventlist dumps the final streamed content, not the placeholder', async (assert) => {
    let events = await dumpedEventList('debug:eventlist');

    assert.strictEqual(events.length, 1, 'dump contains the message event');
    let [event] = events;
    assert.strictEqual(
      event.event_id,
      'streamed-event-1',
      'the original event id is kept',
    );
    assert.strictEqual(
      event.content.body,
      'The complete streamed answer',
      'body is the final streamed content',
    );
    assert.true(
      event.content.isStreamingFinished,
      'isStreamingFinished reflects the final edit',
    );
  });

  test('debug:eventlist:raw dumps the unaggregated timeline', async (assert) => {
    let events = await dumpedEventList('debug:eventlist:raw');

    assert.strictEqual(events.length, 1, 'dump contains the message event');
    let [event] = events;
    assert.strictEqual(event.content.body, '', 'body is the raw placeholder');
    assert.false(
      event.content.isStreamingFinished,
      'isStreamingFinished is the raw value',
    );
    assert.strictEqual(
      event.unsigned['m.relations']['m.replace'].content.body,
      'The complete streamed answer',
      'the final edit is still available under unsigned',
    );
  });
});
