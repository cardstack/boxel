import type Koa from 'koa';
import {
  fetchRealmEventRoom,
  fetchRealmNamedGrantees,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
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
// When a realm's room can't be looked up or created, the answer is a 503
// carrying the rooms that were found, so the host asks again rather than take
// the realm for one without a room.
//
// Body: `{ realms: string[] }`. Answer: `{ rooms: { [realm]: roomId } }`,
// keyed by each realm as the request spelled it.
export default function handleRealmEventRooms({
  dbAdapter,
  reconciler,
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
    let failed = false;
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
        failed = true;
        log.error(`Unable to provide the realm event room of ${realmURL}`, e);
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
      new Response(JSON.stringify({ rooms }), {
        status: failed ? 503 : 200,
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
