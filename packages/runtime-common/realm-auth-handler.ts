import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';
import { addAuthorizationHeader } from './index';

export class RealmAuthHandler {
  // Cached realm info and session to avoid fetching it multiple times for the same realm
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

  addAuthorizationHeader = async (
    request: Request,
  ): Promise<Response | null> => {
    return await addAuthorizationHeader(this.loader, request, {
      originRealmURL: this.realmURL,
      getJWT: this.getJWT.bind(this),
      getRealmInfoByURL: this.getRealmInfoByURL.bind(this),
      resetAuth: this.resetAuth.bind(this),
    });
  };

  private async getJWT(realmURL: string): Promise<string> {
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

  private resetAuth(realmURL: string) {
    this.visitedRealms.delete(realmURL);
  }

  private async getRealmInfoByURL(url: string) {
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
