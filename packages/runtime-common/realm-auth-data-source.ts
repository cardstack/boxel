import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';

type RealmInfo = {
  isPublicReadable: boolean;
  url: string;
};

export interface IRealmAuthDataSource {
  realmURL: string | undefined;
  getRealmInfo(url: string): Promise<RealmInfo | null>;
  getJWT(targetRealmURL: string): Promise<string>;
  resetAuth(targetRealmURL: string): void;
}

type RealmInfoAndAuth = RealmInfo & { realmAuthClient?: RealmAuthClient };

export class RealmAuthDataSource implements IRealmAuthDataSource {
  // Cached realm info and session to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmInfoAndAuth>();
  private matrixClient: MatrixClient;
  private loader: Loader;
  realmURL: string;

  constructor(matrixClient: MatrixClient, loader: Loader, realmURL: string) {
    this.matrixClient = matrixClient;
    this.loader = loader;
    this.realmURL = realmURL;
  }

  async getJWT(targetRealmURL: string): Promise<string> {
    let targetRealm = this.visitedRealms.get(targetRealmURL);
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

  resetAuth(targetRealmURL: string) {
    this.visitedRealms.delete(targetRealmURL);
  }

  async getRealmInfo(url: string) {
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
    targetRealmURL: URL,
    matrixClient: MatrixClient,
    loader: Loader,
  ) {
    return new RealmAuthClient(targetRealmURL, matrixClient, loader);
  }
}
