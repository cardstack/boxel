// The token endpoint's limits (ADR 021 §1.4), applied before the library
// sees a request.
//
// - Per grant: every code and refresh exchange counts against the grant it
//   names. A connection refreshes about every 10 minutes, so the default
//   allows ten times that. Not per address or per client: a hosted client
//   refreshes every user's tokens from a few server addresses.
// - Failed attempts, for requests that name no code or refresh token the
//   provider holds, or a code without the verifier its PKCE challenge needs:
//   such a request can never succeed, so each counts as it arrives, and a
//   caller with none left is refused, so guessing codes or refresh tokens is
//   slow. They are counted as the provider's other unsigned endpoints count
//   requests (`caller-limit.ts`): per address (an IPv4 address or IPv6 /64),
//   per network (a /24 or /48, so a holder of many addresses is still one
//   caller), and overall. The overall limit refuses only such requests, so
//   reaching it never refuses an exchange that could succeed. Anyone who sees
//   a code in a redirect URL can send it, but without the verifier it never
//   counts against the code's grant, so it can't use up the limit the real
//   exchange and the grant's refreshes need, or end the grant as a reuse. A
//   request that can succeed is bounded by its grant instead. The address is
//   the one the `clientAddress` middleware works out, never the socket's.
//
// Ending a grant deletes its tokens, so a refresh that names a token of an
// ended grant counts as a failure too. So does a revocation that names one
// (`revocation.ts`), which counts in the same buckets: a client that ends a
// connection by revoking its refresh token and then its access token spends
// one failure, since the first revocation deleted the second token. A hosted client whose users' grants
// have ended refreshes those tokens from a few server addresses until each is
// told `invalid_grant`; where that is many, `address` and `network` in
// `BOXEL_OAUTH_TOKEN_RATE_LIMIT` raise the limit.
//
// A code or refresh token presented again after it was used ends its grant
// (§1.9) even when the grant is over its limit: the limit is checked after
// that, so a grant whose limit is kept spent can't put off the reuse that
// ends it. A code does so only with its verifier, as in the library.

import { createHash, timingSafeEqual } from 'crypto';
import type Koa from 'koa';
import type Provider from 'oidc-provider';
import {
  CLIENT_IP_HEADER,
  counterKey,
  isRateLimitUnavailable,
  logger,
  parseRateLimitSpec,
  type AnonymousRateLimit,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import {
  CallerLimitAlert,
  parseCallerLimit,
  takeFromCallerLimit,
  tokenBucket,
  type CallerLimit,
} from './caller-limit.ts';
import { browserOriginAllowed } from './client-cors.ts';
import { endGrant } from './grants.ts';
import { sha256Hex } from './objects.ts';
import { presentedRefreshToken } from './tokens.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_TOKEN_RATE_LIMIT_VAR = 'BOXEL_OAUTH_TOKEN_RATE_LIMIT';

// The largest token request read: a code or refresh token and a few short
// parameters fit many times over.
export const MAX_BODY_BYTES = 8 * 1024;

export interface TokenLimit {
  perGrant: AnonymousRateLimit;
  failures: CallerLimit;
}

export const DEFAULT_TOKEN_LIMIT: TokenLimit = Object.freeze({
  perGrant: Object.freeze({ requests: 60, windowSeconds: 3600 }),
  failures: Object.freeze({
    perAddress: Object.freeze({ requests: 60, windowSeconds: 600 }),
    perNetwork: Object.freeze({ requests: 300, windowSeconds: 600 }),
    overall: Object.freeze({ requests: 3000, windowSeconds: 600 }),
    alertAfter: 1500,
  }),
});

// Comma-separated named parts, each optional, with the default for any left
// out: `grant` as `requests/windowSeconds`, and the failures limit's parts as
// `parseCallerLimit` reads them, for example
// `grant=60/3600,address=60/600,network=300/600,all=3000/600,alert=1500`.
// Undefined when a part is unknown, repeated or malformed.
export function parseTokenLimit(spec: string): TokenLimit | undefined {
  let perGrant: AnonymousRateLimit = DEFAULT_TOKEN_LIMIT.perGrant;
  let failureParts: string[] = [];
  let grantSeen = false;
  for (let part of spec.split(',')) {
    let [name, value, ...rest] = part.split('=').map((text) => text.trim());
    if (name !== 'grant') {
      failureParts.push(part);
      continue;
    }
    if (grantSeen || value === undefined || rest.length > 0) {
      return undefined;
    }
    grantSeen = true;
    let bucket = parseRateLimitSpec(value);
    if (!bucket) {
      return undefined;
    }
    perGrant = bucket;
  }
  let failures =
    failureParts.length === 0
      ? DEFAULT_TOKEN_LIMIT.failures
      : parseCallerLimit(failureParts.join(','), DEFAULT_TOKEN_LIMIT.failures);
  return failures ? { perGrant, failures } : undefined;
}

export function tokenLimitFormat(): string {
  let bucket = ({ requests, windowSeconds }: AnonymousRateLimit) =>
    `${requests}/${windowSeconds}`;
  let { perGrant, failures } = DEFAULT_TOKEN_LIMIT;
  return (
    `named parts, each optional: grant, address, network and all as requests/windowSeconds, ` +
    `and alert as a count below all's requests, for example ` +
    `grant=${bucket(perGrant)},address=${bucket(failures.perAddress)},` +
    `network=${bucket(failures.perNetwork)},all=${bucket(failures.overall)},` +
    `alert=${failures.alertAfter}`
  );
}

// The alert for failed requests, shared by the token and revocation
// endpoints, since their failures count in the same buckets.
export function failureAlert(limit: TokenLimit): CallerLimitAlert {
  return new CallerLimitAlert(
    limit.failures,
    ({ overall, alertAfter }) =>
      `more than ${alertAfter} failed OAuth token or revocation requests within ${overall.windowSeconds} seconds; ` +
      `they are refused for everyone at ${overall.requests}`,
  );
}

// The handler for `POST` on the token endpoint. `next` hands the request to
// the library, which reads the body Boxel left on `req.body` once the body
// itself has been read.
//
// A request that names a code or refresh token the provider holds, and
// for a code also its verifier, counts only against that token's grant,
// never against its address, so a hosted client's users can't be locked out
// by failures someone else causes through the client's address. One the
// grant's limit refuses still ends the grant if it presents a code or token
// already used. Any other request counts as a failure, against its address,
// its network and the overall limit. One whose address can't be worked out
// is refused, since it can't be counted.
export function tokenHandler({
  provider,
  dbAdapter,
  rateLimitStore,
  limit,
  alert = failureAlert(limit),
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
  limit: TokenLimit;
  alert?: CallerLimitAlert;
}): Koa.Middleware {
  let perGrant = tokenBucket(limit.perGrant);

  return async function handleToken(ctxt, next) {
    let body: string | undefined;
    if (ctxt.is('application/x-www-form-urlencoded')) {
      try {
        body = await readBody(ctxt.req);
      } catch {
        return respond(ctxt, 400, {
          error: 'invalid_request',
          error_description: `a token request must be at most ${MAX_BODY_BYTES} bytes`,
        });
      }
    }
    let params = new URLSearchParams(body ?? '');
    let answer = async (
      status: number,
      error: { error: string; error_description: string },
    ) => {
      await allowClientOrigin(ctxt, provider, params.get('client_id'));
      respond(ctxt, status, error);
    };

    let exchange =
      body === undefined ? undefined : await grantOfExchange(dbAdapter, params);
    if (exchange) {
      let taken = await rateLimitStore.take(
        counterKey('oauth-token-grant', exchange.grantId),
        perGrant,
      );
      if (!taken.admitted) {
        if (exchange.reused) {
          // What the library does with a reuse it sees.
          log.info(`${exchange.what} reused`);
          await endGrant(dbAdapter, exchange.grantId, 'reuse');
          return answer(400, {
            error: 'invalid_grant',
            error_description: 'grant request is invalid',
          });
        }
        return refuse(
          answer,
          ctxt,
          isRateLimitUnavailable(taken)
            ? { reason: 'unavailable' }
            : { reason: 'limited', retryAfterSeconds: taken.retryAfterSeconds },
          'grant',
          'token',
        );
      }
    } else if (
      !(await chargeFailure({
        ctxt,
        answer,
        rateLimitStore,
        limit,
        alert,
        endpoint: 'token',
      }))
    ) {
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

// The answers Boxel writes itself on the token and revocation routes go out
// before the library's CORS runs, so they carry the same CORS the library would give:
// a page on an origin the client may call from can read them, `Retry-After`
// included. The one answer without it is to a body too large to read, which
// names no client to check the origin against; no client sends one.
export async function allowClientOrigin(
  ctxt: Koa.Context,
  provider: Provider,
  clientId: string | null,
) {
  let origin = ctxt.get('Origin');
  if (!origin || !clientId) {
    return;
  }
  let client = await provider.Client.find(clientId).catch(() => undefined);
  if (client && browserOriginAllowed(origin, client)) {
    ctxt.vary('Origin');
    ctxt.set('Access-Control-Allow-Origin', origin);
    ctxt.set('Access-Control-Expose-Headers', 'Retry-After');
  }
}

// The grant a code or refresh exchange names, if the code or token is one
// the provider issued and, for a code, the request proves it with the
// verifier its PKCE challenge needs; and whether presenting it again ends
// the grant. A code without its verifier is refused by the library before it
// checks for reuse, so it names no grant here.
async function grantOfExchange(
  dbAdapter: DBAdapter,
  params: URLSearchParams,
): Promise<
  | { grantId: string; reused: boolean; what: 'code' | 'refresh token' }
  | undefined
> {
  let grantType = params.get('grant_type');
  if (grantType === 'authorization_code') {
    let code = params.get('code');
    if (!code) {
      return undefined;
    }
    let [row] = (await dbAdapter.execute(
      `SELECT payload->>'grantId' AS grant_id,
              payload->>'codeChallenge' AS challenge,
              payload->>'codeChallengeMethod' AS method,
              payload->'consumed' IS NOT NULL AND expires_at > now() AS reused
         FROM oauth_provider_objects
        WHERE kind = 'AuthorizationCode' AND id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(code)] },
    )) as {
      grant_id: string | null;
      challenge: string | null;
      method: string | null;
      reused: boolean;
    }[];
    return row?.grant_id &&
      pkceCanPass(params.get('code_verifier'), row.challenge, row.method)
      ? { grantId: row.grant_id, reused: row.reused, what: 'code' }
      : undefined;
  }
  if (grantType === 'refresh_token') {
    let token = params.get('refresh_token');
    if (!token) {
      return undefined;
    }
    let presented = await presentedRefreshToken(dbAdapter, token);
    return presented ? { ...presented, what: 'refresh token' } : undefined;
  }
  return undefined;
}

// The library's PKCE check (`helpers/pkce.js`), as a test rather than a
// refusal.
function pkceCanPass(
  verifier: string | null,
  challenge: string | null,
  method: string | null,
): boolean {
  if (!verifier && !challenge) {
    return true;
  }
  if (!verifier || !challenge || method !== 'S256') {
    return false;
  }
  let expected = Buffer.from(
    createHash('sha256').update(verifier).digest('base64url'),
  );
  let actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Writes an error answer of Boxel's own, with the CORS its request allows.
export type Answer = (
  status: number,
  error: { error: string; error_description: string },
) => Promise<void>;

// Counts a request that can never succeed against the failure limits, per
// address, per network and overall, shared by the token and revocation
// endpoints. Answers whether it was admitted; one that wasn't has been
// answered already, with 403 when its address can't be worked out, since it
// can't be counted.
export async function chargeFailure({
  ctxt,
  answer,
  rateLimitStore,
  limit,
  alert,
  endpoint,
}: {
  ctxt: Koa.Context;
  answer: Answer;
  rateLimitStore: RateLimitStore;
  limit: TokenLimit;
  alert: CallerLimitAlert;
  endpoint: 'token' | 'revocation';
}): Promise<boolean> {
  let address = ctxt.req.headers[CLIENT_IP_HEADER];
  let admitted = await takeFromCallerLimit(
    rateLimitStore,
    'oauth-token-failure',
    typeof address === 'string' ? address : undefined,
    limit.failures,
  );
  alert.note(admitted);
  if (admitted.admitted) {
    return true;
  }
  if (admitted.reason === 'unknown-address') {
    log.info(`${endpoint} request refused: unknown address`);
    await answer(403, {
      error: 'access_denied',
      error_description: `${endpoint} requests are refused from this address`,
    });
  } else {
    await refuse(answer, ctxt, admitted, 'failures', endpoint);
  }
  return false;
}

// Refuses a request a limit didn't admit, naming the endpoint it was sent to.
export async function refuse(
  answer: Answer,
  ctxt: Koa.Context,
  outcome:
    | { reason: 'unavailable' }
    | { reason: 'limited'; retryAfterSeconds: number },
  limit: 'grant' | 'failures',
  endpoint: 'token' | 'revocation',
) {
  if (outcome.reason === 'unavailable') {
    log.warn(`${endpoint} request refused: rate limit unavailable`);
    return answer(503, {
      error: 'temporarily_unavailable',
      error_description: `the ${endpoint} endpoint is unavailable; try again later`,
    });
  }
  log.info(`${endpoint} request refused: rate limit, ${limit}`);
  ctxt.set('Retry-After', String(outcome.retryAfterSeconds));
  return answer(429, {
    error: 'temporarily_unavailable',
    error_description: `too many ${endpoint} requests; try again later`,
  });
}

// Reads a request's body, up to `MAX_BODY_BYTES`.
export async function readBody(req: Koa.Context['req']): Promise<string> {
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) {
      throw new Error('request too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function respond(
  ctxt: Koa.Context,
  status: number,
  body: { error: string; error_description: string },
) {
  ctxt.status = status;
  ctxt.set('Cache-Control', 'no-store');
  ctxt.body = body;
}
