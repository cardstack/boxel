import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';

export class RealmAuthDataSource {
  // Cached realm info and session to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmAuthClient>();
  private matrixClient: MatrixClient;
  private getFetch: () => typeof globalThis.fetch;
  realmURL: string;

  constructor(
    matrixClient: MatrixClient,
    // we want our fetch to be lazily obtained as it might be the very fetch
    // that is composed by middleware containing this data source instance
    getFetch: () => typeof globalThis.fetch,
    realmURL: string,
  ) {
    this.matrixClient = matrixClient;
    this.getFetch = getFetch;
    this.realmURL = realmURL;
  }

  token(url: string): string | undefined {
    let targetRealmURL = this.toRealmURL(url);
    if (!targetRealmURL) {
      return undefined;
    }
    if (targetRealmURL === this.realmURL) {
      return undefined;
    }
    let client = this.visitedRealms.get(targetRealmURL);
    if (!client) {
      return undefined;
    }
    if (!this.matrixClient.isLoggedIn()) {
      return undefined;
    }
    return client.jwt;
  }

  async reauthenticate(targetRealmURL: string): Promise<string | undefined> {
    this.visitedRealms.delete(targetRealmURL);
    let client = this.createRealmAuthClient(
      new URL(targetRealmURL),
      this.matrixClient,
      this.getFetch(),
    );
    this.visitedRealms.set(targetRealmURL, client);

    if (!this.matrixClient.isLoggedIn()) {
      await this.matrixClient.login();
    }
    return await client.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
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

  // A separate method for realm auth client creation to support mocking in tests
  private createRealmAuthClient(
    targetRealmURL: URL,
    matrixClient: MatrixClient,
    fetch: typeof globalThis.fetch,
  ) {
    return new RealmAuthClient(targetRealmURL, matrixClient, fetch);
  }
}
