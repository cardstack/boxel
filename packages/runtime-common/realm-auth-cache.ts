import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';

type RealmInfo = {
  isPublicReadable: boolean;
  url: string;
};

type RealmInfoAndAuth = RealmInfo & { realmAuthClient?: RealmAuthClient };

export interface IRealmAuthCache {
  getRealmInfoByURL(url: string): Promise<RealmInfo | null>;
  getJWT(realmURL: string): Promise<string>;
  resetAuth(realmURL: string): void;
}

export class RealmAuthCache implements IRealmAuthCache {
  private matrixClient: MatrixClient;
  private loader: Loader;
  // Cached realm info and session to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmInfoAndAuth>();

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
