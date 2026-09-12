import type { FetcherMiddlewareHandler } from './fetcher.ts';

export interface TokenSource {
  token(url: string): string | undefined;
  reauthenticate(realmURL: string): Promise<string | undefined>;
}

function shouldSkipReauthentication(): boolean {
  try {
    let inRenderContext = Boolean((globalThis as any).__boxelRenderContext);
    // Host tests also run the indexer and the app in the same js runtime which
    // can be very confusing. We err on the side of host tests needing
    // reauthentication retries enabled so browser-loaded assets can recover
    // from transient 401s.
    let isBrowserTestEnv =
      typeof window !== 'undefined' && Boolean((globalThis as any).QUnit);
    return inRenderContext && !isBrowserTestEnv;
  } catch {
    return false;
  }
}

export function authorizationMiddleware(
  tokenSource: TokenSource,
): FetcherMiddlewareHandler {
  return async function (req, next) {
    let token = tokenSource.token(req.url);
    if (token) {
      req.headers.set('Authorization', token);
    }
    let response = await next(req);

    let realmURL = response.headers.get('x-boxel-realm-url');
    if (realmURL) {
      if (
        // Only 401 should attempt reauthentication. A 403 typically means the
        // caller is authenticated but not permitted, so reauth would be noisy
        // and not expected to succeed.
        response.status === 401 &&
        !shouldSkipReauthentication() &&
        !req.url.startsWith(`${realmURL}_session`)
      ) {
        token = await tokenSource.reauthenticate(realmURL);
        if (token) {
          req.headers.set('Authorization', token);
          response = await next(req);
        }
      }
    }
    return response;
  };
}

// The realm server's own federated endpoints (`_federated-search`,
// `_federated-info`) are authorized by `multiRealmAuthorization`, which reads a
// realm-server session token rather than a per-realm one, and answers 401 for
// both a missing `Authorization` header and a token it rejects (expired,
// revoked, unparseable). Neither 401 names a realm, so `authorizationMiddleware`
// — which keys its reauth off the `x-boxel-realm-url` response header and
// reauthenticates that one realm — cannot recover from it. This middleware is
// the realm-server-scoped counterpart: it attaches the session token the
// endpoint actually validates, and on a 401 mints a fresh session and replays
// the request once.
//
// `realms` is the realm list the request carries, which selects the fallback
// token a caller holding no realm-server session can still authenticate with.
export interface RealmServerTokenSource {
  // The bearer token to send for a request naming `realms`, without the
  // `Bearer` prefix. Undefined when the caller holds no usable session, in
  // which case the request goes out unauthenticated and the server decides
  // whether the realms are publicly readable.
  tokenForRealms(realms: string[]): string | undefined;
  // Mint a fresh realm-server session, discarding the rejected one. Resolves to
  // the new token, or undefined when no session can be minted (no matrix
  // client, or the mint itself failed).
  reauthenticateRealmServer(): Promise<string | undefined>;
}

export function realmServerAuthorizationMiddleware(
  tokenSource: RealmServerTokenSource,
  realms: string[],
): FetcherMiddlewareHandler {
  return async function (req, next) {
    // A caller that set its own `Authorization` header has chosen a token
    // deliberately (the delegated and prerender token paths do this); leave it
    // alone rather than overwriting it with the session token.
    let callerSuppliedAuth = req.headers.has('Authorization');
    if (!callerSuppliedAuth) {
      let token = tokenSource.tokenForRealms(realms);
      if (token) {
        req.headers.set('Authorization', `Bearer ${token}`);
      }
    }
    let response = await next(req);
    if (
      response.status !== 401 ||
      callerSuppliedAuth ||
      shouldSkipReauthentication()
    ) {
      return response;
    }
    // A 403 means authenticated-but-not-permitted and is deliberately not
    // retried here: the session is fine and a fresh one would be refused the
    // same way.
    let token = await tokenSource.reauthenticateRealmServer();
    if (!token) {
      return response;
    }
    req.headers.set('Authorization', `Bearer ${token}`);
    // One replay only: `next` runs the rest of the chain, never this handler
    // again, so a session that is still refused surfaces its 401 to the caller.
    return next(req);
  };
}
