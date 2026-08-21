import { module, test } from 'qunit';

import Room from '@cardstack/host/lib/matrix-classes/room';

import type { EventStatus } from 'matrix-js-sdk';

module('Unit | matrix | room', function () {
  test('addEvent decodes the wire-encoded data of the event and of its aggregation bundle', function (assert) {
    // `content.data` is a JSON string on the wire. Backfilled events also
    // carry their latest edit as a server-side aggregation bundle under
    // unsigned['m.relations']['m.replace'], whose content the room resource
    // substitutes for the event's own (getAggregatedReplacement) — so a
    // string left undecoded there silently drops every field read off
    // `data` on rebuild: token usage, context.agentId, and with it the
    // agent gate for tool auto-execution.
    let room = new Room('!room1:localhost');
    let usage = { promptTokens: 10, completionTokens: 2, costUsd: 0.01 };
    let event = {
      event_id: '$original',
      type: 'm.room.message',
      room_id: '!room1:localhost',
      origin_server_ts: 1,
      status: null as EventStatus | null,
      content: {
        msgtype: 'app.boxel.message',
        body: 'streaming…',
        data: JSON.stringify({ context: { agentId: 'agent-1' } }),
      },
      unsigned: {
        age: 0,
        'm.relations': {
          'm.replace': {
            event_id: '$edit',
            type: 'm.room.message',
            origin_server_ts: 2,
            content: {
              msgtype: 'app.boxel.message',
              body: 'the whole answer',
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

    room.addEvent(event as any);

    let added = room.events[0] as any;
    assert.deepEqual(
      added.content.data.context,
      { agentId: 'agent-1' },
      'the event’s own data is decoded',
    );
    let bundled = added.unsigned['m.relations']['m.replace'];
    assert.deepEqual(
      bundled.content.data.usage,
      usage,
      'the aggregation bundle’s data is decoded too, so a rebuilt message keeps its usage',
    );
    assert.strictEqual(
      bundled.content.data.context.agentId,
      'agent-1',
      'and keeps its agent id',
    );
  });
});
