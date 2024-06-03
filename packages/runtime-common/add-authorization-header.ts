import { AuthenticationErrorMessages } from './router';
import { baseRealm } from './index';
import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { IRealmAuthDataSource } from './realm-auth-data-source';
import { RequestHandler } from './loader';

export function addAuthorizationHeader(
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

    let realmInfo = await realmAuthDataSource.getRealmInfo(request.url);
    if (!realmInfo) {
      return null;
    }

    let isRequestToItself =
      realmInfo.url === realmAuthDataSource.getOriginRealmURL(); // Could be a request to itself when indexing its own cards
    if (
      isRequestToItself ||
      (realmInfo.isPublicReadable && request.method === 'GET')
    ) {
      return null;
    } else {
      request.headers.set(
        'Authorization',
        await realmAuthDataSource.getJWT(realmInfo.url),
      );

      let response = await realmAuthDataSource.getLoader().fetch(request);

      if (response.status === 401 && retryOnAuthFail) {
        let errorMessage = await response.text();
        if (
          errorMessage === AuthenticationErrorMessages.PermissionMismatch ||
          errorMessage === AuthenticationErrorMessages.TokenExpired
        ) {
          realmAuthDataSource.resetAuth(realmInfo.url);
          request.headers.delete('Authorization');

          return requestHandler(request, false);
        }
      }
      return response;
    }
  };
}
