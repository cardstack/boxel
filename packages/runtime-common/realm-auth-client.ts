import { unixTime, delay } from './index';

function isBrowserTestEnv() {
  return typeof window !== 'undefined' && Boolean((globalThis as any).QUnit);
}
import type { TokenClaims } from './realm';

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
  hashMessageWithSecret(message: string): Promise<string>;
  getAccountDataFromServer(type: string): Promise<{ [k: string]: any } | null>;
  setAccountData(type: string, data: any): Promise<any>;
}

interface Options {
  authWithRealmServer?: true;
}

export class RealmAuthClient {
  private _jwt: string | undefined;
  private isRealmServerAuth: boolean;

  constructor(
    private realmURL: URL,
    private matrixClient: RealmAuthMatrixClientInterface,
    private fetch: typeof globalThis.fetch,
    options?: Options,
  ) {
    this.isRealmServerAuth = Boolean(options?.authWithRealmServer);
  }

  get jwt(): string | undefined {
    return this._jwt;
  }

  async getJWT() {
    let tokenRefreshLeadTimeSeconds = 60;
    let jwt: string;

    // the prerenderer relies solely on the JWT's in local storage
    if ((globalThis as any).__boxelRenderContext) {
      let sessionStr = globalThis.localStorage.getItem('boxel-session') ?? '{}';
      let session: { [realmURL: string]: string } = JSON.parse(sessionStr);
      let jwt = session[this.realmURL.href];
      if (!jwt) {
        if (isBrowserTestEnv()) {
          jwt = await this.createRealmSession();
          session[this.realmURL.href] = jwt;
          globalThis.localStorage.setItem(
            'boxel-session',
            JSON.stringify(session),
          );
        } else {
          throw new Error(
            `Error: Prerenderer did not set a JWT for realm ${this.realmURL.href}`,
          );
        }
      }
      this._jwt = jwt;
      return jwt;
    }

    if (!this._jwt) {
      jwt = await this.createRealmSession();
      this._jwt = jwt;
      return jwt;
    } else {
      let jwtData = JSON.parse(atob(this._jwt.split('.')[1])) as JWTPayload;
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

  private get sessionEndpoint() {
    return this.isRealmServerAuth ? '_server-session' : '_session';
  }

  private async createRealmSession() {
    if (!this.matrixClient.isLoggedIn()) {
      throw new Error(
        `must be logged in to matrix before a realm session can be created`,
      );
    }

    let initialResponse = await this.initiateSessionRequest();

    if (initialResponse.status !== 401) {
      throw new Error(
        `unexpected response from POST ${this.realmURL.href}${
          this.sessionEndpoint
        }: ${initialResponse.status} - ${await initialResponse.text()}`,
      );
    }

    let initialJSON = (await initialResponse.json()) as {
      room?: string;
      challenge: string;
    };

    let { room, challenge } = initialJSON;
    let challengeResponse: Response;
    if (!room) {
      // if the realm did not invite us to a room that means that the realm user
      // is the same as our user and that we hash the challenge with our realm
      // password
      challengeResponse = await this.challengeRequest(
        challenge,
        await this.matrixClient.hashMessageWithSecret(challenge),
      );
    } else {
      let { joined_rooms: rooms } = await this.matrixClient.getJoinedRooms();

      if (!rooms.includes(room)) {
        await joinDMRoom(this.matrixClient, room);
      }

      await this.matrixClient.sendEvent(room, 'm.room.message', {
        body: `auth-response: ${challenge}`,
        msgtype: 'm.text',
      });
      challengeResponse = await this.challengeRequest(challenge);
    }
    if (!challengeResponse.ok) {
      throw new Error(
        `unsuccessful HTTP status in response to POST session: ${
          challengeResponse.status
        }: ${await challengeResponse.text()}`,
      );
    }

    let jwt = challengeResponse.headers.get('Authorization');

    if (!jwt) {
      throw new Error(
        "expected 'Authorization' header in response to POST session but it was missing",
      );
    }

    return jwt;
  }

  private async initiateSessionRequest() {
    let userId = this.matrixClient.getUserId();
    if (!userId) {
      throw new Error('userId is undefined');
    }
    return this.withRetries(() =>
      this.fetch(`${this.realmURL.href}${this.sessionEndpoint}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: JSON.stringify({
          user: userId,
        }),
      }),
    );
  }

  private async challengeRequest(
    challenge: string,
    challengeResponse?: string,
  ) {
    return this.withRetries(() =>
      this.fetch(`${this.realmURL.href}${this.sessionEndpoint}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: JSON.stringify({
          user: this.matrixClient.getUserId(),
          challenge,
          ...(challengeResponse ? { challengeResponse } : {}),
        }),
      }),
    );
  }

  private async withRetries(
    fetchFn: () => ReturnType<typeof globalThis.fetch>,
  ) {
    let attempt = 0;
    for (;;) {
      let response = await fetchFn();
      // we believe that realm is sometimes unable to login to matrix in CI
      // which results in failed auth requests because the realm doesn't know
      // who it is. in these cases the realm responds with a 500 error, so we try again...
      if (response.status === 500 && ++attempt <= maxAttempts) {
        await delay(attempt * backOffMs);
      } else {
        return response;
      }
    }
  }
}

const maxAttempts = 5;
const backOffMs = 100;

export async function joinDMRoom(
  matrixClient: RealmAuthMatrixClientInterface,
  roomId: string,
) {
  await matrixClient.joinRoom(roomId);

  /* In sliding sync, we distinguish between AI rooms and auth rooms (session rooms) based on whether a room is a DM or not.
   * Unfortunately, the is_dm flag we set when creating a room isn’t enough to make that filter work — we also need to add
   * the room to the m.direct account data so it can be identified as a DM room.
   */
  let directRooms = await matrixClient.getAccountDataFromServer('m.direct');
  let userId = matrixClient.getUserId() as string;
  if (!directRooms?.[userId]?.includes(roomId)) {
    await matrixClient.setAccountData('m.direct', {
      [userId]: [...(directRooms?.[userId] ?? []), roomId],
    });
  }
}
