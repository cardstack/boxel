import { FetcherMiddlewareHandler } from './fetcher';

export interface TokenSource {
  token(url: string): string | undefined;
  reauthenticate(realmURL: string): Promise<string | undefined>;
}

export function authorizationMiddleware(
  tokenSource: TokenSource,
): FetcherMiddlewareHandler {
  return async function (req, next) {
    console.log('authorizationMiddleware', req.url);
    let token = tokenSource.token(req.url);
    if (token) {
      console.log('authorizationMiddleware token', req.url, token);
      req.headers.set('Authorization', token);
    }
    let response = await next(req);

    let realmURL = response.headers.get('x-boxel-realm-url');
    if (realmURL) {
      if (
        response.status === 401 &&
        !req.url.startsWith(`${realmURL}_session`)
      ) {
        console.log('authorizationMiddleware - reauthenticate', realmURL);
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
