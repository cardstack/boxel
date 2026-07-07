import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForSystemError,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  WORKER_REALM_EVENT_SIGNATURE_HEADER,
  WORKER_REALM_EVENT_TIMESTAMP_HEADER,
  verifyWorkerRealmEventRequest,
  type WorkerRealmEventBody,
} from '@cardstack/runtime-common/worker-realm-event';

const log = logger('realm:worker-event');

// Broadcasts a worker-originated realm event (CS-11808). A background job runs
// in a worker child that holds no matrix client; it requests an event through
// its worker manager, which forwards it here over this shared-secret
// (HMAC-over-body) authenticated endpoint. We resolve the target realm from the
// event's realmURL — the job's realm context — and broadcast through the realm's
// existing matrix session-room plumbing, so the event reaches subscribed hosts
// exactly as a web-tier-originated event does. Routing every event through the
// single worker manager gives exactly-once delivery with no per-replica fan-out.
export default function handleWorkerEvent({
  realmSecretSeed,
  reconciler,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let rawBody = await request.text();

    let auth = verifyWorkerRealmEventRequest({
      secret: realmSecretSeed,
      timestamp: ctxt.get(WORKER_REALM_EVENT_TIMESTAMP_HEADER),
      signature: ctxt.get(WORKER_REALM_EVENT_SIGNATURE_HEADER),
      rawBody,
      now: Date.now(),
    });
    if (!auth.ok) {
      log.warn(`worker-event request rejected: ${auth.reason}`);
      await sendResponseForUnauthorizedRequest(ctxt, auth.reason);
      return;
    }

    let body: WorkerRealmEventBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
      return;
    }
    let event = body?.event as RealmEventContent | undefined;
    if (
      !event ||
      typeof event !== 'object' ||
      typeof event.realmURL !== 'string' ||
      event.realmURL.length === 0
    ) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body must include an "event" object with a non-empty "realmURL"',
      );
      return;
    }

    let realmURL = event.realmURL;
    // Route through the reconciler so a realm that hasn't been touched on this
    // process since the last restart still mounts on demand — the request may
    // land on any replica behind the load balancer, not necessarily one that
    // already has the realm mounted.
    let realm;
    try {
      realm = await reconciler.lookupOrMount(realmURL);
    } catch (e: any) {
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }
    if (!realm) {
      await sendResponseForError(
        ctxt,
        404,
        'Not Found',
        `realm ${realmURL} does not exist on this server`,
      );
      return;
    }

    try {
      await realm.broadcastEvent(event);
    } catch (e: any) {
      log.error(`failed to broadcast worker realm event for ${realmURL}:`, e);
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
