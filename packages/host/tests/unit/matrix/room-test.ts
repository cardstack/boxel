import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import { RoomMember } from '@cardstack/host/lib/matrix-classes/member';
import MessageBuilder from '@cardstack/host/lib/matrix-classes/message-builder';
import Room, { decodeWireData } from '@cardstack/host/lib/matrix-classes/room';
import type { TempEvent } from '@cardstack/host/lib/matrix-classes/room';
import { getAggregatedReplacement } from '@cardstack/host/resources/room';

import type {
  CardMessageEvent,
  MatrixEvent as DiscreteMatrixEvent,
} from '@cardstack/base/matrix-event';
import type { IRoomEvent } from 'matrix-js-sdk';

module('Unit | matrix | room', function (hooks) {
  setupTest(hooks);

  const usage = { promptTokens: 10, completionTokens: 2, costUsd: 0.01 };

  // `content.data` is a JSON string on the wire, and a backfilled event
  // carries its latest edit as a server-side aggregation bundle under
  // unsigned['m.relations']['m.replace'] — the edit events themselves are
  // filtered out of the backfill, so the bundle is the only carrier of the
  // fields that arrive on edits: token usage, and context.agentId, which
  // gates tool auto-run.
  function bundledEventFixture(): TempEvent {
    return {
      event_id: '$original',
      type: 'm.room.message',
      room_id: '!room1:localhost',
      sender: '@aibot:localhost',
      origin_server_ts: 1,
      status: null,
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        body: 'streaming…',
        data: JSON.stringify({ context: { agentId: 'agent-1' } }),
      },
      unsigned: {
        age: 0,
        'm.relations': {
          'm.replace': {
            event_id: '$edit',
            type: 'm.room.message',
            room_id: '!room1:localhost',
            sender: '@aibot:localhost',
            origin_server_ts: 2,
            content: {
              msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
              format: 'org.matrix.custom.html',
              body: 'the whole answer',
              isStreamingFinished: true,
              data: JSON.stringify({ context: { agentId: 'agent-1' }, usage }),
              'm.relates_to': {
                rel_type: 'm.replace',
                event_id: '$original',
              },
            },
          },
        },
      },
    };
  }

  test('addEvent decodes the event’s own wire data; the bundle stays encoded for the substitution site', function (assert) {
    let room = new Room('!room1:localhost');
    room.addEvent(bundledEventFixture());

    let added = room.events[0] as any;
    assert.deepEqual(
      added.content.data.context,
      { agentId: 'agent-1' },
      'the event’s own data is decoded at ingest',
    );
    assert.strictEqual(
      typeof added.unsigned['m.relations']['m.replace'].content.data,
      'string',
      'the aggregation bundle is not decoded here — getAggregatedReplacement decodes it after substitution',
    );
  });

  test('a rebuilt message keeps the usage and agentId that arrived on its bundled edit', async function (assert) {
    // The end-to-end reload path: Room.addEvent ingests the backfilled
    // event, getAggregatedReplacement substitutes the bundled edit and
    // decodes its data, and MessageBuilder reads usage and context off the
    // substituted event. A regression anywhere along that seam surfaces
    // here as an undefined usage — the wrong-session-total symptom.
    let room = new Room('!room1:localhost');
    room.addEvent(bundledEventFixture());

    let substituted = getAggregatedReplacement(
      room.events[0] as unknown as IRoomEvent,
    );
    assert.strictEqual(
      substituted.event_id,
      '$original',
      'the substituted event keeps the original event id',
    );

    let message = await new MessageBuilder(
      substituted as unknown as CardMessageEvent,
      this.owner,
      {
        roomId: '!room1:localhost',
        effectiveEventId: '$original',
        author: new RoomMember({ userId: '@aibot:localhost' }),
        index: 0,
        skills: [],
        events: room.events as unknown as DiscreteMatrixEvent[],
      },
    ).buildMessage();

    assert.deepEqual(
      message.usage,
      usage,
      'the rebuilt message carries the token usage from the bundled edit',
    );
    assert.strictEqual(
      message.agentId,
      'agent-1',
      'the rebuilt message carries the agent id that gates tool auto-run',
    );
    assert.strictEqual(
      message.body,
      'the whole answer',
      'the rebuilt message carries the edited body',
    );
  });

  test('an unparseable data string is left in place instead of aborting the timeline pass', function (assert) {
    let room = new Room('!room1:localhost');
    let event = bundledEventFixture();
    event.content!.data = '{not json';
    (event.unsigned as any)['m.relations']['m.replace'].content.data =
      '{also not json';

    room.addEvent(event);
    let added = room.events[0] as any;
    assert.strictEqual(
      added.content.data,
      '{not json',
      'addEvent leaves the undecodable string in place rather than throwing',
    );

    let substituted = getAggregatedReplacement(
      room.events[0] as unknown as IRoomEvent,
    ) as any;
    assert.strictEqual(
      substituted.content.data,
      '{also not json',
      'the substitution site leaves the undecodable string in place too',
    );

    // The direct contract of the shared decoder: this message loses its
    // data-derived fields, but the rest of the room still loads.
    let content = { data: '{still not json' };
    decodeWireData(content);
    assert.strictEqual(content.data, '{still not json');
  });
});
