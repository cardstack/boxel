import {
  clearRealmEventRoom,
  clearRetiredRealmEventRoom,
  createSendEvent,
  fetchRealmEventRoom,
  fetchRealmNamedGrantees,
  fetchRealmsWithRetiredEventRooms,
  fetchRetiredRealmEventRooms,
  insertRealmEventRoom,
  insertRetiredRealmEventRoom,
  isRealmServerNotInRoomError,
  logger,
  retireRealmEventRoomRow,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { REALMS_LIST_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
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
// each other's Matrix ids, so the room must never show anyone a user they
// don't share a grant with. The room is created through the matrix client the
// realm sends its events with, so that client's user is the only one who may
// send, invite or kick in it (see `MatrixClient.createRealmEventRoom`).
//
// Membership follows the grants:
//
// - A grantee who isn't a member is invited. No one joins any other way,
//   since the room is invite-only.
// - A member no grant names is never kicked out of the realm's room, because
//   a kick leaves their membership in the room's state, where a member who
//   joins later could read it. The room is retired instead, and the realm gets
//   a new one the next time a host asks. Retiring takes effect at once for
//   every process (see `retireRealmEventRoomRow`): the realm's events go to
//   session rooms, which follow the grants per event, until the new room
//   exists. The remaining grantees are told their realms changed, so their
//   hosts ask again and join the new room.
// - A retired room is emptied: every member is removed, and then the realm
//   server leaves it. Its record is kept until that has all succeeded, and the
//   next sync for the realm tries again, so a removal that fails is never
//   forgotten with the room.
// - A new room is stored as the realm's only once its first invites have gone
//   out, so no event is sent into it before its members can see it.
//
// The Matrix work runs as jobs on the realm's line in the realm event
// dispatcher, so invites and removals are paced with the realm's events and
// back off with them.

export interface RealmEventRoomDeps {
  realmURL: string;
  matrixClient: MatrixClient;
  dbAdapter: DBAdapter;
  dispatcher: RealmEventDispatcher;
}

// One creation at a time per realm in this process. A room is stored only
// after its invites, so without this, a second ask arriving meanwhile would
// see no room and make another.
const creations = new Map<string, Promise<unknown>>();

function oneAtATime<T>(realmURL: string, run: () => Promise<T>): Promise<T> {
  let previous = creations.get(realmURL) ?? Promise.resolve();
  let next = previous.then(run, run);
  creations.set(realmURL, next);
  void next.finally(() => {
    if (creations.get(realmURL) === next) {
      creations.delete(realmURL);
    }
  });
  return next;
}

// The room the realm's events go to, for a host signed in as `member`:
// created the first time it is asked for, with the realm's grantees invited.
// Every ask also invites any grantee who isn't a member, so the asking member
// is invited by the time this resolves and their host's join succeeds.
// Undefined when the realm is world-readable or no grant names `member`.
// Rejects when the room can't be provided, including when Synapse stays
// overloaded, so the caller can tell the host to ask again.
export async function ensureRealmEventRoom(
  deps: RealmEventRoomDeps,
  member: string,
): Promise<string | undefined> {
  let { isPrivate } = await fetchRealmEventRoom(deps.dbAdapter, deps.realmURL);
  if (!isPrivate) {
    return undefined;
  }
  let grantees = await fetchRealmNamedGrantees(deps.dbAdapter, deps.realmURL);
  if (!grantees.includes(member)) {
    return undefined;
  }
  return await oneAtATime(deps.realmURL, async () => {
    let stored = await bringInStep(deps, { required: true });
    if (stored) {
      return stored;
    }
    return await createRoom(deps);
  });
}

// Brings the realm's room, when it has one, in step with its grants (see
// above), and retries the removals of any of its retired rooms. For after a
// grant is added, and for when a realm mounts, so a change no process saw
// (one made while the realm wasn't served, or lost with a process that
// stopped) is repaired. Resolves once the work is done; never rejects.
export async function syncRealmEventRoom(
  deps: RealmEventRoomDeps,
): Promise<void> {
  try {
    await bringInStep(deps, { required: false });
    await emptyRetiredRooms(deps);
  } catch (e) {
    log.warn(
      `Unable to bring the event room of ${deps.realmURL} in step with its grants: ${message(e)}`,
    );
  }
}

// For a grant that was revoked: the realm's room stops being the realm's at
// once, in every process, and is emptied and left in the background, and the
// remaining grantees are told to ask again. Resolves once the realm's events
// no longer go to the room; the Matrix work is awaited only with
// `waitForRemovals`.
export async function retireRealmEventRoom(
  deps: RealmEventRoomDeps,
  opts: { notifyGrantees?: boolean; waitForRemovals?: boolean } = {},
): Promise<void> {
  let retired = await retireRealmEventRoomRow(deps.dbAdapter, deps.realmURL);
  if (!retired) {
    return;
  }
  if (opts.notifyGrantees ?? true) {
    void notifyGrantees(deps);
  }
  let removals = emptyRetiredRooms(deps).catch((e) => {
    log.warn(
      `Unable to empty the retired event rooms of ${deps.realmURL}: ${message(e)}`,
    );
  });
  if (opts.waitForRemovals) {
    await removals;
  }
}

// Retries the removals of every retired room, for when the realm server
// starts: a deleted realm never mounts again, so its sync can't.
export async function emptyAllRetiredRealmEventRooms({
  matrixClient,
  dbAdapter,
  dispatcher,
}: Omit<RealmEventRoomDeps, 'realmURL'>): Promise<void> {
  try {
    for (let realmURL of await fetchRealmsWithRetiredEventRooms(dbAdapter)) {
      await emptyRetiredRooms({
        realmURL,
        matrixClient,
        dbAdapter,
        dispatcher,
      });
    }
  } catch (e) {
    log.warn(`Unable to empty the retired realm event rooms: ${message(e)}`);
  }
}

async function loginIfNeeded(matrixClient: MatrixClient) {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

// One job on the realm's line: invites any grantee who isn't a member of the
// realm's room, or retires the room when it has a member no grant names.
// Resolves the room the realm's events go to afterwards, if it has one. With
// `required`, rejects when the job couldn't run (for example when Synapse
// stayed overloaded past the dispatcher's attempts) rather than answer as if
// the realm had no room.
async function bringInStep(
  deps: RealmEventRoomDeps,
  { required }: { required: boolean },
): Promise<string | undefined> {
  let outcome: { roomId: string | undefined } | undefined;
  let failure: unknown;
  let retire = false;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      try {
        let { roomId } = await fetchRealmEventRoom(
          deps.dbAdapter,
          deps.realmURL,
        );
        if (!roomId) {
          outcome = { roomId: undefined };
          return [];
        }
        await loginIfNeeded(deps.matrixClient);
        let grantees = await fetchRealmNamedGrantees(
          deps.dbAdapter,
          deps.realmURL,
        );
        let memberships: Map<string, string>;
        try {
          memberships = await deps.matrixClient.getRoomMemberships(roomId);
        } catch (e) {
          if (isRealmServerNotInRoomError(e, roomId)) {
            // The server can't send in or administer the room, as after a
            // homeserver reset, so the realm needs a new one.
            await forgetRoom(deps, roomId);
            outcome = { roomId: undefined };
            return [];
          }
          throw e;
        }
        let wanted = wantedMembers(deps, grantees);
        let unwanted = [...memberships.keys()].some(
          (user) => isMember(memberships, user) && !wanted.has(user),
        );
        if (unwanted) {
          retire = true;
          outcome = { roomId: undefined };
          return [];
        }
        outcome = { roomId };
        return invites(deps, roomId, wanted, memberships);
      } catch (e) {
        failure = e;
        if (isBackPressure(e)) {
          throw e;
        }
        return [];
      }
    },
  });
  if (retire) {
    await retireRealmEventRoom(deps, { waitForRemovals: true });
    return undefined;
  }
  if (!outcome) {
    // The job never ran to the end: its last attempt failed, and `failure`
    // holds why.
    if (required) {
      throw (
        failure ??
        new Error(`Unable to look up the event room of ${deps.realmURL}`)
      );
    }
    return undefined;
  }
  return outcome.roomId;
}

// Creates a room for the realm, invites its grantees, and only then stores
// it as the realm's. If another process stored a room first, that one is the
// realm's, and the new one is retired.
async function createRoom(deps: RealmEventRoomDeps): Promise<string> {
  let created: string | undefined;
  let failure: unknown;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      try {
        await loginIfNeeded(deps.matrixClient);
        let grantees = await fetchRealmNamedGrantees(
          deps.dbAdapter,
          deps.realmURL,
        );
        // An attempt prepared again after back-pressure reuses the room the
        // first attempt made.
        created ??= await deps.matrixClient.createRealmEventRoom(deps.realmURL);
        return invites(deps, created, wantedMembers(deps, grantees), new Map());
      } catch (e) {
        failure = e;
        if (isBackPressure(e)) {
          throw e;
        }
        return [];
      }
    },
  });
  if (!created) {
    throw (
      failure ??
      new Error(`Unable to create the event room of ${deps.realmURL}`)
    );
  }
  let stored = await insertRealmEventRoom(
    deps.dbAdapter,
    deps.realmURL,
    created,
  );
  if (stored === created) {
    return stored;
  }
  await insertRetiredRealmEventRoom(deps.dbAdapter, deps.realmURL, created);
  await emptyRetiredRooms(deps);
  return (await bringInStep(deps, { required: true })) ?? stored;
}

// Removes every member of each of the realm's retired rooms, then leaves the
// room and forgets it. A room whose members couldn't all be removed is kept,
// with the realm server still in it, for the next sync to try again.
async function emptyRetiredRooms(deps: RealmEventRoomDeps): Promise<void> {
  let rooms = await fetchRetiredRealmEventRooms(deps.dbAdapter, deps.realmURL);
  for (let roomId of rooms) {
    await emptyRetiredRoom(deps, roomId);
  }
}

async function emptyRetiredRoom(
  deps: RealmEventRoomDeps,
  roomId: string,
): Promise<void> {
  let emptied = false;
  let gone = false;
  let failed = false;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => {
      let memberships: Map<string, string>;
      try {
        await loginIfNeeded(deps.matrixClient);
        memberships = await deps.matrixClient.getRoomMemberships(roomId);
      } catch (e) {
        if (isRealmServerNotInRoomError(e, roomId)) {
          // Nothing the server can do in a room it isn't in.
          gone = true;
          return [];
        }
        if (isBackPressure(e)) {
          throw e;
        }
        failed = true;
        log.warn(
          `Unable to read the members of the retired event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
        );
        return [];
      }
      emptied = true;
      return [...memberships.keys()]
        .filter((user) => isMember(memberships, user))
        .map((user) => ({
          roomId,
          send: async () => {
            await deps.matrixClient.kickUser(
              roomId,
              user,
              'This room no longer carries the realm’s events',
            );
          },
          onFailure: async (e: unknown) => {
            failed = true;
            log.warn(
              `Unable to remove ${user} from the retired event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
            );
          },
        }));
    },
  });
  if (gone) {
    await clearRetiredRealmEventRoom(deps.dbAdapter, roomId);
    return;
  }
  if (!emptied || failed) {
    return;
  }
  let left = false;
  await deps.dispatcher.schedule({
    realmURL: deps.realmURL,
    newTxnId: () => deps.matrixClient.nextTxnId(),
    prepare: async () => [
      {
        roomId,
        send: async () => {
          await deps.matrixClient.leaveRoom(roomId);
          left = true;
        },
        onFailure: async (e) => {
          log.warn(
            `Unable to leave the retired event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
          );
        },
      },
    ],
  });
  if (left) {
    await clearRetiredRealmEventRoom(deps.dbAdapter, roomId);
  }
}

// Tells each of the realm's grantees that their realms changed, so their
// hosts ask again which room to listen in. Best-effort, one user at a time.
async function notifyGrantees(deps: RealmEventRoomDeps): Promise<void> {
  let sendEvent = createSendEvent({
    matrixClient: deps.matrixClient,
    dbAdapter: deps.dbAdapter,
  });
  let grantees: string[];
  try {
    grantees = await fetchRealmNamedGrantees(deps.dbAdapter, deps.realmURL);
  } catch (e) {
    log.warn(`Unable to list the grantees of ${deps.realmURL}: ${message(e)}`);
    return;
  }
  for (let user of grantees) {
    try {
      await sendEvent(user, REALMS_LIST_UPDATED_EVENT_TYPE);
    } catch (e) {
      log.warn(
        `Unable to tell ${user} the event room of ${deps.realmURL} changed: ${message(e)}`,
      );
    }
  }
}

function wantedMembers(deps: RealmEventRoomDeps, grantees: string[]) {
  let self = deps.matrixClient.getUserId();
  return new Set(grantees.filter((user) => user !== self));
}

function isMember(memberships: Map<string, string>, user: string) {
  return ['join', 'invite'].includes(memberships.get(user) ?? '');
}

function invites(
  deps: RealmEventRoomDeps,
  roomId: string,
  wanted: Set<string>,
  memberships: Map<string, string>,
): RealmEventSend[] {
  return [...wanted]
    .filter((user) => !isMember(memberships, user))
    .map((user) => ({
      roomId,
      send: async () => {
        await deps.matrixClient.inviteUser(roomId, user);
      },
      onFailure: async (e: unknown) => {
        // The next sync for the realm tries again.
        log.warn(
          `Unable to invite ${user} to the event room ${roomId} of ${deps.realmURL}: ${message(e)}`,
        );
      },
    }));
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
