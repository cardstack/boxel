// The token endpoint's limits (ADR 021 §1.4), applied before the library
// sees a request.
//
// - Per grant: every code and refresh exchange counts against the grant it
//   names. A connection refreshes about every 10 minutes, so the default
//   allows ten times that. Not per address or per client: a hosted client
//   refreshes every user's tokens from a few server addresses.
// - Failed attempts per address, for requests that name no code or refresh
//   token the provider holds: each the library refuses counts against the
//   caller's address, and a caller with none left is refused, so guessing
//   codes or refresh tokens is slow. A request that names one the provider
//   holds is bounded by its grant instead. The address is the one the
//   `clientAddress` middleware works out, never the socket's.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import {
  CLIENT_IP_HEADER,
  counterKey,
  isRateLimitUnavailable,
  logger,
  parseIP,
  parseRateLimitSpec,
  rateLimitKey,
  type AnonymousRateLimit,
  type DBAdapter,
  type RateLimitStore,
  type TokenBucketLimit,
  type TokenBucketOutcome,
} from '@cardstack/runtime-common';
import { browserOriginAllowed } from './client-cors.ts';
import { sha256Hex } from './objects.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_TOKEN_RATE_LIMIT_VAR = 'BOXEL_OAUTH_TOKEN_RATE_LIMIT';

// The largest token request read: a code or refresh token and a few short
// parameters fit many times over.
const MAX_BODY_BYTES = 8 * 1024;

export interface TokenLimit {
  perGrant: AnonymousRateLimit;
  failuresPerAddress: AnonymousRateLimit;
}

export const DEFAULT_TOKEN_LIMIT: TokenLimit = Object.freeze({
  perGrant: Object.freeze({ requests: 60, windowSeconds: 3600 }),
  failuresPerAddress: Object.freeze({ requests: 60, windowSeconds: 600 }),
});

const LIMIT_PARTS = {
  grant: 'perGrant',
  failures: 'failuresPerAddress',
} as const;

// Comma-separated named parts, each optional, with the default for any left
// out: `grant` and `failures` as `requests/windowSeconds`, for example
// `grant=60/3600,failures=60/600`. Undefined when a part is unknown, repeated
// or malformed.
export function parseTokenLimit(spec: string): TokenLimit | undefined {
  let limit: TokenLimit = { ...DEFAULT_TOKEN_LIMIT };
  let seen = new Set<string>();
  for (let part of spec.split(',')) {
    let [name, value, ...rest] = part.split('=').map((text) => text.trim());
    if (
      !name ||
      value === undefined ||
      rest.length > 0 ||
      seen.has(name) ||
      !(name in LIMIT_PARTS)
    ) {
      return undefined;
    }
    seen.add(name);
    let bucket = parseRateLimitSpec(value);
    if (!bucket) {
      return undefined;
    }
    limit[LIMIT_PARTS[name as keyof typeof LIMIT_PARTS]] = bucket;
  }
  return limit;
}

export function tokenLimitFormat(): string {
  let { perGrant, failuresPerAddress } = DEFAULT_TOKEN_LIMIT;
  return (
    `named parts, each optional: grant and failures as requests/windowSeconds, for example ` +
    `grant=${perGrant.requests}/${perGrant.windowSeconds},` +
    `failures=${failuresPerAddress.requests}/${failuresPerAddress.windowSeconds}`
  );
}

// The handler for `POST` on the token endpoint. `next` hands the request to
// the library, which reads the body Boxel left on `req.body` once the body
// itself has been read.
//
// A request that names a code or refresh token the provider holds counts
// only against that token's grant, never against its address, so a hosted
// client's users can't be locked out by failures someone else causes through
// the client's address. Any other request is checked against its address's
// failures, and counted there if the library refuses it. One whose address
// can't be worked out is refused, since it can't be counted.
export function tokenHandler({
  provider,
  dbAdapter,
  rateLimitStore,
  limit,
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
  limit: TokenLimit;
}): Koa.Middleware {
  let failures = tokenBucket(limit.failuresPerAddress);
  let perGrant = tokenBucket(limit.perGrant);
  // The requests that named no code or token the provider holds, which are
  // the only ones whose refusals count against their address.
  let unknownExchanges = new WeakSet<object>();

  provider.on('grant.error', (ctx: { req: Koa.Context['req'] }) => {
    if (!unknownExchanges.has(ctx.req)) {
      return;
    }
    let key = failureKey(ctx.req.headers[CLIENT_IP_HEADER]);
    if (key) {
      void rateLimitStore.take(key, failures);
    }
  });

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

    let grantId =
      body === undefined ? undefined : await grantOfExchange(dbAdapter, params);
    if (grantId) {
      let taken = await rateLimitStore.take(
        counterKey('oauth-token-grant', grantId),
        perGrant,
      );
      if (!taken.admitted) {
        return refuse(answer, ctxt, taken, 'grant');
      }
    } else {
      let key = failureKey(ctxt.req.headers[CLIENT_IP_HEADER]);
      if (!key) {
        log.info('token request refused: unknown address');
        return answer(403, {
          error: 'access_denied',
          error_description: 'token requests are refused from this address',
        });
      }
      let left = await rateLimitStore.peek(key, failures);
      if (!left.admitted) {
        return refuse(answer, ctxt, left, 'failures');
      }
      unknownExchanges.add(ctxt.req);
    }
    if (body !== undefined) {
      // The library reads `req.body` when the request stream has been read,
      // as it now has.
      (ctxt.req as typeof ctxt.req & { body?: unknown }).body = body;
    }
    await next();
  };
}

// The answers Boxel writes itself on the token route go out before the
// library's CORS runs, so they carry the same CORS the library would give:
// a page on an origin the client may call from can read them, `Retry-After`
// included.
async function allowClientOrigin(
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
// the provider issued.
async function grantOfExchange(
  dbAdapter: DBAdapter,
  params: URLSearchParams,
): Promise<string | undefined> {
  let grantType = params.get('grant_type');
  if (grantType === 'authorization_code') {
    let code = params.get('code');
    if (!code) {
      return undefined;
    }
    let [row] = (await dbAdapter.execute(
      `SELECT payload->>'grantId' AS grant_id FROM oauth_provider_objects
        WHERE kind = 'AuthorizationCode' AND id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(code)] },
    )) as { grant_id: string | null }[];
    return row?.grant_id ?? undefined;
  }
  if (grantType === 'refresh_token') {
    let token = params.get('refresh_token');
    if (!token) {
      return undefined;
    }
    let [row] = (await dbAdapter.execute(
      `SELECT grant_id FROM oauth_provider_tokens
        WHERE kind = 'RefreshToken' AND id_hash = decode($1, 'hex')`,
      { bind: [sha256Hex(token)] },
    )) as { grant_id: string }[];
    return row?.grant_id;
  }
  return undefined;
}

function failureKey(
  address: string | string[] | undefined,
): string | undefined {
  let parsed = typeof address === 'string' ? parseIP(address) : undefined;
  return parsed
    ? counterKey('oauth-token-failure', rateLimitKey(parsed))
    : undefined;
}

async function refuse(
  answer: (
    status: number,
    error: { error: string; error_description: string },
  ) => Promise<void>,
  ctxt: Koa.Context,
  outcome: Exclude<TokenBucketOutcome, { admitted: true }>,
  limit: 'grant' | 'failures',
) {
  if (isRateLimitUnavailable(outcome)) {
    log.warn(`token request refused: rate limit unavailable`);
    return answer(503, {
      error: 'temporarily_unavailable',
      error_description: 'the token endpoint is unavailable; try again later',
    });
  }
  log.info(`token request refused: rate limit, ${limit}`);
  ctxt.set('Retry-After', String(outcome.retryAfterSeconds));
  return answer(429, {
    error: 'temporarily_unavailable',
    error_description: 'too many token requests; try again later',
  });
}

async function readBody(req: Koa.Context['req']): Promise<string> {
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) {
      throw new Error('token request too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function respond(
  ctxt: Koa.Context,
  status: number,
  body: { error: string; error_description: string },
) {
  ctxt.status = status;
  ctxt.set('Cache-Control', 'no-store');
  ctxt.body = body;
}

function tokenBucket({
  requests,
  windowSeconds,
}: AnonymousRateLimit): TokenBucketLimit {
  return { burst: requests, refillPerMinute: (requests * 60) / windowSeconds };
}
