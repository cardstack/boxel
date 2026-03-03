import type { FetcherMiddlewareHandler } from './fetcher';

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
