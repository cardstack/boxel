import type { MatrixClient } from './matrix-client.ts';
import { isMatrixServerName } from './matrix-server-name.ts';

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
  // Rejects with `SessionUserNotFoundError` for a Matrix user with no Boxel
  // account.
  ensureSessionRoom(user: string): Promise<string>;
}

// A Matrix user with no Boxel account on this realm server, which is made when
// they first sign in to Boxel. A session minted for
// them would carry no session room, so none is minted.
export class SessionUserNotFoundError extends Error {
  readonly user: string;
  constructor(user: string) {
    super(
      `${user} has no Boxel account on this realm server; sign in to Boxel as ${user} first`,
    );
    this.user = user;
  }
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
    let { access_token, matrix_server_name, lifetime } = json as {
      access_token?: string;
      matrix_server_name?: unknown;
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
    // The homeserver that issued the token, as a Matrix OpenID token response
    // names it. A client that sends none is a user of the paired homeserver.
    if (
      matrix_server_name != null &&
      (typeof matrix_server_name !== 'string' ||
        !isMatrixServerName(matrix_server_name))
    ) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`'matrix_server_name' must be a Matrix server name`],
        }),
      );
    }
    return await this.verifyToken(
      access_token,
      matrix_server_name ?? this.matrixClient.serverName,
      {
        extendedLifetime: lifetime === 'extended',
      },
    );
  }

  private async verifyToken(
    openIdToken: string,
    matrixServerName: string,
    opts?: { extendedLifetime?: boolean },
  ) {
    // Ask the issuing homeserver, through the federation endpoint, who the
    // token vouches for (ADR 004 §1.3).
    let user = await this.matrixClient.verifyOpenIdToken(
      openIdToken,
      matrixServerName,
    );
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
      try {
        roomId = await this.utils.ensureSessionRoom(user);
      } catch (e) {
        if (e instanceof SessionUserNotFoundError) {
          return this.utils.createResponse(
            JSON.stringify({ errors: [e.message] }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        throw e;
      }
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
