import type { MatrixClient } from './matrix-client.ts';

export interface Utils {
  badRequest(message: string): Response;
  createResponse(
    body: BodyInit | null,
    responseInit: ResponseInit | undefined,
  ): Response;
  // `extendedLifetime` is a request from the caller, not a guarantee. An
  // implementation that has no reason to hand out long-lived tokens ignores it
  // and mints its usual lifetime.
  createJWT(
    user: string,
    sessionRoom?: string,
    opts?: { extendedLifetime?: boolean },
  ): Promise<string>;
  ensureSessionRoom(user: string, registrationToken?: string): Promise<string>;
}

export class MatrixBackendAuthentication {
  private matrixClient: MatrixClient;
  private utils: Utils;
  constructor(matrixClient: MatrixClient, utils: Utils) {
    this.matrixClient = matrixClient;
    this.utils = utils;
  }

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
    let { access_token, registration_token, lifetime } = json as {
      access_token?: string;
      registration_token?: string;
      lifetime?: string;
    };
    if (!access_token) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`Request body missing 'access_token' property`],
        }),
      );
    }
    if (lifetime != null && lifetime !== 'extended') {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [
            `'lifetime' must be omitted or "extended" (got "${lifetime}")`,
          ],
        }),
      );
    }
    return await this.verifyToken(access_token, registration_token, {
      extendedLifetime: lifetime === 'extended',
    });
  }

  private async verifyToken(
    openIdToken: string,
    registrationToken?: string,
    opts?: { extendedLifetime?: boolean },
  ) {
    // Check openID token using the federation endpoint
    let user = await this.matrixClient.verifyOpenIdToken(openIdToken);
    if (!user) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`Unable to verify OpenID token`],
        }),
      );
    }
    let roomId;
    // Only create a session room if the user is different from the backend user
    // because we can't create DM rooms with ourselves
    // and these are used just for direct messaging.
    if (this.matrixClient.getUserId() !== user) {
      roomId = await this.utils.ensureSessionRoom(user, registrationToken);
    }

    let jwt = await this.utils.createJWT(user, roomId, opts);
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
