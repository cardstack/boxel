import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';

export class RealmAuthHandler {
  // Cached realm info to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<
    string,
    {
      isPublicReadable: boolean;
      realmAuthClient?: RealmAuthClient;
      url: string;
    }
  >();
  private matrixClient: MatrixClient;
  private loader: Loader;
  private realmURL: string;

  constructor(matrixClient: MatrixClient, loader: Loader, realmURL: string) {
    this.matrixClient = matrixClient;
    this.loader = loader;
    this.realmURL = realmURL;
  }

  // A separate method for realm auth client creation to support mocking in tests
  private createRealmAuthClient(
    realmURL: URL,
    matrixClient: MatrixClient,
    loader: Loader,
  ) {
    return new RealmAuthClient(realmURL, matrixClient, loader);
  }

  fetchWithAuth = async (
    request: Request,
    retryOnAuthFail = true,
  ): Promise<Response | null> => {
    // todo rename method and retryOnAuthFail
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      return null;
    }

    if (
      request.url.endsWith('_session') ||
      request.method === 'HEAD' ||
      request.headers.has('Authorization')
    ) {
      return null;
    }

    let targetRealm: {
      isPublicReadable: boolean;
      realmAuthClient?: RealmAuthClient;
      url: string;
    };

    let visitedRealmURL = Array.from(this.visitedRealms.keys()).find((key) => {
      return request.url.includes(key);
    });

    if (visitedRealmURL) {
      targetRealm = this.visitedRealms.get(visitedRealmURL)!;
    } else {
      let targetRealmHeadResponse = await this.loader.fetch(request, {
        method: 'HEAD',
      });

      let targetRealmURL =
        targetRealmHeadResponse.headers.get('x-boxel-realm-url');

      if (!targetRealmURL) {
        return null; // It doesn't look like we are talking to a realm (the request is for something else), so skip adding auth header
      }

      let isPublicReadable = Boolean(
        targetRealmHeadResponse.headers.get('x-boxel-realm-public-readable'),
      );

      targetRealm = {
        isPublicReadable,
        url: targetRealmURL,
        realmAuthClient: this.createRealmAuthClient(
          new URL(targetRealmURL),
          this.matrixClient,
          this.loader,
        ),
      };

      this.visitedRealms.set(targetRealmURL, targetRealm);
    }

    if (!targetRealm || !targetRealm.realmAuthClient) {
      throw new Error(
        `bug: should not have been able to get here without a visitedRealm or without an auth client`,
      );
    }

    let isRequestToItself = targetRealm.url === this.realmURL; // Could be a request to itself when indexing its own cards

    if (
      isRequestToItself ||
      (targetRealm.isPublicReadable && request.method === 'GET')
    ) {
      return null; // No need to add auth for GET to public readable realms
    } else {
      if (!this.matrixClient.isLoggedIn()) {
        await this.matrixClient.login();
      }
      let jwt = await targetRealm.realmAuthClient.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
      request.headers.set('Authorization', jwt);

      let response = await this.loader.fetch(request);

      // 401 can mean the following: Missing token, expired token, malformed token, permissions changed (jwt payload does not match server permissions)
      // We make one retry if we get a 401 to make sure we have the latest permissions from the server
      if (response.status === 401 && retryOnAuthFail) {
        this.visitedRealms.delete(visitedRealmURL!);
        request.headers.delete('Authorization');
        return this.fetchWithAuth(request, false);
      }
      return response;
    }
  };
}
