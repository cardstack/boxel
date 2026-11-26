import type Koa from 'koa';
import {
  deleteExpiredRealmEventWatchers,
  fetchRealmEventRoom,
  fetchRealmNamedGrantees,
  logger,
  SupportedMimeType,
  upsertRealmEventWatcher,
} from '@cardstack/runtime-common';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { realmPolicyPointer } from '../lib/realm-policy-pointer.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';

const log = logger('realm:events');

// A host asks about the realms it has open, batched as they open; this is
// well above that, and bounds what one request can make the server do.
const MAX_REALMS_PER_REQUEST = 100;
// Looking a realm's room up can mount the realm, create its room and invite
// its grantees, so a request works through its realms a few at a time.
const REALMS_IN_FLIGHT = 4;
// Each realm a user watches costs that realm a pass through its policy gate
// per index completion, for as long as the watch lasts. A host watches the
// policy realms it has open, which is a handful; this bounds what one user
// can make every such realm do.
const MAX_WATCHED_REALMS_PER_USER = 20;
// Each watcher of a realm costs it gate decisions on every index completion,
// made at the head of its line of events, so this bounds what the realm's
// completions can be made to wait behind.
const MAX_WATCHERS_PER_REALM = 100;

// Answers a signed-in host with the rooms the private realms it names send
// their realm events into, so it can join them. Only a realm whose grants
// name the signed-in user is answered for, and that user is invited to the
// room before the answer goes out, so the host's join succeeds. A realm's
// room is created the first time a host asks for it. A world-readable realm,
// a realm no grant names the user on, and a realm this server doesn't serve
// are left out: their events reach the host through the user's session room,
// if they reach it at all. A realm is named by its URL or by a registered
// prefix.
//
// A private realm that names no grant on the user but names a policy may
// still let them read some of its cards. The user is registered as one of its
// watchers instead (see `realm-event-watcher-queries.ts`), and the realm sends
// their session room its index events filtered to what the policy lets them
// read. A watch lapses unless renewed, so a host asks again while the realm
// stays open. Only a user the policy could admit to something is registered
// (see `Realm.policyMayAdmit`); a realm is mounted to ask only once its
// `realm.json` is read to name a policy.
//
// When a realm's room can't be looked up or created, the answer is a 503
// carrying the rooms that were found, so the host asks again rather than take
// the realm for one without a room.
//
// Body: `{ realms: string[] }`. Answer: `{ rooms: { [realm]: roomId } }`,
// with `watched: string[]` beside it when the user watches any of them, each
// realm as the request spelled it.
export default function handleRealmEventRooms({
  dbAdapter,
  reconciler,
  realmsRootPath,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let { user } = ctxt.state.token as RealmServerTokenClaim;
    let request = await fetchRequestFromContext(ctxt);
    let body: { realms?: unknown };
    try {
      body = JSON.parse(await request.text());
    } catch {
      await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
      return;
    }
    let realms = body?.realms;
    if (
      !Array.isArray(realms) ||
      !realms.every((realm) => typeof realm === 'string')
    ) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body must be { "realms": string[] }',
      );
      return;
    }
    if (realms.length > MAX_REALMS_PER_REQUEST) {
      await sendResponseForBadRequest(
        ctxt,
        `A request may name at most ${MAX_REALMS_PER_REQUEST} realms`,
      );
      return;
    }

    let rooms: Record<string, string> = {};
    let watched: string[] = [];
    let failed = false;
    let sweptLapsedWatches = false;
    let watch = async (realm: string, realmURL: string) => {
      // A pointer that can't be read without mounting is taken as no policy,
      // so a user the realm doesn't name still can't make this server mount
      // it.
      let pointer = await realmPolicyPointer(realmURL, {
        reconciler,
        realmsRootPath,
        virtualNetwork,
      });
      if (!pointer) {
        return;
      }
      let mounted = await reconciler.lookupOrMount(realmURL);
      if (!mounted || !(await mounted.policyMayAdmit(user))) {
        return;
      }
      if (!sweptLapsedWatches) {
        sweptLapsedWatches = true;
        await deleteExpiredRealmEventWatchers(dbAdapter);
      }
      if (
        await upsertRealmEventWatcher(dbAdapter, realmURL, user, {
          maxRealmsPerUser: MAX_WATCHED_REALMS_PER_USER,
          maxWatchersPerRealm: MAX_WATCHERS_PER_REALM,
        })
      ) {
        watched.push(realm);
      }
    };
    let lookUp = async (realm: string) => {
      let identifier = virtualNetwork.isRegisteredPrefix(realm)
        ? virtualNetwork.toURL(realm).href
        : realm;
      let realmURL = normalizeRealmURL(identifier)?.href;
      if (!realmURL) {
        return;
      }
      try {
        // Checked before anything is mounted, so a user the realm doesn't
        // name can't make this server mount it.
        let { isPrivate } = await fetchRealmEventRoom(dbAdapter, realmURL);
        if (!isPrivate) {
          return;
        }
        let grantees = await fetchRealmNamedGrantees(dbAdapter, realmURL);
        if (!grantees.includes(user)) {
          await watch(realm, realmURL);
          return;
        }
        // The realm's room is created and its members invited through the
        // matrix client the realm sends its realm events with.
        let mounted = await reconciler.lookupOrMount(realmURL);
        let roomId = await mounted?.ensureRealmEventRoom(user);
        if (roomId) {
          rooms[realm] = roomId;
        }
      } catch (e) {
        // A watch that failed to register fails the request the same way, so
        // the host asks about the realm again.
        failed = true;
        log.error(
          `Unable to provide the realm event room or watch of ${realmURL}`,
          e,
        );
      }
    };
    let queue = [...new Set(realms as string[])];
    await Promise.all(
      Array.from(
        { length: Math.min(REALMS_IN_FLIGHT, queue.length) },
        async () => {
          for (
            let realm = queue.shift();
            realm !== undefined;
            realm = queue.shift()
          ) {
            await lookUp(realm);
          }
        },
      ),
    );

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(watched.length > 0 ? { rooms, watched } : { rooms }),
        {
          status: failed ? 503 : 200,
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
