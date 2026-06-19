import { createHmac, timingSafeEqual } from 'crypto';

// Shared-secret authentication for the realm-server /_delegate-session
// endpoint (security design CS-11551). ai-bot and the realm server hold a
// shared secret; ai-bot signs each delegation request with it. The secret
// itself never crosses the wire — only an HMAC over the request — so TLS plus
// the timestamp window below give meaningful replay protection, and secret
// rotation (CS-11567) remains the defense against the secret leaking from
// configuration.

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
