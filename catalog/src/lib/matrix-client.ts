import { Sha256 } from '@aws-crypto/sha256-js';

export interface MatrixAccess {
  accessToken: string;
  deviceId: string;
  userId: string;
}

export class MatrixClient {
  readonly matrixURL: URL;
  readonly username: string;
  private access: MatrixAccess | undefined;
  private password?: string;
  private seed?: string;
  private loginPromise: Promise<void> | undefined;

  constructor({
    matrixURL,
    username,
    password,
    seed,
  }: {
    matrixURL: URL;
    username: string;
    password?: string;
    seed?: string;
  }) {
    if (!password && !seed) {
      throw new Error(
        'Either password or a seed must be specified when creating a matrix client',
      );
    }
    this.matrixURL = matrixURL;
    this.username = username;
    this.password = password;
    this.seed = seed;
  }

  getUserId(): string | undefined {
    return this.access?.userId;
  }

  isLoggedIn(): boolean {
    return this.access !== undefined;
  }

  getAccessToken(): string | undefined {
    return this.access?.accessToken;
  }

  private async request(
    path: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET' = 'GET',
    options: RequestInit = {},
    includeAuth = true,
  ): Promise<Response> {
    options.method = method;

    if (includeAuth) {
      if (!this.access) {
        throw new Error('Missing matrix access token');
      }
      options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.access.accessToken}`,
      };
    }
    return fetch(`${this.matrixURL.href}${path}`, options);
  }

  async login(): Promise<void> {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = this.performLogin();
    return this.loginPromise;
  }

  private async performLogin(): Promise<void> {
    let password: string | undefined;
    if (this.password) {
      password = this.password;
    } else if (this.seed) {
      password = await passwordFromSeed(this.username, this.seed);
    } else {
      throw new Error(
        'bug: should never be here, we ensure password or seed exists in constructor',
      );
    }

    const response = await this.request(
      '_matrix/client/v3/login',
      'POST',
      {
        body: JSON.stringify({
          identifier: {
            type: 'm.id.user',
            user: this.username,
          },
          password,
          type: 'm.login.password',
        }),
      },
      false,
    );

    const json = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Unable to login to matrix ${this.matrixURL.href} as user ${this.username}: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }

    const {
      access_token: accessToken,
      device_id: deviceId,
      user_id: userId,
    } = json as { access_token: string; device_id: string; user_id: string };

    this.access = { accessToken, deviceId, userId };
  }

  async getJoinedRooms(): Promise<{ joined_rooms: string[] }> {
    const response = await this.request('_matrix/client/v3/joined_rooms');
    return (await response.json()) as { joined_rooms: string[] };
  }

  async joinRoom(roomId: string): Promise<void> {
    const response = await this.request(
      `_matrix/client/v3/rooms/${roomId}/join`,
      'POST',
    );
    if (!response.ok) {
      const json = await response.json();
      throw new Error(
        `Unable to join room ${roomId}: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
  }

  async getOpenIdToken(): Promise<{
    access_token: string;
    expires_in: number;
    matrix_server_name: string;
    token_type: string;
  } | undefined> {
    if (!this.access) {
      throw new Error('Must be logged in to get OpenID token');
    }
    const response = await this.request(
      `_matrix/client/v3/user/${encodeURIComponent(this.access.userId)}/openid/request_token`,
      'POST',
      { body: '{}' },
    );
    if (!response.ok) {
      return undefined;
    }
    return response.json() as Promise<{
      access_token: string;
      expires_in: number;
      matrix_server_name: string;
      token_type: string;
    }>;
  }
}

function uint8ArrayToHex(uint8: Uint8Array): string {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}

function getMatrixUsername(userId: string): string {
  return userId.replace(/^@/, '').replace(/:.*$/, '');
}

export async function passwordFromSeed(username: string, seed: string): Promise<string> {
  const hash = new Sha256();
  const cleanUsername = getMatrixUsername(username);
  hash.update(cleanUsername);
  hash.update(seed);
  return uint8ArrayToHex(await hash.digest());
}
