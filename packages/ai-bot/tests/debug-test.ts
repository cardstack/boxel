import QUnit from 'qunit';
const { module, test } = QUnit;
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import { handleDebugCommands } from '../lib/debug.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';

module('handleDebugCommands - boxel-debug:eventlist', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let uploadedContents: string[];

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
    uploadedContents = [];
    fakeMatrixClient.uploadContent = async (content: string) => {
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
      {} as any, // openai is only used by boxel-debug:title:create
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

  test('boxel-debug:eventlist dumps the final streamed content, not the placeholder', async (assert) => {
    let events = await dumpedEventList('boxel-debug:eventlist');

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

  test('boxel-debug:eventlist leaves the input event list unmutated', async (assert) => {
    let input = [streamedBotMessage()];
    let pristine = structuredClone(input);

    await handleDebugCommands(
      {} as any,
      'boxel-debug:eventlist',
      fakeMatrixClient,
      'room1',
      '@aibot:localhost',
      input,
    );

    assert.deepEqual(
      input,
      pristine,
      'aggregation operates on a clone, so a fallback raw dump stays raw',
    );
  });

  test('boxel-debug:eventlist:raw dumps the unaggregated timeline', async (assert) => {
    let events = await dumpedEventList('boxel-debug:eventlist:raw');

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

module('handleDebugCommands - help', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
  });

  async function reply(eventBody: string): Promise<string> {
    await handleDebugCommands(
      {} as any,
      eventBody,
      fakeMatrixClient,
      'room1',
      '@aibot:localhost',
      [],
    );
    let sent = fakeMatrixClient.getSentEvents();
    QUnit.assert.strictEqual(sent.length, 1, 'the bot sent one reply');
    return sent[0].content.body;
  }

  test('boxel-debug on its own lists the commands', async (assert) => {
    let body = await reply('boxel-debug');
    assert.true(body.includes('boxel-debug:eventlist'));
    assert.true(body.includes('boxel-debug:prompt'));
    assert.true(body.includes('boxel-debug:feature:enable:'));
  });

  test('an unknown boxel-debug command lists the commands', async (assert) => {
    let body = await reply('boxel-debug:nonsense');
    assert.true(body.includes('boxel-debug:feature:enable:'));
  });

  test('the help lists the available features', async (assert) => {
    let body = await reply('boxel-debug');
    assert.true(body.includes('catalog-reuse — '));
  });

  test('an old debug: command points to boxel-debug', async (assert) => {
    let body = await reply('debug:prompt');
    assert.true(body.startsWith('Did you mean boxel-debug?'));
    assert.true(body.includes('boxel-debug:prompt'));
    assert.true(body.includes('boxel-debug:feature:enable:'));
  });

  test('enabling an unknown feature says so', async (assert) => {
    let body = await reply('boxel-debug:feature:enable:no-such-feature');
    assert.true(body.includes('There is no feature named no-such-feature.'));
    assert.true(body.includes('Available features: catalog-reuse.'));
  });
});
