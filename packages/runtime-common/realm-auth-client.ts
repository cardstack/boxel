import { TokenClaims } from './realm';

// iat - issued at (seconds since epoch)
// exp - expires at (seconds since epoch)
export type JWTPayload = TokenClaims & { iat: number; exp: number };

// This auth client is intended to be used in both the host app and the realm node environment, where we use different matrix client implementations (in host we have the official matrix sdk
// and in realm we have a custom implementation). This interface is used to enforce compatibility between the two implementations for the mechanisms used for getting a JWT token from the realm server.
export interface RealmAuthMatrixClientInterface {
  isLoggedIn(): boolean;
  getUserId(): string | null | undefined;
  getJoinedRooms(): Promise<{ joined_rooms: string[] }>;
  joinRoom(room: string): Promise<any>;
  sendEvent(room: string, type: string, content: any): Promise<any>;
}

export class RealmAuthClient {
  private realmURL: URL;
  private jwt: string | undefined;
  private matrixClient: RealmAuthMatrixClientInterface;

  constructor(realmURL: URL, matrixClient: RealmAuthMatrixClientInterface) {
    this.matrixClient = matrixClient;
    this.realmURL = realmURL;
  }

  async getJWT() {
    let tokenRefreshLeadTimeSeconds = 60;
    let jwt: string;

    if (!this.jwt) {
      jwt = await this.createRealmSession();
      this.jwt = jwt;
      return jwt;
    } else {
      let jwtData = JSON.parse(atob(this.jwt.split('.')[1])) as JWTPayload;
      // If the token is about to expire (in tokenRefreshLeadTimeSeconds), create a new one just to make sure we reduce the risk of the token getting outdated during things happening in createRealmSession
      if (jwtData.exp - tokenRefreshLeadTimeSeconds < Date.now() / 1000) {
        jwt = await this.createRealmSession();
        this.jwt = jwt;
        return jwt;
      } else {
        return this.jwt;
      }
    }
  }

  private async createRealmSession() {
    if (!this.matrixClient.isLoggedIn) {
      throw new Error(
        `must be logged in to matrix before a realm session can be created`,
      );
    }

    let initialResponse = await this.initiateSessionRequest();

    if (initialResponse.status !== 401) {
      throw new Error(
        `unexpected response from POST ${this.realmURL.href}_session: ${
          initialResponse.status
        } - ${await initialResponse.text()}`,
      );
    }

    let initialJSON = (await initialResponse.json()) as {
      room: string;
      challenge: string;
    };

    let { room, challenge } = initialJSON;

    let { joined_rooms: rooms } = await this.matrixClient.getJoinedRooms();

    if (!rooms.includes(room)) {
      await this.matrixClient.joinRoom(room);
    }

    await this.matrixClient.sendEvent(room, 'm.room.message', {
      body: `auth-response: ${challenge}`,
      msgtype: 'm.text',
    });

    let challengeResponse = await this.challengeRequest(challenge);

    let jwt = challengeResponse.headers.get('Authorization');

    if (!jwt) {
      throw new Error(
        "expected 'Authorization' header in response to POST session but it was missing",
      );
    }

    return jwt;
  }

  private async initiateSessionRequest() {
    return fetch(`${this.realmURL.href}_session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: JSON.stringify({
        user: this.matrixClient.getUserId(),
      }),
    });
  }

  private async challengeRequest(challenge: string) {
    return fetch(`${this.realmURL.href}_session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: JSON.stringify({
        user: this.matrixClient.getUserId(),
        challenge,
      }),
    });
  }
}
