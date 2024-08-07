import { Sha256 } from "@aws-crypto/sha256-js";
import { MatrixClient, waitForMatrixMessage } from "./matrix-client";
import { v4 as uuidv4 } from 'uuid';

export interface Utils {
  badRequest(message: string): Response;
  createResponse(body: BodyInit | null, responseInit: ResponseInit | undefined): Response;
  createJWT(user: string): Promise<string>;
}

export class RealmAuthServer {

  constructor(
    private matrixClient: MatrixClient,
    private secretSeed: string,
    private utils: Utils,
  ) {}

  async createSession(request: Request): Promise<Response> {
    if (!(await this.matrixClient.isTokenValid())) {
      await this.matrixClient.login();
    }
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return this.utils.badRequest(
        JSON.stringify({ errors: [`Request body is not valid JSON`] })
      );
    }
    let { user, challenge } = json as { user?: string; challenge?: string };
    if (!user) {
      return this.utils.badRequest(
        JSON.stringify({ errors: [`Request body missing 'user' property`] })
      );
    }

    if (challenge) {
      return await this.verifyChallenge(user);
    } else {
      return await this.createChallenge(user);
    }
  }

  private async createChallenge(user: string) {
    let dmRooms =
      (await this.matrixClient.getAccountData<Record<string, string>>(
        'boxel.session-rooms',
      )) ?? {};
    let roomId = dmRooms[user];
    if (!roomId) {
      roomId = await this.matrixClient.createDM(user);
      dmRooms[user] = roomId;
      await this.matrixClient.setAccountData('boxel.session-rooms', dmRooms);
    }

    let challenge = uuidv4();
    let hash = new Sha256();
    hash.update(challenge);
    hash.update(this.secretSeed);
    let hashedChallenge = uint8ArrayToHex(await hash.digest());
    await this.matrixClient.sendEvent(roomId, 'm.room.message', {
      body: `auth-challenge: ${hashedChallenge}`,
      msgtype: 'm.text',
    });

    return this.utils.createResponse(
      JSON.stringify({
        room: roomId,
        challenge,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      });
  }

  private async verifyChallenge(user: string) {
    let dmRooms =
      (await this.matrixClient.getAccountData<Record<string, string>>(
        'boxel.session-rooms',
      )) ?? {};
    let roomId = dmRooms[user];
    if (!roomId) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`No challenge previously issued for user ${user}`],
        }),
      );
    }

    // The messages look like this:
    // --- Matrix Room Messages ---:
    // realm1
    // auth-challenge: 7cb8f904a2a53d256687c2aeb374a686a26cfd66af5fcc09a366d49644a3e2ba
    // realm2
    // auth-response: 342c5854-e716-4bda-9b31-eba83d24e25d
    // ----------------------------

    // This is a best-effort type of implementation - we don't know when the messages will appear in the room so we just wait for a bit.
    // This is not a problem when the realms are on the same matrix server but when they are on different (federated) servers the latencies and
    // race conditions can cause delays in the messages appearing in the room.
    let oneMinuteAgo = Date.now() - 60000;

    let latestAuthChallengeMessage = await waitForMatrixMessage(
      this.matrixClient,
      roomId,
      (m) => {
        return (
          m.type === 'm.room.message' &&
          m.sender === this.matrixClient.getUserId() &&
          m.content.body.startsWith('auth-challenge:') &&
          m.origin_server_ts > oneMinuteAgo
        );
      },
    );

    let latestAuthResponseMessage = await waitForMatrixMessage(
      this.matrixClient,
      roomId,
      (m) => {
        return (
          m.type === 'm.room.message' &&
          m.sender === user &&
          m.content.body.startsWith('auth-response:') &&
          m.origin_server_ts > oneMinuteAgo
        );
      },
    );

    if (!latestAuthChallengeMessage) {
      return this.utils.badRequest(
        JSON.stringify({ errors: [`No challenge found for user ${user}`] })
      );
    }

    if (!latestAuthResponseMessage) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`No challenge response response found for user ${user}`],
        })
      );
    }

    let challenge = latestAuthChallengeMessage.content.body.replace(
      'auth-challenge: ',
      '',
    );
    let response = latestAuthResponseMessage.content.body.replace(
      'auth-response: ',
      '',
    );
    let hash = new Sha256();
    hash.update(response);
    hash.update(this.secretSeed);
    let hashedResponse = uint8ArrayToHex(await hash.digest());
    if (hashedResponse === challenge) {
      let jwt = await this.utils.createJWT(
        user
      );
      return this.utils.createResponse(null, {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          Authorization: jwt,
        },
      });
    } else {
      return this.utils.createResponse(JSON.stringify({
          errors: [
            `user ${user} failed auth challenge: latest challenge message: "${JSON.stringify(
              latestAuthChallengeMessage,
            )}", latest response message: "${JSON.stringify(
              latestAuthResponseMessage,
            )}"`,
          ],
        }),
        {
          status: 401,
        });
    }
  }
}

function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}
