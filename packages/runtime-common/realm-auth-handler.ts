import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { Loader, RequestHandler } from './loader';
import { AuthenticationErrorMessages } from './router';
import { baseRealm } from './constants';
import { IRealmAuthCache } from './realm-auth-cache';

export function createRealmAuthHandler(
  loader: Loader,
  realmCache: IRealmAuthCache,
  realmURL?: string,
): RequestHandler {
  return async function addAuthorizationHeader(
    request: Request,
    retryOnAuthFail = true,
  ): Promise<Response | null> {
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

    let realmInfo = await realmCache.getRealmInfoByURL(request.url);
    if (!realmInfo) {
      return null;
    }

    let isRequestToItself = realmInfo.url === realmURL; // Could be a request to itself when indexing its own cards
    if (
      isRequestToItself ||
      (realmInfo.isPublicReadable && request.method === 'GET')
    ) {
      return null;
    } else {
      request.headers.set(
        'Authorization',
        await realmCache.getJWT(realmInfo.url),
      );

      let response = await loader.fetch(request);

      if (response.status === 401 && retryOnAuthFail) {
        let errorMessage = await response.text();
        if (
          errorMessage === AuthenticationErrorMessages.PermissionMismatch ||
          errorMessage === AuthenticationErrorMessages.TokenExpired
        ) {
          realmCache.resetAuth(realmInfo.url);
          request.headers.delete('Authorization');

          return addAuthorizationHeader(request, false);
        }
      }
      return response;
    }
  };
}
