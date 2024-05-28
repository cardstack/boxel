import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';
import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';
import { AuthenticationErrorMessages } from './router';
import { baseRealm } from './constants';

type RealmInfo = {
  isPublicReadable: boolean;
  url: string;
};

type RealmInfoAuth = RealmInfo & { realmAuthClient?: RealmAuthClient };

export interface IRealmCache {
  getRealmInfoByURL(url: string): Promise<RealmInfo | null>;
  getJWT(realmURL: string): Promise<string>;
  resetAuth(realmURL: string): void;
}

export class RealmCache implements IRealmCache {
  private matrixClient: MatrixClient;
  private loader: Loader;
  // Cached realm info to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmInfoAuth>();

  constructor(loader: Loader, matrixClient: MatrixClient) {
    this.loader = loader;
    this.matrixClient = matrixClient;
  }

  async getJWT(realmURL: string): Promise<string> {
    let targetRealm = this.visitedRealms.get(realmURL);
    if (!targetRealm || !targetRealm.realmAuthClient) {
      throw new Error(
        `bug: should not have been able to get here without a targetRealm or without an auth client`,
      );
    }

    if (!this.matrixClient.isLoggedIn()) {
      await this.matrixClient.login();
    }
    return await targetRealm.realmAuthClient.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
  }

  resetAuth(realmURL: string) {
    this.visitedRealms.delete(realmURL);
  }

  async getRealmInfoByURL(url: string): Promise<RealmInfo | null> {
    let visitedRealmURL = Array.from(this.visitedRealms.keys()).find((key) => {
      return url.includes(key);
    });
    let targetRealm;

    if (visitedRealmURL) {
      targetRealm = this.visitedRealms.get(visitedRealmURL)!;
    } else {
      let targetRealmHeadResponse = await this.loader.fetch(url, {
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

    return {
      isPublicReadable: targetRealm.isPublicReadable,
      url: targetRealm.url,
    };
  }

  // A separate method for realm auth client creation to support mocking in tests
  private createRealmAuthClient(
    realmURL: URL,
    matrixClient: MatrixClient,
    loader: Loader,
  ) {
    return new RealmAuthClient(realmURL, matrixClient, loader);
  }
}

export class RealmAuthHandler {
  private loader: Loader;
  private realmURL?: string;
  private realmCache: IRealmCache;

  constructor(
    loader: Loader,
    realmURL?: string,
    matrixClient?: MatrixClient,
    realmCache?: IRealmCache,
  ) {
    this.loader = loader;
    this.realmURL = realmURL;
    if (!realmCache) {
      if (!matrixClient) {
        throw new Error(
          'bug: realmCache or matrixClient is required to instatiate RealmAuthHandler',
        );
      }
      realmCache = new RealmCache(loader, matrixClient);
    }
    this.realmCache = realmCache;
  }

  fetchWithAuth = async (
    request: Request,
    retryOnAuthFail = true,
  ): Promise<Response | null> => {
    // todo rename method and retryOnAuthFail
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

    let realmInfo = await this.realmCache.getRealmInfoByURL(request.url);
    if (!realmInfo) {
      return null;
    }

    let isRequestToItself = realmInfo.url === this.realmURL; // Could be a request to itself when indexing its own cards
    if (
      isRequestToItself ||
      (realmInfo.isPublicReadable && request.method === 'GET')
    ) {
      return null;
    } else {
      request.headers.set(
        'Authorization',
        await this.realmCache.getJWT(realmInfo.url),
      );

      let response = await this.loader.fetch(request);

      if (response.status === 401 && retryOnAuthFail) {
        let errorMessage = await response.text();
        if (
          errorMessage === AuthenticationErrorMessages.PermissionMismatch ||
          errorMessage === AuthenticationErrorMessages.TokenExpired
        ) {
          this.realmCache.resetAuth(realmInfo.url);
          request.headers.delete('Authorization');

          return this.fetchWithAuth(request, false);
        }
      }
      return response;
    }
  };
}
