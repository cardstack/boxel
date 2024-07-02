import { MatrixClient } from './matrix-client';
import { RealmAuthClient } from './realm-auth-client';

export class RealmAuthDataSource {
  // Cached realm info and session to avoid fetching it multiple times for the same realm
  private visitedRealms = new Map<string, RealmAuthClient>();
  private matrixClient: MatrixClient;
  private fetch: typeof globalThis.fetch;
  realmURL: string;

  constructor(
    matrixClient: MatrixClient,
    fetch: typeof globalThis.fetch,
    realmURL: string,
  ) {
    this.matrixClient = matrixClient;
    this.fetch = fetch;
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
    if (targetRealmURL === this.realmURL) {
      throw new Error(
        `bug: did not expect to ever be asked to log into myself`,
      );
    }

    this.visitedRealms.delete(targetRealmURL);
    let client = this.createRealmAuthClient(
      new URL(targetRealmURL),
      this.matrixClient,
      this.fetch,
    );
    this.visitedRealms.set(targetRealmURL, client);

    if (!this.matrixClient.isLoggedIn()) {
      await this.matrixClient.login();
    }
    return await client.getJWT(); // This will use a cached JWT from the realm auth client or create a new one if it's expired or about to expire
  }

  async ensureRealmMeta(_realmURL: string): Promise<void> {
    // no-op
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
