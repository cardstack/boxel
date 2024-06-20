import { FetcherMiddlewareHandler } from './fetcher';

export interface TokenSource {
  peekToken(url: string): Promise<string>;
  getToken(url: string): Promise<string>;
  tokenFailed(token: string): Promise<void>;
}

export const authorizationMiddleware: () => FetcherMiddlewareHandler =
  function () {
    return function (req, next) {
      return next(req);
    };
  };
