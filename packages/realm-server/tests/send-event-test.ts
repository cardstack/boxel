import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { DBAdapter } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createSendEvent } from '../handlers/send-event.ts';

// Realm events are addressed to a user's session room. Callers treat the
// notify as best-effort and catch its failures, so what matters here is that
// an ordinary condition — a user with no session room — doesn't produce one.
module(basename(import.meta.filename), function () {
  function fakeDeps(sessionRoomId: string | null) {
    let sent: { roomId: string; body: unknown }[] = [];
    let dbAdapter = {
      kind: 'pg',
      execute: async () =>
        sessionRoomId === null ? [] : [{ session_room_id: sessionRoomId }],
    } as unknown as DBAdapter;
    let matrixClient = {
      isLoggedIn: () => true,
      login: async () => {},
      sendEvent: async (roomId: string, _type: string, body: unknown) => {
        sent.push({ roomId, body });
      },
    } as unknown as MatrixClient;
    return { sendEvent: createSendEvent({ matrixClient, dbAdapter }), sent };
  }

  test('an event for a user with no session room is skipped, not attempted', async function (assert) {
    let { sendEvent, sent } = fakeDeps(null);

    // Resolves rather than rejects: the send is the thing that used to fail,
    // by addressing a `null` room that Matrix answered 403.
    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.deepEqual(sent, [], 'no room event was addressed to a null room');
  });

  test('an event for a user with a session room is delivered to it', async function (assert) {
    let { sendEvent, sent } = fakeDeps('!room-abc:localhost');

    await sendEvent('@mango:localhost', 'realms-list-updated', { a: 1 });

    assert.strictEqual(sent.length, 1, 'one room event sent');
    assert.strictEqual(sent[0].roomId, '!room-abc:localhost');
    assert.deepEqual(
      JSON.parse((sent[0].body as { body: string }).body),
      { eventType: 'realms-list-updated', data: { a: 1 } },
      'the event type and payload ride in the message body',
    );
  });
});
