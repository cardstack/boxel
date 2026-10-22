import type Koa from 'koa';
import {
  fetchRealmEventRoom,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { CreateRoutesArgs } from '../routes.ts';
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
// Looking a realm's room up can mount the realm and create its room, so a
// request works through its realms a few at a time.
const REALMS_IN_FLIGHT = 4;

// Answers a signed-in host with the rooms that the world-readable realms it
// names send their realm events into, so it can join them. A realm's room is
// created the first time a host asks for it. A realm that isn't
// world-readable, or that this server doesn't serve, is left out of the
// answer: its events reach the host through the user's session room, if they
// reach it at all. A realm is named by its URL or by a registered prefix.
//
// When a realm's room can't be looked up or created, the answer is a 503
// carrying the rooms that were found, so the host asks again rather than take
// the realm for one that isn't world-readable.
//
// Body: `{ realms: string[] }`. Answer: `{ rooms: { [realm]: roomId } }`,
// keyed by each realm as the request spelled it.
export default function handleRealmEventRooms({
  dbAdapter,
  reconciler,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
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
        let { worldReadable, roomId } = await fetchRealmEventRoom(
          dbAdapter,
          realmURL,
        );
        if (!worldReadable) {
          return;
        }
        if (!roomId) {
          // The realm creates its room, through the matrix client it sends
          // its realm events with, so that client's user is the one allowed
          // to send in it.
          let mounted = await reconciler.lookupOrMount(realmURL);
          roomId = (await mounted?.ensureRealmEventRoom()) ?? null;
        }
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
