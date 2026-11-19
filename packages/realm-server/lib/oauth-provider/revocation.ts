// The revocation endpoint's limit (RFC 7009, ADR 021 §1.4), applied before
// the library sees a request.
//
// The body is read as the library reads it, with `node:querystring`, so both
// see the same `token` and `client_id`. A request that names either more than
// once names no single one, and is treated as naming none.
//
// A request that can revoke something names a live token issued to the
// client it names, and it can do so only once: revoking ends the token's
// grant (§1.9), which deletes the grant's tokens. Such a request isn't
// counted as a failure, so a client can always end its own connection,
// whatever its address has used up. It counts against a bucket of the
// token's grant instead, `REVOCATION_GRANT_LIMIT`. That bucket bounds a
// request that names a live token of its own client and still fails in the
// library (a stray `Authorization` header, or an origin the client may not be
// called from), which revokes nothing and could otherwise be sent without
// limit. It is fixed, apart from the grant's refreshes and from the
// `grant` part of `BOXEL_OAUTH_TOKEN_RATE_LIMIT`: a grant whose refreshes
// are used up can still be revoked, and raising a busy client's refreshes
// doesn't raise how many refused revocations one token can drive.
//
// Telling the two apart takes a lookup of the token before any limit is
// checked, so a caller whose address is over its limit still costs that
// lookup, one read by an indexed hash, as the token endpoint's lookup of a
// code or refresh token does. Checking the failure buckets first would cost a
// read of the rate-limit store all the same.
//
// Any other request can never revoke anything, so it counts as a failure, in
// the token endpoint's failure buckets (`token-limit.ts`): per address, per
// network and overall. That covers a token the provider doesn't hold (never
// issued, expired, or already revoked), another client's token, a request
// that names no token or no client, and a body too large to read. One whose
// address can't be worked out is refused, since it can't be counted. The
// library answers an admitted one: 200 for a known client and an opaque
// token, revoking nothing, as RFC 7009 requires, and an error for a missing
// or unknown client or a malformed request.
//
// A client is named by the `client_id` in the body, the only way a public
// client authenticates here. A client identified by a metadata document is
// looked up, and its document downloaded when it isn't cached, by the
// library, which counts the download on the new-client limit as at the token
// endpoint; a client whose document can't be fetched can't revoke.

import { parse as parseQuery } from 'node:querystring';
import type Koa from 'koa';
import type Provider from 'oidc-provider';
import {
  counterKey,
  isRateLimitUnavailable,
  type AnonymousRateLimit,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import { tokenBucket, type CallerLimitAlert } from './caller-limit.ts';
import { sha256Hex } from './objects.ts';
import {
  allowClientOrigin,
  chargeFailure,
  MAX_BODY_BYTES,
  readBody,
  refuse,
  respond,
  type Answer,
  type TokenLimit,
} from './token-limit.ts';

// Refused revocations one live token can drive against its grant. A client
// needs one revocation to end a grant, and a few more to cover retries.
export const REVOCATION_GRANT_LIMIT: AnonymousRateLimit = Object.freeze({
  requests: 10,
  windowSeconds: 3600,
});

// The handler for `POST` on the revocation endpoint. `next` hands the
// request to the library, which reads the body Boxel left on `req.body`.
export function revocationHandler({
  provider,
  dbAdapter,
  rateLimitStore,
  limit,
  alert,
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
  limit: TokenLimit;
  alert: CallerLimitAlert;
}): Koa.Middleware {
  let perGrant = tokenBucket(REVOCATION_GRANT_LIMIT);
  let charge = (ctxt: Koa.Context, answer: Answer) =>
    chargeFailure({
      ctxt,
      answer,
      rateLimitStore,
      limit,
      alert,
      endpoint: 'revocation',
    });

  return async function handleRevocation(ctxt, next) {
    let body: string | undefined;
    if (ctxt.is('application/x-www-form-urlencoded')) {
      try {
        body = await readBody(ctxt.req);
      } catch {
        // It names no client, so its answers carry no CORS.
        let answer: Answer = async (status, error) =>
          respond(ctxt, status, error);
        if (!(await charge(ctxt, answer))) {
          return;
        }
        return respond(ctxt, 400, {
          error: 'invalid_request',
          error_description: `a revocation request must be at most ${MAX_BODY_BYTES} bytes`,
        });
      }
    }
    let params = parseQuery(body ?? '');
    let clientId = single(params.client_id);
    let answer: Answer = async (status, error) => {
      await allowClientOrigin(ctxt, provider, clientId ?? null);
      respond(ctxt, status, error);
    };

    let token = single(params.token);
    let grantId =
      clientId && token
        ? await grantOfClientsLiveToken(dbAdapter, token, clientId)
        : undefined;
    if (grantId) {
      let taken = await rateLimitStore.take(
        counterKey('oauth-revocation-grant', grantId),
        perGrant,
      );
      if (!taken.admitted) {
        return refuse(
          answer,
          ctxt,
          isRateLimitUnavailable(taken)
            ? { reason: 'unavailable' }
            : { reason: 'limited', retryAfterSeconds: taken.retryAfterSeconds },
          'grant',
          'revocation',
        );
      }
    } else if (!(await charge(ctxt, answer))) {
      return;
    }
    if (body !== undefined) {
      // The library reads `req.body` when the request stream has been read,
      // as it now has.
      (ctxt.req as typeof ctxt.req & { body?: unknown }).body = body;
    }
    await next();
  };
}

// A parameter's value when the body names it exactly once.
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// The grant of a token, by its value, when it is an access or refresh token
// the provider holds, unexpired, and issued to this client. A used or revoked
// refresh token still counts: revoking it ends its grant all the same.
async function grantOfClientsLiveToken(
  dbAdapter: DBAdapter,
  token: string,
  clientId: string,
): Promise<string | undefined> {
  let [row] = (await dbAdapter.execute(
    `SELECT grant_id FROM oauth_provider_tokens
      WHERE id_hash = decode($1, 'hex')
        AND expires_at > now()
        AND payload->>'clientId' = $2`,
    { bind: [sha256Hex(token), clientId] },
  )) as { grant_id: string }[];
  return row?.grant_id;
}
