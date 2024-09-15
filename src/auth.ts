function unixTime(epochTimeMs: number) {
  return Math.floor(epochTimeMs / 1000);
}

interface TokenClaims {
  user: string;
  realm: string;
  permissions: ("read" | "write")[];
}

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
  private _jwt: string | undefined;

  constructor(
    private realmURL: URL,
    private matrixClient: RealmAuthMatrixClientInterface,
    private fetch: typeof globalThis.fetch
  ) {}

  get jwt(): string | undefined {
    return this._jwt;
  }

  async getJWT() {
    let tokenRefreshLeadTimeSeconds = 60;
    let jwt: string;

    if (!this._jwt) {
      console.log("Creating realm session");
      jwt = await this.createRealmSession();
      this._jwt = jwt;

      let jwtData = JSON.parse(atob(this._jwt.split(".")[1])) as JWTPayload;
      console.log("JWT created", jwt);
      console.log(
        "JWT expires at",
        jwtData.exp,
        "which is this far away: ",
        jwtData.exp - unixTime(Date.now()),
        "which is ",
        (jwtData.exp - unixTime(Date.now())) / 60,
        "minutes"
      );
      return jwt;
    } else {
      let jwtData = JSON.parse(atob(this._jwt.split(".")[1])) as JWTPayload;
      // If the token is about to expire (in tokenRefreshLeadTimeSeconds), create a new one just to make sure we reduce the risk of the token getting outdated during things happening in createRealmSession
      if (jwtData.exp - tokenRefreshLeadTimeSeconds < unixTime(Date.now())) {
        jwt = await this.createRealmSession();
        this._jwt = jwt;
        return jwt;
      } else {
        return this._jwt;
      }
    }
  }

  private async createRealmSession() {
    if (!this.matrixClient.isLoggedIn()) {
      throw new Error(
        `must be logged in to matrix before a realm session can be created`
      );
    }

    console.log("Initiating session request");
    let initialResponse = await this.initiateSessionRequest();

    if (initialResponse.status !== 401) {
      throw new Error(
        `unexpected response from POST ${this.realmURL.href}_session: ${
          initialResponse.status
        } - ${await initialResponse.text()}`
      );
    }

    console.log("Parsing initial response");
    let initialJSON = (await initialResponse.json()) as {
      room: string;
      challenge: string;
    };

    console.log("Getting joined rooms");
    let { room, challenge } = initialJSON;

    console.log("Getting joined rooms");
    let { joined_rooms: rooms } = await this.matrixClient.getJoinedRooms();

    if (!rooms.includes(room)) {
      await this.matrixClient.joinRoom(room);
    }

    console.log("Sending event");
    await this.matrixClient.sendEvent(room, "m.room.message", {
      body: `auth-response: ${challenge}`,
      msgtype: "m.text",
    });

    console.log("Requesting challenge response");
    let challengeResponse = await this.challengeRequest(challenge);

    let jwt = challengeResponse.headers.get("Authorization");
    console.log("Parsing challenge response");
    if (!jwt) {
      throw new Error(
        "expected 'Authorization' header in response to POST session but it was missing"
      );
    }

    return jwt;
  }

  private async initiateSessionRequest() {
    let userId = this.matrixClient.getUserId();
    if (!userId) {
      throw new Error("userId is undefined");
    }
    console.log(
      "Initiating session request -",
      `${this.realmURL.href}_session`
    );
    return this.fetch(`${this.realmURL.href}_session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: JSON.stringify({
        user: userId,
      }),
    });
  }

  private async challengeRequest(challenge: string) {
    return this.fetch(`${this.realmURL.href}_session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: JSON.stringify({
        user: this.matrixClient.getUserId(),
        challenge,
      }),
    });
  }
}
