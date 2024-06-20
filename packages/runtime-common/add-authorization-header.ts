import { AuthenticationErrorMessages } from './router';
import { baseRealm } from './index';
import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { RequestHandler } from './loader';

export interface IRealmAuthDataSource {
  getToken(url: string, httpMethod: string): Promise<string | undefined>;
  resetToken(url: string): void;
}
export function addAuthorizationHeader(
  fetch: typeof globalThis.fetch,
  realmAuthDataSource: IRealmAuthDataSource,
): RequestHandler {
  return async function requestHandler(
    request: Request,
    retryOnAuthFail = true,
  ) {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      return null;
    }

    // To avoid deadlock, we can assume that any GET requests to baseRealm don't need authentication.
    let isGetRequestToBaseRealm =
      request.url.includes(baseRealm.url) && request.method === 'GET';
    if (
      isGetRequestToBaseRealm ||
      request.url.endsWith('_session') ||
      request.method === 'HEAD' ||
      request.headers.has('Authorization')
    ) {
      return null;
    }

    let token = await realmAuthDataSource.getToken(request.url, request.method);
    if (!token) {
      return null;
    }
    request.headers.set('Authorization', token);
    let response = await fetch(request);

    if (response.status === 401 && retryOnAuthFail) {
      let errorMessage = await response.text();
      if (
        errorMessage === AuthenticationErrorMessages.PermissionMismatch ||
        errorMessage === AuthenticationErrorMessages.TokenExpired
      ) {
        realmAuthDataSource.resetToken(request.url);
        request.headers.delete('Authorization');

        return requestHandler(request, false);
      }
    }
    return response;
  };
}
