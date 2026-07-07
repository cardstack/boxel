import { createHmac, timingSafeEqual } from 'crypto';
import { ensureTrailingSlash } from './paths.ts';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

// Shared-secret authentication and wire contract for the realm-server
// /_worker-request endpoint. A worker container's worker manager and the realm
// server hold a shared secret (REALM_SECRET_SEED); the manager signs each
// forwarded worker request with it and the realm server verifies it. The secret
// never crosses the wire — only an HMAC over the request — so TLS plus the
// timestamp window below give meaningful replay protection, and rotating the
// shared secret is the defense against it leaking from configuration.
//
// The mechanism is generic: a worker request carries an arbitrary typed
// payload, and both the manager and the realm server dispatch on `type`.
// `broadcast-realm-event` is the first specialization — a worker asking the
// realm server to broadcast a realm event it can't emit itself (it holds no
// matrix client). Future worker-originated requests add a new `type` without
// touching the transport.
//
// This module is the single source of truth for the signed-payload format and
// the envelope shape, so the manager (signing) and the realm server (verifying)
// can never drift. Node-only (pulls in `crypto`); imported via the
// `@cardstack/runtime-common/worker-request` subpath by node consumers only,
// never from the package barrel that browser code loads.

export const WORKER_REQUEST_TIMESTAMP_HEADER =
  'x-boxel-worker-request-timestamp';
export const WORKER_REQUEST_SIGNATURE_HEADER =
  'x-boxel-worker-request-signature';

// ±60s window on the request timestamp. Cheap and stateless — it bounds the
// replay window for a captured request without a server-side nonce store.
export const WORKER_REQUEST_TIMESTAMP_WINDOW_MS = 60_000;

// The canonical string both sides sign: `${timestamp}.${rawBody}`. `timestamp`
// is epoch milliseconds in base-10; `rawBody` is the exact request body bytes.
// HMAC-SHA256 with the shared secret, hex digest. Binding the timestamp into
// the signed payload is what makes the ±60s window enforceable — a captured
// request cannot have its timestamp rewritten without the secret.
export function workerRequestSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

export type WorkerRequestAuthResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyWorkerRequest({
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
}): WorkerRequestAuthResult {
  if (!timestamp || !signature) {
    return {
      ok: false,
      reason: 'missing worker-request timestamp or signature header',
    };
  }
  let ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed worker-request timestamp' };
  }
  if (Math.abs(now - ts) > WORKER_REQUEST_TIMESTAMP_WINDOW_MS) {
    return {
      ok: false,
      reason: 'worker-request timestamp is outside the allowed window',
    };
  }
  let expected = workerRequestSignature(secret, timestamp, rawBody);
  let expectedBuf = Buffer.from(expected, 'utf8');
  let providedBuf = Buffer.from(signature, 'utf8');
  // Constant-time compare. timingSafeEqual throws on a length mismatch, so
  // gate on length first — both are hex SHA-256 digests (64 chars) when
  // well-formed, and the length itself is not secret.
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, reason: 'invalid worker-request signature' };
  }
  return { ok: true };
}

// The generic wire envelope: a typed worker request forwarded to the realm
// server. Both the manager and the realm server dispatch on `type`.
export interface WorkerRequestBody<T = unknown> {
  type: string;
  payload: T;
}

// First specialization: ask the realm server to broadcast a realm event on the
// worker's behalf. The payload is the event itself; its `realmURL` names the
// target realm (the manager resolves it against its url mappings, the realm
// server resolves the mounted realm from it).
export const BROADCAST_REALM_EVENT = 'broadcast-realm-event';
export type BroadcastRealmEventPayload = RealmEventContent;

// ─── Client ──────────────────────────────────────────────────────────────

// Sign and POST a typed worker request to the realm server's /_worker-request
// endpoint. `realmServerURL` is the origin of the realm server to forward to.
// `now` and `fetch` are injectable for tests. Returns the raw Response so the
// caller decides retry/logging.
export async function postWorkerRequest({
  realmServerURL,
  secret,
  type,
  payload,
  fetch = globalThis.fetch,
  now = Date.now(),
}: {
  realmServerURL: string;
  secret: string;
  type: string;
  payload: unknown;
  fetch?: typeof globalThis.fetch;
  now?: number;
}): Promise<Response> {
  let endpoint = new URL(
    '_worker-request',
    ensureTrailingSlash(realmServerURL),
  );
  let rawBody = JSON.stringify({ type, payload } satisfies WorkerRequestBody);
  let timestamp = String(now);
  let signature = workerRequestSignature(secret, timestamp, rawBody);
  return await fetch(endpoint.href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WORKER_REQUEST_TIMESTAMP_HEADER]: timestamp,
      [WORKER_REQUEST_SIGNATURE_HEADER]: signature,
    },
    body: rawBody,
  });
}
