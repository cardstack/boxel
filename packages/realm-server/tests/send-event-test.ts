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
  function fakeDeps(
    sessionRoomId: string | null,
    opts: { loggedIn?: boolean; loginFails?: boolean } = {},
  ) {
    let sent: { roomId: string; body: unknown }[] = [];
    let logins = 0;
    let dbAdapter = {
      kind: 'pg',
      execute: async () =>
        sessionRoomId === null ? [] : [{ session_room_id: sessionRoomId }],
    } as unknown as DBAdapter;
    let matrixClient = {
      isLoggedIn: () => opts.loggedIn ?? true,
      login: async () => {
        logins++;
        if (opts.loginFails) {
          throw new Error('homeserver unreachable');
        }
      },
      sendEvent: async (roomId: string, _type: string, body: unknown) => {
        sent.push({ roomId, body });
      },
    } as unknown as MatrixClient;
    return {
      sendEvent: createSendEvent({ matrixClient, dbAdapter }),
      sent,
      loginCount: () => logins,
    };
  }

  test('an event for a user with no session room is skipped, not attempted', async function (assert) {
    let { sendEvent, sent } = fakeDeps(null);

    // Resolves rather than rejects: the send is the thing that used to fail,
    // by addressing a `null` room that Matrix answered 403.
    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.deepEqual(sent, [], 'no room event was addressed to a null room');
  });

  // The room lookup has to come before the login, or a user with no session
  // room can still turn an unreachable homeserver into a failed notify — the
  // noise this skip exists to remove, reached the other way round.
  test('a skipped event does not reach Matrix at all', async function (assert) {
    let { sendEvent, sent, loginCount } = fakeDeps(null, {
      loggedIn: false,
      loginFails: true,
    });

    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.strictEqual(loginCount(), 0, 'no login was attempted');
    assert.deepEqual(sent, [], 'nothing was sent');
  });

  test('a deliverable event still logs in when the client is cold', async function (assert) {
    let { sendEvent, sent, loginCount } = fakeDeps('!room-abc:localhost', {
      loggedIn: false,
    });

    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.strictEqual(loginCount(), 1, 'logged in before sending');
    assert.strictEqual(sent.length, 1, 'and delivered the event');
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
