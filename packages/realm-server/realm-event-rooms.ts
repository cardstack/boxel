import {
  clearRealmEventRoom,
  fetchRealmEventRoom,
  fetchRealmNamedGrantees,
  insertRealmEventRoom,
  isRealmServerNotInRoomError,
  logger,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  isBackPressure,
  type RealmEventDispatcher,
  type RealmEventSend,
} from './realm-event-dispatcher.ts';

const log = logger('realm:events');

// A private realm sends each realm event once, into a Matrix room whose
// members are exactly the users the realm's grants name (see
// `fetchRealmNamedGrantees`), rather than once into each of their session
// rooms. Users who each hold a grant naming them on the same realm may see
// each other's Matrix ids, so the room shows its members nothing they may not
// see. The room is created through the matrix client the realm sends its
// events with, so that client's user is the only one who may send, invite or
// kick in it (see `MatrixClient.createRealmEventRoom`).
//
// Membership follows the grants: the realm server invites a user a grant
// names and kicks a member no grant names. No one joins any other way, since
// the room is invite-only. The work runs as a job on the realm's line in the
// realm event dispatcher, so invites and kicks are paced with the realm's
// events and back off with them, and a job that invites a user completes
// before an event queued after it is sent.

export interface RealmEventRoomDeps {
  realmURL: string;
  matrixClient: MatrixClient;
  dbAdapter: DBAdapter;
  dispatcher: RealmEventDispatcher;
}

// The room the realm's events go to, for a host signed in as `member`:
// created the first time it is asked for, with the realm's grantees invited.
// Every ask also brings the room's members in step with the grants, so the
// asking member is invited by the time this resolves and their host's join
// succeeds. Undefined when the realm is world-readable, when no grant names
// `member`, or when the room can't be provided.
export async function ensureRealmEventRoom(
  deps: RealmEventRoomDeps,
  member: string,
): Promise<string | undefined> {
  let roomId: string | undefined;
  let failure: unknown;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      try {
        let { isPrivate, roomId: stored } = await fetchRealmEventRoom(
          deps.dbAdapter,
          deps.realmURL,
        );
        if (!isPrivate) {
          return [];
        }
        let grantees = await fetchRealmNamedGrantees(
          deps.dbAdapter,
          deps.realmURL,
        );
        if (!grantees.includes(member)) {
          return [];
        }
        await loginIfNeeded(deps.matrixClient);
        let room = stored ?? (await createRoom(deps));
        let sends = await membershipSends(deps, room, grantees);
        roomId = room;
        return sends;
      } catch (e) {
        if (isBackPressure(e)) {
          throw e;
        }
        failure = e;
        return [];
      }
    },
  });
  if (failure) {
    throw failure;
  }
  return roomId;
}

// Brings the members of the realm's room, when it has one, in step with its
// grants: a grantee who isn't a member is invited, and a member no grant
// names is kicked. For after a grant changes, and for when a realm mounts, so
// a change no process saw (one made while the realm wasn't served, or lost
// with a process that stopped) is repaired. Resolves once the invites and
// kicks are done; never rejects.
export async function syncRealmEventRoom(
  deps: RealmEventRoomDeps,
): Promise<void> {
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      let { roomId } = await fetchRealmEventRoom(deps.dbAdapter, deps.realmURL);
      if (!roomId) {
        return [];
      }
      await loginIfNeeded(deps.matrixClient);
      let grantees = await fetchRealmNamedGrantees(
        deps.dbAdapter,
        deps.realmURL,
      );
      return await membershipSends(deps, roomId, grantees);
    },
  });
}

// For a realm that is being deleted: forgets its room, so nothing more is sent
// there, removes every member, and has the realm server leave it. Resolves
// once that is done; never rejects.
export async function retireRealmEventRoom(
  deps: RealmEventRoomDeps,
): Promise<void> {
  let retired: string | undefined;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      let { roomId } = await fetchRealmEventRoom(deps.dbAdapter, deps.realmURL);
      if (!roomId) {
        return [];
      }
      await clearRealmEventRoom(deps.dbAdapter, deps.realmURL, roomId);
      retired = roomId;
      await loginIfNeeded(deps.matrixClient);
      return await membershipSends(deps, roomId, []);
    },
  });
  if (!retired) {
    return;
  }
  let roomId = retired;
  // A job of its own, so it starts only once every kick above has finished:
  // a member can only be kicked by someone still in the room.
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => [
      {
        roomId,
        send: async () => {
          await deps.matrixClient.leaveRoom(roomId);
        },
        onFailure: async (e) => {
          log.warn(
            `Unable to leave the retired event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
          );
        },
      },
    ],
  });
}

async function loginIfNeeded(matrixClient: MatrixClient) {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

// Creates a room for the realm and stores it, unless another process stored
// one first, in which case that one is the realm's room and the new one is
// left.
async function createRoom(deps: RealmEventRoomDeps): Promise<string> {
  let created = await deps.matrixClient.createRealmEventRoom(deps.realmURL);
  let stored = await insertRealmEventRoom(
    deps.dbAdapter,
    deps.realmURL,
    created,
  );
  if (stored !== created) {
    try {
      await deps.matrixClient.leaveRoom(created);
    } catch (e) {
      log.warn(
        `Unable to leave the unused event room ${created} of ${deps.realmURL}: ${message(e)}`,
      );
    }
  }
  return stored;
}

// The invites and kicks that make the room's members the given grantees. A
// stored room the realm server is no longer in, as after a homeserver reset,
// is forgotten instead, so the next host that asks gets a new one.
async function membershipSends(
  deps: RealmEventRoomDeps,
  roomId: string,
  grantees: string[],
): Promise<RealmEventSend[]> {
  let self = deps.matrixClient.getUserId();
  let wanted = new Set(grantees.filter((user) => user !== self));
  let memberships: Map<string, string>;
  try {
    memberships = await deps.matrixClient.getRoomMemberships(roomId);
  } catch (e) {
    if (isRealmServerNotInRoomError(e, roomId)) {
      await forgetRoom(deps, roomId);
      return [];
    }
    throw e;
  }
  let isMember = (user: string) =>
    ['join', 'invite'].includes(memberships.get(user) ?? '');

  let sends: RealmEventSend[] = [];
  for (let user of wanted) {
    if (!isMember(user)) {
      sends.push({
        roomId,
        send: async () => {
          await deps.matrixClient.inviteUser(roomId, user);
        },
        onFailure: membershipFailure(deps, roomId, `invite ${user}`),
      });
    }
  }
  for (let user of memberships.keys()) {
    if (isMember(user) && !wanted.has(user)) {
      sends.push({
        roomId,
        send: async () => {
          await deps.matrixClient.kickUser(
            roomId,
            user,
            'No longer has a grant on this realm',
          );
        },
        onFailure: membershipFailure(deps, roomId, `kick ${user}`),
      });
    }
  }
  return sends;
}

function membershipFailure(
  deps: RealmEventRoomDeps,
  roomId: string,
  what: string,
) {
  return async (e: unknown) => {
    if (isRealmServerNotInRoomError(e, roomId)) {
      await forgetRoom(deps, roomId);
      return;
    }
    // The next sync for the realm tries again.
    log.warn(
      `Unable to ${what} in the event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
    );
  };
}

async function forgetRoom(deps: RealmEventRoomDeps, roomId: string) {
  try {
    let cleared = await clearRealmEventRoom(
      deps.dbAdapter,
      deps.realmURL,
      roomId,
    );
    log.warn(
      `Forgetting event room ${roomId} of ${deps.realmURL}; the realm server is no longer in the room`,
      { cleared },
    );
  } catch (e) {
    log.error(`Failed to forget event room ${roomId} of ${deps.realmURL}`, e);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
