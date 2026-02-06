import type { MatrixClient } from './matrix-client.js';

export interface JWTPayload {
  iat: number;
  exp: number;
  user: string;
  realm: string;
  permissions: string[];
}

const MAX_ATTEMPTS = 3;
const BACK_OFF_MS = 1000;

export class RealmAuthClient {
  private _jwt: string | undefined;

  constructor(
    private realmURL: URL,
    private matrixClient: MatrixClient,
  ) {}

  get jwt(): string | undefined {
    return this._jwt;
  }

  async getJWT(): Promise<string> {
    const tokenRefreshLeadTimeSeconds = 60;

    if (!this._jwt) {
      this._jwt = await this.createRealmSession();
      return this._jwt;
    }

    // Check if token is about to expire
    const jwtData = JSON.parse(atob(this._jwt.split('.')[1])) as JWTPayload;
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (jwtData.exp - tokenRefreshLeadTimeSeconds < nowSeconds) {
      this._jwt = await this.createRealmSession();
      return this._jwt;
    }

    return this._jwt;
  }

  private async createRealmSession(): Promise<string> {
    if (!this.matrixClient.isLoggedIn()) {
      throw new Error(
        'Must be logged in to matrix before a realm session can be created',
      );
    }

    const initialResponse = await this.initiateSessionRequest();
    const jwt = initialResponse.headers.get('Authorization');

    if (!jwt) {
      throw new Error(
        "Expected 'Authorization' header in response to POST session but it was missing",
      );
    }

    // Parse JWT to get session room
    const [, payload] = jwt.split('.');
    const jwtBody = JSON.parse(atob(payload)) as { sessionRoom?: string };
    const { sessionRoom } = jwtBody;

    if (sessionRoom) {
      const { joined_rooms: rooms } = await this.matrixClient.getJoinedRooms();
      if (!rooms.includes(sessionRoom)) {
        await this.matrixClient.joinRoom(sessionRoom);
      }
    }

    return jwt;
  }

  private async initiateSessionRequest(): Promise<Response> {
    const userId = this.matrixClient.getUserId();
    if (!userId) {
      throw new Error('userId is undefined');
    }

    const openAccessToken = await this.matrixClient.getOpenIdToken();
    if (!openAccessToken) {
      throw new Error('Failed to fetch OpenID token from matrix');
    }

    return this.withRetries(() =>
      fetch(`${this.realmURL.href}_session`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: JSON.stringify(openAccessToken),
      }),
    );
  }

  private async withRetries(
    fetchFn: () => Promise<Response>,
  ): Promise<Response> {
    let attempt = 0;

    for (;;) {
      const response = await fetchFn();

      // Retry on 500 errors (realm may be temporarily unable to authenticate)
      if (response.status === 500 && ++attempt <= MAX_ATTEMPTS) {
        await this.delay(attempt * BACK_OFF_MS);
      } else {
        return response;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
