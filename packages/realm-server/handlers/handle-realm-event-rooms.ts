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

// More realms than a host has open at once.
const MAX_REALMS_PER_REQUEST = 200;

// Answers a signed-in host with the rooms that the world-readable realms it
// names send their realm events into, so it can join them. A realm's room is
// created the first time a host asks for it. A realm that isn't
// world-readable, or that this server doesn't serve, is left out of the
// answer: its events reach the host through the user's session room, if they
// reach it at all.
//
// Body: `{ realms: string[] }`. Answer: `{ rooms: { [realm]: roomId } }`,
// keyed by each realm as the request spelled it.
export default function handleRealmEventRooms({
  dbAdapter,
  reconciler,
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
    await Promise.all(
      (realms as string[]).map(async (realm) => {
        let realmURL = normalizeRealmURL(realm)?.href;
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
            // Only the realm's own matrix user may send in its room, so the
            // realm creates it.
            let mounted = await reconciler.lookupOrMount(realmURL);
            roomId = (await mounted?.ensureRealmEventRoom()) ?? null;
          }
          if (roomId) {
            rooms[realm] = roomId;
          }
        } catch (e) {
          log.error(`Unable to provide the realm event room of ${realmURL}`, e);
        }
      }),
    );

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ rooms }), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
