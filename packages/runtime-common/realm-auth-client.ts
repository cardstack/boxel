import { MatrixClient } from './matrix-client';

export class RealmAuthClient {
  private matrixUsername: string;
  private matrixPassword: string;
  private matrixURL: URL;
  private realmURL: URL;
  private rawJWT: string | undefined;

  constructor(
    matrixUsername: string,
    matrixPassword: string,
    matrixURL: URL,
    realmURL: URL,
  ) {
    this.matrixUsername = matrixUsername;
    this.matrixPassword = matrixPassword;
    this.matrixURL = matrixURL;
    this.realmURL = realmURL;
  }

  async getJWT() {
    let extraPeriodBeforeExpirySeconds = 60;
    let rawJWT: string;

    if (!this.rawJWT) {
      rawJWT = await this.createRealmSession();
      this.rawJWT = rawJWT;
      return rawJWT;
    } else {
      let jwtData = JSON.parse(atob(this.rawJWT.split('.')[1]));
      // If the token is about to expire in extraPeriodBeforeExpirySeconds, create a new one just to make sure we reduce the risk of outdated tokens
      if (jwtData.exp - extraPeriodBeforeExpirySeconds < Date.now() / 1000) {
        rawJWT = await this.createRealmSession();
        this.rawJWT = rawJWT;
        return rawJWT;
      } else {
        return this.rawJWT;
      }
    }
  }

  async createRealmSession() {
    let matrixClient = new MatrixClient(
      this.matrixURL,
      this.matrixUsername,
      this.matrixPassword,
    );

    await matrixClient.login();

    let initialResponse = await fetch(`${this.realmURL.href}_session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: JSON.stringify({
        user: matrixClient.userId,
      }),
    });

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

    let rooms = (await matrixClient.rooms()).joined_rooms;

    if (!rooms.includes(room)) {
      await matrixClient.joinRoom(room);
    }

    await matrixClient.sendRoomEvent(room, 'm.room.message', {
      body: `auth-response: ${challenge}`,
      msgtype: 'm.text',
    });

    let challengeResponse = await fetch(`${this.realmURL.href}_session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: JSON.stringify({
        user: matrixClient.userId,
        challenge,
      }),
    });

    let rawJWT = challengeResponse.headers.get('Authorization');

    if (!rawJWT) {
      throw new Error(
        "expected 'Authorization' header in response to POST session but it was missing",
      );
    }

    return rawJWT;
  }
}
