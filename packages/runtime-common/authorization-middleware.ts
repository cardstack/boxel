import { FetcherMiddlewareHandler } from './fetcher';

export interface TokenSource {
  token(url: string): string | undefined;
  attemptLogin(realmURL: string): Promise<string | undefined>;
  ensureRealmMeta(realmURL: string): Promise<void>;
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
      if (response.status === 401) {
        token = await tokenSource.attemptLogin(realmURL);
        if (token) {
          req.headers.set('Authorization', token);
          response = await next(req);
        }
      }

      await tokenSource.ensureRealmMeta(realmURL);
    }
    return response;
  };
}
