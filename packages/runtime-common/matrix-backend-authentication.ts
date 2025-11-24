import type { MatrixClient } from './matrix-client';

export interface Utils {
  badRequest(message: string): Response;
  createResponse(
    body: BodyInit | null,
    responseInit: ResponseInit | undefined,
  ): Response;
  createJWT(user: string): Promise<string>;
}

export class MatrixBackendAuthentication {
  constructor(
    private matrixClient: MatrixClient,
    private utils: Utils,
  ) {}

  async createSession(request: Request): Promise<Response> {
    if (!(await this.matrixClient.isTokenValid())) {
      await this.matrixClient.login();
    }
    let accessToken: string;
    try {
      let json = await request.json();
      accessToken = json['access_token'];
    } catch (e) {
      return this.utils.badRequest(
        JSON.stringify({
          errors: [
            `Request body is not valid JSON or did not have access_token`,
          ],
        }),
      );
    }

    const user = await this.matrixClient.getUserIdFromOpenIdToken(accessToken);

    if (user) {
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
          errors: [`OpenID token not recognised on matrix server`],
        }),
        {
          status: 401,
        },
      );
    }
  }
}
