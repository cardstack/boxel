import { AuthenticationErrorMessages } from './router';
import { Loader, baseRealm } from './index';
import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';

export type RealmInfoFromHeadReq = {
  isPublicReadable: boolean;
  url: string;
};

export type AuthSource = {
  originRealmURL?: string;
  getRealmInfoByURL(url: string): Promise<RealmInfoFromHeadReq | null>;
  getJWT(realmURL: string): Promise<string>;
  resetAuth(realmURL: string): void;
};

export async function addAuthorizationHeader(
  loader: Loader,
  request: Request,
  authSource: AuthSource,
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

  let realmInfo = await authSource.getRealmInfoByURL(request.url);
  if (!realmInfo) {
    return null;
  }

  let isRequestToItself = realmInfo.url === authSource.originRealmURL; // Could be a request to itself when indexing its own cards
  if (
    isRequestToItself ||
    (realmInfo.isPublicReadable && request.method === 'GET')
  ) {
    return null;
  } else {
    request.headers.set(
      'Authorization',
      await authSource.getJWT(realmInfo.url),
    );

    let response = await loader.fetch(request);

    if (response.status === 401 && retryOnAuthFail) {
      let errorMessage = await response.text();
      if (
        errorMessage === AuthenticationErrorMessages.PermissionMismatch ||
        errorMessage === AuthenticationErrorMessages.TokenExpired
      ) {
        authSource.resetAuth(realmInfo.url);
        request.headers.delete('Authorization');

        return addAuthorizationHeader(loader, request, authSource, false);
      }
    }
    return response;
  }
}
