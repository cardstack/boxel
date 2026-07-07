import { createHmac, timingSafeEqual } from 'crypto';
import { ensureTrailingSlash } from './paths.ts';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

// Shared-secret authentication for the realm-server /_worker-event endpoint.
// A worker container's worker manager and the realm server hold a shared
// secret (REALM_SECRET_SEED); the manager signs each bridged realm-event
// request with it and the realm server verifies it. The secret never crosses
// the wire — only an HMAC over the request — so TLS plus the timestamp window
// below give meaningful replay protection, and rotating the shared secret is
// the defense against it leaking from configuration.
//
// This module is the single source of truth for the signed-payload format.
// Both sides import from here so they can never drift: the worker manager calls
// `sendWorkerRealmEvent` / `workerRealmEventSignature` to sign, and the realm
// server's /_worker-event handler calls `verifyWorkerRealmEventRequest` to
// verify — neither keeps its own copy of the canonical `${timestamp}.${rawBody}`
// construction. It is imported via the
// `@cardstack/runtime-common/worker-realm-event` subpath by node consumers
// only — it pulls in node `crypto`, so it is deliberately not re-exported from
// the package barrel that browser code loads.

export const WORKER_REALM_EVENT_TIMESTAMP_HEADER =
  'x-boxel-worker-event-timestamp';
export const WORKER_REALM_EVENT_SIGNATURE_HEADER =
  'x-boxel-worker-event-signature';

// ±60s window on the request timestamp. Cheap and stateless — it bounds the
// replay window for a captured request without a server-side nonce store.
export const WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS = 60_000;

// The canonical string both sides sign: `${timestamp}.${rawBody}`. `timestamp`
// is epoch milliseconds in base-10; `rawBody` is the exact request body bytes.
// HMAC-SHA256 with the shared secret, hex digest. Binding the timestamp into
// the signed payload is what makes the ±60s window enforceable — a captured
// request cannot have its timestamp rewritten without the secret.
export function workerRealmEventSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

export type WorkerRealmEventAuthResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyWorkerRealmEventRequest({
  secret,
  timestamp,
  signature,
  rawBody,
  now,
}: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  now: number;
}): WorkerRealmEventAuthResult {
  if (!timestamp || !signature) {
    return {
      ok: false,
      reason: 'missing worker-event timestamp or signature header',
    };
  }
  let ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed worker-event timestamp' };
  }
  if (Math.abs(now - ts) > WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS) {
    return {
      ok: false,
      reason: 'worker-event timestamp is outside the allowed window',
    };
  }
  let expected = workerRealmEventSignature(secret, timestamp, rawBody);
  let expectedBuf = Buffer.from(expected, 'utf8');
  let providedBuf = Buffer.from(signature, 'utf8');
  // Constant-time compare. timingSafeEqual throws on a length mismatch, so
  // gate on length first — both are hex SHA-256 digests (64 chars) when
  // well-formed, and the length itself is not secret.
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, reason: 'invalid worker-event signature' };
  }
  return { ok: true };
}

// The wire body: a single realm event to broadcast. The event carries its own
// `realmURL` (the job's realm context), which the endpoint resolves to a
// mounted realm.
export interface WorkerRealmEventBody {
  event: RealmEventContent;
}

// ─── Client ──────────────────────────────────────────────────────────────

// Sign and POST a worker-originated realm event to the realm server's
// /_worker-event endpoint. `realmServerURL` is the origin of the realm server
// that fronts the event's realm. `now` and `fetch` are injectable for tests.
// Returns the raw Response so the caller decides retry/logging.
export async function sendWorkerRealmEvent({
  realmServerURL,
  secret,
  event,
  fetch = globalThis.fetch,
  now = Date.now(),
}: {
  realmServerURL: string;
  secret: string;
  event: RealmEventContent;
  fetch?: typeof globalThis.fetch;
  now?: number;
}): Promise<Response> {
  let endpoint = new URL('_worker-event', ensureTrailingSlash(realmServerURL));
  let rawBody = JSON.stringify({ event } satisfies WorkerRealmEventBody);
  let timestamp = String(now);
  let signature = workerRealmEventSignature(secret, timestamp, rawBody);
  return await fetch(endpoint.href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WORKER_REALM_EVENT_TIMESTAMP_HEADER]: timestamp,
      [WORKER_REALM_EVENT_SIGNATURE_HEADER]: signature,
    },
    body: rawBody,
  });
}
