import type { MatrixClient } from './matrix-client';

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
    let { access_token } = json as {
      access_token?: string;
    };
    if (!access_token) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [`Request body missing 'access_token' property`],
        }),
      );
    }
    return await this.verifyToken(access_token);
  }

  private async verifyToken(openIdToken: string) {
    // Check openID token using the federation endpoint
    let user = await this.matrixClient.verifyOpenIdToken(openIdToken);
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
