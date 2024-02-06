import { TokenClaims } from 'realm';
import { MatrixClient } from './matrix-client';

// iat - issued at (seconds since epoch)
// exp - expires at (seconds since epoch)
type JWTPayload = TokenClaims & { iat: number; exp: number };

export class RealmAuthClient {
  private realmURL: URL;
  private jwt: string | undefined;
  private matrixClient: MatrixClient;

  constructor(
    matrixUsername: string,
    matrixPassword: string,
    matrixURL: URL,
    realmURL: URL,
  ) {
    this.realmURL = realmURL;
    this.matrixClient = new MatrixClient(
      matrixURL,
      matrixUsername,
      matrixPassword,
    );
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
    await this.matrixClient.login();

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

    let rooms = (await this.matrixClient.getRooms()).joined_rooms;

    if (!rooms.includes(room)) {
      await this.matrixClient.joinRoom(room);
    }

    await this.matrixClient.sendRoomEvent(room, 'm.room.message', {
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
        user: this.matrixClient.userId,
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
        user: this.matrixClient.userId,
        challenge,
      }),
    });
  }
}
