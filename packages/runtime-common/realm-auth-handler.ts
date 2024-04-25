import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';

export class RealmAuthHandler {
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

  // As a separate method to support mocking in tests
  private buildRealmAuthClient(
    realmURL: URL,
    matrixClient: MatrixClient,
    loader: Loader,
  ) {
    return new RealmAuthClient(realmURL, matrixClient, loader);
  }

  fetchWithAuth = async (request: Request) => {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      return null;
    }

    if (
      request.url.endsWith('_session') ||
      request.method === 'HEAD' ||
      request.headers.has('Authorization')
    ) {
      return null; // Prevent infinite recursion when loader.fetch calls this handler again - fetchWithAuth from here on already added what it needed to
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
      let targetRealmHeadResponse = await this.loader.fetch(request.url, {
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
        realmAuthClient: this.buildRealmAuthClient(
          new URL(targetRealmURL),
          this.matrixClient,
          this.loader,
        ),
      };

      this.visitedRealms.set(targetRealmURL, targetRealm);
    }

    if (!targetRealm || !targetRealm.realmAuthClient) {
      throw new Error(
        `bug: should not have been able to get here without a visitedRealm without an auth client`,
      );
    }

    let isRequestToItself = targetRealm.url === this.realmURL; // Could be a request to itself when indexing its own cards

    if (
      isRequestToItself ||
      (targetRealm.isPublicReadable && request.method === 'GET')
    ) {
      return null; // No need to add auth header for GET to public readable realms
    } else {
      if (!this.matrixClient.isLoggedIn()) {
        await this.matrixClient.login();
      }
      let jwt = await targetRealm.realmAuthClient.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
      request.headers.set('Authorization', jwt);
    }

    return null;
  };
}
