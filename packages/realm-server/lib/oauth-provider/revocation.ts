// The revocation endpoint's limit (RFC 7009, ADR 021 §1.4), applied before
// the library sees a request.
//
// A request that can revoke something names a live token issued to the
// client it names, and it can do so only once: revoking ends the token's
// grant (§1.9), which deletes the grant's tokens. Such a request isn't
// counted, so a client can always end its own connection, whatever its
// grant's refreshes or its address have used up.
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
// A request that names a live token of its own client and still fails in the
// library (a stray `Authorization` header, a repeated parameter, an origin the
// client may not be called from) isn't counted either. Sending it takes a live
// token, so it can't be used to guess one.
//
// A client is named by the `client_id` in the body, the only way a public
// client authenticates here. A client identified by a metadata document is
// looked up, and its document downloaded when it isn't cached, by the
// library, which counts the download on the new-client limit as at the token
// endpoint; a client whose document can't be fetched can't revoke.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import {
  CLIENT_IP_HEADER,
  logger,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import { takeFromCallerLimit, type CallerLimitAlert } from './caller-limit.ts';
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
    let params = new URLSearchParams(body ?? '');
    let clientId = params.get('client_id');
    let answer = async (
      status: number,
      error: { error: string; error_description: string },
    ) => {
      await allowClientOrigin(ctxt, provider, clientId);
      respond(ctxt, status, error);
    };

    let token = params.get('token');
    if (
      !(
        clientId &&
        token &&
        (await isClientsLiveToken(dbAdapter, token, clientId))
      )
    ) {
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

// Whether a token, by its value, is an access or refresh token the provider
// holds, unexpired, and issued to this client. A used or revoked refresh
// token still counts: revoking it ends its grant all the same.
async function isClientsLiveToken(
  dbAdapter: DBAdapter,
  token: string,
  clientId: string,
): Promise<boolean> {
  let rows = await dbAdapter.execute(
    `SELECT 1 FROM oauth_provider_tokens
      WHERE id_hash = decode($1, 'hex')
        AND expires_at > now()
        AND payload->>'clientId' = $2`,
    { bind: [sha256Hex(token), clientId] },
  );
  return rows.length > 0;
}
