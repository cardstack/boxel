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
// token's grant instead, kept apart from the grant's refreshes so that a
// grant whose refreshes are used up can still be revoked. That bucket bounds
// a request that names a live token of its own client and still fails in the
// library (a stray `Authorization` header, or an origin the client may not be
// called from), which revokes nothing and could otherwise be sent without
// limit.
//
// Any other request can never revoke anything, so it counts as a failure, in
// the token endpoint's failure buckets (`token-limit.ts`): per address, per
// network and overall. That covers a token the provider doesn't hold (never
// issued, expired, or already revoked), another client's token, and a
// request that names no token or no client. One whose address can't be worked
// out is refused, since it can't be counted. The library answers an admitted
// one: 200 for a known client and an opaque token, revoking nothing, as RFC
// 7009 requires, and an error for a missing or unknown client or a malformed
// request.
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
  CLIENT_IP_HEADER,
  counterKey,
  isRateLimitUnavailable,
  logger,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import {
  takeFromCallerLimit,
  tokenBucket,
  type CallerLimitAlert,
} from './caller-limit.ts';
import { sha256Hex } from './objects.ts';
import {
  allowClientOrigin,
  MAX_BODY_BYTES,
  readBody,
  refuse,
  respond,
  type TokenLimit,
} from './token-limit.ts';

const log = logger('boxel:oauth-provider');

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
  let perGrant = tokenBucket(limit.perGrant);

  return async function handleRevocation(ctxt, next) {
    let body: string | undefined;
    if (ctxt.is('application/x-www-form-urlencoded')) {
      try {
        body = await readBody(ctxt.req);
      } catch {
        return respond(ctxt, 400, {
          error: 'invalid_request',
          error_description: `a revocation request must be at most ${MAX_BODY_BYTES} bytes`,
        });
      }
    }
    let params = parseQuery(body ?? '');
    let clientId = single(params.client_id);
    let answer = async (
      status: number,
      error: { error: string; error_description: string },
    ) => {
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
    } else {
      let address = ctxt.req.headers[CLIENT_IP_HEADER];
      let admitted = await takeFromCallerLimit(
        rateLimitStore,
        'oauth-token-failure',
        typeof address === 'string' ? address : undefined,
        limit.failures,
      );
      alert.note(admitted);
      if (!admitted.admitted) {
        if (admitted.reason === 'unknown-address') {
          log.info('revocation request refused: unknown address');
          return answer(403, {
            error: 'access_denied',
            error_description:
              'revocation requests are refused from this address',
          });
        }
        return refuse(answer, ctxt, admitted, 'failures', 'revocation');
      }
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
