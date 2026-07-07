import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForSystemError,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  BROADCAST_REALM_EVENT,
  WORKER_REQUEST_SIGNATURE_HEADER,
  WORKER_REQUEST_TIMESTAMP_HEADER,
  verifyWorkerRequest,
  type WorkerRequestBody,
} from '@cardstack/runtime-common/worker-request';

const log = logger('realm:worker-request');

// Handles a worker-originated request bridged in through the worker manager.
// A background job runs in a worker child that holds no matrix client; it hands
// a typed request to its manager, which forwards it here over this shared-secret
// (HMAC-over-body) authenticated endpoint. The request is dispatched on its
// `type` — a generic seam so a worker-originated request adds a handler here
// (and a manager-side forwarder) without changing the transport.
// `broadcast-realm-event` is one such type.
export default function handleWorkerRequest({
  realmSecretSeed,
  reconciler,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let rawBody = await request.text();

    let auth = verifyWorkerRequest({
      secret: realmSecretSeed,
      timestamp: ctxt.get(WORKER_REQUEST_TIMESTAMP_HEADER),
      signature: ctxt.get(WORKER_REQUEST_SIGNATURE_HEADER),
      rawBody,
      now: Date.now(),
    });
    if (!auth.ok) {
      log.warn(`worker-request rejected: ${auth.reason}`);
      await sendResponseForUnauthorizedRequest(ctxt, auth.reason);
      return;
    }

    let body: WorkerRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
      return;
    }

    switch (body?.type) {
      case BROADCAST_REALM_EVENT:
        await broadcastRealmEvent(ctxt, body.payload, reconciler);
        return;
      default:
        await sendResponseForBadRequest(
          ctxt,
          `Unknown worker request type: ${JSON.stringify(body?.type)}`,
        );
        return;
    }
  };
}

// Resolves the target realm from the event's realmURL — the job's realm context
// — and broadcasts through the realm's existing matrix session-room plumbing, so
// the event reaches subscribed hosts exactly as a web-tier-originated event
// does. Routing every request through the single worker manager avoids the
// per-replica fan-out a Postgres NOTIFY re-broadcast would cause.
async function broadcastRealmEvent(
  ctxt: Koa.Context,
  payload: unknown,
  reconciler: CreateRoutesArgs['reconciler'],
): Promise<void> {
  let event = payload as RealmEventContent | undefined;
  if (
    !event ||
    typeof event !== 'object' ||
    typeof event.realmURL !== 'string' ||
    event.realmURL.length === 0
  ) {
    await sendResponseForBadRequest(
      ctxt,
      'broadcast-realm-event payload must be a realm event with a non-empty "realmURL"',
    );
    return;
  }

  // Registry keys are canonicalized; canonicalize before the exact-match lookup.
  let normalized = normalizeRealmURL(event.realmURL);
  if (!normalized) {
    await sendResponseForBadRequest(
      ctxt,
      `event realmURL is not a valid URL: ${event.realmURL}`,
    );
    return;
  }

  // Route through the reconciler so a realm not touched on this process since
  // the last restart still mounts on demand — the request may land on any
  // replica behind the load balancer, not necessarily one that already has the
  // realm mounted.
  let realm;
  try {
    realm = await reconciler.lookupOrMount(normalized.href);
  } catch (e: any) {
    await sendResponseForSystemError(ctxt, e.message);
    return;
  }
  if (!realm) {
    await sendResponseForError(
      ctxt,
      404,
      'Not Found',
      `realm ${normalized.href} does not exist on this server`,
    );
    return;
  }

  try {
    await realm.broadcastEvent(event);
  } catch (e: any) {
    log.error(
      `failed to broadcast worker realm event for ${normalized.href}:`,
      e,
    );
    await sendResponseForSystemError(ctxt, e.message);
    return;
  }

  await setContextResponse(
    ctxt,
    new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': SupportedMimeType.JSON },
    }),
  );
}
