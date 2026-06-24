import { createHmac, timingSafeEqual } from 'crypto';

// Shared-secret authentication for the realm-server /_delegate-session
// endpoint. ai-bot and the realm server hold a shared secret; ai-bot signs
// each delegation request with it, the realm server verifies it. The secret
// itself never crosses the wire — only an HMAC over the request — so TLS plus
// the timestamp window below give meaningful replay protection, and rotating
// the shared secret is the defense against it leaking from configuration.
//
// This module is the single source of truth for the signed-payload format.
// Both sides import from here so they can never drift: ai-bot calls
// `requestDelegatedToken`/`delegationSignature` to sign, and the realm
// server's /_delegate-session handler calls `verifyDelegationRequest` to
// verify — neither keeps its own copy of the canonical `${timestamp}.${rawBody}`
// construction. It is imported via the
// `@cardstack/runtime-common/user-delegated-realm-server-session` subpath by
// node consumers only — it pulls in node `crypto`, so it is
// deliberately not re-exported from the package barrel that browser code loads.

export const DELEGATION_TIMESTAMP_HEADER = 'x-boxel-delegation-timestamp';
export const DELEGATION_SIGNATURE_HEADER = 'x-boxel-delegation-signature';

// ±60s window on the request timestamp. Cheap and stateless — it bounds the
// replay window for a captured request without a server-side nonce store.
export const DELEGATION_TIMESTAMP_WINDOW_MS = 60_000;

// The canonical string both sides sign: `${timestamp}.${rawBody}`. `timestamp`
// is epoch milliseconds in base-10; `rawBody` is the exact request body bytes.
// HMAC-SHA256 with the shared secret, hex digest. Binding the timestamp into
// the signed payload is what makes the ±60s window enforceable — a captured
// request cannot have its timestamp rewritten without the secret.
export function delegationSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

export type DelegationAuthResult = { ok: true } | { ok: false; reason: string };

export function verifyDelegationRequest({
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
}): DelegationAuthResult {
  if (!timestamp || !signature) {
    return {
      ok: false,
      reason: 'missing delegation timestamp or signature header',
    };
  }
  let ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed delegation timestamp' };
  }
  if (Math.abs(now - ts) > DELEGATION_TIMESTAMP_WINDOW_MS) {
    return {
      ok: false,
      reason: 'delegation timestamp is outside the allowed window',
    };
  }
  let expected = delegationSignature(secret, timestamp, rawBody);
  let expectedBuf = Buffer.from(expected, 'utf8');
  let providedBuf = Buffer.from(signature, 'utf8');
  // Constant-time compare. timingSafeEqual throws on a length mismatch, so
  // gate on length first — both are hex SHA-256 digests (64 chars) when
  // well-formed, and the length itself is not secret.
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, reason: 'invalid delegation signature' };
  }
  return { ok: true };
}

// ─── Client ──────────────────────────────────────────────────────────────

export interface DelegatedSession {
  token: string;
  realm: string;
  permissions: string[];
}

// Why a custom error: callers (ai-bot) branch on the failure kind — `disabled`
// (the realm server has no secret configured, 503) is a "feature is off, carry
// on" signal, whereas `forbidden` (the user has no read access, 403) and the
// auth failures are genuine errors worth surfacing.
export type DelegationErrorKind =
  | 'disabled' // 503: endpoint not configured on the realm server
  | 'forbidden' // 403: onBehalfOf lacks read on the realm
  | 'unauthorized' // 401: signature/timestamp rejected
  | 'bad-request' // 400: malformed request
  | 'unexpected'; // anything else

export class DelegationError extends Error {
  readonly kind: DelegationErrorKind;
  readonly status?: number;
  constructor(kind: DelegationErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'DelegationError';
    this.kind = kind;
    this.status = status;
  }
}

function delegationErrorKindForStatus(status: number): DelegationErrorKind {
  switch (status) {
    case 503:
      return 'disabled';
    case 403:
      return 'forbidden';
    case 401:
      return 'unauthorized';
    case 400:
      return 'bad-request';
    default:
      return 'unexpected';
  }
}

// Exchanges the shared secret for a 30-minute, single-realm, read-only JWT
// scoped to `onBehalfOf`'s read access on `realm`, by signing and POSTing to
// the realm server's /_delegate-session endpoint.
//
// `realmServerURL` is the origin of the realm server that fronts `realm`
// (ai-bot derives it as `new URL(realm).origin`). `now` and `fetch` are
// injectable for tests.
export async function requestDelegatedToken({
  realmServerURL,
  secret,
  onBehalfOf,
  realm,
  fetch = globalThis.fetch,
  now = Date.now(),
}: {
  realmServerURL: string;
  secret: string;
  onBehalfOf: string;
  realm: string;
  fetch?: typeof globalThis.fetch;
  now?: number;
}): Promise<DelegatedSession> {
  let endpoint = new URL(
    '_delegate-session',
    ensureTrailingSlash(realmServerURL),
  );
  let rawBody = JSON.stringify({ onBehalfOf, realm });
  let timestamp = String(now);
  let signature = delegationSignature(secret, timestamp, rawBody);

  let response: Response;
  try {
    response = await fetch(endpoint.href, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DELEGATION_TIMESTAMP_HEADER]: timestamp,
        [DELEGATION_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
    });
  } catch (e: any) {
    throw new DelegationError(
      'unexpected',
      `delegation request to ${endpoint.href} failed: ${e?.message ?? e}`,
    );
  }

  if (!response.ok) {
    let detail = await safeText(response);
    throw new DelegationError(
      delegationErrorKindForStatus(response.status),
      `delegation request rejected (${response.status})${
        detail ? `: ${detail}` : ''
      }`,
      response.status,
    );
  }

  let session: DelegatedSession;
  try {
    session = (await response.json()) as DelegatedSession;
  } catch {
    throw new DelegationError(
      'unexpected',
      'delegation response was not valid JSON',
      response.status,
    );
  }
  if (!session?.token) {
    throw new DelegationError(
      'unexpected',
      'delegation response did not include a token',
      response.status,
    );
  }
  return session;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
