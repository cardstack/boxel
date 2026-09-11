import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { DBAdapter } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createSendEvent } from '@cardstack/runtime-common/send-event';

// Realm events are addressed to a user's session room. Callers treat the
// notify as best-effort and catch its failures, so what matters here is that
// an ordinary condition — a user with no session room — doesn't produce one.
module(basename(import.meta.filename), function () {
  function fakeDeps(
    sessionRoomId: string | null,
    opts: {
      loggedIn?: boolean;
      loginFails?: boolean;
      sendFails?: boolean;
      notInRoom?: boolean;
    } = {},
  ) {
    let sent: { roomId: string; body: unknown }[] = [];
    let executes: string[] = [];
    let logins = 0;
    let dbAdapter = {
      kind: 'pg',
      execute: async (sql: string) => {
        executes.push(sql);
        // The stale-room self-heal issues `UPDATE ... SET session_room_id =
        // NULL ... RETURNING id`; report one row cleared. Every other read is
        // the session-room lookup.
        if (/SET session_room_id = NULL/i.test(sql)) {
          return [{ id: 'cleared-1' }];
        }
        return sessionRoomId === null
          ? []
          : [{ session_room_id: sessionRoomId }];
      },
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
        if (opts.notInRoom) {
          // Shape of a real Synapse rejection when the sender was never a
          // member of the room (a stale row from a prior room owner).
          throw new Error(
            `Unable to send room event 'm.room.message' to room ${roomId}: status 403 - ` +
              JSON.stringify({
                errcode: 'M_FORBIDDEN',
                error: `@sender:localhost not in room ${roomId}`,
              }),
          );
        }
        if (opts.sendFails) {
          throw new Error('homeserver rejected the event');
        }
        sent.push({ roomId, body });
      },
    } as unknown as MatrixClient;
    return {
      sendEvent: createSendEvent({ matrixClient, dbAdapter }),
      sent,
      executes,
      loginCount: () => logins,
    };
  }

  test('an event for a user with no session room is skipped, not attempted', async function (assert) {
    let { sendEvent, sent } = fakeDeps(null);

    // Resolves rather than rejects: a null room id is not addressable, so
    // there is nothing to send and nothing to fail.
    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.deepEqual(sent, [], 'no room event was addressed to a null room');
  });

  // The room lookup gates the login, so a user with nothing to receive is
  // never exposed to an unreachable homeserver.
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

  // The other half of the header's reasoning: callers can only catch what
  // reaches them. A send failure has to keep propagating, or a `try/catch`
  // added here in the name of quieting things further would swallow it past
  // every caller's own handling with this file still green.
  test('a real send failure still propagates to the caller', async function (assert) {
    let { sendEvent } = fakeDeps('!room-abc:localhost', { sendFails: true });

    await assert.rejects(
      sendEvent('@mango:localhost', 'realms-list-updated'),
      /homeserver rejected the event/,
      'the caller decides what a failed delivery means',
    );
  });

  // A stale session-room row (the sender was never in the room, e.g. it was
  // minted by a prior room owner) is not a caller-visible failure: the helper
  // clears the row so the user's next auth re-mints one this account is in,
  // and resolves as the best-effort no-op it always was.
  test('a "not in room" send clears the stale session room instead of throwing', async function (assert) {
    let { sendEvent, sent, executes } = fakeDeps('!stale-room:localhost', {
      notInRoom: true,
    });

    await sendEvent('@mango:localhost', 'realms-list-updated');

    assert.deepEqual(sent, [], 'the event was not considered delivered');
    assert.ok(
      executes.some((sql) => /SET session_room_id = NULL/i.test(sql)),
      'the stale session-room row was cleared',
    );
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
