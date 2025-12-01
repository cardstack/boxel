import { Sha256 } from '@aws-crypto/sha256-js';
import type { MatrixClient } from './matrix-client';
import { waitForMatrixMessage } from './matrix-client';
import { v4 as uuidv4 } from 'uuid';
import type { MessageEvent } from 'https://cardstack.com/base/matrix-event';

export interface Utils {
  badRequest(message: string): Response;
  createResponse(
    body: BodyInit | null,
    responseInit: ResponseInit | undefined,
  ): Response;
  createJWT(user: string, sessionRoom?: string): Promise<string>;
  ensureSessionRoom(user: string): Promise<string>;
}

export class MatrixBackendAuthentication {
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
        JSON.stringify({ errors: [`Request body is not valid JSON`] }),
      );
    }
    let { user, challenge, challengeResponse } = json as {
      user?: string;
      challenge?: string;
      challengeResponse?: string;
    };
    if (!user) {
      return this.utils.badRequest(
        JSON.stringify({ errors: [`Request body missing 'user' property`] }),
      );
    }
    return await this.verifyChallenge(user, challenge, challengeResponse);
  }

  private async verifyChallenge(
    user: string,
    challenge: string,
    challengeResponse?: string,
  ) {
    if (user === this.matrixClient.getUserId() && challengeResponse) {
      let successfulChallengeResponse =
        await this.matrixClient.hashMessageWithSecret(challenge);
      if (challengeResponse === successfulChallengeResponse) {
        let jwt = await this.utils.createJWT(user);
        return this.utils.createResponse(null, {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            Authorization: jwt,
            'Access-Control-Expose-Headers': 'Authorization',
          },
        });
      } else {
        return this.utils.createResponse(
          JSON.stringify({
            errors: [`user ${user} failed auth challenge`],
          }),
          {
            status: 401,
          },
        );
      }
    }

    let roomId = await this.utils.ensureSessionRoom(user);

    let jwt = await this.utils.createJWT(user, roomId);
    return this.utils.createResponse(null, {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        Authorization: jwt,
        'Access-Control-Expose-Headers': 'Authorization',
      },
    });
  }
}

function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}
