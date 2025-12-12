import type { FetcherMiddlewareHandler } from './fetcher';

export interface TokenSource {
  token(url: string): string | undefined;
  reauthenticate(realmURL: string): Promise<string | undefined>;
}

export function authorizationMiddleware(
  tokenSource: TokenSource,
): FetcherMiddlewareHandler {
  return async function (req, next) {
    let token = tokenSource.token(req.url);
    // if (
    //   !token &&
    //   typeof globalThis !== 'undefined' &&
    //   (globalThis as any).__boxelRenderContext
    // ) {
    //   try {
    //     let sessions = globalThis.localStorage?.getItem('boxel-session');
    //     if (sessions) {
    //       let parsed = JSON.parse(sessions) as Record<string, string>;
    //       for (let [realmURL, sessionToken] of Object.entries(parsed)) {
    //         if (req.url.startsWith(realmURL)) {
    //           token = sessionToken;
    //           break;
    //         }
    //       }
    //     }
    //   } catch (_e) {
    //     // best effort fallback; ignore parse errors
    //   }
    // }
    if (token) {
      req.headers.set('Authorization', token);
    }
    let response = await next(req);

    let realmURL = response.headers.get('x-boxel-realm-url');
    if (realmURL) {
      if (
        response.status === 401 &&
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
