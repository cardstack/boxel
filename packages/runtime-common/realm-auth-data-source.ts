import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';
import { Loader } from './loader';
import { type IRealmAuthDataSource } from './add-authorization-header';

export class RealmAuthDataSource implements IRealmAuthDataSource {
  // Cached realm info and session to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmAuthClient | 'public'>();
  private matrixClient: MatrixClient;
  private loader: Loader;
  realmURL: string;

  constructor(matrixClient: MatrixClient, loader: Loader, realmURL: string) {
    this.matrixClient = matrixClient;
    this.loader = loader;
    this.realmURL = realmURL;
  }

  async getToken(
    url: string,
    _httpMethod: string,
  ): Promise<string | undefined> {
    let targetRealmURL = this.toRealmURL(url);
    let isPublic: boolean | undefined;

    if (!targetRealmURL) {
      let realmFetchResult = await this.fetchRealmURL(url);
      if (!realmFetchResult) {
        return undefined;
      }
      ({ realmURL: targetRealmURL, isPublic } = realmFetchResult);
    }

    if (targetRealmURL === this.realmURL) {
      return undefined;
    }

    let client = this.visitedRealms.get(targetRealmURL);
    if (!client) {
      if (isPublic) {
        client = 'public';
      } else {
        client = this.createRealmAuthClient(
          new URL(targetRealmURL),
          this.matrixClient,
          this.loader,
        );
      }
      this.visitedRealms.set(targetRealmURL, client);
    }
    if (client === 'public') {
      return undefined;
    } else {
      if (!this.matrixClient.isLoggedIn()) {
        await this.matrixClient.login();
      }
      return await client.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
    }
  }

  resetToken(url: string) {
    let targetRealmURL = this.toRealmURL(url);
    if (targetRealmURL) {
      this.visitedRealms.delete(targetRealmURL);
    }
  }

  private toRealmURL(url: string): string | undefined {
    if (url.startsWith(this.realmURL)) {
      return this.realmURL;
    }
    for (let key of this.visitedRealms.keys()) {
      if (url.startsWith(key)) {
        return key;
      }
    }
    return undefined;
  }

  private async fetchRealmURL(
    url: string,
  ): Promise<{ realmURL: string; isPublic: boolean } | undefined> {
    let response = await this.loader.fetch(url, {
      method: 'HEAD',
    });
    let realmURL = response.headers.get('x-boxel-realm-url');
    if (!realmURL) {
      return undefined;
    }
    let isPublic = Boolean(
      response.headers.get('x-boxel-realm-public-readable'),
    );
    return { realmURL, isPublic };
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
